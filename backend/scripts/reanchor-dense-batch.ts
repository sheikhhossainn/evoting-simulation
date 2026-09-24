/**
 * reanchor-dense-batch.ts — one-time re-anchor of the pre-redeploy dense
 * batch onto the new MerkleRootStorage contract.
 *
 * The contract redeploy (SMT §12 additions) reset batchCount to 0 on-chain.
 * The old merkle_batches row (batch_id=1, 32 votes, old contract) is stale —
 * verify() against it now targets a contract that never anchored it. This
 * script rebuilds the SAME 32 votes' dense tree, anchors it fresh on the new
 * contract, replaces the stale row, and updates those votes' tx_hash.
 *
 * Deliberately does NOT touch the SMT (backend/src/services/anchorSmtBatch.ts)
 * — those 32 keys are already correctly backfilled there (backfill-smt.ts);
 * re-running the dense anchor must not double-count them as "new" SMT keys.
 *
 * Run: npx ts-node scripts/reanchor-dense-batch.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true } as any);

import { supabase } from "../src/supabaseClient";
import { buildMerkleTree, hashVoteLeaf } from "../src/merkle/merkleTree";
import { getWritableMerkleContract } from "../src/blockchain/merkleContract";

interface VoteRow {
  id: string;
  encrypted_vote: { c1: string; c2: string };
  created_at: string;
}

const STALE_BATCH_ID = 1;

async function main() {
  const contract = getWritableMerkleContract();
  if (!contract) throw new Error("Anchoring not configured");

  const { data: staleBatch, error: staleErr } = await supabase
    .from("merkle_batches")
    .select("batch_id, vote_ids, vote_count, tx_hash")
    .eq("batch_id", STALE_BATCH_ID)
    .maybeSingle();
  if (staleErr) throw staleErr;
  if (!staleBatch) {
    console.log(`No stale batch_id=${STALE_BATCH_ID} row found — nothing to do.`);
    return;
  }

  const voteIds: string[] = staleBatch.vote_ids;
  console.log(`Stale batch_id=${STALE_BATCH_ID}: ${voteIds.length} votes, old tx_hash=${staleBatch.tx_hash}`);

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, encrypted_vote, created_at")
    .in("id", voteIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!votes || votes.length !== voteIds.length) {
    throw new Error(
      `Expected ${voteIds.length} live vote rows, found ${votes?.length ?? 0} — refusing to proceed`
    );
  }

  const voteRows = votes as VoteRow[];
  const leaves = voteRows.map((v) =>
    hashVoteLeaf({ voteId: v.id, c1: v.encrypted_vote.c1, c2: v.encrypted_vote.c2, createdAt: v.created_at })
  );
  const tree = buildMerkleTree(leaves);

  const tx = await contract.anchorRoot(tree.root, voteRows.length);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: any) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "BatchAnchored");
  if (!event) throw new Error("Could not parse batchId from receipt");
  const newBatchId = Number(event.args.batchId);
  console.log(`Anchored fresh on new contract: batchId=${newBatchId}, root=${tree.root}, tx=${tx.hash}`);

  const { error: deleteErr } = await supabase
    .from("merkle_batches")
    .delete()
    .eq("batch_id", STALE_BATCH_ID);
  if (deleteErr) throw deleteErr;
  console.log(`Deleted stale batch_id=${STALE_BATCH_ID} row.`);

  const newVoteIds = voteRows.map((v) => v.id);
  const { error: insertErr } = await supabase.from("merkle_batches").insert({
    batch_id: newBatchId,
    root: tree.root,
    tx_hash: tx.hash,
    vote_ids: newVoteIds,
    vote_count: newVoteIds.length,
  });
  if (insertErr) throw insertErr;
  console.log(`Inserted new merkle_batches row: batch_id=${newBatchId}`);

  const { error: updateErr } = await supabase
    .from("votes")
    .update({ tx_hash: tx.hash })
    .in("id", newVoteIds);
  if (updateErr) throw updateErr;
  console.log(`Updated tx_hash for ${newVoteIds.length} votes.`);

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

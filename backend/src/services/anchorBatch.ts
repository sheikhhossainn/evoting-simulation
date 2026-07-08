/**
 * anchorBatch.ts — Core batch-anchoring logic
 *
 * Shared by the manual admin route (POST /anchor/batch in
 * routes/anchor.ts) and the automatic every-50-votes trigger called
 * from routes/vote.ts after each successful vote. Kept here, not in
 * routes/anchor.ts, so vote.ts doesn't have to import another route
 * file to reuse it.
 */

import { supabase } from "../supabaseClient";
import { buildMerkleTree, hashVoteLeaf } from "../merkle/merkleTree";
import { getWritableMerkleContract } from "../blockchain/merkleContract";

/** Auto-anchor triggers once this many votes are waiting, unanchored. */
export const AUTO_ANCHOR_THRESHOLD = 50;

interface VoteRow {
  id: string;
  encrypted_vote: { c1: string; c2: string };
  created_at: string;
}

export interface AnchorBatchResult {
  batch_id: number;
  root: string;
  tx_hash: string;
  vote_count: number;
}

/**
 * Anchor all currently-unanchored votes (tx_hash IS NULL) as one batch.
 * Returns null if anchoring isn't configured or there's nothing to
 * anchor — both are normal, expected states for the auto-trigger to see
 * on most vote casts, not errors.
 */
export async function runAnchorBatch(): Promise<AnchorBatchResult | null> {
  const contract = getWritableMerkleContract();
  if (!contract) return null;

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, encrypted_vote, created_at")
    .is("tx_hash", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!votes || votes.length === 0) return null;

  const voteRows = votes as VoteRow[];
  const voteIds = voteRows.map((v) => v.id);
  const leaves = voteRows.map((v) =>
    hashVoteLeaf({
      voteId: v.id,
      c1: v.encrypted_vote.c1,
      c2: v.encrypted_vote.c2,
      createdAt: v.created_at,
    })
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

  if (!event) {
    throw new Error(
      "Anchored on-chain but could not parse batchId from the receipt"
    );
  }

  const batchId = Number(event.args.batchId);

  const { error: batchInsertError } = await supabase
    .from("merkle_batches")
    .insert({
      batch_id: batchId,
      root: tree.root,
      tx_hash: tx.hash,
      vote_ids: voteIds,
      vote_count: voteRows.length,
    });

  if (batchInsertError) {
    // The anchor tx already landed on-chain; log loudly but don't
    // pretend to roll it back — chain state is the source of truth.
    console.error(
      "Supabase error inserting merkle_batches row (chain anchor already committed!):",
      batchInsertError
    );
  }

  const { error: updateError } = await supabase
    .from("votes")
    .update({ tx_hash: tx.hash, status: "confirmed" })
    .in("id", voteIds);

  if (updateError) {
    console.error("Supabase error updating anchored votes:", updateError);
  }

  return {
    batch_id: batchId,
    root: tree.root,
    tx_hash: tx.hash,
    vote_count: voteRows.length,
  };
}

// Simple in-process guard against overlapping auto-anchor runs. This is a
// single-instance Express app; if this ever scales horizontally, replace
// with a DB-level advisory lock instead.
let autoAnchorInFlight = false;

/**
 * Check whether unanchored votes have crossed AUTO_ANCHOR_THRESHOLD and,
 * if so, kick off a batch anchor. Called fire-and-forget after each vote
 * is cast — never throws, never blocks/delays the voter's response.
 */
export async function maybeAutoAnchor(): Promise<void> {
  if (autoAnchorInFlight) return;

  try {
    const { count, error } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .is("tx_hash", null);

    if (error || !count || count < AUTO_ANCHOR_THRESHOLD) return;

    autoAnchorInFlight = true;
    console.log(
      `Auto-anchor: ${count} unanchored votes >= ${AUTO_ANCHOR_THRESHOLD}, anchoring batch...`
    );

    const result = await runAnchorBatch();

    if (result) {
      console.log(
        `Auto-anchor: batch ${result.batch_id} anchored (tx ${result.tx_hash}, ${result.vote_count} votes)`
      );
    }
  } catch (err) {
    console.error("Auto-anchor failed:", err);
  } finally {
    autoAnchorInFlight = false;
  }
}

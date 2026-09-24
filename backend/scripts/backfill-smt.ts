/**
 * backfill-smt.ts — one-time SMT backfill (docs/smt-design.md §13 test 21).
 *
 * The SMT contract was just redeployed (fresh, empty tree). This anchors
 * every existing confirmed vote (tx_hash IS NOT NULL, i.e. already anchored
 * in the dense tree) into the SMT in a single batch, then independently
 * cross-checks totalKeysAnchored against a direct DB count.
 *
 * Run: npx ts-node scripts/backfill-smt.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true } as any);

import { supabase } from "../src/supabaseClient";
import { runAnchorSmtBatch } from "../src/services/anchorSmtBatch";
import { getWritableMerkleContract } from "../src/blockchain/merkleContract";

async function main() {
  if (!getWritableMerkleContract()) {
    throw new Error(
      "Anchoring not configured — set AMOY_RPC_URL, MERKLE_CONTRACT_ADDRESS, ANCHOR_PRIVATE_KEY"
    );
  }

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash, encrypted_vote, created_at")
    .not("tx_hash", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  const confirmedCount = (votes ?? []).length;
  console.log(`Confirmed (already dense-anchored) votes in DB: ${confirmedCount}`);

  if (confirmedCount === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const { data: existingSmtBatches } = await supabase
    .from("smt_batches")
    .select("smt_batch_id")
    .limit(1);
  if (existingSmtBatches && existingSmtBatches.length > 0) {
    throw new Error(
      "smt_batches already has rows — this script is for the one-time initial backfill only. Refusing to run again."
    );
  }

  const result = await runAnchorSmtBatch(votes as any);
  if (!result) {
    throw new Error("runAnchorSmtBatch returned null unexpectedly");
  }

  console.log("Backfill anchored:", result);

  if (result.total_keys_anchored !== confirmedCount) {
    throw new Error(
      `Cross-check FAILED: totalKeysAnchored=${result.total_keys_anchored} but direct DB count=${confirmedCount}`
    );
  }
  console.log(
    `Cross-check OK: totalKeysAnchored (${result.total_keys_anchored}) === confirmed vote count (${confirmedCount})`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

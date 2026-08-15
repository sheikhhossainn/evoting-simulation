/**
 * reset-anchors.ts — One-off recovery after contract redeploy
 *
 * The Merkle contract was redeployed (leaked ANCHOR_PRIVATE_KEY), so the
 * new contract's batch_ids restart at 0. Stale merkle_batches rows from
 * the abandoned old contract collide on batch_id, blocking new inserts.
 *
 * This clears merkle_batches and resets every vote back to unanchored
 * (tx_hash NULL, status 'queued') so a fresh anchor batch lands cleanly.
 * Seeded/mock data only — safe to wipe.
 *
 * Run: npx ts-node src/scripts/reset-anchors.ts
 */

import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// Multi-election isolation (threat_model.md §10): scoped to ONE election's
// batches/votes — a redeployed contract only invalidates that election's
// batch_id counter (each election has its own, per MerkleRootStorage.sol's
// mapping(string => uint256) batchCount), so this must never touch other
// elections' already-valid anchored data.
const ELECTION_ID = process.env.CEREMONY_ELECTION_ID || "NATIONAL-2026-001";

async function main() {
  console.log(`Resetting anchors for election ${ELECTION_ID} only.\n`);

  // 1. Delete this election's merkle_batches rows (old-contract batch_ids).
  const { error: delErr, count: delCount } = await supabase
    .from("merkle_batches")
    .delete({ count: "exact" })
    .eq("election_id", ELECTION_ID)
    .gte("batch_id", 0);
  if (delErr) throw delErr;
  console.log(`🗑️  Deleted ${delCount ?? "?"} merkle_batches row(s)`);

  // 2. Reset this election's anchored votes back to unanchored.
  const { error: updErr, count: updCount } = await supabase
    .from("votes")
    .update(
      { tx_hash: null, status: "queued" },
      { count: "exact" }
    )
    .eq("election_id", ELECTION_ID)
    .not("tx_hash", "is", null);
  if (updErr) throw updErr;
  console.log(`♻️  Reset ${updCount ?? "?"} vote(s) to unanchored`);

  console.log("✅ Reset complete — ready for a fresh anchor batch");
}

main().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});

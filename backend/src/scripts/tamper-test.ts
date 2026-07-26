/**
 * tamper-test.ts — Adversarial tamper-detection check for the anchoring flow
 *
 * Run: npx ts-node src/scripts/tamper-test.ts <anchoredVoteId>
 *
 * Proves the on-chain anchor detects DB tampering. Two vectors:
 *
 *   1. merkle_batches.root  — no DB trigger guards this column, so the edit
 *      SUCCEEDS at the DB level. GET /anchor/verify/:id must then return 409
 *      because the recomputed root no longer matches the anchored one.
 *      The original root is restored automatically afterwards.
 *
 *   2. votes.encrypted_vote — the schema's fn_votes_immutable_guard trigger
 *      must REJECT this edit outright (defense-in-depth: a tamperer can't
 *      even change the ballot to begin with).
 *
 * Safe to run against the test env: vector 1 is restored; vector 2 never
 * commits (the trigger raises).
 */

import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = process.env.BASE_URL || "http://localhost:3000";

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function verify(voteId: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/anchor/verify/${voteId}`);
  return { status: res.status, body: await res.json() };
}

/** Flip one hex nibble of a 0x-prefixed hash so it stays valid hex but differs. */
function flipOneNibble(hash: string): string {
  const chars = hash.split("");
  const i = hash.length - 1;
  chars[i] = chars[i] === "0" ? "1" : "0";
  return chars.join("");
}

async function main() {
  const voteId = process.argv[2];
  if (!voteId) {
    console.error("Usage: npx ts-node src/scripts/tamper-test.ts <anchoredVoteId>");
    process.exit(1);
  }

  console.log("\n🕵️  Tamper-detection test\n");

  // Locate the batch this vote belongs to.
  const { data: batch, error } = await supabase
    .from("merkle_batches")
    .select("batch_id, root, vote_ids")
    .contains("vote_ids", JSON.stringify([voteId]))
    .maybeSingle();

  if (error || !batch) {
    console.error("❌ Could not find an anchored batch for that vote:", error);
    process.exit(1);
  }

  const originalRoot: string = batch.root;
  console.log(`Vote ${voteId} is in batch ${batch.batch_id}`);
  console.log(`Anchored root: ${originalRoot}\n`);

  // ── Baseline: verify passes before any tampering ──
  const before = await verify(voteId);
  console.log(
    `[baseline] verify → HTTP ${before.status}, ` +
      `included_locally=${before.body.included_locally}, ` +
      `included_on_chain=${before.body.included_on_chain}`
  );
  if (before.status !== 200) {
    console.error("❌ Baseline verify did not return 200 — aborting before tampering.");
    process.exit(1);
  }

  // ── Vector 1: tamper merkle_batches.root (no trigger guards it) ──
  const tamperedRoot = flipOneNibble(originalRoot);
  console.log(`\n[vector 1] Tampering merkle_batches.root → ${tamperedRoot}`);

  const { error: updErr } = await supabase
    .from("merkle_batches")
    .update({ root: tamperedRoot })
    .eq("batch_id", batch.batch_id);

  if (updErr) {
    console.error("❌ Could not tamper root (unexpected):", updErr);
    process.exit(1);
  }

  let vector1Pass = false;
  try {
    const after = await verify(voteId);
    console.log(`[vector 1] verify → HTTP ${after.status}: ${JSON.stringify(after.body)}`);
    vector1Pass = after.status === 409;
  } finally {
    // Always restore, even if the assertion throws.
    const { error: restoreErr } = await supabase
      .from("merkle_batches")
      .update({ root: originalRoot })
      .eq("batch_id", batch.batch_id);
    if (restoreErr) {
      console.error("⚠️  FAILED TO RESTORE ROOT — restore manually to:", originalRoot);
    } else {
      console.log(`[vector 1] Restored root to ${originalRoot}`);
    }
  }

  // Confirm restore worked: verify should be 200 again.
  const restored = await verify(voteId);
  console.log(
    `[vector 1] post-restore verify → HTTP ${restored.status}, ` +
      `included_on_chain=${restored.body.included_on_chain}`
  );

  // ── Vector 2: attempt to tamper votes.encrypted_vote (trigger must block) ──
  console.log(`\n[vector 2] Attempting to edit votes.encrypted_vote (expect DB trigger to reject)`);
  const { error: voteUpdErr } = await supabase
    .from("votes")
    .update({ encrypted_vote: { c1: "0xtampered", c2: "0xtampered" } })
    .eq("id", voteId);

  const vector2Pass = !!voteUpdErr;
  if (voteUpdErr) {
    console.log(`[vector 2] Rejected by DB as expected: ${voteUpdErr.message}`);
  } else {
    console.error("[vector 2] ❌ EDIT SUCCEEDED — immutability trigger is NOT protecting encrypted_vote!");
  }

  // ── Summary ──
  console.log("\n──────── SUMMARY ────────");
  console.log(`Vector 1 (root tamper → 409):        ${vector1Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Vector 2 (encrypted_vote immutable): ${vector2Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Restore verified (200 again):        ${restored.status === 200 ? "✅" : "❌"}`);
  console.log("─────────────────────────\n");

  process.exitCode = vector1Pass && vector2Pass && restored.status === 200 ? 0 : 1;
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

/**
 * integrity.test.ts — DB-level integrity & immutability tests
 *
 * These tests talk to Supabase directly (bypassing the HTTP routes and
 * fn_cast_vote) to isolate raw schema constraints — triggers, foreign
 * keys, and unique constraints — independent of any application logic.
 *
 * Covers 4 of the 7 db-integrity-tests categories:
 *   1. Immutability trigger      — DELETE half (UPDATE half is in vote.test.ts)
 *   2. FK integrity              — voters / votes / candidates → constituencies
 *   3. Double-vote unique constraint — votes.nullifier_hash
 *   4. Nullifier uniqueness      — nullifiers table
 *
 * Categories 5, 6, 7 are covered elsewhere — see the note at the bottom
 * of this file rather than duplicated here.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";

// Load test environment variables (same convention as vote.test.ts)
const envTestPath = path.resolve(__dirname, "../../.env.test");
const envProdPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath });
} else {
  dotenv.config({ path: envProdPath });
}

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`FATAL: ${key} is not set.`);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Seeded by seed-constituencies.ts — a real FK target for the "should
// succeed" side of these tests.
const VALID_CONSTITUENCY = "CON-01";

// Multi-election isolation (threat_model.md §10): election_id is NOT NULL on
// voters/votes/candidates now, so every insert below needs a real one — the
// backfilled election every other fixture/script in this project uses.
const VALID_ELECTION_ID = "NATIONAL-2026-001";

// Well-formed per ck_constituency_code_format (`^[A-Z]{2,4}-\d{1,3}$`) but
// deliberately never seeded — the FK target that should always fail.
const NONEXISTENT_CONSTITUENCY = "ZZ-99";

function randomHex64(): string {
  return crypto.randomBytes(32).toString("hex");
}

describe("DB Integrity & Immutability", () => {
  describe("Category 1 — Immutability trigger (DELETE)", () => {
    // The UPDATE half of immutability is already covered by vote.test.ts
    // ("enforces DB immutability trigger for SQL UPDATEs"). This covers
    // the DELETE half, guarded by trg_votes_no_delete (schema.sql).
    //
    // SKIPPED: this test inserts a real row into `votes` to attempt-and-fail
    // deleting it. Because trg_votes_no_delete blocks all deletes and there's
    // no separate test DB yet (this file and vote.test.ts both point at the
    // same project as the live app — see .env), running this would
    // permanently pollute the real database with a fake vote. Unskip once a
    // dedicated test DB exists.
    it.skip("rejects DELETE on a cast vote row", async () => {
      const insertRes = await supabase
        .from("votes")
        .insert({
          nullifier_hash: randomHex64(),
          constituency_code: VALID_CONSTITUENCY,
          encrypted_vote: { c1: "c1", c2: "c2" },
        })
        .select("id")
        .single();
      expect(insertRes.error).toBeNull();

      const deleteRes = await supabase
        .from("votes")
        .delete()
        .eq("id", insertRes.data!.id);

      expect(deleteRes.error).not.toBeNull();
      expect(deleteRes.error?.message).toMatch(
        /immutable and cannot be deleted/
      );

      // No cleanup — the row surviving this attempted delete is the
      // entire point of the test.
    });
  });

  describe("Category 2 — Foreign key integrity", () => {
    it("rejects a voter with a non-existent constituency_code", async () => {
      const { error } = await supabase.from("voters").insert({
        election_id: VALID_ELECTION_ID,
        nid_hash: randomHex64(),
        name: "FK Test Voter",
        constituency_code: NONEXISTENT_CONSTITUENCY,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503"); // foreign_key_violation
    });

    it("rejects a vote with a non-existent constituency_code", async () => {
      const { error } = await supabase.from("votes").insert({
        election_id: VALID_ELECTION_ID,
        nullifier_hash: randomHex64(),
        constituency_code: NONEXISTENT_CONSTITUENCY,
        encrypted_vote: { c1: "c1", c2: "c2" },
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
      // Insert failed — no row was created, so there's nothing to clean up.
    });

    it("rejects a candidate with a non-existent constituency_code", async () => {
      const { error } = await supabase.from("candidates").insert({
        election_id: VALID_ELECTION_ID,
        name: "FK Test Candidate",
        party: "Test Party",
        symbol: "x",
        constituency_code: NONEXISTENT_CONSTITUENCY,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
    });
  });

  describe("Category 3 — Double-vote unique constraint (votes.nullifier_hash)", () => {
    // SKIPPED: the first insert below is a real, successful row in `votes`
    // that trg_votes_no_delete then makes permanent. Same reasoning as the
    // DELETE test above — no separate test DB yet, so this would leave a
    // fake vote in the live database. Unskip once a dedicated test DB exists.
    it.skip("rejects a second vote row with a duplicate nullifier_hash", async () => {
      // Bypasses fn_cast_vote and the /vote route entirely, to isolate the
      // raw schema constraint (uq_votes_nullifier_hash) on its own —
      // independent of the HTTP-level concurrency stress test in
      // vote.test.ts (category 5).
      const nullifierHash = randomHex64();

      const first = await supabase.from("votes").insert({
        nullifier_hash: nullifierHash,
        constituency_code: VALID_CONSTITUENCY,
        encrypted_vote: { c1: "first", c2: "first" },
      });
      expect(first.error).toBeNull();

      const second = await supabase.from("votes").insert({
        nullifier_hash: nullifierHash,
        constituency_code: VALID_CONSTITUENCY,
        encrypted_vote: { c1: "second", c2: "second" },
      });
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505"); // unique_violation

      // The first insert is a genuine, successfully-cast vote row and,
      // per trg_votes_no_delete, can never be cleaned up afterward. That's
      // expected — it's the same permanence every real cast vote gets.
    });
  });

  describe("Category 4 — Nullifier uniqueness (nullifiers table)", () => {
    const electionId = "DB-INTEGRITY-TEST-ELECTION";

    it("rejects a duplicate (election_id, nullifier_hash) pair", async () => {
      const nullifierHash = randomHex64();

      const first = await supabase.from("nullifiers").insert({
        election_id: electionId,
        nullifier_hash: nullifierHash,
      });
      expect(first.error).toBeNull();

      const second = await supabase.from("nullifiers").insert({
        election_id: electionId,
        nullifier_hash: nullifierHash,
      });
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505");

      // Unlike `votes`, `nullifiers` has no delete-immutability guard — it's
      // a best-effort secondary ledger (see vote.ts), so cleanup is safe.
      await supabase
        .from("nullifiers")
        .delete()
        .eq("nullifier_hash", nullifierHash);
    });
  });

  // ── Categories 5, 6, 7 — covered elsewhere, not duplicated here ──
  //
  // 5. Concurrency (N=50 parallel double-cast, exactly 1 lands):
  //    backend/src/routes/vote.test.ts
  //      → "prevents concurrent double-cast under N=50 stress"
  //    testing/concurrency_stress_output.json (regenerated evidence)
  //
  // 6. Merkle proof correctness (every leaf verifies; tampered leaf fails):
  //    backend/src/merkle/merkleTree.test.ts
  //
  // 7. Threshold decryption edge cases (2-of-4 fails, 3-of-4 succeeds):
  //    backend/src/crypto/shamir.test.ts
});

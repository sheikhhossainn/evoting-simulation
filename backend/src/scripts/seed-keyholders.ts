/**
 * seed-keyholders.ts — populate the `keyholders` table for an election
 * (threat_model.md §10 multi-election isolation follow-up)
 *
 * Replaces config/keyholders.ts's old static DEMO_PASSPHRASES map. Run once
 * per election, alongside setup-shamir-zq.ts (same CEREMONY_ELECTION_ID env
 * var, same KH-00<n> id / role convention, so the two scripts describe the
 * same 4 keyholders consistently).
 *
 * Demo defaults (KH-001/share001 ... KH-004/share004) match what the old
 * static config shipped, so the out-of-box demo still works unchanged.
 * Override via KEYHOLDER_PASSPHRASE_1..4 in .env for a real deployment so
 * actual passphrases are never committed to the repo.
 *
 * Run: npx ts-node src/scripts/seed-keyholders.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createHash } from "crypto";
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true } as any);

import { supabase } from "../supabaseClient";

const ELECTION_ID = process.env.CEREMONY_ELECTION_ID || "NATIONAL-2026-001";

const ROLES = ["Election Commission", "Judiciary Observer", "Academic Auditor", "Civil Society Observer"];
const DEMO_PASSPHRASES = ["share001", "share002", "share003", "share004"];

function hashPassphrase(passphrase: string): string {
  const salt = process.env.KEYHOLDER_PASSPHRASE_SALT || "";
  return createHash("sha256").update(passphrase + salt).digest("hex");
}

async function main() {
  console.log(`\nSeeding keyholders for election ${ELECTION_ID}\n`);

  const { data: election, error: electionErr } = await supabase
    .from("elections")
    .select("election_id")
    .eq("election_id", ELECTION_ID)
    .maybeSingle();
  if (electionErr) {
    console.error("Supabase error checking elections row:", electionErr);
    process.exit(1);
  }
  if (!election) {
    console.error(
      `No elections row for ${ELECTION_ID} — create it first (POST /elections or an INSERT into elections).`
    );
    process.exit(1);
  }

  for (let i = 1; i <= 4; i++) {
    const keyholderId = `KH-00${i}`;
    const passphrase = process.env[`KEYHOLDER_PASSPHRASE_${i}`] || DEMO_PASSPHRASES[i - 1];
    const passphraseHash = hashPassphrase(passphrase);

    const { error } = await supabase.from("keyholders").upsert(
      {
        election_id: ELECTION_ID,
        keyholder_id: keyholderId,
        role: ROLES[i - 1],
        share_index: i,
        passphrase_hash: passphraseHash,
      },
      { onConflict: "election_id,keyholder_id" }
    );
    if (error) {
      console.error(`Supabase error seeding ${keyholderId}:`, error);
      process.exit(1);
    }
    console.log(`   ${keyholderId} (${ROLES[i - 1]}, index ${i}) seeded.`);
  }

  console.log("\nDone. Keyholders can now authenticate against this election via POST /keyshares/submit-partial.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

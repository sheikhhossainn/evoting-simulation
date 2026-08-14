/**
 * setup-shamir-zq.ts — Z_q + Feldman VSS key ceremony
 * (docs/tally-verifiability-design.md §2, §14)
 *
 * Replaces setup-shamir.ts's role for the verifiable-tally flow. Splits the
 * existing ElGamal private key over Z_q (not GF(2^8) — incompatible with
 * partial-decryption combination, docs §1.2), publishes Feldman commitments,
 * and prints each keyholder's share for OUT-OF-BAND distribution.
 *
 * CRITICAL, per docs §7.1: this script NEVER writes any x_i anywhere the
 * backend process can read — no backend/.env, no Supabase table. Only
 * PUBLIC values (p, g, Feldman commitments, each y_i) are persisted. If the
 * printed shares below are copy-pasted into backend/.env "for convenience,"
 * the entire verifiable-tally guarantee is void — see §7.1's comment on
 * setup-shamir.ts's old anti-pattern.
 *
 * Run: npx ts-node src/scripts/setup-shamir-zq.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";
dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true } as any);

import { modPow } from "../crypto/elgamal";
import { splitSecretZq, reconstructSecretZq, verifyFeldmanShare } from "../crypto/shamirZq";
import { supabase } from "../supabaseClient";

const ELECTION_ID = process.env.CEREMONY_ELECTION_ID || "NATIONAL-2026-001";

function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

async function main() {
  console.log("\nZ_q + Feldman VSS key ceremony (docs/tally-verifiability-design.md §2)\n");
  console.log("=".repeat(60));

  const pHex = process.env.ELGAMAL_P;
  const gHex = process.env.ELGAMAL_G;
  const xHex = process.env.ELGAMAL_PRIVATE_KEY;
  if (!pHex || !gHex || !xHex) {
    console.error("ELGAMAL_P / ELGAMAL_G / ELGAMAL_PRIVATE_KEY must be set in backend/.env");
    process.exit(1);
  }

  const p = BigInt("0x" + pHex);
  const g = BigInt("0x" + gHex);
  const q = (p - 1n) / 2n;
  const x = BigInt("0x" + xHex);
  const xPrime = x % q; // docs §1.1 — only x mod q is meaningful as the exponent

  console.log(`\nq = (p-1)/2 derived. x' = x mod q computed (not logged).`);

  const { shares, commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q), 4, 3);

  console.log("\n-- Verifying Feldman consistency for all 4 shares --");
  for (const { index, value } of shares) {
    const ok = verifyFeldmanShare(index, value, commitments, g, p);
    console.log(`   Share ${index}: ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) {
      console.error("Feldman verification failed — aborting, do not distribute these shares.");
      process.exit(1);
    }
  }

  console.log("\n-- Verifying all 3-of-4 combinations reconstruct x' (sanity, discarded) --");
  const combos = [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3],
  ];
  for (const combo of combos) {
    const reconstructed = reconstructSecretZq(combo.map((i) => shares[i]), q);
    console.log(`   Shares ${combo.map((i) => i + 1).join("+")}: ${reconstructed === xPrime ? "MATCH" : "MISMATCH"}`);
    if (reconstructed !== xPrime) {
      console.error("Reconstruction sanity check failed — aborting.");
      process.exit(1);
    }
  }

  const roles = ["Election Commission", "Judiciary Observer", "Academic Auditor", "Civil Society Observer"];
  console.log("\n-- Shares for OUT-OF-BAND distribution (NOT written to any file) --");
  console.log("   Hand each share to its keyholder directly. Do NOT paste these into backend/.env.\n");
  for (const { index, value } of shares) {
    console.log(`   Share ${index} (${roles[Number(index) - 1]}):`);
    console.log(`   ${value.toString(16)}\n`);
  }

  console.log("-- Publishing PUBLIC values only (p, g, Feldman commitments, y_i per index) --");

  const { error: ceremonyError } = await supabase.from("election_key_ceremony").upsert(
    {
      election_id: ELECTION_ID,
      p_hex: pHex,
      g_hex: gHex,
      feldman_commitments: commitments.map((c) => c.toString(16)),
    },
    { onConflict: "election_id" }
  );
  if (ceremonyError) {
    console.error("Supabase error publishing election_key_ceremony:", ceremonyError);
    process.exit(1);
  }

  for (const { index, value } of shares) {
    const y_i = modPow(g, value, p);
    const { error } = await supabase.from("key_shares").upsert(
      {
        election_id: ELECTION_ID,
        keyholder_id: `KH-00${index}`,
        share_index: Number(index),
        keyholder_role: roles[Number(index) - 1],
        public_commitment: y_i.toString(16),
        submitted: false,
      },
      { onConflict: "election_id,keyholder_id" }
    );
    if (error) {
      console.error(`Supabase error publishing commitment for share ${index}:`, error);
      process.exit(1);
    }
  }

  console.log("\nCeremony complete. Public commitments published.");
  console.log("Distribute the printed shares out-of-band, then discard this process's memory.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

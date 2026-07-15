/**
 * setup-shamir.ts — Generate and verify Shamir shares for ElGamal private key
 *
 *
 * This script:
 *   1. Reads ELGAMAL_PRIVATE_KEY from .env
 *   2. Splits it into 4 shares using (3,4) Shamir's Secret Sharing
 *   3. Verifies ALL 4 combinations of 3-of-4 reconstruct correctly
 *   4. Prints shares for distribution to keyholders
 *   5. Optionally appends shares to .env for local testing
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { splitPrivateKey, reconstructKey, verifyReconstruction } from "../crypto/shamir";

const ENV_PATH = path.join(__dirname, "../../.env");
dotenv.config({ path: ENV_PATH });

async function main() {
  console.log("\n🔐 Shamir's Secret Sharing Setup (3-of-4)\n");
  console.log("=".repeat(50));

  // ── Step 1: Load private key ──
  const privateKey = process.env.ELGAMAL_PRIVATE_KEY;

  if (!privateKey) {
    console.error("\n❌ ELGAMAL_PRIVATE_KEY not found in .env");
    console.error("   Run first: npx ts-node src/scripts/setup-keys.ts\n");
    process.exit(1);
  }

  console.log(`\n✅ Private key loaded from .env`);
  console.log(`   Key (first 16 chars): ${privateKey.slice(0, 16)}...`);
  console.log(`   Key length: ${privateKey.length} hex chars`);

  // ── Step 2: Split into 4 shares ──
  console.log("\n── Splitting into 4 shares (threshold: 3) ──");

  const shares = splitPrivateKey(privateKey);

  console.log("\n   Share 1 (Election Commission):");
  console.log(`   ${shares.share1}`);
  console.log("\n   Share 2 (Judiciary Observer):");
  console.log(`   ${shares.share2}`);
  console.log("\n   Share 3 (Academic Auditor — YOU):");
  console.log(`   ${shares.share3}`);
  console.log("\n   Share 4 (Civil Society Observer):");
  console.log(`   ${shares.share4}`);

  // ── Step 3: Verify ALL 4 combinations of 3-of-4 ──
  console.log("\n── Verifying all 3-of-4 combinations ──");

  const shareArray = [shares.share1, shares.share2, shares.share3, shares.share4];
  const combos = [
    { label: "Shares 1+2+3", indices: [0, 1, 2] },
    { label: "Shares 1+2+4", indices: [0, 1, 3] },
    { label: "Shares 1+3+4", indices: [0, 2, 3] },
    { label: "Shares 2+3+4", indices: [1, 2, 3] },
  ];

  let allPassed = true;

  for (const combo of combos) {
    const selectedShares = combo.indices.map((i) => shareArray[i]);
    const reconstructed = reconstructKey(selectedShares);
    const match = reconstructed === privateKey;

    console.log(`   ${combo.label}: ${match ? "✅ MATCH" : "❌ MISMATCH"}`);

    if (!match) {
      allPassed = false;
      console.error(`      Expected: ${privateKey.slice(0, 16)}...`);
      console.error(`      Got:      ${reconstructed.slice(0, 16)}...`);
    }
  }

  // ── Step 4: Verify 2-of-4 fails (should NOT reconstruct correctly) ──
  console.log("\n── Verifying 2 shares CANNOT reconstruct (security check) ──");

  let twoShareMatches = false;
try {
  const twoShareResult = reconstructKey([shares.share1, shares.share2]);
  twoShareMatches = twoShareResult === privateKey;
} catch {
  // Expected — 2 shares should throw "Need at least 3 shares"
  twoShareMatches = false;
}

  console.log(
    `   Shares 1+2 only: ${!twoShareMatches ? "✅ Cannot reconstruct (correct)" : "❌ SECURITY FAIL — 2 shares reconstructed!"}`
  );

  if (twoShareMatches) {
    allPassed = false;
    console.error("   ⚠️  CRITICAL: 2 shares should not reconstruct the key!");
  }

  // ── Step 5: Result ──
  console.log("\n" + "=".repeat(50));

  if (allPassed) {
    console.log("\n✅ All verification tests passed!\n");
    console.log("📋 Next steps:");
    console.log("   1. Share each share string with the corresponding keyholder");
    console.log("   2. Each keyholder stores their share securely");
    console.log("   3. At tallying time, 3+ keyholders submit via /keyshares/submit");
    console.log("   4. Backend reconstructs key and decrypts final tally\n");

    // ── Step 6: Write shares to .env for local testing ──
    console.log("── Writing shares to .env for local testing ──");

    const shareEntries = [
      `SHAMIR_SHARE_1=${shares.share1}`,
      `SHAMIR_SHARE_2=${shares.share2}`,
      `SHAMIR_SHARE_3=${shares.share3}`,
      `SHAMIR_SHARE_4=${shares.share4}`,
    ];

    let envContent = fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, "utf-8")
      : "";

    for (const entry of shareEntries) {
      const key = entry.split("=")[0];
      if (!envContent.includes(key)) {
        fs.appendFileSync(ENV_PATH, `\n${entry}`);
        console.log(`   ✅ ${key} written to .env`);
      } else {
        console.log(`   ⏭  ${key} already in .env, skipping`);
      }
    }

    console.log("\n✅ Shares saved to .env for local testing.\n");
  } else {
    console.error("\n❌ Some verification tests FAILED. Do not distribute these shares.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

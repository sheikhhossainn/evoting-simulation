/**
 * setup-keys.ts — One-time ElGamal keypair + NID salt generator
 *
 * Run: npx ts-node src/scripts/setup-keys.ts
 *
 * Generates ElGamal keypair and NID_HASH_SALT, then appends them
 * to backend/.env. Skips any key that already exists in .env.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { generateKeypair } from "../crypto/elgamal";

const ENV_PATH = path.join(__dirname, "../../.env");

// Load existing .env
dotenv.config({ path: ENV_PATH });

function appendToEnv(key: string, value: string): void {
  const envContent = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf-8")
    : "";

  // Check if key already exists (non-empty)
  if (process.env[key] && process.env[key]!.length > 0) {
    console.log(`  ⏭  ${key} already set, skipping`);
    return;
  }

  // Append to .env file
  const line = `${key}=${value}\n`;
  fs.appendFileSync(ENV_PATH, line, "utf-8");
  console.log(`  ✅ ${key} written`);
}

async function main() {
  console.log("\n🔐 ElGamal Key Setup\n");

  // ── 1. NID Hash Salt ──
  console.log("── NID Hash Salt ──");
  const salt = crypto.randomBytes(32).toString("hex");
  appendToEnv("NID_HASH_SALT", salt);

  // ── 2. ElGamal Keypair ──
  console.log("\n── ElGamal Keypair (256-bit safe prime) ──");

  if (process.env.ELGAMAL_P && process.env.ELGAMAL_PUBLIC_KEY) {
    console.log("  ⏭  ElGamal keys already set, skipping generation");
  } else {
    console.log("  ⏳ Generating keypair...");
    const keypair = generateKeypair();

    appendToEnv("ELGAMAL_P", keypair.publicKey.p);
    appendToEnv("ELGAMAL_G", keypair.publicKey.g);
    appendToEnv("ELGAMAL_PUBLIC_KEY", keypair.publicKey.y);
    appendToEnv("ELGAMAL_PRIVATE_KEY", keypair.privateKey.x);

    console.log("\n  📋 Public Key Parameters:");
    console.log(`     p = ${keypair.publicKey.p.slice(0, 20)}...`);
    console.log(`     g = ${keypair.publicKey.g}`);
    console.log(`     y = ${keypair.publicKey.y.slice(0, 20)}...`);
    console.log(`     x = [PRIVATE — stored in .env]`);
  }

  console.log("\n✅ Setup complete. Keys are in backend/.env\n");
}

main().catch(console.error);

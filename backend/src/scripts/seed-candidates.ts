/**
 * seed-candidates.ts — Seed candidates into Supabase from candidates.json
 *
 * Run: npx ts-node src/scripts/seed-candidates.ts
 *
 * Reads frontend/public/candidates.json, maps constituencyId → CON-XX,
 * and inserts into the Supabase candidates table.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface CandidateJson {
  id: string;
  constituencyId: number;
  name: string;
  party: string;
  symbol: string;
}

async function main() {
  console.log("\n🗳️  Seeding candidates into Supabase...\n");

  const jsonPath = path.join(__dirname, "../../../frontend/public/candidates.json");

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ candidates.json not found at: ${jsonPath}`);
    process.exit(1);
  }

  const rawCandidates: CandidateJson[] = JSON.parse(
    fs.readFileSync(jsonPath, "utf-8")
  );

  // Map constituencyId (1-8) → CON-XX format
  const candidates = rawCandidates.map((c) => ({
    name: c.name,
    party: c.party,
    symbol: c.symbol,
    constituency_code: `CON-${String(c.constituencyId).padStart(2, "0")}`,
  }));

  // Upsert in batches
  const { data, error } = await supabase
    .from("candidates")
    .upsert(candidates, {
      onConflict: "name,constituency_code",
      ignoreDuplicates: true,
    });

  if (error) {
    console.error("❌ Supabase error:", error.message);
    process.exit(1);
  }

  // Print summary
  const byCon = new Map<string, number>();
  for (const c of candidates) {
    byCon.set(c.constituency_code, (byCon.get(c.constituency_code) || 0) + 1);
  }

  console.log("  Candidates per constituency:");
  for (const [code, count] of [...byCon.entries()].sort()) {
    console.log(`    ${code}: ${count} candidates`);
  }

  console.log(`\n✅ ${candidates.length} candidates seeded\n`);
}

main().catch(console.error);

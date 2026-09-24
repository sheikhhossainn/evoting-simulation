/**
 * seed-constituencies.ts — Seed constituencies and candidates into Supabase
 *
 * Run: npx ts-node src/scripts/seed-constituencies.ts
 *
 * Seeds the 8 predefined constituencies and then reads
 * frontend/public/candidates.json to populate the candidates table.
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

// Multi-election isolation (threat_model.md §10): same CEREMONY_ELECTION_ID
// env convention as setup-shamir-zq.ts / seed-keyholders.ts. The elections
// row must already exist (POST /elections or a direct INSERT) — constituencies
// and candidates both carry a FK to it.
const ELECTION_ID = process.env.CEREMONY_ELECTION_ID || "NATIONAL-2026-001";

interface CandidateJson {
  id: string;
  constituencyId: number;
  name: string;
  party: string;
  symbol: string;
}

const CONSTITUENCIES = [
  { code: "CON-01", name: "Dhaka North" },
  { code: "CON-02", name: "Dhaka South" },
  { code: "CON-03", name: "Chattogram City" },
  { code: "CON-04", name: "Rajshahi Central" },
  { code: "CON-05", name: "Khulna Metro" },
  { code: "CON-06", name: "Sylhet City" },
  { code: "CON-07", name: "Barishal Sadar" },
  { code: "CON-08", name: "Rangpur Metro" },
];

async function main() {
  console.log(`\n🗳️  Seeding constituencies and candidates into Supabase for election ${ELECTION_ID}...\n`);

  const { data: election, error: electionErr } = await supabase
    .from("elections")
    .select("election_id")
    .eq("election_id", ELECTION_ID)
    .maybeSingle();
  if (electionErr) {
    console.error("❌ Supabase error checking elections row:", electionErr.message);
    process.exit(1);
  }
  if (!election) {
    console.error(
      `❌ No elections row for ${ELECTION_ID} — create it first (POST /elections or an INSERT into elections).`
    );
    process.exit(1);
  }

  // 1. Seed Constituencies
  console.log("  Seeding 8 constituencies...");
  const { error: conError } = await supabase
    .from("constituencies")
    .upsert(
      CONSTITUENCIES.map((c) => ({ ...c, election_id: ELECTION_ID })),
      {
        onConflict: "election_id,code",
        ignoreDuplicates: true,
      }
    );

  if (conError) {
    console.error("❌ Supabase error seeding constituencies:", conError.message);
    process.exit(1);
  }
  console.log("  ✅ Constituencies seeded.\n");

  // 2. Seed Candidates
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
    election_id: ELECTION_ID,
    name: c.name,
    party: c.party,
    symbol: c.symbol,
    constituency_code: `CON-${String(c.constituencyId).padStart(2, "0")}`,
  }));

  // Upsert in batches
  console.log("  Seeding candidates...");
  const { data, error: canError } = await supabase
    .from("candidates")
    .upsert(candidates, {
      onConflict: "election_id,name,constituency_code",
      ignoreDuplicates: true,
    });

  if (canError) {
    console.error("❌ Supabase error seeding candidates:", canError.message);
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

  console.log(`\n✅ ${candidates.length} candidates seeded successfully.\n`);
}

main().catch(console.error);

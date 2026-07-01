/**
 * seed-voters.ts — Seed 20 mock voters across 8 constituencies
 *
 * Run: npx ts-node src/scripts/seed-voters.ts
 *
 * Generates 20 deterministic mock NID numbers, hashes them with
 * the salt from .env, and upserts into the Supabase voters table.
 *
 * Distribution: 2-3 voters per constituency (CON-01 through CON-08).
 */

import { createHash } from "crypto";
import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env from backend root
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

// ── Helpers ──

function sha256WithSalt(input: string): string {
  const salt = process.env.NID_HASH_SALT || "";
  return createHash("sha256").update(input + salt).digest("hex");
}

// ── Mock voter data ──
// 20 voters, deterministic NIDs designed so constituencyFromNid gives
// an even spread across CON-01 through CON-08.
// constituencyFromNid: (parseInt(nid.slice(0,4)) % 8) + 1

interface MockVoter {
  nid: string;
  name: string;
  constituency_code: string;
}

function constituencyFromNid(nid: string): string {
  const firstFour = parseInt(nid.slice(0, 4)) || 0;
  const id = (firstFour % 8) + 1;
  return `CON-${String(id).padStart(2, "0")}`;
}

// Generate 20 mock NIDs that map to specific constituencies
// We pick the first 4 digits to control constituency assignment
const MOCK_NIDS: { nid: string; displayName: string }[] = [
  // CON-01: firstFour % 8 === 0 → firstFour = 1000, 1008
  { nid: "10001234567", displayName: "Rahim Ahmed" },
  { nid: "10081234567", displayName: "Salma Begum" },
  { nid: "10161234567", displayName: "Nasir Uddin" },

  // CON-02: firstFour % 8 === 1 → firstFour = 1001, 1009
  { nid: "10011234567", displayName: "Fatema Khatun" },
  { nid: "10091234567", displayName: "Jahangir Alam" },

  // CON-03: firstFour % 8 === 2 → firstFour = 1002, 1010
  { nid: "10021234567", displayName: "Kamal Hossain" },
  { nid: "10101234567", displayName: "Rupa Akter" },
  { nid: "10181234567", displayName: "Tariq Hasan" },

  // CON-04: firstFour % 8 === 3 → firstFour = 1003, 1011
  { nid: "10031234567", displayName: "Momena Islam" },
  { nid: "10111234567", displayName: "Shahin Alam" },

  // CON-05: firstFour % 8 === 4 → firstFour = 1004, 1012
  { nid: "10041234567", displayName: "Arif Rahman" },
  { nid: "10121234567", displayName: "Nazma Sultana" },
  { nid: "10201234567", displayName: "Babul Miah" },

  // CON-06: firstFour % 8 === 5 → firstFour = 1005, 1013
  { nid: "10051234567", displayName: "Shahida Parvin" },
  { nid: "10131234567", displayName: "Mokbul Hossain" },

  // CON-07: firstFour % 8 === 6 → firstFour = 1006, 1014
  { nid: "10061234567", displayName: "Jasmine Akter" },
  { nid: "10141234567", displayName: "Rezaul Karim" },

  // CON-08: firstFour % 8 === 7 → firstFour = 1007, 1015
  { nid: "10071234567", displayName: "Delwar Hossain" },
  { nid: "10151234567", displayName: "Farida Yasmin" },
  { nid: "10231234567", displayName: "Sumon Chowdhury" },
];

async function main() {
  console.log("\n🌱 Seeding 20 mock voters into Supabase...\n");

  if (!process.env.NID_HASH_SALT) {
    console.warn(
      "⚠️  NID_HASH_SALT not set in .env — hashes will be unsalted.\n" +
        "   Run setup-keys.ts first: npx ts-node src/scripts/setup-keys.ts\n"
    );
  }

  const voters: MockVoter[] = MOCK_NIDS.map(({ nid, displayName }) => ({
    nid,
    name: displayName,
    constituency_code: constituencyFromNid(nid),
  }));

  let inserted = 0;
  let skipped = 0;

  for (const voter of voters) {
    const nidHash = sha256WithSalt(voter.nid);

    const { error } = await supabase.from("voters").upsert(
      {
        nid_hash: nidHash,
        name: voter.name,
        constituency_code: voter.constituency_code,
        is_eligible: true,
        has_voted: false,
      },
      {
        onConflict: "nid_hash",
        ignoreDuplicates: true,
      }
    );

    if (error) {
      console.error(`  ❌ Failed to insert ${voter.name}: ${error.message}`);
      skipped++;
    } else {
      inserted++;
    }
  }

  // Print summary table
  console.log("┌──────────────────────┬─────────────┬────────────────┐");
  console.log("│ Name                 │ NID         │ Constituency   │");
  console.log("├──────────────────────┼─────────────┼────────────────┤");

  for (const voter of voters) {
    const name = voter.name.padEnd(20);
    const nid = voter.nid;
    const con = voter.constituency_code.padEnd(14);
    console.log(`│ ${name} │ ${nid} │ ${con} │`);
  }

  console.log("└──────────────────────┴─────────────┴────────────────┘");
  console.log(`\n✅ Done — ${inserted} inserted, ${skipped} skipped\n`);
}

main().catch(console.error);

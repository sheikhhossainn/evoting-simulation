/**
 * deploy-election-setup.ts — deploy ElectionSetupCommitment.sol and anchor
 * the candidate/constituency commitment (docs/tally-verifiability-design.md §8.2.5)
 *
 * Reads candidates/constituencies from Supabase, computes the commitment
 * (backend/src/crypto/candidateCommitment.ts), deploys the contract, calls
 * anchor(), then writes the election_setup_commitments row.
 *
 * IMPORTANT (docs §14): for THIS system's already-running demo election,
 * candidates were never locked at true setup time — running this now only
 * proves "the set as of today," not "the set as of when voting began."
 * Label any such retroactive anchor accordingly; do not present it as
 * having always been in place.
 *
 * This is a real, irreversible on-chain deployment + write-once anchor
 * transaction — run deliberately, not as part of an automated test suite.
 *
 * Run:  npx hardhat run scripts/deploy-election-setup.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../backend/.env"), quiet: true } as any);

import { createClient } from "@supabase/supabase-js";
import {
  buildAndComputeCommitment,
  type CandidateRecord,
  type ConstituencyRecord,
} from "../../backend/src/crypto/candidateCommitment";

const ELECTION_ID = process.env.CEREMONY_ELECTION_ID || "NATIONAL-2026-001";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const [candidatesRes, constituenciesRes] = await Promise.all([
    supabase.from("candidates").select("id, name, party, symbol, constituency_code"),
    supabase.from("constituencies").select("code, name"),
  ]);
  if (candidatesRes.error) throw candidatesRes.error;
  if (constituenciesRes.error) throw constituenciesRes.error;

  const candidates = candidatesRes.data as CandidateRecord[];
  const constituencies = constituenciesRes.data as ConstituencyRecord[];
  console.log(`Loaded ${candidates.length} candidates, ${constituencies.length} constituencies.`);

  const { commitment, trees } = buildAndComputeCommitment(ELECTION_ID, candidates, constituencies);
  console.log(`Computed commitment: ${commitment}`);
  console.log(`  candidatesRoot: ${trees.candidatesRoot}`);
  console.log(`  constituenciesRoot: ${trees.constituenciesRoot}`);

  const [owner] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("ElectionSetupCommitment");
  const contract = await factory.deploy(owner.address);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\nElectionSetupCommitment deployed to: ${address}`);

  const tx = await contract.anchor(ELECTION_ID, commitment);
  const receipt = await tx.wait();
  console.log(`Anchored. tx: ${receipt!.hash}`);

  const { error: insertErr } = await supabase.from("election_setup_commitments").upsert(
    {
      election_id: ELECTION_ID,
      commitment,
      candidates_root: trees.candidatesRoot,
      constituencies_root: trees.constituenciesRoot,
      contract_address: address,
      tx_hash: receipt!.hash,
    },
    { onConflict: "election_id" }
  );
  if (insertErr) {
    console.error("Supabase error inserting election_setup_commitments row:", insertErr);
    process.exit(1);
  }

  console.log(`\nAdd this to backend/.env:`);
  console.log(`   ELECTION_SETUP_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

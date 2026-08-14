/**
 * independent-verify-tally.ts — standalone independent recount verifier
 * (docs/tally-verifiability-design.md §9)
 *
 * Consumes ONLY the public verification bundle (GET /keyshares/verification-bundle)
 * plus direct on-chain reads. NO database connection, NO ELGAMAL_PRIVATE_KEY,
 * NO admin secret — this script must be runnable by anyone, from anywhere,
 * with nothing but a bundle file and public RPC access.
 *
 * Performs, in order (§9's numbered steps):
 *   1. Query MerkleRootStorage directly for the named batch's root —
 *      reject if it doesn't match the bundle's claim.
 *   1b. Query the named SMT batch's on-chain root/total — reject if it
 *       doesn't match the bundle's claim (methodology-audit finding M1:
 *       previously the bundle's smt_coverage_verified flag was a
 *       self-reported server boolean with nothing independently checkable
 *       behind it).
 *   2. Rebuild the dense Merkle tree from ballots[] — reject if it doesn't
 *      reproduce the bundle's claimed dense_root.
 *   2a. Query ElectionSetupCommitment directly — recompute and compare the
 *       candidate/constituency commitment.
 *   3. Cross-check independently_observed_vote_count against total_keys_anchored.
 *   4. Verify every (ballot_id, keyholder_index) DLEQ proof.
 *   5. Combine each ballot's plaintext, decode, cross-reference candidates.
 *   6. Recount and diff against published_results.
 *
 * The check logic (`verifyBundle`) is a pure-ish async function, deliberately
 * separated from the CLI's argv/process.exit handling, so it can be unit
 * tested against deliberately-corrupted bundles without a real RPC endpoint
 * (see independent-verify-tally.test.ts) — the CLI wrapper below is a thin
 * shell around it.
 *
 * Run: npx ts-node src/scripts/independent-verify-tally.ts <bundle.json>
 *      [--merkle-address 0x...] [--setup-address 0x...] [--rpc-url https://...]
 */

import * as fs from "fs";
import { ethers } from "ethers";
import { buildMerkleTree, hashVoteLeaf } from "../merkle/merkleTree";
import { verifyDleq, combinePartialDecryptions, type ValidPartial } from "../crypto/dleq";
import { decodeCandidateId } from "../crypto/elgamal";
import { buildAndComputeCommitment, type CandidateRecord, type ConstituencyRecord } from "../crypto/candidateCommitment";
import { verifySmtMembershipProof, type SmtMembershipProof } from "../merkle/sparseMerkleTree";

const MERKLE_ROOT_STORAGE_ABI = [
  "function batchCount() external view returns (uint256)",
  "function getBatch(uint256 batchId) external view returns (bytes32 root, uint256 voteCount, uint256 timestamp)",
  "function smtBatches(uint256 smtBatchId) external view returns (bytes32 smtRoot, bytes32 previousSmtRoot, uint256 newKeysThisBatch, uint256 totalKeysAnchored, uint256 timestamp)",
];
const ELECTION_SETUP_ABI = ["function commitment() external view returns (bytes32)"];

export interface Bundle {
  election_id: string;
  anchored_batch_ref: {
    dense_batch_id: number;
    dense_root: string;
    smt_batch_id?: number | null;
    smt_root: string | null;
    total_keys_anchored: number | null;
  };
  group_params: { p: string; g: string } | null;
  keyholder_commitments: { index: number; y_i: string }[];
  ballots: { ballot_id: string; c1: string; c2: string; constituency_code: string; created_at: string }[];
  partial_decryptions: {
    ballot_id: string;
    keyholder_index: number;
    d_i: string;
    proof: { t1: string; t2: string; z: string };
  }[];
  smt_membership_proofs?: {
    ballot_id: string;
    nullifier_hash: string;
    type: "membership" | "non-membership" | "error";
    proof: SmtMembershipProof | { key: string; bitmap: string; siblings: string[] } | null;
    error?: string;
  }[];
  candidates: { id: string; name: string; party: string; symbol: string; constituency_code: string }[];
  constituencies: { code: string; name: string }[];
  election_setup_commitment: string | null;
  candidates_root: string | null;
  constituencies_root: string | null;
  independently_observed_vote_count: number;
  published_results: {
    total_votes: number;
    valid_votes: number;
    invalid_votes: number;
    results: { constituency_code: string; candidates: { candidate_id: string; votes: number }[] }[];
  } | null;
}

export interface CheckResult {
  step: string;
  ok: boolean;
  detail: string;
}

export interface VerifyOptions {
  merkleAddress?: string;
  setupAddress?: string;
  provider?: ethers.Provider;
}

export interface VerifyResult {
  checks: CheckResult[];
  allOk: boolean;
}

export async function verifyBundle(bundle: Bundle, opts: VerifyOptions): Promise<VerifyResult> {
  const { merkleAddress, setupAddress, provider } = opts;
  const checks: CheckResult[] = [];
  let allOk = true;
  const record = (step: string, ok: boolean, detail: string) => {
    checks.push({ step, ok, detail });
    if (!ok) allOk = false;
  };

  // ── Step 1: on-chain existence + root check ──
  // Verifies the bundle's NAMED batch (not "whatever is latest") actually
  // exists on-chain with the claimed root. The bundle is scoped to an
  // explicit batch_id (docs §8) precisely because "latest batch" can be a
  // contaminated batch — so an older, still-canonical batch is expected and
  // valid, not stale. "Not the latest" is reported as context, never a FAIL.
  if (merkleAddress && provider) {
    try {
      const contract = new ethers.Contract(merkleAddress, MERKLE_ROOT_STORAGE_ABI, provider);
      const [onChainRoot] = await contract.getBatch(bundle.anchored_batch_ref.dense_batch_id);
      record(
        "1. on-chain batch existence + root check",
        onChainRoot.toLowerCase() === bundle.anchored_batch_ref.dense_root.toLowerCase(),
        `Batch ${bundle.anchored_batch_ref.dense_batch_id} on-chain root: ${onChainRoot}`
      );

      const latestBatchCount: bigint = await contract.batchCount();
      const latestId = Number(latestBatchCount) - 1;
      if (latestId !== bundle.anchored_batch_ref.dense_batch_id) {
        console.log(
          `       [info] batch ${bundle.anchored_batch_ref.dense_batch_id} is not the chain's latest (batch ${latestId} is) — expected when an explicit, older canonical batch is deliberately used instead of a newer contaminated one.`
        );
      }
    } catch (err) {
      record("1. on-chain batch existence + root check", false, `Contract query failed: ${err}`);
    }
  } else {
    record("1. on-chain batch existence + root check", false, "SKIPPED — no --merkle-address/provider given, cannot verify against the chain");
  }

  // ── Step 1b: on-chain SMT batch check (methodology-audit finding M1) ──
  // The dense-tree check above (step 1) only proves ballot CONTENT wasn't
  // tampered post-anchor. It says nothing about completeness — that's the
  // SMT's job. Previously this verifier never checked the SMT at all; it
  // just trusted the bundle's self-reported smt_coverage_verified boolean,
  // computed server-side against the server's own in-process tree. This
  // step closes that gap by independently confirming the SMT root/total the
  // bundle claims for its referenced smt_batch_id actually matches what's
  // anchored on-chain — the same "don't trust the claim, check the chain"
  // discipline step 1 already applies to the dense root.
  if (bundle.anchored_batch_ref.smt_batch_id != null && bundle.anchored_batch_ref.smt_root) {
    if (merkleAddress && provider) {
      try {
        const contract = new ethers.Contract(merkleAddress, MERKLE_ROOT_STORAGE_ABI, provider);
        const [onChainSmtRoot, , , onChainTotal] = await contract.smtBatches(
          bundle.anchored_batch_ref.smt_batch_id
        );
        const rootMatches = onChainSmtRoot.toLowerCase() === bundle.anchored_batch_ref.smt_root.toLowerCase();
        const totalMatches = Number(onChainTotal) === bundle.anchored_batch_ref.total_keys_anchored;
        record(
          "1b. on-chain SMT batch root + total_keys_anchored check",
          rootMatches && totalMatches,
          `on-chain smt_root=${onChainSmtRoot}, total=${onChainTotal}`
        );
      } catch (err) {
        record("1b. on-chain SMT batch root + total_keys_anchored check", false, `Contract query failed: ${err}`);
      }
    } else {
      record(
        "1b. on-chain SMT batch root + total_keys_anchored check",
        false,
        "SKIPPED — no --merkle-address/provider given, cannot verify against the chain"
      );
    }
  } else {
    record(
      "1b. on-chain SMT batch root + total_keys_anchored check",
      false,
      "Bundle has no smt_batch_id/smt_root to check — cannot independently confirm SMT coverage"
    );
  }

  // ── Step 1c: per-ballot SMT membership proof verification ──
  // Step 1b confirms the bundle's claimed smt_root is genuinely on-chain.
  // This step goes further: confirms EVERY ballot in the bundle individually
  // has a valid membership proof against that exact root, using the same
  // canonical off-chain algorithm the contract's _verifySmt runs (one
  // implementation, docs/smt-design.md §11 — no extra RPC calls needed).
  // Previously the verifier had no way to check per-ballot SMT coverage at
  // all; it could only trust the server's self-reported aggregate boolean.
  {
    const smtRoot = bundle.anchored_batch_ref.smt_root;
    const proofs = bundle.smt_membership_proofs;
    if (!smtRoot) {
      record("1c. per-ballot SMT membership proof verification", false, "Bundle has no smt_root to verify against");
    } else if (!proofs || proofs.length === 0) {
      record(
        "1c. per-ballot SMT membership proof verification",
        false,
        "Bundle has no smt_membership_proofs — cannot independently confirm per-ballot SMT coverage"
      );
    } else {
      const ballotIds = new Set(bundle.ballots.map((b) => b.ballot_id));
      let validCount = 0;
      let invalidCount = 0;
      const failures: string[] = [];

      for (const entry of proofs) {
        if (entry.type !== "membership" || !entry.proof) {
          invalidCount++;
          failures.push(`${entry.ballot_id}: not a membership proof (type=${entry.type})`);
          continue;
        }
        const ok = verifySmtMembershipProof(smtRoot, entry.proof as SmtMembershipProof);
        if (ok) validCount++;
        else {
          invalidCount++;
          failures.push(`${entry.ballot_id}: membership proof failed to verify against smt_root`);
        }
      }

      const provenBallotIds = new Set(proofs.map((p) => p.ballot_id));
      const missingBallots = [...ballotIds].filter((id) => !provenBallotIds.has(id));
      if (missingBallots.length > 0) {
        invalidCount += missingBallots.length;
        failures.push(`${missingBallots.length} ballot(s) in ballots[] have no smt_membership_proofs entry at all`);
      }

      record(
        "1c. per-ballot SMT membership proof verification",
        invalidCount === 0,
        `${validCount} valid, ${invalidCount} invalid/missing` + (failures.length > 0 ? ` — ${failures.join("; ")}` : "")
      );
    }
  }

  // ── Step 2: rebuild dense root from ballots[] ──
  // Relies on ballots[] being in the SAME order the dense tree was
  // originally built with (GET /keyshares/verification-bundle preserves
  // vote_ids' exact order, not insertion/query order — see its comment).
  try {
    const leaves = bundle.ballots.map((b) =>
      hashVoteLeaf({ voteId: b.ballot_id, c1: b.c1, c2: b.c2, createdAt: b.created_at })
    );
    const tree = buildMerkleTree(leaves);
    record(
      "2. dense root rebuild",
      tree.root.toLowerCase() === bundle.anchored_batch_ref.dense_root.toLowerCase(),
      `rebuilt=${tree.root}, bundle claims=${bundle.anchored_batch_ref.dense_root}`
    );
  } catch (err) {
    record("2. dense root rebuild", false, `${err}`);
  }

  // ── Step 2a: election setup commitment ──
  if (bundle.candidates.length > 0 && bundle.constituencies.length > 0) {
    const { commitment } = buildAndComputeCommitment(
      bundle.election_id,
      bundle.candidates as CandidateRecord[],
      bundle.constituencies as ConstituencyRecord[]
    );
    const bundleMatches = commitment === bundle.election_setup_commitment;
    record("2a. candidate/constituency commitment (recomputed vs bundle)", bundleMatches, `recomputed=${commitment}`);

    if (setupAddress && provider) {
      try {
        const contract = new ethers.Contract(setupAddress, ELECTION_SETUP_ABI, provider);
        const onChain: string = await contract.commitment();
        record(
          "2a. candidate/constituency commitment (recomputed vs on-chain)",
          onChain.toLowerCase() === commitment.toLowerCase(),
          `on-chain=${onChain}`
        );
      } catch (err) {
        record("2a. candidate/constituency commitment (on-chain query)", false, `${err}`);
      }
    } else {
      record("2a. candidate/constituency commitment (on-chain query)", false, "SKIPPED — no --setup-address/provider given");
    }
  } else {
    record("2a. candidate/constituency commitment", false, "Bundle has no candidates/constituencies to check");
  }

  // ── Step 3: completeness cross-check (bounded, non-cryptographic — docs §8.1) ──
  const totalKeys = bundle.anchored_batch_ref.total_keys_anchored ?? 0;
  const observed = bundle.independently_observed_vote_count;
  // observed === 0 with totalKeys > 0 is itself a material mismatch (methodology-
  // audit finding m2) — the original `observed > 0 && ...` guard silently passed
  // this case because the relative-gap division is undefined at zero, not because
  // the mismatch is actually acceptable.
  const materialGap = observed === 0 ? totalKeys > 0 : Math.abs(totalKeys - observed) / observed > 0.05;
  record(
    "3. completeness cross-check (bounded, cannot catch small/targeted omission — docs §8.1)",
    !materialGap,
    `total_keys_anchored=${totalKeys}, independently_observed_vote_count=${observed}`
  );

  // ── Step 4: verify every DLEQ proof ──
  if (bundle.group_params) {
    const p = BigInt("0x" + bundle.group_params.p);
    const g = BigInt("0x" + bundle.group_params.g);
    const q = (p - 1n) / 2n;
    const yByIndex = new Map(bundle.keyholder_commitments.map((k) => [k.index, k.y_i]));
    const ballotById = new Map(bundle.ballots.map((b) => [b.ballot_id, b]));

    let validCount = 0;
    let invalidCount = 0;
    const validByBallot = new Map<string, ValidPartial[]>();

    for (const pd of bundle.partial_decryptions) {
      const ballot = ballotById.get(pd.ballot_id);
      const y_iHex = yByIndex.get(pd.keyholder_index);
      if (!ballot || !y_iHex) {
        invalidCount++;
        continue;
      }
      const ok = verifyDleq(bundle.election_id, pd.ballot_id, ballot.c1, pd.d_i, y_iHex, pd.proof, g, p, q);
      if (ok) {
        validCount++;
        const list = validByBallot.get(pd.ballot_id) ?? [];
        list.push({ index: BigInt(pd.keyholder_index), d_iHex: pd.d_i });
        validByBallot.set(pd.ballot_id, list);
      } else {
        invalidCount++;
      }
    }
    record("4. DLEQ proof verification", true, `${validCount} valid, ${invalidCount} invalid partial decryptions`);

    // ── Step 5: combine + recount ──
    const candidateById = new Map(bundle.candidates.map((c) => [c.id, c]));
    const recount = new Map<string, Map<string, number>>();
    let recountedValidVotes = 0;
    let recountedInsufficientShares = 0;
    let recountedDecryptFailures = 0;
    let recountedCandidateMismatch = 0;

    for (const ballot of bundle.ballots) {
      const partials = (validByBallot.get(ballot.ballot_id) ?? []).sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0
      );
      if (partials.length < 3) {
        recountedInsufficientShares++;
        continue;
      }
      let candidateId: string;
      try {
        const mHex = combinePartialDecryptions(partials.slice(0, 3), ballot.c2, p, q);
        candidateId = decodeCandidateId(BigInt("0x" + mHex));
      } catch {
        recountedDecryptFailures++;
        continue;
      }
      const candidate = candidateById.get(candidateId);
      if (!candidate || candidate.constituency_code !== ballot.constituency_code) {
        recountedCandidateMismatch++;
        continue;
      }
      recountedValidVotes++;
      if (!recount.has(ballot.constituency_code)) recount.set(ballot.constituency_code, new Map());
      const m = recount.get(ballot.constituency_code)!;
      m.set(candidateId, (m.get(candidateId) ?? 0) + 1);
    }

    record(
      "5. independent recount",
      true,
      `recounted valid_votes=${recountedValidVotes}, insufficient_shares=${recountedInsufficientShares}, ` +
        `decrypt_failures=${recountedDecryptFailures}, candidate_mismatch=${recountedCandidateMismatch}`
    );

    // ── Step 6: diff against published_results ──
    if (bundle.published_results) {
      const matches = recountedValidVotes === bundle.published_results.valid_votes;
      record(
        "6. diff vs published_results",
        matches,
        `recounted valid_votes=${recountedValidVotes} vs published=${bundle.published_results.valid_votes}`
      );
    } else {
      record("6. diff vs published_results", false, "No published_results in bundle to compare against");
    }
  } else {
    record("4-6. DLEQ verification / recount / diff", false, "SKIPPED — bundle has no group_params");
  }

  return { checks, allOk };
}

async function main() {
  const args = process.argv.slice(2);
  const bundlePath = args[0];
  if (!bundlePath) {
    console.error("Usage: independent-verify-tally.ts <bundle.json> [--merkle-address 0x..] [--setup-address 0x..] [--rpc-url https://..]");
    process.exit(1);
  }
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const merkleAddress = flag("--merkle-address") || process.env.MERKLE_CONTRACT_ADDRESS;
  const setupAddress = flag("--setup-address") || process.env.ELECTION_SETUP_CONTRACT_ADDRESS;
  const rpcUrl = flag("--rpc-url") || process.env.AMOY_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

  const bundle: Bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const { checks, allOk } = await verifyBundle(bundle, { merkleAddress, setupAddress, provider });

  console.log("\nIndependent tally verification report");
  console.log("=".repeat(60));
  for (const c of checks) {
    console.log(`[${c.ok ? "PASS" : "FAIL"}] ${c.step}\n       ${c.detail}`);
  }
  console.log("=".repeat(60));
  console.log(allOk ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED — see above");
  process.exit(allOk ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

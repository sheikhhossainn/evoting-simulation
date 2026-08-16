/**
 * independent-verify-tally.test.ts — adversarial bundle tests for the
 * standalone verifier's REJECTION paths.
 *
 * Methodology-audit finding M2: the design doc (§13, tests 11/13/14/15/16)
 * requires the verifier's reject-on-bad-input behavior to be explicitly
 * tested, not just its accept-on-good-input behavior — a verifier that
 * always prints PASS regardless of what it's given would also pass a
 * happy-path-only test suite. Every prior run of this script was against a
 * genuinely correct bundle; these tests deliberately corrupt one field at a
 * time and assert the corresponding check fails.
 *
 * No network/RPC needed for steps 2-6 — merkleAddress/setupAddress/provider
 * are omitted, so steps 1/1b/2a-on-chain are expected-FAIL ("SKIPPED", by
 * design, same as the CLI's own behavior with no --merkle-address) and are
 * asserted separately from the steps under test here.
 */
import { describe, it, expect } from "vitest";
import { generateKeypair, modPow, encryptCandidateId } from "../crypto/elgamal";
import { splitSecretZq, type ShareZq } from "../crypto/shamirZq";
import { proveDleq, type DleqProof } from "../crypto/dleq";
import { buildMerkleTree, hashVoteLeaf } from "../merkle/merkleTree";
import { buildAndComputeCommitment } from "../crypto/candidateCommitment";
import { SparseMerkleTree } from "../merkle/sparseMerkleTree";
import { verifyBundle, type Bundle } from "./independent-verify-tally";

function randomBigIntBelow(max: bigint): bigint {
  const crypto = require("crypto");
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

const ELECTION_ID = "TEST-VERIFY-ELECTION";
const CONSTITUENCY = "CON-01";
const CANDIDATE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

/** Build one genuine, fully-consistent bundle: 1 ballot, 3 valid keyholder partials. */
function buildGenuineBundle(): Bundle {
  const { publicKey, privateKey } = generateKeypair();
  const p = BigInt("0x" + publicKey.p);
  const g = BigInt("0x" + publicKey.g);
  const q = (p - 1n) / 2n;
  const x = BigInt("0x" + privateKey.x);
  const xPrime = x % q;

  const { shares, commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q), 4, 3);
  const yByIndex = new Map<number, bigint>(shares.map((s: ShareZq) => [Number(s.index), modPow(g, s.value, p)]));

  const ct = encryptCandidateId(CANDIDATE_ID, publicKey);
  const ballotId = "ballot-1";
  const createdAt = "2026-01-01T00:00:00.000Z";

  const chosen = shares.slice(0, 3);
  const partial_decryptions = chosen.map((s: ShareZq) => {
    const d_i = modPow(BigInt("0x" + ct.c1), s.value, p).toString(16);
    const proof: DleqProof = proveDleq(
      ELECTION_ID,
      ballotId,
      ct.c1,
      d_i,
      s.value,
      yByIndex.get(Number(s.index))!.toString(16),
      g,
      p,
      q
    );
    return { ballot_id: ballotId, keyholder_index: Number(s.index), d_i, proof };
  });

  const leaf = hashVoteLeaf({ voteId: ballotId, c1: ct.c1, c2: ct.c2, createdAt });
  const tree = buildMerkleTree([leaf]);

  const nullifierHash = "0x" + "ab".repeat(32);
  const smt = new SparseMerkleTree();
  smt.insert(nullifierHash, leaf);
  const smtMembershipProof = smt.getMembershipProof(nullifierHash);

  const candidates = [
    { id: CANDIDATE_ID, name: "Test Candidate", party: "Test Party", symbol: "star", constituency_code: CONSTITUENCY },
  ];
  const constituencies = [{ code: CONSTITUENCY, name: "Test Constituency" }];
  const { commitment } = buildAndComputeCommitment(ELECTION_ID, candidates, constituencies);

  return {
    election_id: ELECTION_ID,
    anchored_batch_ref: {
      dense_batch_id: 0,
      dense_root: tree.root,
      smt_batch_id: 0,
      smt_root: smt.root(),
      total_keys_anchored: 1,
    },
    group_params: { p: publicKey.p, g: publicKey.g },
    keyholder_commitments: shares.map((s: ShareZq) => ({
      index: Number(s.index),
      y_i: yByIndex.get(Number(s.index))!.toString(16),
    })),
    ballots: [{ ballot_id: ballotId, c1: ct.c1, c2: ct.c2, constituency_code: CONSTITUENCY, created_at: createdAt }],
    partial_decryptions,
    smt_membership_proofs: [
      { ballot_id: ballotId, nullifier_hash: nullifierHash, type: "membership", proof: smtMembershipProof },
    ],
    candidates,
    constituencies,
    election_setup_commitment: commitment,
    candidates_root: null,
    constituencies_root: null,
    independently_observed_vote_count: 1,
    published_results: { total_votes: 1, valid_votes: 1, invalid_votes: 0, results: [] },
  };
}

function findCheck(checks: { step: string; ok: boolean; detail: string }[], prefix: string) {
  const c = checks.find((c) => c.step.startsWith(prefix));
  if (!c) throw new Error(`No check found with prefix "${prefix}"`);
  return c;
}

describe("independent-verify-tally: genuine bundle", () => {
  it("passes every check that doesn't require live RPC access", async () => {
    const bundle = buildGenuineBundle();
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "1c. per-ballot SMT membership proof verification").ok).toBe(true);
    expect(findCheck(checks, "2. dense root rebuild").ok).toBe(true);
    expect(findCheck(checks, "2a. candidate/constituency commitment (recomputed vs bundle)").ok).toBe(true);
    expect(findCheck(checks, "3. completeness cross-check").ok).toBe(true);
    expect(findCheck(checks, "5. independent recount").ok).toBe(true);
    expect(findCheck(checks, "6. diff vs published_results").ok).toBe(true);
  });
});

describe("independent-verify-tally: rejection paths (docs §13 tests 14/15/16 — never previously exercised)", () => {
  it("rejects a bundle whose claimed dense_root doesn't match a rebuild from ballots[] (substituted ballot)", async () => {
    const bundle = buildGenuineBundle();
    // Simulate a substituted ciphertext: c1 changed after the root was computed.
    bundle.ballots[0].c1 = (BigInt("0x" + bundle.ballots[0].c1) + 1n).toString(16);
    const { checks, allOk } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "2. dense root rebuild").ok).toBe(false);
    expect(allOk).toBe(false);
  });

  it("rejects a bundle with a tampered dense_root directly", async () => {
    const bundle = buildGenuineBundle();
    bundle.anchored_batch_ref.dense_root = "0x" + "ff".repeat(32);
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "2. dense root rebuild").ok).toBe(false);
  });

  it("rejects a bundle with a tampered election_setup_commitment (relabeled candidate metadata)", async () => {
    const bundle = buildGenuineBundle();
    bundle.candidates[0].name = "Different Candidate Name";
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "2a. candidate/constituency commitment (recomputed vs bundle)").ok).toBe(false);
  });

  it("flags a gross completeness mismatch (total_keys_anchored far below independently_observed_vote_count)", async () => {
    const bundle = buildGenuineBundle();
    bundle.independently_observed_vote_count = 100; // 1 anchored vs 100 observed — well over the 5% threshold
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "3. completeness cross-check").ok).toBe(false);
  });

  it("flags total_keys_anchored > 0 with independently_observed_vote_count === 0 (methodology-audit finding m2 — previously silently passed)", async () => {
    const bundle = buildGenuineBundle();
    bundle.independently_observed_vote_count = 0;
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "3. completeness cross-check").ok).toBe(false);
  });

  it("rejects a bundle where published_results.valid_votes doesn't match the independent recount", async () => {
    const bundle = buildGenuineBundle();
    bundle.published_results!.valid_votes = 999;
    const { checks, allOk } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "6. diff vs published_results").ok).toBe(false);
    expect(allOk).toBe(false);
  });

  it("does not silently tally a ballot with only 2 valid partials (insufficient shares)", async () => {
    const bundle = buildGenuineBundle();
    bundle.partial_decryptions = bundle.partial_decryptions.slice(0, 2); // drop to 2-of-3
    bundle.published_results!.valid_votes = 1; // server would have rejected this too — mismatch expected
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "5. independent recount").detail).toMatch(/insufficient_shares=1/);
    expect(findCheck(checks, "6. diff vs published_results").ok).toBe(false);
  });

  it("rejects when the on-chain SMT batch check is unreachable but a batch is claimed (methodology-audit finding M1)", async () => {
    const bundle = buildGenuineBundle();
    const { checks } = await verifyBundle(bundle, {}); // no merkleAddress/provider supplied
    expect(findCheck(checks, "1b. on-chain SMT batch root").ok).toBe(false);
  });

  it("rejects a bundle whose per-ballot SMT membership proof doesn't verify against the claimed smt_root (methodology-audit finding M1 follow-up)", async () => {
    const bundle = buildGenuineBundle();
    const proof = bundle.smt_membership_proofs![0].proof as { value: string };
    proof.value = "0x" + "99".repeat(32); // tampered leaf value — proof no longer reconstructs smt_root
    const { checks, allOk } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "1c. per-ballot SMT membership proof verification").ok).toBe(false);
    expect(allOk).toBe(false);
  });

  it("rejects a bundle where a ballot has no corresponding smt_membership_proofs entry (silently omitted coverage)", async () => {
    const bundle = buildGenuineBundle();
    bundle.smt_membership_proofs = [];
    const { checks } = await verifyBundle(bundle, {});
    const check = findCheck(checks, "1c. per-ballot SMT membership proof verification");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/no smt_membership_proofs/);
  });

  it("rejects a bundle where a ballot's SMT proof is only a non-membership proof (claims the ballot isn't actually anchored)", async () => {
    const bundle = buildGenuineBundle();
    bundle.smt_membership_proofs![0].type = "non-membership";
    const { checks } = await verifyBundle(bundle, {});
    expect(findCheck(checks, "1c. per-ballot SMT membership proof verification").ok).toBe(false);
  });

  it("rejects a bundle where the SMT proof genuinely verifies against smt_root but belongs to a DIFFERENT, unrelated leaf (security-audit finding: hash-only attack — proof isn't content-bound to the ballot it's attached to)", async () => {
    const bundle = buildGenuineBundle();

    // A second, genuinely-anchored leaf under a different nullifier — this
    // simulates a server substituting an unrelated-but-real proof onto
    // ballot-1's entry instead of ballot-1's own proof. verifySmtMembershipProof
    // alone would pass (the decoy leaf really is in the tree); only the
    // recomputed-value cross-check introduced by this fix catches the swap.
    const decoyLeaf = hashVoteLeaf({
      voteId: "ballot-decoy",
      c1: "deadbeef",
      c2: "cafebabe",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const decoyNullifier = "0x" + "cd".repeat(32);
    const smt = new SparseMerkleTree();
    const realNullifier = bundle.smt_membership_proofs![0].nullifier_hash;
    const realProof = bundle.smt_membership_proofs![0].proof as { value: string };
    smt.insert(realNullifier, realProof.value);
    smt.insert(decoyNullifier, decoyLeaf);

    bundle.anchored_batch_ref.smt_root = smt.root();
    bundle.smt_membership_proofs![0].proof = smt.getMembershipProof(decoyNullifier);

    const { checks, allOk } = await verifyBundle(bundle, {});
    const check = findCheck(checks, "1c. per-ballot SMT membership proof verification");
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/does not match this ballot's own ciphertext/);
    expect(allOk).toBe(false);
  });
});

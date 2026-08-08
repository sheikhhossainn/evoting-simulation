/**
 * zkp.ts — Disjunctive Chaum-Pedersen NIZK OR-proof for ballot validity
 *
 * Proves that an ElGamal ciphertext (c1, c2) encrypts ONE of a list of
 * valid candidate encodings, without revealing which.
 *
 * Scheme: standard Σ-protocol OR-composition (Cramer–Damgård–Schoenmakers '94),
 * made non-interactive via Fiat-Shamir with SHA-256.
 *
 * NOT a zk-SNARK — this is a lightweight, direct proof that works with the
 * existing 256-bit ElGamal parameters.
 *
 * Security argument (zero-knowledge property):
 *   The simulated transcripts for the non-chosen branches are computationally
 *   indistinguishable from real transcripts because the simulator freely picks
 *   (e_j, z_j) and derives (a_j, b_j) — the verification equation is satisfied
 *   by construction, and the simulated values are uniformly distributed in Z_q.
 *   The Fiat-Shamir hash binds all commitments, preventing malleability. This
 *   is a standard result from the CDS94 OR-proof composition; it does not
 *   require empirical testing — it follows from the DDH assumption on the
 *   prime-order subgroup.
 */

import crypto from "crypto";
import {
  modPow,
  modInverse,
  encodeCandidateId,
  type ElGamalPublicKey,
} from "./elgamal";

// ── Types ──

export interface ZkpProof {
  /** Per-candidate partial challenges (hex strings), one per candidate encoding */
  challenges: string[];
  /** Per-candidate responses (hex strings), one per candidate encoding */
  responses: string[];
}

// ── Internal helpers ──

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

/**
 * Generate a random BigInt in [1, max-1] using Node crypto.
 * Used for simulator randomness and the prover's commitment.
 */
function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

/**
 * Fiat-Shamir challenge: SHA-256 over the transcript, reduced mod q.
 *
 * Input order: g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1 ‖ …
 * Each element is serialised as its minimal hex representation.
 */
function fiatShamirChallenge(
  g: bigint,
  y: bigint,
  c1: bigint,
  c2: bigint,
  commitments: { a: bigint; b: bigint }[],
  q: bigint
): bigint {
  const parts: string[] = [
    bigIntToHex(g),
    bigIntToHex(y),
    bigIntToHex(c1),
    bigIntToHex(c2),
  ];
  for (const { a, b } of commitments) {
    parts.push(bigIntToHex(a));
    parts.push(bigIntToHex(b));
  }
  const preimage = parts.join(",");
  const hash = crypto.createHash("sha256").update(preimage).digest("hex");
  return BigInt("0x" + hash) % q;
}

// ── Public API ──

/**
 * Prove that the ElGamal ciphertext (c1, c2) encrypts the candidate at
 * `trueIndex` in `candidateIds`, without revealing which.
 *
 * @param c1Hex             - g^k mod p (hex)
 * @param c2Hex             - m·y^k mod p (hex)
 * @param kHex              - the ephemeral exponent used during encryption (hex)
 * @param pubKey            - ElGamal public key { p, g, y }
 * @param candidateIds      - ordered list of valid candidate UUIDs for the constituency
 * @param trueIndex         - index into candidateIds of the actually-encrypted candidate
 * @returns                 - ZkpProof with challenges[] and responses[] (hex strings)
 */
export function proveBallotValidity(
  c1Hex: string,
  c2Hex: string,
  kHex: string,
  pubKey: ElGamalPublicKey,
  candidateIds: string[],
  trueIndex: number
): ZkpProof {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);
  const q = (p - 1n) / 2n; // safe prime: p = 2q + 1
  const c1 = hexToBigInt(c1Hex);
  const c2 = hexToBigInt(c2Hex);
  const k = hexToBigInt(kHex);

  const n = candidateIds.length;
  if (n === 0) throw new Error("candidateIds must not be empty");
  if (trueIndex < 0 || trueIndex >= n) {
    throw new Error("trueIndex out of range");
  }

  // Encode all candidate UUIDs to their BigInt plaintexts
  const encodings = candidateIds.map((id) => encodeCandidateId(id));

  // For each candidate i, the "target" is c2 / m_i mod p.
  // If i == trueIndex, then c2 / m_i = y^k (the real discrete-log relation).
  const targets = encodings.map((m_i) => {
    const mInv = modInverse(m_i, p);
    return (c2 * mInv) % p;
  });

  // ── Simulate non-true branches, commit on the real branch ──
  const challenges: bigint[] = new Array(n);
  const responses: bigint[] = new Array(n);
  const commitments: { a: bigint; b: bigint }[] = new Array(n);

  // Real branch: pick random w, compute commitment (a_t, b_t)
  const w = randomBigIntBelow(q);
  commitments[trueIndex] = {
    a: modPow(g, w, p),
    b: modPow(y, w, p),
  };

  // Simulated branches: pick random (e_j, z_j), derive (a_j, b_j)
  let challengeSum = 0n;
  for (let j = 0; j < n; j++) {
    if (j === trueIndex) continue;

    const e_j = randomBigIntBelow(q);
    const z_j = randomBigIntBelow(q);
    challenges[j] = e_j;
    responses[j] = z_j;
    challengeSum = (challengeSum + e_j) % q;

    // a_j = g^z_j · c1^(-e_j) mod p
    const c1InvE = modPow(modInverse(c1, p), e_j, p);
    const a_j = (modPow(g, z_j, p) * c1InvE) % p;

    // b_j = y^z_j · target_j^(-e_j) mod p
    const tInvE = modPow(modInverse(targets[j], p), e_j, p);
    const b_j = (modPow(y, z_j, p) * tInvE) % p;

    commitments[j] = { a: a_j, b: b_j };
  }

  // ── Fiat-Shamir: compute the global challenge e ──
  const e = fiatShamirChallenge(g, y, c1, c2, commitments, q);

  // Real branch: e_t = e - Σ(e_j for j ≠ t) mod q
  const e_t = ((e - challengeSum) % q + q) % q;
  challenges[trueIndex] = e_t;

  // z_t = w + e_t · k mod q
  responses[trueIndex] = (w + e_t * k) % q;

  return {
    challenges: challenges.map(bigIntToHex),
    responses: responses.map(bigIntToHex),
  };
}

/**
 * Verify a ZKP proof that the ElGamal ciphertext (c1, c2) encrypts one
 * of the given candidate UUIDs.
 *
 * @param c1Hex         - g^k mod p (hex)
 * @param c2Hex         - m·y^k mod p (hex)
 * @param pubKey        - ElGamal public key { p, g, y }
 * @param candidateIds  - ordered list of valid candidate UUIDs (same order as prove)
 * @param proof         - { challenges[], responses[] } (hex strings)
 * @returns             - true iff the proof is valid
 */
export function verifyBallotValidity(
  c1Hex: string,
  c2Hex: string,
  pubKey: ElGamalPublicKey,
  candidateIds: string[],
  proof: ZkpProof
): boolean {
  try {
    const p = hexToBigInt(pubKey.p);
    const g = hexToBigInt(pubKey.g);
    const y = hexToBigInt(pubKey.y);
    const q = (p - 1n) / 2n;
    const c1 = hexToBigInt(c1Hex);
    const c2 = hexToBigInt(c2Hex);

    const n = candidateIds.length;
    if (
      n === 0 ||
      proof.challenges.length !== n ||
      proof.responses.length !== n
    ) {
      return false;
    }

    const encodings = candidateIds.map((id) => encodeCandidateId(id));
    const targets = encodings.map((m_i) => {
      const mInv = modInverse(m_i, p);
      return (c2 * mInv) % p;
    });

    const challenges = proof.challenges.map(hexToBigInt);
    const responses = proof.responses.map(hexToBigInt);

    // Recompute commitments (a_i, b_i) from (e_i, z_i)
    const commitments: { a: bigint; b: bigint }[] = [];
    for (let i = 0; i < n; i++) {
      const e_i = challenges[i];
      const z_i = responses[i];

      // a_i = g^z_i · c1^(-e_i) mod p
      const c1InvE = modPow(modInverse(c1, p), e_i, p);
      const a_i = (modPow(g, z_i, p) * c1InvE) % p;

      // b_i = y^z_i · target_i^(-e_i) mod p
      const tInvE = modPow(modInverse(targets[i], p), e_i, p);
      const b_i = (modPow(y, z_i, p) * tInvE) % p;

      commitments.push({ a: a_i, b: b_i });
    }

    // Recompute the Fiat-Shamir challenge
    const e = fiatShamirChallenge(g, y, c1, c2, commitments, q);

    // Check: Σ e_i ≡ e (mod q)
    let challengeSum = 0n;
    for (const e_i of challenges) {
      challengeSum = (challengeSum + e_i) % q;
    }

    return challengeSum === e;
  } catch {
    // Any malformed input (bad hex, bad UUID, etc.) → reject
    return false;
  }
}

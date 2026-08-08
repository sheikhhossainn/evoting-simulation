/**
 * zkp.test.ts — Tests for disjunctive Chaum-Pedersen ballot-validity proof
 *
 * Covers §11c of testing_guidance.md:
 *   • valid proof → verifies
 *   • forged (ciphertext of a value not in the candidate list) → rejected
 *   • tampered proof (flip one byte in a challenge/response) → rejected
 *   • proof for ballot A checked against ballot B → rejected
 *
 * NOTE on zero-knowledge property (§11c):
 *   The zero-knowledge property is a design argument validated by the
 *   CDS94 OR-proof security proof under the DDH assumption — it is not
 *   something that can be tested empirically. A simulator can produce
 *   transcripts indistinguishable from real ones because it freely
 *   chooses (e_j, z_j) for all branches and derives (a_j, b_j) to
 *   satisfy the verification equations. This is covered in the design
 *   writeup, not in this test file.
 */

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import {
  generateKeypair,
  modPow,
  modInverse,
  encodeCandidateId,
  type ElGamalPublicKey,
  type ElGamalPrivateKey,
} from "./elgamal";
import {
  proveBallotValidity,
  verifyBallotValidity,
  type ZkpProof,
} from "./zkp";

// ── Shared test fixtures ──

/** Deterministic candidate UUIDs for a constituency */
const CANDIDATE_IDS = [
  "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  "dddddddd-dddd-4ddd-dddd-dddddddddddd",
];

/** UUID that is NOT in the candidate list */
const FORGED_CANDIDATE = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";

/** Helpers to work at the raw BigInt level (same as elgamal.test.ts) */
function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

/**
 * Encrypt a candidate UUID with a known ephemeral k, returning (c1, c2, k)
 * all as hex — needed because the prover requires k.
 */
function encryptWithKnownK(
  candidateId: string,
  pubKey: ElGamalPublicKey
): { c1: string; c2: string; k: string } {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);
  const m = encodeCandidateId(candidateId);

  // Random k ∈ [2, p-2]
  const byteLen = Math.ceil(p.toString(16).length / 2);
  let k: bigint;
  do {
    k = BigInt("0x" + crypto.randomBytes(byteLen).toString("hex")) % (p - 3n) + 2n;
  } while (k >= p - 1n || k < 2n);

  const c1 = modPow(g, k, p);
  const c2 = (m * modPow(y, k, p)) % p;

  return { c1: bigIntToHex(c1), c2: bigIntToHex(c2), k: bigIntToHex(k) };
}

describe("zkp — disjunctive Chaum-Pedersen ballot validity proof", () => {
  let publicKey: ElGamalPublicKey;
  let privateKey: ElGamalPrivateKey;

  beforeAll(() => {
    const keypair = generateKeypair();
    publicKey = keypair.publicKey;
    privateKey = keypair.privateKey;
  });

  // ────────────────────────────────────────────────
  // §11c-1: valid proof → verifies
  // ────────────────────────────────────────────────

  describe("valid proof verification", () => {
    it("accepts a proof for each candidate position", () => {
      for (let i = 0; i < CANDIDATE_IDS.length; i++) {
        const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[i], publicKey);
        const proof = proveBallotValidity(
          c1, c2, k, publicKey, CANDIDATE_IDS, i
        );

        expect(proof.challenges).toHaveLength(CANDIDATE_IDS.length);
        expect(proof.responses).toHaveLength(CANDIDATE_IDS.length);

        const valid = verifyBallotValidity(
          c1, c2, publicKey, CANDIDATE_IDS, proof
        );
        expect(valid).toBe(true);
      }
    });

    it("accepts a proof with only two candidates", () => {
      const twoIds = CANDIDATE_IDS.slice(0, 2);
      const { c1, c2, k } = encryptWithKnownK(twoIds[1], publicKey);
      const proof = proveBallotValidity(c1, c2, k, publicKey, twoIds, 1);
      expect(verifyBallotValidity(c1, c2, publicKey, twoIds, proof)).toBe(true);
    });

    it("accepts 50 random encryptions of random valid candidates", () => {
      for (let trial = 0; trial < 50; trial++) {
        const idx = Math.floor(Math.random() * CANDIDATE_IDS.length);
        const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[idx], publicKey);
        const proof = proveBallotValidity(
          c1, c2, k, publicKey, CANDIDATE_IDS, idx
        );
        expect(
          verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, proof)
        ).toBe(true);
      }
    });
  });

  // ────────────────────────────────────────────────
  // §11c-2: forged (ciphertext of value not in list) → rejected
  // ────────────────────────────────────────────────

  describe("forged ciphertext rejection", () => {
    it("rejects a proof where the encrypted value is not in the candidate list", () => {
      // Encrypt a candidate NOT in the list
      const { c1, c2, k } = encryptWithKnownK(FORGED_CANDIDATE, publicKey);

      // Attempt to forge: claim it's candidate 0 (the prover "lies" about trueIndex)
      // The proof should either fail during generation or fail verification.
      // proveBallotValidity will generate with trueIndex=0 but the ciphertext
      // actually encrypts FORGED_CANDIDATE. The math won't work because
      // c2/m_0 ≠ y^k, so the real branch will produce an invalid z_t.
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, 0
      );
      const valid = verifyBallotValidity(
        c1, c2, publicKey, CANDIDATE_IDS, proof
      );
      expect(valid).toBe(false);
    });

    it("rejects forgery attempt for each candidate position", () => {
      const { c1, c2, k } = encryptWithKnownK(FORGED_CANDIDATE, publicKey);

      for (let i = 0; i < CANDIDATE_IDS.length; i++) {
        const proof = proveBallotValidity(
          c1, c2, k, publicKey, CANDIDATE_IDS, i
        );
        expect(
          verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, proof)
        ).toBe(false);
      }
    });
  });

  // ────────────────────────────────────────────────
  // §11c-3: tampered proof → rejected
  // ────────────────────────────────────────────────

  describe("tampered proof rejection", () => {
    it("rejects when a challenge value is altered", () => {
      const idx = 0;
      const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[idx], publicKey);
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, idx
      );

      // Tamper with the first challenge: flip the last hex digit
      const tampered: ZkpProof = {
        challenges: [...proof.challenges],
        responses: [...proof.responses],
      };
      const original = tampered.challenges[0];
      const lastChar = original[original.length - 1];
      const flipped = lastChar === "0" ? "1" : "0";
      tampered.challenges[0] =
        original.slice(0, -1) + flipped;

      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, tampered)
      ).toBe(false);
    });

    it("rejects when a response value is altered", () => {
      const idx = 2;
      const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[idx], publicKey);
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, idx
      );

      // Tamper with the last response
      const tampered: ZkpProof = {
        challenges: [...proof.challenges],
        responses: [...proof.responses],
      };
      const original = tampered.responses[CANDIDATE_IDS.length - 1];
      const lastChar = original[original.length - 1];
      const flipped = lastChar === "f" ? "e" : "f";
      tampered.responses[CANDIDATE_IDS.length - 1] =
        original.slice(0, -1) + flipped;

      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, tampered)
      ).toBe(false);
    });

    it("rejects when an extra challenge/response pair is appended", () => {
      const idx = 1;
      const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[idx], publicKey);
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, idx
      );

      const tampered: ZkpProof = {
        challenges: [...proof.challenges, "deadbeef"],
        responses: [...proof.responses, "cafebabe"],
      };

      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, tampered)
      ).toBe(false);
    });

    it("rejects when challenges/responses arrays are swapped", () => {
      const idx = 0;
      const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[idx], publicKey);
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, idx
      );

      const swapped: ZkpProof = {
        challenges: proof.responses,
        responses: proof.challenges,
      };

      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, swapped)
      ).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // §11c-4: proof for ballot A checked against ballot B → rejected
  // ────────────────────────────────────────────────

  describe("cross-ballot proof rejection", () => {
    it("rejects a proof generated for ballot A when verified against ballot B", () => {
      // Generate two different ballots for different candidates
      const { c1: c1A, c2: c2A, k: kA } = encryptWithKnownK(
        CANDIDATE_IDS[0], publicKey
      );
      const { c1: c1B, c2: c2B } = encryptWithKnownK(
        CANDIDATE_IDS[1], publicKey
      );

      // Generate proof for ballot A
      const proofA = proveBallotValidity(
        c1A, c2A, kA, publicKey, CANDIDATE_IDS, 0
      );

      // Verify proof A against ballot A → should pass
      expect(
        verifyBallotValidity(c1A, c2A, publicKey, CANDIDATE_IDS, proofA)
      ).toBe(true);

      // Verify proof A against ballot B → should fail
      expect(
        verifyBallotValidity(c1B, c2B, publicKey, CANDIDATE_IDS, proofA)
      ).toBe(false);
    });

    it("rejects same-candidate different-randomness cross-ballot", () => {
      // Two encryptions of the SAME candidate but different ephemeral k
      const { c1: c1A, c2: c2A, k: kA } = encryptWithKnownK(
        CANDIDATE_IDS[2], publicKey
      );
      const { c1: c1B, c2: c2B } = encryptWithKnownK(
        CANDIDATE_IDS[2], publicKey
      );

      const proofA = proveBallotValidity(
        c1A, c2A, kA, publicKey, CANDIDATE_IDS, 2
      );

      // Same candidate, same proof, but different ciphertext → fail
      expect(
        verifyBallotValidity(c1B, c2B, publicKey, CANDIDATE_IDS, proofA)
      ).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("rejects empty candidate list", () => {
      expect(() =>
        proveBallotValidity("1", "1", "1", publicKey, [], 0)
      ).toThrow("candidateIds must not be empty");
    });

    it("rejects trueIndex out of range", () => {
      expect(() =>
        proveBallotValidity("1", "1", "1", publicKey, CANDIDATE_IDS, 5)
      ).toThrow("trueIndex out of range");
    });

    it("rejects proof with mismatched array lengths", () => {
      const { c1, c2, k } = encryptWithKnownK(CANDIDATE_IDS[0], publicKey);
      const proof = proveBallotValidity(
        c1, c2, k, publicKey, CANDIDATE_IDS, 0
      );

      // Remove one challenge
      const bad: ZkpProof = {
        challenges: proof.challenges.slice(0, -1),
        responses: proof.responses,
      };
      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, bad)
      ).toBe(false);
    });

    it("verifier returns false (not throws) on malformed hex", () => {
      const { c1, c2 } = encryptWithKnownK(CANDIDATE_IDS[0], publicKey);
      const bad: ZkpProof = {
        challenges: ["not-hex", "also-bad", "xyz", "!!!"],
        responses: ["1", "2", "3", "4"],
      };
      expect(
        verifyBallotValidity(c1, c2, publicKey, CANDIDATE_IDS, bad)
      ).toBe(false);
    });
  });
});

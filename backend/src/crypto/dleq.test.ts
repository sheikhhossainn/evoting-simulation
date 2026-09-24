import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { generateKeypair, decryptCandidateId, encryptCandidateId, modPow } from "./elgamal";
import { splitSecretZq, type ShareZq } from "./shamirZq";
import {
  computePartialDecryption,
  proveDleq,
  verifyDleq,
  combinePartialDecryptions,
  isSubgroupMember,
  type ValidPartial,
} from "./dleq";

function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

function setup() {
  const { publicKey, privateKey } = generateKeypair();
  const p = BigInt("0x" + publicKey.p);
  const g = BigInt("0x" + publicKey.g);
  const q = (p - 1n) / 2n;
  const x = BigInt("0x" + privateKey.x);
  const xPrime = x % q;
  const { shares, commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
  const yByIndex = new Map(
    shares.map((s) => [s.index.toString(), modPow(g, s.value, p)])
  );
  return { publicKey, privateKey, p, g, q, xPrime, shares, commitments, yByIndex };
}

/**
 * A genuine subgroup-member c1, matching what real ElGamal encryption
 * always produces (c1 = g^k mod p, always in the order-q subgroup g
 * generates). Using this instead of an arbitrary random element of Z*_p is
 * required, not stylistic — see isSubgroupMember's comment in dleq.ts and
 * the dedicated "rejects an out-of-subgroup c1" tests below, which cover
 * the case this fixture deliberately avoids everywhere else.
 */
function randomSubgroupC1(g: bigint, p: bigint, q: bigint): string {
  const k = randomBigIntBelow(q);
  return modPow(g, k, p).toString(16);
}

/** A value in Z*_p guaranteed NOT to be in the order-q subgroup (a quadratic non-residue). */
function randomNonSubgroupElement(p: bigint, q: bigint): bigint {
  let candidate: bigint;
  do {
    candidate = randomBigIntBelow(p);
  } while (candidate === 0n || modPow(candidate, q, p) === 1n);
  return candidate;
}

const ELECTION_ID = "TEST-ELECTION-001";

describe("DLEQ partial decryption (docs/tally-verifiability-design.md §13)", () => {
  // Test 4: Partial decryption correctness
  it("combining 3 valid partials recovers the same plaintext as direct decryption", () => {
    const { publicKey, privateKey, p, q, shares } = setup();
    const candidateId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const ct = encryptCandidateId(candidateId, publicKey);

    const chosen = shares.slice(0, 3);
    const partials: ValidPartial[] = chosen.map((s: ShareZq) => ({
      index: s.index,
      d_iHex: computePartialDecryption(ct.c1, s.value, p, q),
    }));

    const mHex = combinePartialDecryptions(partials, ct.c2, p, q);
    const directDecrypt = decryptCandidateId(ct, privateKey);

    const expected = BigInt("0x" + directDecrypt.replace(/-/g, ""));
    expect(BigInt("0x" + mHex)).toBe(expected);
  });

  // Test 5: DLEQ proof round-trip
  it("a genuine proof verifies", () => {
    const { p, g, q, shares, yByIndex } = setup();
    const ballotId = "ballot-1";
    const c1Hex = randomSubgroupC1(g, p, q);
    const share = shares[0];
    const d_iHex = computePartialDecryption(c1Hex, share.value, p, q);
    const y_iHex = yByIndex.get(share.index.toString())!.toString(16);

    const proof = proveDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, share.value, y_iHex, g, p, q);
    expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, y_iHex, proof, g, p, q)).toBe(true);
  });

  // Regression tests for the subgroup-membership bug found via adversarial
  // stress-testing (3000-trial repro, ~0.1%+ failure rate on out-of-subgroup
  // c1). Must keep failing if the isSubgroupMember checks in dleq.ts are
  // ever reverted or weakened.
  describe("out-of-subgroup c1 is rejected cleanly, not left to behave unpredictably", () => {
    it("isSubgroupMember correctly classifies subgroup members and non-members", () => {
      const { p, g, q } = setup();
      const member = modPow(g, randomBigIntBelow(q), p);
      const nonMember = randomNonSubgroupElement(p, q);
      expect(isSubgroupMember(member, p, q)).toBe(true);
      expect(isSubgroupMember(nonMember, p, q)).toBe(false);
    });

    it("computePartialDecryption throws on an out-of-subgroup c1", () => {
      const { p, q, shares } = setup();
      const badC1 = randomNonSubgroupElement(p, q).toString(16);
      expect(() => computePartialDecryption(badC1, shares[0].value, p, q)).toThrow(
        /prime-order subgroup/
      );
    });

    it("proveDleq throws on an out-of-subgroup c1", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const share = shares[0];
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);
      const badC1 = randomNonSubgroupElement(p, q).toString(16);
      // d_i here is nonsensical for a bad c1, but proveDleq must reject
      // before ever getting far enough to care.
      expect(() =>
        proveDleq(ELECTION_ID, "ballot-1", badC1, "01", share.value, y_iHex, g, p, q)
      ).toThrow(/prime-order subgroup/);
    });

    it("verifyDleq returns false (not throws, not flaky) on an out-of-subgroup c1, even with an otherwise-well-formed proof", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const share = shares[0];
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);

      // Build a genuine, valid proof against a real subgroup c1 first...
      const goodC1 = randomSubgroupC1(g, p, q);
      const d_i = computePartialDecryption(goodC1, share.value, p, q);
      const proof = proveDleq(ELECTION_ID, "ballot-1", goodC1, d_i, share.value, y_iHex, g, p, q);
      expect(verifyDleq(ELECTION_ID, "ballot-1", goodC1, d_i, y_iHex, proof, g, p, q)).toBe(true);

      // ...then confirm re-verifying the SAME proof against an
      // out-of-subgroup c1 is a clean, deterministic rejection.
      const badC1 = randomNonSubgroupElement(p, q).toString(16);
      expect(verifyDleq(ELECTION_ID, "ballot-1", badC1, d_i, y_iHex, proof, g, p, q)).toBe(false);
    });

    it("1000-trial stress check: every out-of-subgroup c1 is rejected, every subgroup c1 works", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const share = shares[0];
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);

      for (let i = 0; i < 500; i++) {
        const c1Hex = randomSubgroupC1(g, p, q);
        const d_i = computePartialDecryption(c1Hex, share.value, p, q);
        const proof = proveDleq(ELECTION_ID, "ballot-x", c1Hex, d_i, share.value, y_iHex, g, p, q);
        expect(verifyDleq(ELECTION_ID, "ballot-x", c1Hex, d_i, y_iHex, proof, g, p, q)).toBe(true);
      }

      for (let i = 0; i < 500; i++) {
        const badC1 = randomNonSubgroupElement(p, q).toString(16);
        expect(() => computePartialDecryption(badC1, share.value, p, q)).toThrow();
      }
    });
  });

  // Test 6: DLEQ forgery rejection
  describe("forgery rejection", () => {
    function fixture() {
      const { p, g, q, shares, yByIndex } = setup();
      const ballotId = "ballot-1";
      const c1Hex = randomSubgroupC1(g, p, q);
      const share = shares[0];
      const d_iHex = computePartialDecryption(c1Hex, share.value, p, q);
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);
      const proof = proveDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, share.value, y_iHex, g, p, q);
      return { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof };
    }

    it("rejects a tampered t1", () => {
      const { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof } = fixture();
      const bad = { ...proof, t1: (BigInt("0x" + proof.t1) + 1n).toString(16) };
      expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, y_iHex, bad, g, p, q)).toBe(false);
    });

    it("rejects a tampered t2", () => {
      const { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof } = fixture();
      const bad = { ...proof, t2: (BigInt("0x" + proof.t2) + 1n).toString(16) };
      expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, y_iHex, bad, g, p, q)).toBe(false);
    });

    it("rejects a tampered z", () => {
      const { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof } = fixture();
      const bad = { ...proof, z: (BigInt("0x" + proof.z) + 1n).toString(16) };
      expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, y_iHex, bad, g, p, q)).toBe(false);
    });

    it("rejects a tampered d_i", () => {
      const { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof } = fixture();
      const badD = (BigInt("0x" + d_iHex) + 1n).toString(16);
      expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, badD, y_iHex, proof, g, p, q)).toBe(false);
    });

    it("rejects a tampered y_i (wrong keyholder commitment)", () => {
      const { p, g, q, ballotId, c1Hex, d_iHex, y_iHex, proof } = fixture();
      const badY = (BigInt("0x" + y_iHex) + 1n).toString(16);
      expect(verifyDleq(ELECTION_ID, ballotId, c1Hex, d_iHex, badY, proof, g, p, q)).toBe(false);
    });
  });

  // Test 7: Binding regression test (required, §5.2) — mirrors the SMT
  // relabeling regression (sparseMerkleTree.test.ts). Must never be
  // weakened or removed.
  describe("binding regression: proof cannot be relabeled to a different ballot or keyholder", () => {
    it("a proof valid for (keyholder i, ballot A) does NOT verify against ballot B's c1/d_i", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const share = shares[0];
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);

      const c1_A = randomSubgroupC1(g, p, q);
      const d_i_A = computePartialDecryption(c1_A, share.value, p, q);
      const proofForA = proveDleq(ELECTION_ID, "ballot-A", c1_A, d_i_A, share.value, y_iHex, g, p, q);

      // Genuinely different ballot, same keyholder.
      const c1_B = randomSubgroupC1(g, p, q);
      const d_i_B = computePartialDecryption(c1_B, share.value, p, q);

      // Sanity: the proof is genuinely valid for A.
      expect(verifyDleq(ELECTION_ID, "ballot-A", c1_A, d_i_A, y_iHex, proofForA, g, p, q)).toBe(true);

      // Relabeled as if it were for ballot B (same keyholder, wrong ballot):
      expect(
        verifyDleq(ELECTION_ID, "ballot-B", c1_B, d_i_B, y_iHex, proofForA, g, p, q)
      ).toBe(false);
    });

    it("keyholder i's proof for ballot A does NOT verify against keyholder j's public commitment", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const shareI = shares[0];
      const shareJ = shares[1];
      const y_iHex = yByIndex.get(shareI.index.toString())!.toString(16);
      const y_jHex = yByIndex.get(shareJ.index.toString())!.toString(16);

      const c1_A = randomSubgroupC1(g, p, q);
      const d_i_A = computePartialDecryption(c1_A, shareI.value, p, q);
      const proofForI = proveDleq(ELECTION_ID, "ballot-A", c1_A, d_i_A, shareI.value, y_iHex, g, p, q);

      expect(verifyDleq(ELECTION_ID, "ballot-A", c1_A, d_i_A, y_iHex, proofForI, g, p, q)).toBe(true);
      expect(verifyDleq(ELECTION_ID, "ballot-A", c1_A, d_i_A, y_jHex, proofForI, g, p, q)).toBe(false);
    });

    it("a proof does NOT verify under a different election_id (cross-election replay)", () => {
      const { p, g, q, shares, yByIndex } = setup();
      const share = shares[0];
      const y_iHex = yByIndex.get(share.index.toString())!.toString(16);
      const c1 = randomSubgroupC1(g, p, q);
      const d_i = computePartialDecryption(c1, share.value, p, q);
      const proof = proveDleq(ELECTION_ID, "ballot-A", c1, d_i, share.value, y_iHex, g, p, q);

      expect(verifyDleq("OTHER-ELECTION-002", "ballot-A", c1, d_i, y_iHex, proof, g, p, q)).toBe(false);
    });
  });

  // Test 8: Threshold-subset determinism (shared reasoning with shamirZq.test.ts)
  it("combining different valid 3-subsets of 4 partials produces the same plaintext", () => {
    const { publicKey, p, q, shares } = setup();
    const candidateId = "11111111-2222-3333-4444-555555555555";
    const ct = encryptCandidateId(candidateId, publicKey);

    const allPartials: ValidPartial[] = shares.map((s: ShareZq) => ({
      index: s.index,
      d_iHex: computePartialDecryption(ct.c1, s.value, p, q),
    }));

    const subsetA = combinePartialDecryptions(allPartials.slice(0, 3), ct.c2, p, q);
    const subsetB = combinePartialDecryptions(
      [allPartials[0], allPartials[1], allPartials[3]],
      ct.c2,
      p,
      q
    );
    expect(subsetA).toBe(subsetB);
  });

  // Test 9: Insufficient-shares handling
  it("refuses to combine fewer than 3 partials", () => {
    const { publicKey, p, q, shares } = setup();
    const ct = encryptCandidateId("3fa85f64-5717-4562-b3fc-2c963f66afa6", publicKey);
    const twoPartials: ValidPartial[] = shares.slice(0, 2).map((s: ShareZq) => ({
      index: s.index,
      d_iHex: computePartialDecryption(ct.c1, s.value, p, q),
    }));
    expect(() => combinePartialDecryptions(twoPartials, ct.c2, p, q)).toThrow();
  });
});

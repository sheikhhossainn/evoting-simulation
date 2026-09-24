import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { generateKeypair, modPow } from "./elgamal";
import { splitSecretZq, deriveShareCommitment, type FeldmanCommitments } from "./shamirZq";
import { combineFeldmanCommitments } from "./dkg";

function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

describe("combineFeldmanCommitments — Pedersen DKG combination step", () => {
  it("combined C_0 equals g^(sum of the 4 dealers' secrets) mod p", () => {
    const { publicKey } = generateKeypair();
    const p = BigInt("0x" + publicKey.p);
    const g = BigInt("0x" + publicKey.g);
    const q = (p - 1n) / 2n;

    const secrets: bigint[] = [];
    const vectors: FeldmanCommitments[] = [];
    for (let i = 0; i < 4; i++) {
      const x_i = randomBigIntBelow(q);
      secrets.push(x_i);
      const { commitments } = splitSecretZq(x_i, q, g, p, () => randomBigIntBelow(q));
      vectors.push(commitments);
    }

    const combined = combineFeldmanCommitments(vectors, p);
    const expectedSum = secrets.reduce((acc, x) => (acc + x) % q, 0n);
    expect(combined[0]).toBe(modPow(g, expectedSum, p));
  });

  it("deriveShareCommitment against the combined vector matches each dealer's actual F(index)", () => {
    const { publicKey } = generateKeypair();
    const p = BigInt("0x" + publicKey.p);
    const g = BigInt("0x" + publicKey.g);
    const q = (p - 1n) / 2n;

    // Track each dealer's own polynomial by re-deriving it from splitSecretZq's
    // shares (index 1..4) via Lagrange-free direct evaluation isn't available,
    // so instead sum each dealer's SHARE at a given index directly — this is
    // exactly what a real keyholder's browser does in round 3.
    const dealerShares: bigint[][] = []; // dealerShares[dealer][index-1]
    const vectors: FeldmanCommitments[] = [];
    for (let i = 0; i < 4; i++) {
      const x_i = randomBigIntBelow(q);
      const { shares, commitments } = splitSecretZq(x_i, q, g, p, () => randomBigIntBelow(q));
      dealerShares.push(shares.map((s) => s.value));
      vectors.push(commitments);
    }

    const combined = combineFeldmanCommitments(vectors, p);

    for (let idx = 1; idx <= 4; idx++) {
      const combinedShare = dealerShares.reduce((acc, shares) => (acc + shares[idx - 1]) % q, 0n);
      const expectedY = modPow(g, combinedShare, p);
      const derivedY = deriveShareCommitment(BigInt(idx), combined, p);
      expect(derivedY).toBe(expectedY);
    }
  });

  it("throws on mismatched vector lengths", () => {
    expect(() => combineFeldmanCommitments([[1n, 2n], [1n, 2n, 3n]], 23n)).toThrow();
  });

  it("throws on an empty vector list", () => {
    expect(() => combineFeldmanCommitments([], 23n)).toThrow();
  });
});

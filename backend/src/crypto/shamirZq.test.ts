import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { generateKeypair, modPow } from "./elgamal";
import {
  splitSecretZq,
  reconstructSecretZq,
  verifyFeldmanShare,
  deriveShareCommitment,
  type ShareZq,
} from "./shamirZq";

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
  const xPrime = x % q; // docs §1.1 — only x mod q is meaningful
  return { p, g, q, x, xPrime };
}

function allThreeSubsets(shares: ShareZq[]): ShareZq[][] {
  const subsets: ShareZq[][] = [];
  for (let i = 0; i < shares.length; i++) {
    for (let j = i + 1; j < shares.length; j++) {
      for (let k = j + 1; k < shares.length; k++) {
        subsets.push([shares[i], shares[j], shares[k]]);
      }
    }
  }
  return subsets;
}

describe("Shamir over Z_q (docs/tally-verifiability-design.md §13)", () => {
  // Test 1: round trip from all 4 possible 3-subsets
  it("splits and reconstructs x' from every 3-of-4 subset", () => {
    const { p, g, q, xPrime } = setup();
    const { shares } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));

    expect(shares).toHaveLength(4);
    for (const subset of allThreeSubsets(shares)) {
      expect(reconstructSecretZq(subset, q)).toBe(xPrime);
    }
  });

  // Test 2: 2-of-4 does not reconstruct
  it("throws when given fewer than 3 shares", () => {
    const { p, g, q, xPrime } = setup();
    const { shares } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
    expect(() => reconstructSecretZq(shares.slice(0, 2), q)).toThrow();
  });

  it("2-of-4 does not accidentally equal the real secret even if a caller ignores the throw guard", () => {
    // Direct Lagrange combination bypassing reconstructSecretZq's length
    // guard, to confirm the underlying math (not just the guard) enforces
    // the threshold — mirrors setup-shamir.ts's existing "2 shares should
    // not reconstruct" security check for the old scheme.
    const { p, g, q, xPrime } = setup();
    const { shares } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
    // A 2-point Lagrange interpolation (wrong degree for a t=3 polynomial)
    // extrapolates incorrectly — confirm it does NOT equal x' in general.
    const [a, b] = shares;
    const qMinusB = (q - b.index) % q;
    const denom = (a.index - b.index + q) % q;
    // naive (wrong) 2-point combination — should not equal xPrime
    const wrongLambdaA = (qMinusB * modInverseLocal(denom, q)) % q;
    const qMinusA = (q - a.index) % q;
    const wrongLambdaB = (qMinusA * modInverseLocal((b.index - a.index + q) % q, q)) % q;
    const wrongCombine = (a.value * wrongLambdaA + b.value * wrongLambdaB) % q;
    expect(wrongCombine).not.toBe(xPrime);
  });

  // Test 3: Feldman commitment consistency
  it("Feldman commitments verify every honestly-issued share", () => {
    const { p, g, q, xPrime } = setup();
    const { shares, commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));

    for (const { index, value } of shares) {
      expect(verifyFeldmanShare(index, value, commitments, g, p)).toBe(true);
      expect(deriveShareCommitment(index, commitments, p)).toBe(modPow(g, value, p));
    }
  });

  it("Feldman rejects a tampered share", () => {
    const { p, g, q, xPrime } = setup();
    const { shares, commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
    const tampered = (shares[0].value + 1n) % q;
    expect(verifyFeldmanShare(shares[0].index, tampered, commitments, g, p)).toBe(false);
  });

  // Test 3 (cont.): C_0 equals the public key
  it("C_0 (the constant term's commitment) equals g^x' mod p, matching the public key y", () => {
    const { p, g, q, xPrime, x } = setup();
    const { commitments } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
    const y = modPow(g, x, p); // full x, not reduced — §1.1 says these must agree
    expect(commitments[0]).toBe(y);
  });

  // Test 8 (shared with dleq.test.ts): threshold-subset determinism
  it("every 3-subset of 4 shares reconstructs the identical secret (Lagrange uniqueness)", () => {
    const { p, g, q, xPrime } = setup();
    const { shares } = splitSecretZq(xPrime, q, g, p, () => randomBigIntBelow(q));
    const results = allThreeSubsets(shares).map((subset) => reconstructSecretZq(subset, q));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(xPrime);
  });
});

function modInverseLocal(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  return ((old_s % m) + m) % m;
}

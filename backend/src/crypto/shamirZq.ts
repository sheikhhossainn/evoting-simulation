/**
 * shamirZq.ts — Shamir's Secret Sharing over Z_q, with Feldman VSS commitments
 *
 * Replaces shamir.ts (secrets.js-grempe, GF(2^8)) for the verifiable-tally
 * flow. GF(2^8) byte-wise sharing is algebraically incompatible with
 * partial-decryption combination, which requires shares in the SAME field
 * the ElGamal exponent arithmetic lives in (Z_q). See
 * docs/tally-verifiability-design.md §1.2/§2.
 *
 * shamir.ts is NOT modified or removed — this is an additive module for the
 * new verifiable flow. Existing code paths using shamir.ts are unaffected.
 *
 * Threshold (t=3, n=4), matching the existing key-ceremony convention.
 */

import { modPow, modInverse } from "./elgamal";

export interface ShareZq {
  index: bigint; // 1..4
  value: bigint; // f(index) mod q
}

/**
 * Feldman VSS commitments to the polynomial's coefficients:
 * C_0 = g^(secret) mod p  (== the public key y, when secret = x mod q)
 * C_1 = g^(a_1) mod p
 * ...
 * C_{t-1} = g^(a_{t-1}) mod p
 */
export type FeldmanCommitments = bigint[];

/**
 * Split `secret` (already reduced mod q by the caller — docs §1.1) into
 * n=4 shares with threshold t=3, over Z_q. Returns both the shares and the
 * Feldman commitments to the polynomial's coefficients.
 */
export function splitSecretZq(
  secret: bigint,
  q: bigint,
  g: bigint,
  p: bigint,
  randomBigIntBelowQ: () => bigint,
  n = 4,
  t = 3
): { shares: ShareZq[]; commitments: FeldmanCommitments } {
  if (secret < 0n || secret >= q) {
    throw new Error("secret must already be reduced mod q");
  }

  // f(z) = secret + a_1*z + a_2*z^2 + ... + a_{t-1}*z^(t-1)  (mod q)
  const coefficients: bigint[] = [secret];
  for (let i = 1; i < t; i++) {
    coefficients.push(randomBigIntBelowQ());
  }

  const shares: ShareZq[] = [];
  for (let i = 1; i <= n; i++) {
    const index = BigInt(i);
    let value = 0n;
    let power = 1n;
    for (const coeff of coefficients) {
      value = (value + coeff * power) % q;
      power = (power * index) % q;
    }
    shares.push({ index, value });
  }

  const commitments: FeldmanCommitments = coefficients.map((c) => modPow(g, c, p));

  return { shares, commitments };
}

/**
 * Feldman verification equation: confirm share `value` at `index` is
 * consistent with the published polynomial-coefficient commitments, i.e.
 * g^value mod p == Π_{l=0}^{t-1} C_l^(index^l) mod p.
 *
 * A keyholder runs this the moment they receive their share — catches a
 * dealer who distributed an inconsistent share at distribution time, not
 * tally time (docs §2.1).
 */
export function verifyFeldmanShare(
  index: bigint,
  value: bigint,
  commitments: FeldmanCommitments,
  g: bigint,
  p: bigint
): boolean {
  const lhs = modPow(g, value, p);

  let rhs = 1n;
  let power = 1n;
  for (const C_l of commitments) {
    rhs = (rhs * modPow(C_l, power, p)) % p;
    power = power * index;
  }

  return lhs === rhs;
}

/** Derive keyholder `index`'s public commitment y_i = g^(x_i) mod p from the Feldman commitments. */
export function deriveShareCommitment(
  index: bigint,
  commitments: FeldmanCommitments,
  p: bigint
): bigint {
  let result = 1n;
  let power = 1n;
  for (const C_l of commitments) {
    result = (result * modPow(C_l, power, p)) % p;
    power = power * index;
  }
  return result;
}

/**
 * Lagrange coefficient λ_i for index `i`, evaluated at z=0, over the index
 * set `allIndices`. Publicly computable by anyone from the index set alone
 * — no secret material involved (docs §2/§4).
 */
export function lagrangeCoefficientAtZero(
  i: bigint,
  allIndices: bigint[],
  q: bigint
): bigint {
  let numerator = 1n;
  let denominator = 1n;
  for (const j of allIndices) {
    if (j === i) continue;
    numerator = (numerator * ((q - j) % q)) % q; // (0 - j) mod q
    denominator = (denominator * ((i - j + q) % q)) % q; // (i - j) mod q
  }
  return (numerator * modInverse(denominator, q)) % q;
}

/**
 * Reconstruct the secret from >=3 shares — used ONLY for testing/setup
 * verification (mirrors setup-shamir.ts's existing round-trip check). The
 * verifiable tally flow (dleq.ts) never calls this in production — it
 * combines PARTIAL DECRYPTIONS, never the raw secret (docs §0/§7).
 */
export function reconstructSecretZq(shares: ShareZq[], q: bigint): bigint {
  if (shares.length < 3) {
    throw new Error(`Need at least 3 shares to reconstruct. Got ${shares.length}`);
  }
  const indices = shares.map((s) => s.index);
  let secret = 0n;
  for (const { index, value } of shares) {
    const lambda = lagrangeCoefficientAtZero(index, indices, q);
    secret = (secret + value * lambda) % q;
  }
  return ((secret % q) + q) % q;
}

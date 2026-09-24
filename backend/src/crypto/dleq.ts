/**
 * dleq.ts — Chaum-Pedersen equality-of-discrete-logs (DLEQ) proof for
 * partial ElGamal decryption, and the public combination step.
 *
 * docs/tally-verifiability-design.md §3-§6. Proves, for keyholder i with
 * share x_i and public commitment y_i = g^(x_i):
 *
 *   "I know x_i such that y_i = g^(x_i) mod p AND d_i = c1^(x_i) mod p"
 *
 * — the SAME witness across two bases (g and this specific ballot's c1),
 * which is what binds the proof to both the specific keyholder (via y_i)
 * and the specific ballot (via c1) — see §5's "what does NOT work" note.
 * A standalone knowledge-of-x_i proof (one base only) would NOT bind to a
 * specific ballot and must not be used in its place.
 */

import crypto from "crypto";
import { modPow, modInverse } from "./elgamal";
import { lagrangeCoefficientAtZero } from "./shamirZq";

const PROOF_TAG = "EVOTING-PARTIALDEC-DLEQ-v1";

export interface DleqProof {
  t1: string; // hex
  t2: string; // hex
  z: string; // hex
}

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

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
 * Confirm `value` is a member of the order-q subgroup of Z*_p (c1^q == 1
 * mod p), the same check elgamal.ts's decryptCandidateId already performs
 * before trusting c1 for direct decryption. The DLEQ proof's exponent
 * arithmetic reduces mod q throughout (docs §5.1/§5.2) — that reduction is
 * only sound when the base has order dividing q. A genuine ElGamal c1
 * (= g^k mod p) always satisfies this; a malformed/adversarial c1 outside
 * the subgroup does not, and using it produces non-deterministic
 * prover/verifier disagreement rather than a clean rejection if this check
 * is skipped (found via adversarial stress-testing, not by inspection).
 */
export function isSubgroupMember(value: bigint, p: bigint, q: bigint): boolean {
  if (value <= 0n || value >= p) return false;
  return modPow(value, q, p) === 1n;
}

/**
 * Fiat-Shamir challenge for the DLEQ proof. Domain-separated from zkp.ts's
 * ballot-validity OR-proof via an explicit leading tag (docs §5.3) — that
 * proof type never had one because only one proof type existed when it was
 * written; this is a second, structurally similar-looking protocol over the
 * same group, so an explicit tag makes the hash domains disjoint by
 * construction rather than by accident of differing input shapes.
 *
 * election_id and ballot_id are included directly, not just implied by c1
 * — closes a replay case broader than per-ballot binding alone (docs §5.3).
 */
function fiatShamirChallenge(
  electionId: string,
  ballotId: string,
  g: bigint,
  y_i: bigint,
  c1: bigint,
  d_i: bigint,
  t1: bigint,
  t2: bigint,
  q: bigint
): bigint {
  const preimage = [
    PROOF_TAG,
    electionId,
    ballotId,
    bigIntToHex(g),
    bigIntToHex(y_i),
    bigIntToHex(c1),
    bigIntToHex(d_i),
    bigIntToHex(t1),
    bigIntToHex(t2),
  ].join(",");
  const hash = crypto.createHash("sha256").update(preimage).digest("hex");
  return BigInt("0x" + hash) % q;
}

/**
 * Compute keyholder i's partial decryption for ballot ciphertext (c1, c2).
 * Only needs x_i. Requires q (the subgroup order) so it can reject a
 * malformed c1 outright rather than silently producing a value whose later
 * DLEQ proof would be unverifiable in a well-defined way (see
 * isSubgroupMember's comment).
 */
export function computePartialDecryption(c1Hex: string, x_i: bigint, p: bigint, q: bigint): string {
  const c1 = hexToBigInt(c1Hex);
  if (!isSubgroupMember(c1, p, q)) {
    throw new Error("Invalid ciphertext: c1 is not a member of the prime-order subgroup");
  }
  const d_i = modPow(c1, x_i, p);
  return bigIntToHex(d_i);
}

/**
 * Generate the DLEQ proof binding this partial decryption to keyholder i's
 * public commitment y_i AND this specific ballot's c1 (docs §5.1).
 */
export function proveDleq(
  electionId: string,
  ballotId: string,
  c1Hex: string,
  d_iHex: string,
  x_i: bigint,
  y_iHex: string,
  g: bigint,
  p: bigint,
  q: bigint
): DleqProof {
  const c1 = hexToBigInt(c1Hex);
  const d_i = hexToBigInt(d_iHex);
  const y_i = hexToBigInt(y_iHex);

  if (!isSubgroupMember(c1, p, q)) {
    throw new Error("Invalid ciphertext: c1 is not a member of the prime-order subgroup");
  }

  const w = randomBigIntBelow(q);
  const t1 = modPow(g, w, p);
  const t2 = modPow(c1, w, p);

  const e = fiatShamirChallenge(electionId, ballotId, g, y_i, c1, d_i, t1, t2, q);
  const z = (w + e * x_i) % q;

  return { t1: bigIntToHex(t1), t2: bigIntToHex(t2), z: bigIntToHex(z) };
}

/**
 * Verify a DLEQ proof (docs §5.2). Given ONLY public values — no secret
 * material required. Rejects malformed input rather than throwing.
 */
export function verifyDleq(
  electionId: string,
  ballotId: string,
  c1Hex: string,
  d_iHex: string,
  y_iHex: string,
  proof: DleqProof,
  g: bigint,
  p: bigint,
  q: bigint
): boolean {
  try {
    const c1 = hexToBigInt(c1Hex);
    const d_i = hexToBigInt(d_iHex);
    const y_i = hexToBigInt(y_iHex);
    const t1 = hexToBigInt(proof.t1);
    const t2 = hexToBigInt(proof.t2);
    const z = hexToBigInt(proof.z);

    // Reject a malformed/out-of-subgroup c1 outright rather than letting the
    // exponent-mod-q arithmetic below produce a non-deterministic result —
    // see isSubgroupMember's comment for why this is required, not optional.
    if (!isSubgroupMember(c1, p, q)) return false;

    const e = fiatShamirChallenge(electionId, ballotId, g, y_i, c1, d_i, t1, t2, q);

    const lhs1 = modPow(g, z, p);
    const rhs1 = (t1 * modPow(y_i, e, p)) % p;

    const lhs2 = modPow(c1, z, p);
    const rhs2 = (t2 * modPow(d_i, e, p)) % p;

    return lhs1 === rhs1 && lhs2 === rhs2;
  } catch {
    return false;
  }
}

export interface ValidPartial {
  index: bigint;
  d_iHex: string;
}

/**
 * Public combination (docs §4): given >=3 verified partial decryptions for
 * the same ballot, recover the plaintext m WITHOUT ever assembling the
 * private key. No secret material required — the Lagrange coefficients are
 * publicly derivable from the participating index set alone.
 */
export function combinePartialDecryptions(
  partials: ValidPartial[],
  c2Hex: string,
  p: bigint,
  q: bigint
): string {
  if (partials.length < 3) {
    throw new Error(`Need at least 3 valid partial decryptions. Got ${partials.length}`);
  }

  const indices = partials.map((pt) => pt.index);
  let s = 1n;
  for (const { index, d_iHex } of partials) {
    const lambda = lagrangeCoefficientAtZero(index, indices, q);
    s = (s * modPow(hexToBigInt(d_iHex), lambda, p)) % p;
  }

  const c2 = hexToBigInt(c2Hex);
  const sInv = modInverse(s, p);
  const m = (c2 * sInv) % p;
  return bigIntToHex(m);
}

/**
 * keyholderCrypto.ts — client-side (browser) partial decryption + DLEQ proof
 * generation (docs/tally-verifiability-design.md §7).
 *
 * CRITICAL: this is the module that makes §7's guarantee real. The
 * keyholder's raw share (x_i) is entered here, used here, and NEVER
 * serialized into any network request this module makes. Only the
 * resulting (d_i, proof) pairs — computed locally — are ever sent to the
 * backend (POST /keyshares/submit-partial).
 *
 * Deliberately a from-scratch, browser-native BigInt port of
 * backend/src/crypto/dleq.ts's math (not an import — the backend module
 * uses Node's `crypto` module, unavailable in the browser; native BigInt
 * modular exponentiation needs no library either way). Kept algebraically
 * identical on purpose; cross-checked by backend/src/crypto/dleq.test.ts's
 * own test vectors during implementation, not by shared code, since the
 * whole point is these two implementations run in different trust domains.
 */

const PROOF_TAG = "EVOTING-PARTIALDEC-DLEQ-v1";

export interface DleqProof {
  t1: string;
  t2: string;
  z: string;
}

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = new Uint8Array(byteLength);
    crypto.getRandomValues(buf);
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    result = BigInt("0x" + hex) % max;
  } while (result === 0n);
  return result;
}

/**
 * Same check as dleq.ts's isSubgroupMember — required, not optional (found
 * via adversarial testing during the backend implementation: an
 * out-of-subgroup c1 makes the exponent-mod-q arithmetic below produce
 * non-deterministic results if this check is skipped).
 */
export function isSubgroupMember(value: bigint, p: bigint, q: bigint): boolean {
  if (value <= 0n || value >= p) return false;
  return modPow(value, q, p) === 1n;
}

async function sha256Hex(message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fiatShamirChallenge(
  electionId: string,
  ballotId: string,
  g: bigint,
  y_i: bigint,
  c1: bigint,
  d_i: bigint,
  t1: bigint,
  t2: bigint,
  q: bigint
): Promise<bigint> {
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
  const hash = await sha256Hex(preimage);
  return BigInt("0x" + hash) % q;
}

export interface GroupParams {
  p: bigint;
  g: bigint;
  q: bigint;
}

/** Compute keyholder i's partial decryption for one ballot. Requires the local share x_i. */
export function computePartialDecryption(c1Hex: string, x_i: bigint, group: GroupParams): string {
  const c1 = hexToBigInt(c1Hex);
  if (!isSubgroupMember(c1, group.p, group.q)) {
    throw new Error("Invalid ciphertext: c1 is not a member of the prime-order subgroup");
  }
  return bigIntToHex(modPow(c1, x_i, group.p));
}

/** Generate the DLEQ proof binding this partial decryption to this keyholder AND this ballot. */
export async function proveDleq(
  electionId: string,
  ballotId: string,
  c1Hex: string,
  d_iHex: string,
  x_i: bigint,
  y_iHex: string,
  group: GroupParams
): Promise<DleqProof> {
  const c1 = hexToBigInt(c1Hex);
  const d_i = hexToBigInt(d_iHex);
  const y_i = hexToBigInt(y_iHex);

  if (!isSubgroupMember(c1, group.p, group.q)) {
    throw new Error("Invalid ciphertext: c1 is not a member of the prime-order subgroup");
  }

  const w = randomBigIntBelow(group.q);
  const t1 = modPow(group.g, w, group.p);
  const t2 = modPow(c1, w, group.p);

  const e = await fiatShamirChallenge(electionId, ballotId, group.g, y_i, c1, d_i, t1, t2, group.q);
  const z = (w + e * x_i) % group.q;

  return { t1: bigIntToHex(t1), t2: bigIntToHex(t2), z: bigIntToHex(z) };
}

/**
 * Compute (d_i, proof) for every ballot in `ballots`, using ONLY the
 * locally-held share `xIHex` — this is the single entry point the Key
 * Holder Portal UI should call. Nothing here transmits xIHex anywhere.
 */
export async function computeAllPartials(
  electionId: string,
  xIHex: string,
  yIHex: string,
  group: GroupParams,
  ballots: { ballot_id: string; c1: string }[]
): Promise<{ ballot_id: string; d_i: string; proof: DleqProof }[]> {
  const x_i = hexToBigInt(xIHex);
  const results: { ballot_id: string; d_i: string; proof: DleqProof }[] = [];

  for (const ballot of ballots) {
    const d_i = computePartialDecryption(ballot.c1, x_i, group);
    const proof = await proveDleq(electionId, ballot.ballot_id, ballot.c1, d_i, x_i, yIHex, group);
    results.push({ ballot_id: ballot.ballot_id, d_i, proof });
  }

  return results;
}

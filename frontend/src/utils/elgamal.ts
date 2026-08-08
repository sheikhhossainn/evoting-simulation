/**
 * elgamal.ts — Client-side ElGamal encryption for ballots
 *
 * Mirrors backend/src/crypto/elgamal.ts (encrypt side only — the browser
 * never holds the private key). Uses the Web Crypto API for randomness.
 *
 * Candidate ids are UUIDs (128 bits) encoded by parsing their hex digits
 * directly, not via UTF-8 byte encoding — this keeps the plaintext safely
 * under the 256-bit prime modulus.
 *
 * Benaloh cast-or-audit (Task 5):
 *   • encryptCandidateIdForAudit() — returns ciphertext + revealed randomness r
 *   • verifyEncryptedCandidateId() — recompute ciphertext from (id, r, pubkey)
 *   • encryptCandidateId() — cast path only; fresh r, never returned
 */

export interface ElGamalPublicKey {
  p: string; // Prime modulus (hex)
  g: string; // Generator (hex)
  y: string; // Public key y = g^x mod p (hex)
}

export interface ElGamalCiphertext {
  c1: string; // g^k mod p (hex)
  c2: string; // m * y^k mod p (hex)
}

/** Result of an audit-path encryption — randomness must never be submitted as a vote. */
export interface EncryptedBallot {
  ciphertext: ElGamalCiphertext;
  /** ElGamal ephemeral exponent k (hex). Docs call this r in the Benaloh challenge. */
  randomness: string;
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
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** Random BigInt in [2, max-2] using the Web Crypto API */
function randomBigIntInRange(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = new Uint8Array(byteLength);
    crypto.getRandomValues(buf);
    const hex = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    result = (BigInt("0x" + hex) % (max - 3n)) + 2n;
  } while (result >= max - 1n || result < 2n);
  return result;
}

/** Encode a candidate UUID as a BigInt via its 32 hex digits (128 bits) */
function encodeCandidateId(id: string): bigint {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Candidate id must be a UUID");
  }
  return BigInt("0x" + hex);
}

/** Modular multiplicative inverse using extended Euclidean algorithm */
function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }

  return ((old_s % m) + m) % m;
}

/** Core ElGamal encrypt with a caller-supplied ephemeral exponent k. */
function encryptCandidateIdWithK(
  candidateId: string,
  pubKey: ElGamalPublicKey,
  k: bigint
): ElGamalCiphertext {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);

  const m = encodeCandidateId(candidateId);
  if (m >= p) {
    throw new Error("Encoded candidate id too large for the prime modulus");
  }

  const c1 = modPow(g, k, p);
  const c2 = (m * modPow(y, k, p)) % p;

  return { c1: bigIntToHex(c1), c2: bigIntToHex(c2) };
}

/**
 * Encrypt a candidate's UUID for ballot submission (cast path).
 * Uses fresh randomness; k is never returned to the caller.
 *
 * @param candidateId - The candidate's UUID (from GET /candidates)
 * @param pubKey      - The ElGamal public key { p, g, y } (from GET /election/public-key)
 */
export function encryptCandidateId(
  candidateId: string,
  pubKey: ElGamalPublicKey
): ElGamalCiphertext {
  const p = hexToBigInt(pubKey.p);
  const k = randomBigIntInRange(p);
  return encryptCandidateIdWithK(candidateId, pubKey, k);
}

// ── ZKP Ballot Validity Proof (client-side prover) ──

export interface ZkpProof {
  challenges: string[];
  responses: string[];
}

/** Random BigInt in [1, max-1] using the Web Crypto API */
function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = new Uint8Array(byteLength);
    crypto.getRandomValues(buf);
    const hex = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    result = BigInt("0x" + hex) % max;
  } while (result === 0n);
  return result;
}

/**
 * Fiat-Shamir challenge: SHA-256 over the transcript, reduced mod q.
 * Uses SubtleCrypto.digest for real SHA-256 — matches the backend exactly.
 *
 * Input order: g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1 ‖ …
 * Each element is serialised as its minimal hex representation.
 */
async function fiatShamirChallenge(
  g: bigint,
  y: bigint,
  c1: bigint,
  c2: bigint,
  commitments: { a: bigint; b: bigint }[],
  q: bigint
): Promise<bigint> {
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
  const encoder = new TextEncoder();
  const data = encoder.encode(preimage);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt("0x" + hashHex) % q;
}

/**
 * Encrypt a candidate's UUID and generate a disjunctive Chaum-Pedersen
 * NIZK proof that the ciphertext encrypts one of the valid candidates.
 *
 * This is the main entry point for the cast-path: it generates fresh
 * randomness k, encrypts, and produces the proof — all in one call.
 *
 * @param candidateId      - The chosen candidate's UUID
 * @param pubKey           - ElGamal public key { p, g, y }
 * @param allCandidateIds  - Ordered list of all valid candidate UUIDs for the constituency
 * @returns                - { ciphertext, zkpProof }
 */
export async function encryptCandidateIdWithProof(
  candidateId: string,
  pubKey: ElGamalPublicKey,
  allCandidateIds: string[]
): Promise<{ ciphertext: ElGamalCiphertext; zkpProof: ZkpProof }> {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);
  const q = (p - 1n) / 2n;

  // Fresh ephemeral key
  const k = randomBigIntInRange(p);
  const ciphertext = encryptCandidateIdWithK(candidateId, pubKey, k);

  const c1 = hexToBigInt(ciphertext.c1);
  const c2 = hexToBigInt(ciphertext.c2);

  const trueIndex = allCandidateIds.indexOf(candidateId);
  if (trueIndex === -1) {
    throw new Error("candidateId not found in allCandidateIds");
  }
  const n = allCandidateIds.length;

  // Encode all candidate UUIDs
  const encodings = allCandidateIds.map((id) => encodeCandidateId(id));
  const targets = encodings.map((m_i) => {
    const mInv = modInverse(m_i, p);
    return (c2 * mInv) % p;
  });

  // ── Simulate non-true branches, commit on the real branch ──
  const challenges: bigint[] = new Array(n);
  const responses: bigint[] = new Array(n);
  const commitments: { a: bigint; b: bigint }[] = new Array(n);

  // Real branch: pick random w, compute commitment
  const w = randomBigIntBelow(q);
  commitments[trueIndex] = {
    a: modPow(g, w, p),
    b: modPow(y, w, p),
  };

  // Simulated branches
  let challengeSum = 0n;
  for (let j = 0; j < n; j++) {
    if (j === trueIndex) continue;

    const e_j = randomBigIntBelow(q);
    const z_j = randomBigIntBelow(q);
    challenges[j] = e_j;
    responses[j] = z_j;
    challengeSum = (challengeSum + e_j) % q;

    const c1InvE = modPow(modInverse(c1, p), e_j, p);
    const a_j = (modPow(g, z_j, p) * c1InvE) % p;

    const tInvE = modPow(modInverse(targets[j], p), e_j, p);
    const b_j = (modPow(y, z_j, p) * tInvE) % p;

    commitments[j] = { a: a_j, b: b_j };
  }

  // Fiat-Shamir
  const e = await fiatShamirChallenge(g, y, c1, c2, commitments, q);

  const e_t = ((e - challengeSum) % q + q) % q;
  challenges[trueIndex] = e_t;
  responses[trueIndex] = (w + e_t * k) % q;

  const zkpProof: ZkpProof = {
    challenges: challenges.map(bigIntToHex),
    responses: responses.map(bigIntToHex),
  };

  return { ciphertext, zkpProof };
}

/**
 * Encrypt for the Benaloh audit path — reveals randomness so the voter
 * can independently verify the ciphertext matches their chosen candidate.
 * The returned ciphertext must never be submitted; always re-encrypt on cast.
 */
export function encryptCandidateIdForAudit(
  candidateId: string,
  pubKey: ElGamalPublicKey
): EncryptedBallot {
  const p = hexToBigInt(pubKey.p);
  const k = randomBigIntInRange(p);
  return {
    ciphertext: encryptCandidateIdWithK(candidateId, pubKey, k),
    randomness: bigIntToHex(k),
  };
}

/**
 * Benaloh verification: recompute ciphertext from (candidate_id, r, public_key)
 * and check it matches the audited ciphertext exactly.
 */
export function verifyEncryptedCandidateId(
  candidateId: string,
  randomness: string,
  pubKey: ElGamalPublicKey,
  ciphertext: ElGamalCiphertext
): boolean {
  try {
    const k = hexToBigInt(randomness);
    const recomputed = encryptCandidateIdWithK(candidateId, pubKey, k);
    return (
      recomputed.c1 === ciphertext.c1 && recomputed.c2 === ciphertext.c2
    );
  } catch {
    return false;
  }
}

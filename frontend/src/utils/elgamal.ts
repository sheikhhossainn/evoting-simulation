/**
 * elgamal.ts — Client-side ElGamal encryption for ballots
 *
 * Mirrors backend/src/crypto/elgamal.ts (encrypt side only — the browser
 * never holds the private key). Uses the Web Crypto API for randomness.
 *
 * Candidate ids are UUIDs (128 bits) encoded by parsing their hex digits
 * directly, not via UTF-8 byte encoding — this keeps the plaintext safely
 * under the 256-bit prime modulus.
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

/**
 * Encrypt a candidate's UUID for ballot submission.
 *
 * @param candidateId - The candidate's UUID (from GET /candidates)
 * @param pubKey      - The ElGamal public key { p, g, y } (from GET /election/public-key)
 */
export function encryptCandidateId(
  candidateId: string,
  pubKey: ElGamalPublicKey
): ElGamalCiphertext {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);

  const m = encodeCandidateId(candidateId);
  if (m >= p) {
    throw new Error("Encoded candidate id too large for the prime modulus");
  }

  const k = randomBigIntInRange(p);
  const c1 = modPow(g, k, p);
  const c2 = (m * modPow(y, k, p)) % p;

  return { c1: bigIntToHex(c1), c2: bigIntToHex(c2) };
}

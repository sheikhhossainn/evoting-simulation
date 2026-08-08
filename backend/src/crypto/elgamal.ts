/**
 * elgamal.ts — ElGamal encryption module for e-voting
 *
 * Implements keypair generation, encryption, and decryption using
 * Node.js built-in `crypto` module with BigInt arithmetic.
 *
 * Key size: 256-bit prime (simulation-grade; production would use 2048-bit).
 * All values are serialized as hex strings for storage/transport.
 */

import crypto from "crypto";

// ── Types ──

export interface ElGamalPublicKey {
  p: string; // Prime modulus (hex)
  g: string; // Generator (hex)
  y: string; // Public key y = g^x mod p (hex)
}

export interface ElGamalPrivateKey {
  p: string; // Prime modulus (hex)
  g: string; // Generator (hex)
  x: string; // Private exponent (hex)
}

export interface ElGamalKeypair {
  publicKey: ElGamalPublicKey;
  privateKey: ElGamalPrivateKey;
}

export interface ElGamalCiphertext {
  c1: string; // g^k mod p (hex)
  c2: string; // m * y^k mod p (hex)
}

// ── Helpers ──

/** Convert a hex string to BigInt */
function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

/** Convert a BigInt to hex string (no 0x prefix) */
function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

/** Modular exponentiation: base^exp mod mod */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
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

/** Modular multiplicative inverse using extended Euclidean algorithm */
export function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }

  return ((old_s % m) + m) % m;
}

/** Encode a UTF-8 string as a BigInt (message must be shorter than p) */
function encodeMessage(message: string): bigint {
  const buf = Buffer.from(message, "utf-8");
  return BigInt("0x" + buf.toString("hex"));
}

/** Decode a BigInt back to a UTF-8 string */
function decodeMessage(n: bigint): string {
  let hex = n.toString(16);
  // Pad to even length for Buffer
  if (hex.length % 2 !== 0) hex = "0" + hex;
  return Buffer.from(hex, "hex").toString("utf-8");
}

/** Generate a random BigInt in range [2, max-2] */
function randomBigIntInRange(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % (max - 3n) + 2n;
  } while (result >= max - 1n || result < 2n);
  return result;
}

/**
 * Find a generator for the prime-order subgroup of Z*_p where p is a
 * safe prime (p = 2q + 1).  The subgroup has order q and consists of
 * all quadratic residues mod p.
 *
 * Strategy: find a generator g0 of the full Z*_p (order p-1), then
 * square it to obtain h = g0² mod p, which has order q.
 */
function findGenerator(p: bigint): bigint {
  const q = (p - 1n) / 2n;
  // Find a generator of the full group Z*_p (order p-1):
  // g0 must satisfy g0^2 ≢ 1 and g0^q ≢ 1 (mod p).
  for (let g0 = 2n; g0 < 100n; g0++) {
    if (modPow(g0, 2n, p) !== 1n && modPow(g0, q, p) !== 1n) {
      // Square to project into the order-q subgroup (quadratic residues)
      const h = modPow(g0, 2n, p);
      return h;
    }
  }
  // Fallback: use random, then square
  const g0 = randomBigIntInRange(p);
  return modPow(g0, 2n, p);
}

// ── Core Functions ──

/**
 * Generate a fresh ElGamal keypair.
 *
 * Uses a 256-bit safe prime (p = 2q + 1 where q is also prime).
 * This is simulation-grade; production would use 2048-bit.
 */
export function generateKeypair(): ElGamalKeypair {
  // Generate a safe prime (p where (p-1)/2 is also prime)
  const pBuf = crypto.generatePrimeSync(256, {
    safe: true,
    bigint: true,
  }) as unknown as bigint;

  const p = pBuf;
  const g = findGenerator(p);

  // Private key: random x in [2, p-2]
  const x = randomBigIntInRange(p);

  // Public key: y = g^x mod p
  const y = modPow(g, x, p);

  return {
    publicKey: {
      p: bigIntToHex(p),
      g: bigIntToHex(g),
      y: bigIntToHex(y),
    },
    privateKey: {
      p: bigIntToHex(p),
      g: bigIntToHex(g),
      x: bigIntToHex(x),
    },
  };
}

/**
 * Encrypt a message string using the ElGamal public key.
 *
 * @param message  - The plaintext string (e.g. candidate ID like "c1-3")
 * @param pubKey   - The ElGamal public key { p, g, y } (hex strings)
 * @returns        - Ciphertext { c1, c2 } (hex strings)
 */
export function encrypt(
  message: string,
  pubKey: ElGamalPublicKey
): ElGamalCiphertext {
  const p = hexToBigInt(pubKey.p);
  const g = hexToBigInt(pubKey.g);
  const y = hexToBigInt(pubKey.y);

  // Encode message as BigInt (must be < p)
  const m = encodeMessage(message);
  if (m >= p) {
    throw new Error("Message too long for the given prime modulus");
  }

  // Random ephemeral key k
  const k = randomBigIntInRange(p);

  // c1 = g^k mod p
  const c1 = modPow(g, k, p);

  // c2 = m * y^k mod p
  const c2 = (m * modPow(y, k, p)) % p;

  return {
    c1: bigIntToHex(c1),
    c2: bigIntToHex(c2),
  };
}

/**
 * Decrypt a ciphertext using the ElGamal private key.
 *
 * @param ciphertext - The ciphertext { c1, c2 } (hex strings)
 * @param privKey    - The ElGamal private key { p, g, x } (hex strings)
 * @returns          - The decrypted plaintext string
 */
export function decrypt(
  ciphertext: ElGamalCiphertext,
  privKey: ElGamalPrivateKey
): string {
  const p = hexToBigInt(privKey.p);
  const x = hexToBigInt(privKey.x);

  const c1 = hexToBigInt(ciphertext.c1);
  const c2 = hexToBigInt(ciphertext.c2);

  // s = c1^x mod p  (shared secret)
  const s = modPow(c1, x, p);

  // m = c2 * s^(-1) mod p
  const sInv = modInverse(s, p);
  const m = (c2 * sInv) % p;

  return decodeMessage(m);
}

/**
 * Encode a UUID (candidate id, with or without dashes) as a BigInt by
 * parsing its 32 hex chars directly — NOT via UTF-8 byte encoding.
 * A UUID is 128 bits, safely below the 256-bit prime modulus, whereas
 * encodeMessage() would treat each hex character as its own UTF-8 byte
 * (32 chars -> 256 bits) and risk exceeding p.
 */
export function encodeCandidateId(id: string): bigint {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Candidate id must be a UUID");
  }
  return BigInt("0x" + hex);
}

/** Reform a UUID string from the 128-bit BigInt produced by encodeCandidateId */
function decodeCandidateId(n: bigint): string {
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Encrypt a candidate's UUID for a ballot. Uses encodeCandidateId instead
 * of the generic UTF-8 message encoder so the plaintext (128 bits) always
 * fits under the 256-bit prime modulus.
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

/**
 * Validate that a hex string is well-formed and parse it to BigInt.
 * Throws if the string is empty or contains non-hex characters.
 */
function safeHexToBigInt(hex: string, label: string): bigint {
  if (typeof hex !== "string" || hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid ciphertext: ${label} is not a valid hex string`);
  }
  return BigInt("0x" + hex);
}

/**
 * Decrypt a ballot ciphertext back into the candidate's UUID.
 *
 * Validates the ciphertext components before decryption:
 * - c1 and c2 must be valid hex strings
 * - c1 and c2 must be in range [1, p-1]  (elements of Z*_p)
 * - c1 must be a member of the prime-order subgroup (c1^q ≡ 1 mod p)
 *
 * Throws an Error for any malformed or out-of-group ciphertext.
 */
export function decryptCandidateId(
  ciphertext: ElGamalCiphertext,
  privKey: ElGamalPrivateKey
): string {
  const p = hexToBigInt(privKey.p);
  const x = hexToBigInt(privKey.x);
  const q = (p - 1n) / 2n; // safe prime: p = 2q + 1

  // ── Validate ciphertext components ──

  const c1 = safeHexToBigInt(ciphertext.c1, "c1");
  const c2 = safeHexToBigInt(ciphertext.c2, "c2");

  // Range check: c1, c2 ∈ [1, p-1]
  if (c1 <= 0n || c1 >= p) {
    throw new Error(
      `Invalid ciphertext: c1 out of range [1, p-1] (got ${c1})`
    );
  }
  // c2 = m · y^k mod p — can be 0 when m = 0 (e.g. all-zero UUID)
  if (c2 < 0n || c2 >= p) {
    throw new Error(
      `Invalid ciphertext: c2 out of range [0, p-1] (got ${c2 < 0n ? c2 : "≥ p"})`
    );
  }

  // Subgroup membership: c1^q ≡ 1 (mod p) for safe-prime subgroup
  if (modPow(c1, q, p) !== 1n) {
    throw new Error(
      "Invalid ciphertext: c1 is not a member of the prime-order subgroup (non-quadratic residue)"
    );
  }

  // ── Decrypt ──

  const s = modPow(c1, x, p);
  const sInv = modInverse(s, p);
  const m = (c2 * sInv) % p;

  return decodeCandidateId(m);
}

/**
 * Load an ElGamal public key from environment variables.
 * Returns null if any key component is missing.
 */
export function loadPublicKeyFromEnv(): ElGamalPublicKey | null {
  const p = process.env.ELGAMAL_P;
  const g = process.env.ELGAMAL_G;
  const y = process.env.ELGAMAL_PUBLIC_KEY;

  if (!p || !g || !y) return null;

  return { p, g, y };
}

/**
 * Load an ElGamal private key from environment variables.
 * Returns null if any key component is missing.
 */
export function loadPrivateKeyFromEnv(): ElGamalPrivateKey | null {
  const p = process.env.ELGAMAL_P;
  const g = process.env.ELGAMAL_G;
  const x = process.env.ELGAMAL_PRIVATE_KEY;

  if (!p || !g || !x) return null;

  return { p, g, x };
}

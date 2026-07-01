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
 * Find a generator for Z*_p where p is a safe prime (p = 2q + 1).
 * For a safe prime, g is a generator of the subgroup of order q
 * if g^2 mod p != 1 and g^q mod p != 1.
 * We use a small candidate and verify.
 */
function findGenerator(p: bigint): bigint {
  const q = (p - 1n) / 2n;
  // Try small candidates starting from 2
  for (let g = 2n; g < 100n; g++) {
    if (modPow(g, 2n, p) !== 1n && modPow(g, q, p) !== 1n) {
      return g;
    }
  }
  // Fallback: use random
  return randomBigIntInRange(p);
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

/**
 * dkgCrypto.ts — client-side (browser) distributed key generation (DKG)
 * ceremony math.
 *
 * CRITICAL: this is what makes key GENERATION as trustless as
 * keyholderCrypto.ts already made partial DECRYPTION. Each keyholder's
 * own polynomial (their piece of the private key) is generated here,
 * used here, and NEVER serialized into any network request this module
 * makes. Only PUBLIC Feldman commitments and AES-GCM-encrypted sub-shares
 * (addressed to a specific recipient, opaque to the server) ever leave
 * the browser (backend/src/routes/dkg.ts's round1/round2/round3).
 *
 * The Feldman/Shamir algebra here is deliberately a from-scratch
 * browser-native BigInt port of backend/src/crypto/shamirZq.ts — same
 * convention keyholderCrypto.ts already established for dleq.ts's math:
 * a separate, algebraically-identical reimplementation rather than
 * shared code, since these two implementations run in different trust
 * domains. The transport-encryption layer (round-2 sub-share
 * confidentiality) uses standard WebCrypto ECDH + AES-GCM rather than
 * hand-rolled crypto — vetted primitives for confidentiality/integrity,
 * reserving custom math for the DKG algebra itself where no library
 * exists.
 */

// ── Feldman/Shamir algebra (port of shamirZq.ts) ──

export type FeldmanCommitments = bigint[];

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

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

/**
 * Generate this keyholder's own random degree-(t-1) polynomial over Z_q.
 * f(0) is this keyholder's private contribution x_i to the combined key
 * — never sent anywhere. Threshold t=3 to match the rest of this system.
 */
export function generatePolynomial(q: bigint, t = 3): bigint[] {
  const coefficients: bigint[] = [];
  for (let i = 0; i < t; i++) {
    coefficients.push(randomBigIntBelow(q));
  }
  return coefficients;
}

/** Evaluate this keyholder's own polynomial at `index` (the sub-share for recipient `index`). */
export function computeShare(poly: bigint[], index: bigint, q: bigint): bigint {
  let value = 0n;
  let power = 1n;
  for (const coeff of poly) {
    value = (value + coeff * power) % q;
    power = (power * index) % q;
  }
  return value;
}

/** Feldman commitments to this keyholder's own polynomial coefficients: C_l = g^(a_l) mod p. */
export function computeCommitments(poly: bigint[], g: bigint, p: bigint): FeldmanCommitments {
  return poly.map((coeff) => modPow(g, coeff, p));
}

/**
 * Verify a sub-share received from another dealer against THAT dealer's
 * published Feldman commitments — same equation as shamirZq.ts's
 * verifyFeldmanShare. Run this on every incoming sub-share before
 * summing it in; catches a cheating dealer at exchange time, not later.
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

/** Derive keyholder `index`'s expected public commitment from a (combined) Feldman vector. */
export function deriveShareCommitment(index: bigint, commitments: FeldmanCommitments, p: bigint): bigint {
  let result = 1n;
  let power = 1n;
  for (const C_l of commitments) {
    result = (result * modPow(C_l, power, p)) % p;
    power = power * index;
  }
  return result;
}

export { hexToBigInt, bigIntToHex };

// ── ECDH + AES-GCM transport encryption for round-2 sub-shares ──

/** Fresh P-256 ECDH keypair for this ceremony session — not the same key across ceremonies. */
export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
}

export async function exportEcdhPublicKeyHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return Array.from(new Uint8Array(raw), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function importEcdhPublicKeyFromHex(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

/** Export/import the private key as JWK so it can be round-tripped through sessionStorage
 *  between ceremony rounds (the ceremony spans multiple polling waits in one tab session). */
export async function exportEcdhPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

export async function importEcdhPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
}

/** Derive the shared AES-GCM transport key between this keyholder and one recipient. */
export async function deriveTransportKey(privateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
}

/** Encrypt one sub-share (hex-encoded Z_q value) for a specific recipient. */
export async function encryptSubShare(
  transportKey: CryptoKey,
  shareValueHex: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(shareValueHex);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, transportKey, plaintext);
  return { ciphertext: bytesToHex(new Uint8Array(ciphertext)), iv: bytesToHex(iv) };
}

/** Decrypt a sub-share received from another dealer. Throws if the AES-GCM tag doesn't verify. */
export async function decryptSubShare(
  transportKey: CryptoKey,
  ciphertextHex: string,
  ivHex: string
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ivHex) as BufferSource },
    transportKey,
    hexToBytes(ciphertextHex) as BufferSource
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * elgamal.ts — Pure-TypeScript client-side ballot crypto (P4 port).
 *
 * Ported from frontend/src/utils/elgamal.ts (the web app's client prover) so
 * the mobile app can build BYTE-IDENTICAL ballots. The algorithm, the hex
 * serialization and the Fiat–Shamir transcript construction are preserved
 * exactly; the only structural change is that the two platform primitives are
 * injected instead of imported from Web Crypto:
 *
 *   • randomBytes(n) — replaces crypto.getRandomValues
 *   • sha256(bytes)  — replaces crypto.subtle.digest("SHA-256", …)
 *
 * Why inject rather than re-implement: a hand-rolled SHA-256 would add risk
 * with no security benefit, and the mobile platform can supply an audited,
 * OS-backed implementation (expo-crypto). What MUST stay identical is the
 * transcript built by fiatShamirPreimage() below — minimal lowercase hex,
 * comma-joined, order g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1 ‖ … — because
 * the backend verifier (backend/src/crypto/zkp.ts) recomputes it. The
 * port-equivalence test in this package asserts exactly that.
 *
 * Benaloh cast-or-audit (preserved from the web client):
 *   • encryptCandidateIdForAudit() — returns ciphertext + revealed randomness r
 *   • verifyEncryptedCandidateId() — recompute ciphertext from (id, r, pubkey)
 *   • encryptCandidateIdWithProof() — cast path; fresh r, never returned
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

export interface ZkpProof {
  challenges: string[];
  responses: string[];
}

/**
 * Platform primitives the port needs. Implemented by adapters/node.ts for
 * tests and CI, and by an Expo adapter (expo-crypto) in the mobile app.
 */
export interface ClientCryptoPrimitives {
  /** Cryptographically secure random bytes; must be an OS/hardware CSPRNG. */
  randomBytes(length: number): Uint8Array;
  /** SHA-256 of the given bytes (FIPS 180-4), returned as raw bytes. */
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
}

// ── Helpers (verbatim from frontend/src/utils/elgamal.ts) ──

export function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

/** Minimal hex — no "0x" prefix, no padding. The transcript depends on this. */
export function bigIntToHex(n: bigint): string {
  return n.toString(16);
}

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

/** Modular multiplicative inverse using the extended Euclidean algorithm. */
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

/** Encode a candidate UUID as a BigInt via its 32 hex digits (128 bits). */
export function encodeCandidateId(id: string): bigint {
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Candidate id must be a UUID");
  }
  return BigInt("0x" + hex);
}

/** Hex-encode raw bytes the way the web client does (lowercase, 2 digits/byte). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The exact Fiat–Shamir transcript. Exported so the equivalence test can
 * assert the literal string (order, minimal hex, comma separator) rather than
 * only checking that "some proof verified".
 *
 * Input order: g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1 ‖ … — identical to
 * frontend/src/utils/elgamal.ts and to backend/src/crypto/zkp.ts.
 */
export function fiatShamirPreimage(
  g: bigint,
  y: bigint,
  c1: bigint,
  c2: bigint,
  commitments: { a: bigint; b: bigint }[]
): string {
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
  return parts.join(",");
}

export interface ProverResult {
  ciphertext: ElGamalCiphertext;
  zkpProof: ZkpProof;
}

export interface ClientElGamal {
  /** Cast path without a proof (kept for parity with the web client). */
  encryptCandidateId(candidateId: string, pubKey: ElGamalPublicKey): ElGamalCiphertext;
  /** Benaloh audit path: reveals randomness; never submit the result. */
  encryptCandidateIdForAudit(candidateId: string, pubKey: ElGamalPublicKey): EncryptedBallot;
  /** Benaloh verification: recompute from (id, r, pubkey) and compare. */
  verifyEncryptedCandidateId(
    candidateId: string,
    randomness: string,
    pubKey: ElGamalPublicKey,
    ciphertext: ElGamalCiphertext
  ): boolean;
  /** Main cast-path entry point: encrypt + disjunctive OR-proof in one call. */
  encryptCandidateIdWithProof(
    candidateId: string,
    pubKey: ElGamalPublicKey,
    allCandidateIds: string[]
  ): Promise<ProverResult>;
}

export function createClientElGamal(primitives: ClientCryptoPrimitives): ClientElGamal {
  /** Random BigInt in [2, max-2] — web client's randomBigIntInRange. */
  function randomBigIntInRange(max: bigint): bigint {
    const byteLength = Math.ceil(max.toString(16).length / 2);
    let result: bigint;
    do {
      const buf = primitives.randomBytes(byteLength);
      result = (BigInt("0x" + bytesToHex(buf)) % (max - 3n)) + 2n;
    } while (result >= max - 1n || result < 2n);
    return result;
  }

  /** Random BigInt in [1, max-1] — web client's randomBigIntBelow. */
  function randomBigIntBelow(max: bigint): bigint {
    const byteLength = Math.ceil(max.toString(16).length / 2);
    let result: bigint;
    do {
      const buf = primitives.randomBytes(byteLength);
      result = BigInt("0x" + bytesToHex(buf)) % max;
    } while (result === 0n);
    return result;
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

  function encryptCandidateId(candidateId: string, pubKey: ElGamalPublicKey): ElGamalCiphertext {
    const p = hexToBigInt(pubKey.p);
    const k = randomBigIntInRange(p);
    return encryptCandidateIdWithK(candidateId, pubKey, k);
  }

  async function fiatShamirChallenge(
    g: bigint,
    y: bigint,
    c1: bigint,
    c2: bigint,
    commitments: { a: bigint; b: bigint }[],
    q: bigint
  ): Promise<bigint> {
    const preimage = fiatShamirPreimage(g, y, c1, c2, commitments);
    const digest = await primitives.sha256(new TextEncoder().encode(preimage));
    return BigInt("0x" + bytesToHex(digest)) % q;
  }

  async function encryptCandidateIdWithProof(
    candidateId: string,
    pubKey: ElGamalPublicKey,
    allCandidateIds: string[]
  ): Promise<ProverResult> {
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

  function encryptCandidateIdForAudit(
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

  function verifyEncryptedCandidateId(
    candidateId: string,
    randomness: string,
    pubKey: ElGamalPublicKey,
    ciphertext: ElGamalCiphertext
  ): boolean {
    try {
      const k = hexToBigInt(randomness);
      const recomputed = encryptCandidateIdWithK(candidateId, pubKey, k);
      return recomputed.c1 === ciphertext.c1 && recomputed.c2 === ciphertext.c2;
    } catch {
      return false;
    }
  }

  return {
    encryptCandidateId,
    encryptCandidateIdForAudit,
    verifyEncryptedCandidateId,
    encryptCandidateIdWithProof,
  };
}

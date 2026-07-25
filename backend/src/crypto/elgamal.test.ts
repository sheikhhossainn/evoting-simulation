import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import fc from "fast-check";
import {
  generateKeypair,
  encryptCandidateId,
  decryptCandidateId,
  type ElGamalPublicKey,
  type ElGamalPrivateKey,
  type ElGamalCiphertext,
} from "./elgamal";

describe("elgamal", () => {
  it("round-trips a candidate UUID through encryptCandidateId/decryptCandidateId", () => {
    const { publicKey, privateKey } = generateKeypair();
    const candidateId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    const ciphertext = encryptCandidateId(candidateId, publicKey);
    const decrypted = decryptCandidateId(ciphertext, privateKey);

    expect(decrypted).toBe(candidateId);
  });
});

// Local re-implementations of elgamal.ts's private modPow/modInverse.
// Needed to verify the multiplicative homomorphic property at the raw
// BigInt level — encrypt()/decrypt() only round-trip UTF-8 strings, which
// can't represent an arbitrary product-mod-p plaintext.
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}

describe("elgamal property-based tests", () => {
  let publicKey: ElGamalPublicKey;
  let privateKey: ElGamalPrivateKey;
  let p: bigint;
  let g: bigint;
  let y: bigint;
  let x: bigint;

  beforeAll(() => {
    const keypair = generateKeypair();
    publicKey = keypair.publicKey;
    privateKey = keypair.privateKey;
    p = BigInt("0x" + publicKey.p);
    g = BigInt("0x" + publicKey.g);
    y = BigInt("0x" + publicKey.y);
    x = BigInt("0x" + privateKey.x);
  });

  function rawEncrypt(m: bigint): { c1: bigint; c2: bigint } {
    const k = (BigInt("0x" + crypto.randomBytes(32).toString("hex")) % (p - 2n)) + 1n;
    const c1 = modPow(g, k, p);
    const c2 = (m * modPow(y, k, p)) % p;
    return { c1, c2 };
  }

  function rawDecrypt(c1: bigint, c2: bigint): bigint {
    const s = modPow(c1, x, p);
    const sInv = modInverse(s, p);
    return (c2 * sInv) % p;
  }

  describe("homomorphism", () => {
    it("decrypt(enc(a) · enc(b)) == (a * b) mod p, over 10k random pairs", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
          fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
          (a, b) => {
            const ea = rawEncrypt(a);
            const eb = rawEncrypt(b);
            const combinedC1 = (ea.c1 * eb.c1) % p;
            const combinedC2 = (ea.c2 * eb.c2) % p;
            const decrypted = rawDecrypt(combinedC1, combinedC2);
            expect(decrypted).toBe((a * b) % p);
          }
        ),
        { numRuns: 10000 }
      );
    });
  });

  describe("encrypt -> decrypt round-trip", () => {
    it("round-trips random candidate UUIDs", () => {
      fc.assert(
        fc.property(fc.uuid(), (id) => {
          const ct = encryptCandidateId(id, publicKey);
          expect(decryptCandidateId(ct, privateKey)).toBe(id.toLowerCase());
        }),
        { numRuns: 10000 }
      );
    });

    it("round-trips the minimum candidate id (all-zero UUID)", () => {
      const id = "00000000-0000-0000-0000-000000000000";
      const ct = encryptCandidateId(id, publicKey);
      expect(decryptCandidateId(ct, privateKey)).toBe(id);
    });

    it("round-trips the maximum candidate id (all-f UUID)", () => {
      const id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const ct = encryptCandidateId(id, publicKey);
      expect(decryptCandidateId(ct, privateKey)).toBe(id);
    });
  });

  describe("re-encryption uniqueness", () => {
    it("10k encryptions of the same candidate id never collide", () => {
      const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      const seen = new Set<string>();
      for (let i = 0; i < 10000; i++) {
        const ct = encryptCandidateId(id, publicKey);
        seen.add(`${ct.c1}:${ct.c2}`);
      }
      expect(seen.size).toBe(10000);
    });
  });

  describe("malformed/out-of-group ciphertext rejection", () => {
    it("rejects non-hex garbage in c1 or c2 (10k random string pairs)", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => !/^[0-9a-fA-F]+$/.test(s)),
          fc.string(),
          (badC1, c2) => {
            expect(() =>
              decryptCandidateId({ c1: badC1, c2 }, privateKey)
            ).toThrow(/Invalid ciphertext/);
          }
        ),
        { numRuns: 10000 }
      );
    });

    it("rejects c1 ≡ 0 (not in Z*_p)", () => {
      const ct: ElGamalCiphertext = { c1: "0", c2: "1" };
      expect(() => decryptCandidateId(ct, privateKey)).toThrow(
        /c1 out of range/
      );
    });

    it("rejects out-of-range c2 (≥ p)", () => {
      // Use a valid c1 from a real encryption so it passes hex + range + subgroup checks
      const realCt = encryptCandidateId(
        "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        publicKey
      );
      const oversizedC2 = (p * 3n + 7n).toString(16);
      const ct: ElGamalCiphertext = { c1: realCt.c1, c2: oversizedC2 };
      expect(() => decryptCandidateId(ct, privateKey)).toThrow(
        /c2 out of range/
      );
    });

    it("rejects non-quadratic-residue c1 (not in prime-order subgroup)", () => {
      // Find a non-QR: for a safe prime p = 2q+1, a value v where v^q ≢ 1 mod p
      const q = (p - 1n) / 2n;
      let nonQR = 2n;
      while (modPow(nonQR, q, p) === 1n) {
        nonQR += 1n;
      }
      const ct: ElGamalCiphertext = {
        c1: nonQR.toString(16),
        c2: "1",
      };
      expect(() => decryptCandidateId(ct, privateKey)).toThrow(
        /non-quadratic residue/
      );
    });

    it("rejects empty string c1", () => {
      const ct: ElGamalCiphertext = { c1: "", c2: "1" };
      expect(() => decryptCandidateId(ct, privateKey)).toThrow(
        /Invalid ciphertext/
      );
    });
  });
});

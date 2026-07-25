import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import {
  generateKeypair,
  encryptCandidateId,
  decryptCandidateId,
  encrypt,
  decrypt
} from './elgamal';

beforeAll(() => {
  fc.configureGlobal({ seed: 42 });
});

describe('ElGamal Crypto Properties', () => {
  // Generate a keypair once to speed up tests, since keygen is slow.
  // In a real crypto test we might test multiple keys, but for simulation 1 is fine for properties.
  const keypair = generateKeypair();

  describe('Property: Encrypt-Decrypt Roundtrip', () => {
    it('∀ candidateId (UUID): decrypt(encrypt(id)) === id', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          (id) => {
            const ciphertext = encryptCandidateId(id, keypair.publicKey);
            const decrypted = decryptCandidateId(ciphertext, keypair.privateKey);
            return decrypted === id;
          }
        ),
        { numRuns: 50 } // ElGamal encrypt is slightly slow, limit runs
      );
    });

    it('∀ message: decrypt(encrypt(msg)) === msg', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 16 }), // Keep message small to avoid exceeding modulus
          (msg) => {
            const ciphertext = encrypt(msg, keypair.publicKey);
            const decrypted = decrypt(ciphertext, keypair.privateKey);
            return decrypted === msg;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property: Randomized Ciphertext (Semantic Security)', () => {
    it('∀ candidateId: encrypt(id) ≠ encrypt(id)', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          (id) => {
            const cA = encryptCandidateId(id, keypair.publicKey);
            const cB = encryptCandidateId(id, keypair.publicKey);
            return cA.c1 !== cB.c1 || cA.c2 !== cB.c2;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Edge Cases & Validation', () => {
    it('Invalid UUID throws on encryptCandidateId', () => {
      expect(() => encryptCandidateId('not-a-uuid', keypair.publicKey)).toThrow();
      expect(() => encryptCandidateId('', keypair.publicKey)).toThrow();
      expect(() => encryptCandidateId('12345678-1234-1234-1234-12345678901z', keypair.publicKey)).toThrow();
    });

    it('Message too long throws on encrypt', () => {
      const longMsg = 'A'.repeat(100); // Definitely larger than 256-bit prime
      expect(() => encrypt(longMsg, keypair.publicKey)).toThrow(/too long/);
    });
  });
});

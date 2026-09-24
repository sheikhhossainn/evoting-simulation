import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'crypto';
import {
  hashNidWithSalt,
  computeNullifier,
  constituencyFromNid
} from './identity';

beforeAll(() => {
  fc.configureGlobal({ seed: 42 });
});

describe('Identity & Nullifier Properties', () => {
  describe('hashNidWithSalt', () => {
    it('is deterministic', () => {
      fc.assert(
        fc.property(fc.string(), (nid) => {
          return hashNidWithSalt(nid) === hashNidWithSalt(nid);
        })
      );
    });
  });

  describe('computeNullifier', () => {
    it('is deterministic', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (nid, eid) => {
          return computeNullifier(nid, eid) === computeNullifier(nid, eid);
        })
      );
    });

    it('∀ nid₁ ≠ nid₂: computeNullifier(nid₁, eid) ≠ computeNullifier(nid₂, eid)', () => {
      fc.assert(
        fc.property(
          fc.string(), fc.string(), fc.string(),
          (nid1, nid2, eid) => {
            fc.pre(nid1 !== nid2);
            return computeNullifier(nid1, eid) !== computeNullifier(nid2, eid);
          }
        )
      );
    });

    it('∀ nid: SHA256(nid + eid) ≠ computeNullifier(nid, eid) with salt', () => {
      process.env.NULLIFIER_SECRET = 'test-secret-salt-123';
      fc.assert(
        fc.property(fc.string(), fc.string(), (nid, eid) => {
          const oldStyleHash = createHash('sha256').update(nid + eid).digest('hex');
          return oldStyleHash !== computeNullifier(nid, eid);
        })
      );
    });
  });

  describe('constituencyFromNid', () => {
    it('∀ nid: constituencyFromNid(nid) ∈ {CON-01..CON-08}', () => {
      // Simulate typical 11-digit NIDs
      const nidArbitrary = fc.array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 11, maxLength: 11 }).map(a => a.join(''));
      fc.assert(
        fc.property(nidArbitrary, (nid) => {
          const con = constituencyFromNid(nid, 8);
          return /^CON-0[1-8]$/.test(con);
        })
      );
    });

    it('handles non-numeric strings safely', () => {
      expect(constituencyFromNid('abcdef', 8)).toMatch(/^CON-0[1-8]$/);
      expect(constituencyFromNid('', 8)).toMatch(/^CON-0[1-8]$/);
    });
  });
});

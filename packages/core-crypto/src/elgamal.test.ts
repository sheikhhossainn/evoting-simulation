/**
 * elgamal.test.ts — P4 port-equivalence and behaviour tests.
 *
 * Headline assertion: proofs produced by THIS ported prover are accepted by
 * the UNCHANGED backend verifier (backend/src/crypto/zkp.ts,
 * verifyBallotValidity) — for every candidate position, and under two
 * independently generated keypairs. That is the "the mobile prover can never
 * drift from the verifier" property the migration depends on (D4 / risk R4).
 *
 * The backend modules are imported by relative path, following this repo's
 * existing cross-package convention (blockchain/test imports
 * backend/src/merkle/merkleTree.ts the same way, so the two sides can never
 * disagree about the scheme).
 */
import { describe, it, expect, beforeAll } from "vitest";

import {
  createClientElGamal,
  fiatShamirPreimage,
  bigIntToHex,
  bytesToHex,
  type ClientCryptoPrimitives,
  type ElGamalPublicKey,
} from "./elgamal";
import { nodeCryptoPrimitives } from "./adapters/node";

// The arbiter — the exact module the real POST /vote route verifies with.
import { generateKeypair } from "../../../backend/src/crypto/elgamal";
import { verifyBallotValidity } from "../../../backend/src/crypto/zkp";

const client = createClientElGamal(nodeCryptoPrimitives);

function uuidFor(i: number): string {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

/** Counter-based deterministic RNG — proves the port is pure w.r.t. its inputs. */
function deterministicPrimitives(seed: number): ClientCryptoPrimitives {
  let counter = seed >>> 0;
  return {
    randomBytes(length: number): Uint8Array {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        counter = (Math.imul(counter, 1103515245) + 12345) >>> 0;
        out[i] = counter & 0xff;
      }
      return out;
    },
    sha256: nodeCryptoPrimitives.sha256,
  };
}

// One real keypair shared by the cheap behaviour tests (generated once).
let sharedKey: ElGamalPublicKey;
beforeAll(() => {
  sharedKey = generateKeypair().publicKey;
});

describe("injected primitives", () => {
  it("the adapter's SHA-256 matches the FIPS 180-4 vector for 'abc'", async () => {
    const digest = await nodeCryptoPrimitives.sha256(new TextEncoder().encode("abc"));
    expect(bytesToHex(digest)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("Fiat–Shamir transcript (equivalence-critical)", () => {
  it("builds the exact comma-joined minimal-hex string, in order", () => {
    // g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1
    expect(
      fiatShamirPreimage(2n, 3n, 4n, 5n, [
        { a: 6n, b: 7n },
        { a: 8n, b: 9n },
      ])
    ).toBe("2,3,4,5,6,7,8,9");
  });

  it("uses minimal hex — no padding, no 0x prefix", () => {
    expect(bigIntToHex(255n)).toBe("ff");
    expect(bigIntToHex(16n)).toBe("10");
    expect(bigIntToHex(0n)).toBe("0");
  });
});

describe("port equivalence with the backend verifier", () => {
  const candidates = [uuidFor(1), uuidFor(2), uuidFor(3), uuidFor(4)];

  it("every candidate position produces a proof the backend accepts", async () => {
    for (let i = 0; i < candidates.length; i++) {
      const { ciphertext, zkpProof } = await client.encryptCandidateIdWithProof(
        candidates[i],
        sharedKey,
        candidates
      );
      expect(
        verifyBallotValidity(ciphertext.c1, ciphertext.c2, sharedKey, candidates, zkpProof),
        `candidate index ${i} must be accepted by the backend verifier`
      ).toBe(true);
    }
  });

  it("emits the request shape POST /vote expects", async () => {
    const { ciphertext, zkpProof } = await client.encryptCandidateIdWithProof(
      candidates[0],
      sharedKey,
      candidates
    );
    expect(zkpProof.challenges).toHaveLength(candidates.length);
    expect(zkpProof.responses).toHaveLength(candidates.length);
    const hexNoPrefixLower = /^[0-9a-f]+$/;
    for (const s of [...zkpProof.challenges, ...zkpProof.responses, ciphertext.c1, ciphertext.c2]) {
      expect(s).toMatch(hexNoPrefixLower);
    }
  });

  it("the backend rejects a tampered response", async () => {
    const { ciphertext, zkpProof } = await client.encryptCandidateIdWithProof(
      candidates[1],
      sharedKey,
      candidates
    );
    const tampered = {
      challenges: [...zkpProof.challenges],
      responses: [...zkpProof.responses],
    };
    const last = tampered.responses[1];
    tampered.responses[1] =
      last.endsWith("0") ? last.slice(0, -1) + "1" : last.slice(0, -1) + "0";
    expect(
      verifyBallotValidity(ciphertext.c1, ciphertext.c2, sharedKey, candidates, tampered)
    ).toBe(false);
  });

  it("the backend rejects the proof against a set that excludes the choice", async () => {
    const { ciphertext, zkpProof } = await client.encryptCandidateIdWithProof(
      candidates[3],
      sharedKey,
      candidates
    );
    const withoutChoice = candidates.slice(0, 3); // drops candidates[3]
    expect(
      verifyBallotValidity(ciphertext.c1, ciphertext.c2, sharedKey, withoutChoice, {
        challenges: zkpProof.challenges.slice(0, 3),
        responses: zkpProof.responses.slice(0, 3),
      })
    ).toBe(false);
  });

  it("holds under a second, independently generated keypair", async () => {
    const { publicKey } = generateKeypair();
    const { ciphertext, zkpProof } = await client.encryptCandidateIdWithProof(
      candidates[2],
      publicKey,
      candidates
    );
    expect(
      verifyBallotValidity(ciphertext.c1, ciphertext.c2, publicKey, candidates, zkpProof)
    ).toBe(true);
  });
});

describe("determinism and fresh-randomness behaviour", () => {
  const set = [uuidFor(1), uuidFor(2)];

  it("is a pure function of (inputs, randomBytes): same seed ⇒ identical proof", async () => {
    const a = createClientElGamal(deterministicPrimitives(7));
    const b = createClientElGamal(deterministicPrimitives(7));
    const r1 = await a.encryptCandidateIdWithProof(uuidFor(1), sharedKey, set);
    const r2 = await b.encryptCandidateIdWithProof(uuidFor(1), sharedKey, set);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    // …and that deterministic proof is still accepted by the backend.
    expect(
      verifyBallotValidity(r1.ciphertext.c1, r1.ciphertext.c2, sharedKey, set, r1.zkpProof)
    ).toBe(true);
  });

  it("50 encryptions of one candidate never repeat (fresh k each time)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const ct = client.encryptCandidateId(uuidFor(1), sharedKey);
      seen.add(`${ct.c1}:${ct.c2}`);
    }
    expect(seen.size).toBe(50);
  });
});

describe("Benaloh cast-or-audit", () => {
  const candidate = uuidFor(1);

  it("an audited ballot verifies from (candidate, randomness, pubkey)", () => {
    const audited = client.encryptCandidateIdForAudit(candidate, sharedKey);
    expect(
      client.verifyEncryptedCandidateId(
        candidate,
        audited.randomness,
        sharedKey,
        audited.ciphertext
      )
    ).toBe(true);
  });

  it("the audited ciphertext is not a fresh cast ciphertext (never submit it)", () => {
    const audited = client.encryptCandidateIdForAudit(candidate, sharedKey);
    const fresh = client.encryptCandidateId(candidate, sharedKey);
    expect(JSON.stringify(fresh)).not.toBe(JSON.stringify(audited.ciphertext));
  });

  it("rejects the audit with the wrong randomness", () => {
    const audited = client.encryptCandidateIdForAudit(candidate, sharedKey);
    const wrong = audited.randomness === "2" ? "3" : "2";
    expect(
      client.verifyEncryptedCandidateId(candidate, wrong, sharedKey, audited.ciphertext)
    ).toBe(false);
  });
});
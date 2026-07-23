import { describe, it, expect } from "vitest";
import { generateKeypair, encryptCandidateId, decryptCandidateId } from "./elgamal";

describe("elgamal", () => {
  it("round-trips a candidate UUID through encryptCandidateId/decryptCandidateId", () => {
    const { publicKey, privateKey } = generateKeypair();
    const candidateId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    const ciphertext = encryptCandidateId(candidateId, publicKey);
    const decrypted = decryptCandidateId(ciphertext, privateKey);

    expect(decrypted).toBe(candidateId);
  });
});

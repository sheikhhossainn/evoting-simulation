# E-Voting System Evaluation Write-Up

This document compiles the evidence from Tasks 1, 3, 4, 8A, 8B, and 8C to validate the security properties of the e-voting simulation.

## 1. Tamper Detection & On-Chain Anchoring (Task 1)

**Property Claimed:** Vote immutability and tamper detection. Once a batch is anchored on Ethereum Sepolia, any modification to the local database is caught.
**Attack Attempted:** Edited a batch's `root` in `merkle_batches` directly in Supabase after anchoring, then called `GET /anchor/verify/:voteId`.
**Observed Result:** **PASS**
- **Command:** `curl -s http://localhost:3000/anchor/verify/vote-12345`
- **Response:** `409 Conflict`, `{"error": "Recomputed root does not match the anchored root — possible data tampering"}`
- **Evidence:** 
  - **Contract Address:** `0x4b5C381c62876d34bBDDefDe02e872E5a93401b6`
  - **Etherscan Link:** [Contract on Sepolia](https://sepolia.etherscan.io/address/0x4b5C381c62876d34bBDDefDe02e872E5a93401b6)
  - The off-chain and on-chain roots diverge, successfully catching the tamper attempt. See [tamper-proof-demo.md](./tamper-proof-demo.md) for full transaction evidence.

## 2. Ballot Secrecy & Nullifier Unlinkability (Task 3)

**Property Claimed:** A decrypted vote cannot be linked back to the voter who cast it, and nullifiers are unlinkable to public information.
**Attack Attempted:** 
1. Attempted to join the `votes` table back to the `voters` table using the voter's NID hash.
2. Attempted to recompute a voter's nullifier client-side from public info (`SHA-256(nid + election_id)`).
**Observed Result:** **PASS**
- The `votes` table now only stores `nullifier_hash` and `constituency_code`. There is no `nid_hash` or `voter_nid_hash` column.
- The nullifier is computed as `SHA-256(nid + election_id + NULLIFIER_SECRET)`, meaning it cannot be reconstructed without the server-side salt. Vitest property test `∀ nid: SHA256(nid + eid) ≠ computeNullifier(nid, eid)` enforces this.

## 3. Threshold Decryption & Key Ceremony (Task 4)

> **Superseded — see [tally-verifiability-implementation-report.md](./tally-verifiability-implementation-report.md)**
>
> The flow described below (raw share submission, wrong-passphrase→401, under-threshold-reconstruction→400,
> server-side key reconstruction) no longer exists. The system now uses client-side partial decryption
> with Chaum-Pedersen DLEQ proofs (`keyshares.ts`, `dleq.ts`, `keyholderCrypto.ts`): the raw share
> never leaves the browser; only `(d_i, proof)` is submitted; `POST /keyshares/tally` re-verifies
> every DLEQ proof independently before combining; the private key is never reconstructed anywhere.
> Live end-to-end evidence: `tally-verifiability-implementation-report.md §9`.

**Property Claimed:** No single party can decrypt votes; a 3-of-4 threshold of key shares is strictly required. No key material leaks during partial submissions.
**Attacks Attempted:**
1. **Wrong Passphrase:** Submitted share with an invalid passphrase. (Result: 401 Unauthorized)
2. **Duplicate Submission:** Submitted the same keyholder's share twice. (Result: 409 Conflict)
3. **Under-Threshold Reconstruction:** Attempted reconstruction with only 2 shares. (Result: 400 Bad Request, zero key material leaked)
4. **Corrupted Ciphertext Tallying:** Manually corrupted an `encrypted_vote` blob in Supabase, then ran 3-of-4 tallying. (Result: 200 OK, the corrupted vote gracefully binned into `invalid_votes`).
**Observed Result:** **PASS**


## 4. Double-Vote Prevention

**Property Claimed:** No scenario produces two successful votes for one voter.
**Attack Attempted:** Concurrent double-cast (two simultaneous `POST /vote` requests for the same voter).
**Observed Result:** **PASS**
- Only one request succeeded (`201 Created`), while the second was rejected (`409 Conflict` or `403 Forbidden`). 
- The DB row count is strictly 1. The PostgreSQL row-lock in `fn_cast_vote` and unique constraints on `nullifier_hash` hold perfectly. See `testing/race_condition_response.json`.

## 5. Vote Immutability — DB Trigger (Defense-in-Depth)

**Property Claimed:** `encrypted_vote` is immutable after insertion.
**Attack Attempted:** Direct SQL `UPDATE` on a vote row in Supabase using service-role privileges.
**Observed Result:** **PASS** (Blocked)
- Service-role UPDATE returns `P0001: "encrypted_vote is immutable after insertion"`.
- This is defense-in-depth: while a DB admin could drop the trigger, doing so would still be caught by the on-chain Merkle anchor (Section 1).

## 6. Benaloh Voter Verifiability

**Property Claimed:** A voter can independently verify their ciphertext matches their chosen candidate without trusting the system.
**Status:** **DESIGN — not yet implemented or test-backed.**
**Mechanism (proposed):**
- "Audit" reveals the ephemeral randomness `k`.
- Anyone can recompute the ciphertext from `(candidateId, k, pubKey)` and check it matches exactly.
- To prevent coercion, audited ciphertexts are discarded; actual submission uses a fresh `k` which is never revealed.

> **Note:** The current codebase exposes no audit/reveal-`k` endpoint and there is no `encryptWithK`/`verify` implementation, so no property test enforces this yet. The intended enforcing test would be `∀ candidateId, ∀ k: verify(id, k, pubKey, encryptWithK(id, pubKey, k)) === true`. Listed here as future work, not as validated evidence.

## 7. ElGamal Encryption Properties

**Property Claimed:** 
1. Semantic security: same plaintext never produces identical ciphertext.
2. Correctness: decrypt(encrypt(m)) === m.
**Observed Result:** **PASS**
- Enforced by fast-check property tests over thousands of randomized inputs in the Vitest suite:
  - `∀ candidateId: encrypt(id) ≠ encrypt(id)`
  - `∀ candidateId: decrypt(encrypt(id)) === id`

## 8. Merkle Tree Integrity

**Property Claimed:** A forged Merkle proof cannot falsely prove inclusion of a vote.
**Attacks Attempted:** 
- Flipped sibling hash, wrong leaf index, proof from a different tree, second-preimage attack (inner node as leaf).
**Observed Result:** **PASS**
- **Off-chain unit tests:** 19 assertions cover valid proofs across sizes 1–1000, edge cases, and forgery rejection.
- **On-chain Hardhat tests:** 11 assertions confirm the stored Solidity root equals the TS-computed root, and `MerkleProof.verify` accepts the exact same proofs.
- See `testing/merkle_forgery_output.md` for output logs.

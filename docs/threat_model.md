# Threat Model

Defines attackers, capabilities, trust assumptions, and security properties for the e-voting
simulation. Written against the codebase as of commit `08782df`. This document is the reference
point for prioritizing fixes (see [FUTURE_WORK.md](../FUTURE_WORK.md) for the mobile-first roadmap,
which is a separate, later-phase concern) and for scoping the adversarial test suite.

## 1. System summary (for context)

Voter → ElGamal-encrypts candidate choice client-side + builds a Chaum–Pedersen ZKP of validity →
backend verifies proof against a server-derived candidate set → vote inserted (immutable row,
keyed by `nullifier_hash`) → votes periodically batched into a Merkle tree, root anchored on-chain
→ at tally time, 3-of-4 Shamir keyholders reconstruct the ElGamal private key and decrypt.
Full flow: [README.md#the-voting-flow](../README.md#the-voting-flow).

## 2. Actors

| Actor | Capability | Trust assumption today |
|---|---|---|
| **Voter (honest)** | Controls own NID, own browser, own ballot choice | None required — protocol should be secure even if this is the only honest party |
| **Voter (malicious)** | Same as above, plus: scripts requests, replays, forges payloads | Untrusted by design — every client input is validated/re-derived server-side |
| **Network attacker** | On-path between browser ↔ backend ↔ Supabase ↔ chain | TLS assumed to hold; no certificate pinning yet (flagged in [FUTURE_WORK.md §6.2](../FUTURE_WORK.md#62-network--infra-layer)) |
| **Database administrator / compromised DB credentials** | Full read/write on Supabase via service-role key | **Currently over-trusted.** Direct `DELETE`/`UPDATE` SQL against `votes` is blocked by `trg_votes_no_delete`/`trg_votes_immutable` — see §5. The one narrow exception is `fn_admin_delete_vote()` (schema.sql), a `SECURITY DEFINER` RPC that disables the delete guard for a single row and is used ONLY by the admin-gated SMT deletion-detection demo (`POST /anchor/tamper/delete-vote`); a DB admin with direct SQL access could still call it (or disable the trigger directly), so it does not add a new capability beyond what "full read/write" already implies — it exists to make the deletion-detection demo exercisable, not to close this gap |
| **Backend administrator / compromised backend** | Controls the Express process: env secrets (`NULLIFIER_SECRET`, `NID_HASH_SALT`, `ADMIN_SECRET`), can call any route including dev-tamper endpoints | **Currently over-trusted** for pre-anchor windows (§6); single shared `ADMIN_SECRET`, not per-admin (noted in [FUTURE_WORK.md §0](../FUTURE_WORK.md#0-current-state-baseline-from-codebase-review)) |
| **Keyholder / guardian (individual)** | Holds 1 of 4 Shamir shares, submits via passphrase | Cannot decrypt alone (3-of-4 threshold); passphrase-only auth today, no step-up (mobile roadmap addresses this separately) |
| **Keyholder / guardian (colluding, ≥3 of 4)** | Can reconstruct the ElGamal private key | **Out of scope to fully prevent** — this is the explicit trust assumption of threshold decryption. Property to preserve: decryption is provably impossible below threshold ([evaluation_writeup.md §3](./evaluation_writeup.md#3-threshold-decryption--key-ceremony-task-4)) |
| **Blockchain observer (public)** | Reads anchored roots on Sepolia/Amoy, calls `GET /anchor/verify/:voteId`, `GET /public/stats` | Fully untrusted input to the system; should be able to independently verify integrity without any special access |
| **Miner / chain reorg attacker** | Could theoretically reorg Sepolia/Amoy | Out of scope — testnet finality assumptions inherited, not this project's problem to solve |

## 3. Security properties claimed

1. **Ballot secrecy** — no party except the voter's own browser ever learns the plaintext candidate
   choice before tally-time threshold decryption.
2. **Eligibility** — only registered, not-yet-voted voters can cast a counted ballot.
3. **Uniqueness** — at most one counted ballot per voter.
4. **Ballot validity (soundness)** — every counted ciphertext decrypts to a real candidate in the
   voter's constituency; a malformed or out-of-set ciphertext is rejected before insertion.
5. **Tamper-evidence (completeness)** — any post-insertion modification, deletion, or insertion of
   ballots is detectable by an independent verifier, *for the full ballot set*, not just for ballots
   an auditor happens to already hold a proof for. (§5 below — this is currently **not fully met**.)
6. **Tally correctness** — the published result is verifiably the correct decryption of exactly the
   accepted ballot set. (Currently: decryption happens, but no proof *of correct decryption* is
   published — §7 below.)
7. **Coercion-resistance vs. voter-verifiability tension** — a voter should be able to gain some
   assurance their ballot was recorded as cast, without gaining a receipt that lets a coercer verify
   how they voted. Explicitly *not* solved here (§8) — stated as a boundary, not a gap to silently
   patch.

## 4. Property → mechanism → residual risk

| Property | Mechanism | Residual risk |
|---|---|---|
| Secrecy | ElGamal encryption client-side; nullifier has no reversible link to `nid` ([identity.ts](../backend/src/crypto/identity.ts), salted + server-secret-keyed) | **Fixed** — plaintext `candidate_id` removed from the wire entirely ([vote.ts](../backend/src/routes/vote.ts)); the ZKP disjunction proof is now the sole mechanism establishing ballot validity |
| Eligibility | `fn_cast_vote` atomic check against `voters` table | DB admin with service-role key can bypass by direct insert — no defense at this layer; relies on anchoring to catch it after the fact |
| Uniqueness | Unique constraint on `nullifier_hash` + row lock in `fn_cast_vote` | Concurrency-tested ([evaluation_writeup.md §4](./evaluation_writeup.md#4-double-vote-prevention)) — holds |
| Validity | Mandatory Chaum–Pedersen OR-proof, server-derived candidate set ([README.md — ZKP section](../README.md#zero-knowledge-proof-of-ballot-validity-chaumpedersen-or-proof)) | Sound against a network/voter attacker. Not sound against a backend attacker who controls candidate-set derivation itself |
| Tamper-evidence | Merkle batch + on-chain anchor ([evaluation_writeup.md §1](./evaluation_writeup.md#1-tamper-detection--on-chain-anchoring-task-1)) | **Deletion-completeness gap** (§5) and **pre-anchor window** (§6) — both open |
| Tally correctness | 3-of-4 Shamir reconstruction, decrypt-and-bin-invalid ([evaluation_writeup.md §3](./evaluation_writeup.md#3-threshold-decryption--key-ceremony-task-4)) | No ZK proof of *correct* partial decryption per share — a malicious keyholder with a valid share could submit a wrong decryption and nothing catches it today (§7) |
| Voter verifiability | None enforced today — Benaloh audit is design-only ([evaluation_writeup.md §6](./evaluation_writeup.md#6-benaloh-voter-verifiability)) | Explicit boundary (§8), not silently gapped |

## 5. Deletion-completeness gap (detail)

`GET /anchor/verify/:voteId` proves *inclusion* against the dense per-batch tree: "this specific
ballot is in the anchored tree." It proves nothing about the *complement* — the dense tree alone
cannot detect a shrinking ballot set. `votes` rows are now DB-level immutable and un-deletable
(`trg_votes_immutable`, `trg_votes_no_delete`); the one exception is the narrow, audited
`fn_admin_delete_vote()` RPC (§2), used only by the admin-gated deletion-detection demo. A DB admin
with direct SQL/service-role access can still bypass both triggers regardless of that RPC's
existence, so the underlying trust boundary is unchanged from "DB admin is over-trusted" (§2).

This gap is now **substantially closed** by the Sparse Merkle Tree (`docs/smt-design.md`), anchored
alongside the dense tree at every batch: a real membership proof issued against an old anchored SMT
root stays valid forever, while a non-membership proof for the same key against a later root proves
that key is now absent — the contradiction between the two is what makes deletion of an
already-anchored ballot detectable (`GET /anchor/verify-smt/:voteId`,
`POST /anchor/tamper/delete-vote` for the demo). **Remaining gap, explicit per smt-design.md §8**:
a row deleted *before* it was ever anchored in the SMT (the pre-commitment-window gap, §6) leaves no
trace in either tree — detection requires the key to have been committed at least once. The
watchdog/distributed-audit idea in `smt-design.md` gives detection *coverage* for this narrower
remaining window, not a complete mathematical guarantee of full election-set verification.

## 6. Pre-anchor integrity window (detail)

Anchoring is batched, not per-vote ([batching-vs-per-vote.md](./batching-vs-per-vote.md)). Between
a vote's insertion and its batch's on-chain anchor, the only protection is the DB's
immutability/no-delete triggers — which a service-role DB admin can drop or bypass, and which (by
construction) cannot cover a row that never gets INSERTed at all, or the case of a row deleted
before either tree ever anchors its key. A backend/DB attacker acting inside this window is, today,
effectively undetectable until the next anchor runs — and even then, only a key that was actually
committed to the SMT at least once produces a detectable contradiction on later removal (§5). Needs:
signed or hash-chained intermediate commitments written more frequently than the batch anchor, so
the window of undetectable tampering shrinks from "until next batch" to "until next signature,"
independent of chain cost.

## 7. Tally verifiability gap (detail)

Today: reconstruct private key from 3-of-4 shares, decrypt every ballot server-side, publish totals.
An external observer has no way to confirm the published totals are the correct decryption of the
anchored ciphertext set — they must trust the backend process that ran the decryption. Standard fix:
each keyholder publishes a ZK proof of correct partial decryption (proving their share was applied
correctly to each ciphertext, without revealing the share itself) alongside their partial decryption
result; anyone can verify the proofs and recombine, without trusting the backend's arithmetic.
Flagged as the strongest available research contribution — bigger lift than §5/§6 but higher payoff.

## 8. Explicit boundary: voter-verifiable cast confirmation

Not attempting to fully solve in this phase. A full solution (Benaloh challenge / cast-or-audit)
inherently trades off against coercion-resistance: any receipt strong enough for a voter to prove
"the system recorded my real choice" is also strong enough for a coercer to demand as proof of
compliance. The honest framing for the paper is to state this boundary precisely (what a voter can
and cannot verify today, and why the stronger version is deliberately not built), rather than ship
a partial mechanism that looks solved but isn't. Design sketch for a receipt that stays on the safe
side of this line exists in [FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation) — status
remains **design, not implemented**.

## 9. Adversarial test matrix (to build against this model)

Each row should map to a property in §3 and a concrete automated test.

| Attack | Property under test | Status |
|---|---|---|
| Forged ZKP | Validity | Covered — [zkp.test.ts](../backend/src/crypto/zkp.test.ts) |
| Modified ciphertext post-insertion | Tamper-evidence | Covered — [evaluation_writeup.md §1](./evaluation_writeup.md#1-tamper-detection--on-chain-anchoring-task-1) |
| Replayed ballot | Uniqueness | Covered via nullifier uniqueness — [vote.test.ts](../backend/src/routes/vote.test.ts) |
| Deleted ballot | Tamper-evidence (completeness) | **Not covered** — no test asserts a shrunk batch is detectable (§5) |
| Reordered ballots | Tamper-evidence | **Partially detected, by construction — not a blanket property.** `hashPair` sorts its two operands before hashing (commutative, matches OpenZeppelin's `MerkleProof`), so swapping two leaves within the SAME sibling pair at any tree level is undetectable (root byte-identical) — including a full reverse of an even-length batch, which decomposes entirely into same-pair swaps. Reorderings that move a leaf ACROSS a sibling-pair boundary do change the root. Both cases are now explicit regression tests, [merkleTree.test.ts](../backend/src/merkle/merkleTree.test.ts)'s "Reordering the root — honest coverage" describe block. This is inherent to sorted-pair Merkle hashing generally (why OZ's own library carries no order guarantee), not a bug specific to this codebase — fixing it fully would mean switching to position-aware node hashing like the SMT already uses (`smt-design.md §6.1`), which breaks compatibility with every already-anchored batch's proof format and is a real, separate design decision, not a drop-in change. Left as a documented limitation, not fixed, per explicit instruction (methodology-audit follow-up, 2026-08-14) |
| Duplicated ballot | Uniqueness | Covered via nullifier uniqueness |
| Forged Merkle proof | Tamper-evidence | Covered — [evaluation_writeup.md §8](./evaluation_writeup.md#8-merkle-tree-integrity) |
| Manipulated root | Tamper-evidence | Covered — [evaluation_writeup.md §1](./evaluation_writeup.md#1-tamper-detection--on-chain-anchoring-task-1) |
| Insufficient Shamir shares | Tally correctness (confidentiality side) | Covered — [evaluation_writeup.md §3](./evaluation_writeup.md#3-threshold-decryption--key-ceremony-task-4) |
| Malicious guardian share (wrong partial decryption) | Tally correctness | **Not covered** — no proof-of-correct-decryption exists yet (§7) |
| Concurrent double voting | Uniqueness | Covered — [evaluation_writeup.md §4](./evaluation_writeup.md#4-double-vote-prevention) |
| Backend/database direct manipulation (DELETE bypass) | Tamper-evidence (completeness) | **Not covered** — trigger blocks UPDATE only |

## 10. Non-goals (explicitly out of scope)

- Preventing collusion of ≥3-of-4 keyholders (inherent to threshold trust model, not a bug).
- Chain reorg / finality attacks on the underlying testnet.
- Physical device compromise of the voter's browser (malware, keylogger) — standard client-security
  assumption, not specific to this protocol.
- DDoS / infra hardening — tracked separately in [FUTURE_WORK.md §6](../FUTURE_WORK.md#6-ddos--security-hardening).
- Multi-election isolation. `votes`/`voters`/`nullifiers` carry no `election_id` column — this system models exactly one live election at a time; `election_id` strings flowing through DLEQ/commitment hash domains (dleq.ts, candidateCommitment.ts) are pure cross-context domain separation, not an enforced storage-level scoping key. The candidates/constituencies immutability gate (schema.sql's `trg_candidates_immutable_after_commitment`) is correspondingly global, not per-election, by the same design. A multi-election deployment would need real per-election scoping on all three tables, not just the hash domains.

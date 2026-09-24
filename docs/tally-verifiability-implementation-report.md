# Tally Verifiability — Implementation & Live Verification Report

Companion to [`tally-verifiability-design.md`](./tally-verifiability-design.md) (the spec) and [`threat_model.md`](./threat_model.md). This document records what was actually built, tested, and — as of 2026-08-14 — run for real against live infrastructure, plus what was found along the way and what remains open.

## 1. Goal

> Can an independent observer verify that the final tally was correctly derived from the encrypted ballots, without trusting a single administrator?

Before this work: no. The backend reconstructed the ElGamal private key server-side to decrypt every ballot, with no proof that decryption was done correctly or that a keyholder didn't tamper with their share. This work replaces that with partial decryption + Chaum-Pedersen DLEQ proofs + public threshold combination, so the key is never reconstructed and every step is independently checkable.

## 2. Design process

Per this project's established discipline (design first, adversarial review, then implement), the design went through two rounds of review before any code was written:

1. Initial design doc covering ElGamal params, Shamir-over-Z_q + Feldman VSS, partial decryption, DLEQ proofs with domain separation, threshold combination, and the public verification bundle.
2. A full adversarial pass across §§1–9, which found gaps (omission/substitution/replay attacks not addressed, GF(2⁸)→Z_q migration risk, Feldman-vs-DKG distinction needed to stay explicit) and revised the doc accordingly.
3. A second, focused pass on candidate-set integrity (§8.2) — the exact TLV canonical serialization, commitment construction, and on-chain anchoring protocol for candidates/constituencies, with an adversarial cases table (substitution, reordering, UUID swap, stale replay, cross-election replay).

Only after both passes came back addressed did implementation start.

## 3. What was implemented

### Cryptographic core (`backend/src/crypto/`)
- **`shamirZq.ts`** — Shamir's Secret Sharing over Z_q (not GF(2⁸) — required so threshold combination and ElGamal exponent arithmetic share a field) + Feldman VSS (publishes coefficient commitments so each keyholder can verify their own share against them at distribution time).
- **`dleq.ts`** — Chaum-Pedersen DLEQ proofs. Proves `y_i = g^x_i` AND `d_i = c1^x_i` for the same witness `x_i`, binding a partial decryption to both the specific keyholder and the specific ballot. Fiat-Shamir with explicit domain separation (`EVOTING-PARTIALDEC-DLEQ-v1` + election_id + ballot_id baked into the hash).
- **`candidateCommitment.ts`** — TLV canonical serialization of candidate/constituency records, sorted before hashing (so reordering is provably not an attack), commitment via a separate domain-separated tag.

### Contracts (`blockchain/`)
- **`ElectionSetupCommitment.sol`** — minimal write-once contract; `anchor()` can be called exactly once per deployment, no update function exists at all.

### Backend routes (`backend/src/routes/keyshares.ts`)
Old raw-Shamir-share flow removed entirely (not kept as a fallback):
- `GET /keyshares/commitments` — public group params + Feldman + keyholder commitments.
- `GET /keyshares/status` — per-keyholder submission progress, scoped to an explicit `batch_id`.
- `POST /keyshares/submit-partial` — keyholder submits `(d_i, proof)` only; the raw share never reaches the backend. Verifies each proof against the real ballot ciphertext; publishes failures with a reason rather than silently dropping them.
- `POST /keyshares/tally` — admin-gated; re-verifies every partial at combination time regardless of stored flag; requires ≥3 valid partials per ballot; never imports or calls a key-reconstruction function.
- `GET /keyshares/verification-bundle` — public, no-auth bundle with everything an independent verifier needs.

### Standalone verifier (`backend/src/scripts/independent-verify-tally.ts`)
No DB connection, no admin secret, no private key — takes a bundle file + on-chain addresses and re-derives everything from scratch: on-chain root, dense-tree rebuild, candidate commitment (recomputed and checked against the deployed contract), completeness cross-check, every DLEQ proof, independent recount, diff against published results.

### Client-side crypto (`frontend/src/utils/keyholderCrypto.ts`)
A from-scratch browser port of the DLEQ math (not imported from the backend — Node's `crypto` module isn't available client-side, and the whole point is these two implementations run in different trust domains). The Key Holder Portal (`KeyShareSubmit.tsx`) now fetches ballots and group params, computes `(d_i, proof)` locally, and posts only that — the raw share is entered into the browser and never leaves it.

## 4. A real cryptographic bug, found and fixed mid-implementation

Adversarial stress-testing of `dleq.ts` found that `verifyDleq` failed non-deterministically (~0.1%+ of trials) whenever `c1` was an arbitrary element of Z*_p rather than a genuine subgroup member. Root cause: the proof's exponent arithmetic reduces mod `q`, which is only valid when `c1` has order dividing `q` — true for real ElGamal ciphertexts (`c1 = g^k`), but nothing enforced it. Fixed by adding the same `c1^q ≡ 1 mod p` check `elgamal.ts` already had elsewhere, applied consistently to partial-decryption generation and verification, both backend and browser. This was reported and confirmed with the user before fixing, per this project's stop-and-report discipline for soundness issues.

## 5. Test coverage

| Suite | Result |
|---|---|
| `shamirZq.test.ts`, `dleq.test.ts` (incl. subgroup-membership regression, 500+500 stress trials), `candidateCommitment.test.ts` | all passing |
| `ElectionSetupCommitment.test.ts` (Hardhat) | 5/5 |
| `keyshares.batchScoping.test.ts` (new, see §7) | 11/11 |
| Full backend suite (`vitest run`) | 143 passed, 2 skipped |
| Full Hardhat suite | 30/30 |

## 6. Live deployment

Applied to real infrastructure (with explicit user approval at each irreversible step):
- Supabase migration (`election_key_ceremony`, `partial_decryptions`, `election_setup_commitments` tables, `key_shares.public_commitment` column, candidates/constituencies immutability triggers) — applied via the Supabase SQL editor, verified present.
- `ElectionSetupCommitment.sol` deployed to Sepolia (`0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C`), commitment anchored for `NATIONAL-2026-001`.
- Key ceremony run for real (`setup-shamir-zq.ts`, run directly by the user — the script's raw share output must never pass through an agent's tool output, since that would reintroduce exactly the exposure this design eliminates). Verified live: Feldman `C_0` matches `ELGAMAL_PUBLIC_KEY`, all 4 keyholder public commitments published.

## 7. A live audit finding: the "latest batch" was contaminated

While running live smoke tests against real anchored ballots, DLEQ proof generation immediately threw on the first real ballot tried — not a crypto bug, but because that ballot's `c1` field was the literal string `"fake_c1"`. Full audit of the then-latest anchored batch (batch 2, 32 votes):

| Classification | Count |
|---|---|
| Genuine, valid ciphertext (valid 64-hex-char, passes `c1^q ≡ 1 mod p` subgroup check) | 6 |
| Well-formed 64-hex-char but fails subgroup check | 11 |
| Not valid hex at all (`"fake_c1"`, `"c1"`, `"0x01"`, 16-byte short values, etc.) | 15 |

(Independently re-queried: `SELECT id, encrypted_vote FROM votes WHERE id IN (merkle_batches.vote_ids WHERE batch_id=2)` → 32 rows; each `encrypted_vote->>'c1'` classified. Counts sum to 32, matching the batch size.)

Root cause traced to `vote.test.ts`: it had no working `.env.test` isolation and silently fell back to writing directly into the production Supabase project, with no cleanup — self-documented in its own now-`it.skip`'d concurrency test and the committed `testing/concurrency_stress_output.json` evidence. Because `votes` has a `trg_votes_no_delete` trigger, these rows cannot be cleaned up through ordinary means.

Batch 0 (2 votes, anchored separately) was confirmed fully genuine — one of its two ballots is the only vote in the entire table cast after ZKP became mandatory.

Follow-up investigation (statistical, not just circumstantial): the WRONG-KEY-OR-INVALID rows' ~50/50 pass rate against the subgroup check is exactly what pure-random bytes would produce (a genuine `c1 = g^k mod p` can never fail this check, by construction) — matching a fake-ciphertext-generation pattern (`randomBytes(32).toString("hex")`) already present elsewhere in this codebase's tooling (`test-merkle-batch.ts`). High confidence this is more test contamination, not a historical encryption bug.

**Decision, per explicit instruction: do not delete, filter, or re-anchor anything.** Batch 2 stays exactly as anchored — the on-chain commitment stays honest about what was actually committed. Batch 0 was used instead.

## 8. Two blockers fixed before any real tally

**Batch selection.** `POST /keyshares/tally`, `GET /keyshares/status`, and `GET /keyshares/verification-bundle` used to silently select "whichever `merkle_batches` row has the highest batch_id" — meaning a real tally would have silently pulled in the contaminated batch. Fixed: all three now require an explicit `batch_id`, 400 if omitted, 404 if unknown. A membership-based SMT coverage check (`verifyBatchSmtCoverage`) was added rather than a naive "matching smt_batches row" join — that assumption was checked and found to be actually false for this project's own data (batch 2 added zero new SMT keys, since its nullifiers were already present from an earlier backfill). 11 new regression tests prove batch 0 and batch 2 requests never cross-contaminate. The standalone verifier's stale-bundle check was also updated, since it used to hard-fail any batch that wasn't the chain's literal latest — now checks the named batch's on-chain existence/root directly, with "not latest" downgraded to an informational note.

A follow-on bug this introduced was caught and fixed: the Key Holder Portal, status page, and Tallying page all called these routes without a `batch_id`, which would have 400'd immediately. All three now explicitly target `batch_id=0`.

**Test isolation.** New `backend/src/testUtils/testSupabaseEnv.ts`: any test that writes to Supabase now fails closed (throws at import time) unless `backend/.env.test` exists and points at a genuinely different Supabase project than production. Applied to both `vote.test.ts` and `anchorSmt.integration.test.ts` (which had the identical latent bug). Confirmed live: both now refuse to run rather than silently touching production. **A real second Supabase project for `.env.test` still needs to be provisioned** — this wasn't something an agent could do; the fail-closed behavior means these two files simply won't run until it exists.

## 9. The real, live, end-to-end tally

With both blockers fixed, a read-only preflight (7 checks: explicit batch scoping, on-chain root match, ciphertext/subgroup validity, candidate commitment match, ceremony consistency, frontend wiring, no secret material touched) passed cleanly. Three real keyholders (KH-001, KH-002, KH-003 — Election Commission, Judiciary Observer, Academic Auditor) then submitted real partial decryptions through the actual Key Holder Portal, entering their real shares locally in the browser. Each of the 6 submitted proofs (3 keyholders × 2 ballots) was independently re-verified before the tally was run.

**Result — `POST /keyshares/tally`, `batch_id=0`:**
- 2/2 ballots decoded successfully, 0 rejected, 0 flagged submissions.
- `CON-03 → Farhana Islam (National Reform)`, `CON-06 → Elias Kanchon (Progressive Alliance)`, 1 vote each.
- One DB write: `tally_results` upserted for `NATIONAL-2026-001`. No other writes, no batch 2 interaction, no re-anchoring.

**Standalone independent verifier, re-run against the resulting bundle:**

```
[PASS] 1. on-chain batch existence + root check
[PASS] 2. dense root rebuild
[PASS] 2a. candidate/constituency commitment (vs bundle)
[PASS] 2a. candidate/constituency commitment (vs on-chain)
[PASS] 3. completeness cross-check
[PASS] 4. DLEQ proof verification — 6 valid, 0 invalid
[PASS] 5. independent recount — 2 valid votes, 0 rejections
[PASS] 6. diff vs published_results — recounted 2 vs published 2
ALL CHECKS PASSED
```

This is the first time every check passed against a genuinely real tally — all prior runs failed step 6 only because no real tally had been produced yet under the new flow.

## 10. Remaining limitations — deliberately not solved

- **Pre-anchor omission** (design doc §8.1): the completeness cross-check is bounded and non-cryptographic — it catches gross omission, not small/targeted omission of ballots before they're ever anchored. Unchanged, still open.
- **Dealer-backdoor / no DKG** (§2.1, §11, §12): Feldman VSS lets a keyholder verify their own share, but the dealer who ran the ceremony knows the whole polynomial and could in principle have kept a copy. Explicitly out of scope per instruction, not addressed.
- **Batch 2's contamination**: untouched, as instructed. It remains a real, on-chain-committed batch that must not be used for a real tally in its current form. If a larger/richer demo dataset is wanted, the recommended path is casting fresh votes through the now-hardened (ZKP-mandatory) voting flow and anchoring a new clean batch — not rehabilitating batch 2.
- **`.env.test` still doesn't exist**: `vote.test.ts` and `anchorSmt.integration.test.ts` remain correctly blocked (fail-closed) until a real, separate Supabase test project is provisioned.

# DKG / Verifiable-Tally Security Audit — Findings & Fixes (2026-08-16)

Companion to [`dkg-security-analysis.md`](./dkg-security-analysis.md), [`tally-verifiability-implementation-report.md`](./tally-verifiability-implementation-report.md), and [`threat_model.md`](./threat_model.md). Records a targeted adversarial review of the already-implemented DKG ceremony (`eaa38e1`) and verifiable tally (`2eea30f`), what it found, and what was fixed.

## 1. Method

15 concrete attack scenarios across 5 categories were run against the actual code (not the design docs) by three parallel read-only agents, each asked to confirm or refute each scenario with file:line evidence rather than take the scenario's framing at face value:

1. **State machine / concurrency** — ceremony reset, partial-decryption replay, cross-batch contamination.
2. **Byte/hex/BigInt encoding** — nullifier hashing across the frontend/backend/SMT boundary, Feldman `C_0` vs. the election's public key, SMT leaf domain separator vs. the on-chain Solidity verifier.
3. **Independent verifier trust gaps** — SMT proof content binding, on-chain-vs-JSON root trust, malformed-proof handling.
4. **Deletion/modification integrity** — dense-batch/SMT drift on deletion, `partial_decryptions` mutability, constituency immutability + TLV coverage.
5. **Browser trust** — sessionStorage exposure/CSP, election_id binding in DLEQ proofs, live re-verification at tally.

## 2. Results

**9 of 15 scenarios were already safe**, confirmed with evidence rather than assumed:

| Scenario | Evidence |
|---|---|
| Ceremony re-init after round 1 | `POST /dkg/init` 409s if a `election_key_ceremony` row already exists; `POST /dkg/round1` upserts only the caller's own row and 409s once `status='qualified'` |
| Cross-batch contamination | `GET /keyshares/status` / `verification-bundle` scope every query to the named batch's `vote_ids`, with an explicit anti-regression comment from a prior live finding |
| Nullifier hex consistency | Nullifier is computed once, server-side (`identity.ts`), never client-side; `sparseMerkleTree.ts`'s `normalizeHex32` tolerantly accepts the unprefixed form the DB stores |
| SMT leaf domain separator | TS (`sparseMerkleTree.ts`) and Solidity (`MerkleRootStorage.sol`) both prefix leaves with `0x01` and use identical node-hash/bitmap conventions — a real on-chain verifier exists and matches |
| On-chain root trust | `independent-verify-tally.ts` queries `smtBatches()`/`getBatch()` on-chain for both roots; a missing `--merkle-address` is recorded as a FAIL, never silently trusted from the JSON bundle |
| Missing-sibling handling | `verifyAgainstRoot`'s proof-walk loop explicitly `return false`s on an exhausted or over-long siblings array — no implicit fill with `H[0]` |
| DLEQ election_id binding | Fiat-Shamir hash includes `electionId` identically on both frontend (`keyholderCrypto.ts`) and backend (`dleq.ts`) — tampering the request body's `election_id` breaks proof verification, no separate explicit compare needed |
| Live re-verification at tally | `POST /keyshares/tally` re-fetches `votes.c1` fresh from the DB and re-runs full `verifyDleq` (including the subgroup check) per partial — it does not trust the `verified` flag cached at submission time |
| Constituency immutability + TLV coverage | `candidateCommitment.ts`'s TLV includes `constituency_code`/`name`; per-election immutability triggers are correctly scoped (a prior global-vs-per-election bug was already fixed) |

**6 scenarios were real gaps.** 4 were selected for immediate fixing (below); 2 were left open by explicit choice:

- *Dense-batch `vote_ids` drift on deletion* — `merkle_batches.vote_ids` isn't cleaned up when a vote is deleted via `fn_admin_delete_vote`. Left open: this is by design (the dense batch is an immutable, already-anchored historical record) and the drift is already caught downstream — `checkBatchSmtConsistency` and the independent verifier's dense-root rebuild both fail loudly rather than passing silently.
- *Partial-decryption replay (accountability)* — turned out to share a root cause with the `partial_decryptions` mutability fix below and was closed by the same change.

## 3. Fixes applied

### 3.1 Critical — DKG ceremony produced a key unrelated to the one votes were encrypted under

`POST /dkg/init` (`backend/src/routes/dkg.ts`) generated a fresh, independent `p`/`g` per election and stored only that in `election_key_ceremony`. Meanwhile `GET /election/public-key` and `POST /vote`'s ZKP verification both read `ELGAMAL_P`/`ELGAMAL_G`/`ELGAMAL_PUBLIC_KEY` from `backend/.env` — written once, globally, by `setup-keys.ts`'s own independent key generation. These were two disconnected sources of `p`/`g`/`y`; only `keyshares.ts` (the decrypt/tally side) ever read from the DKG ceremony. Had the DKG ceremony been run as the documented production path, keyholders would have built shares of a key with no mathematical relationship to real ballots — partial decryptions would fail or produce garbage.

**Fix (structural, not a bolt-on check):** `election_key_ceremony` is now the single source of truth for `p`/`g`/`y` on both sides.
- `backend/src/services/electionContext.ts` — new `getElectionPublicKey(electionId)`, returns `{p, g, y: feldman_commitments[0]}` only once `status='qualified'`.
- `backend/src/index.ts` — `GET /election/public-key` now takes `election_id` and calls it, instead of the removed `loadPublicKeyFromEnv()`.
- `backend/src/routes/vote.ts` — ZKP verification now sources the public key the same way.
- `frontend/src/utils/api.ts`, `frontend/src/pages/VotingPage.tsx` — `getElectionPublicKey` now takes `election_id`.
- `backend/src/crypto/elgamal.ts` — `loadPublicKeyFromEnv`/`loadPrivateKeyFromEnv` deleted (fully dead once nothing reads the global env key).
- `backend/src/scripts/setup-shamir-zq.ts` — its `election_key_ceremony` upsert never set `status='qualified'`; this fix surfaced that the dev-only trusted-dealer path would have silently stopped working under the new gate, so `status: "qualified"` was added there too.
- `backend/src/scripts/setup-keys.ts` — doc comment corrected: its ElGamal env vars now only feed the deprecated dev-only path, not production vote encryption.

### 3.2 High — independent verifier's SMT membership proofs weren't bound to ballot content

`independent-verify-tally.ts` step 1c checked that a valid membership proof existed for each `ballot_id` and that it verified against `smt_root`, but never recomputed the leaf value from that ballot's own `c1`/`c2`/`created_at`. A compromised server could attach a genuine-but-unrelated ballot's proof to a substituted ciphertext, and the check would still pass because the unrelated leaf really is anchored.

**Fix:** step 1c now recomputes `hashVoteLeaf({voteId, c1, c2, createdAt})` from the bundle's own `ballots[]` entry and requires it to equal `proof.value`; mismatch is a hard failure. New test (`independent-verify-tally.test.ts`) constructs exactly this attack — a second, genuinely-anchored decoy leaf swapped onto ballot-1's proof entry — and confirms it's now rejected.

### 3.3 Medium — `partial_decryptions` had no immutability guard

`POST /keyshares/submit-partial` upserted on `(election_id, ballot_id, keyholder_index)`. `votes` has both an immutability trigger and a no-delete trigger; `partial_decryptions` had neither — a keyholder could submit, get flagged invalid, then silently resubmit and erase that evidence, or overwrite a valid `d_i` after tally had already run, with no audit trail.

**Fix:**
- `backend/src/schema.sql` — new `fn_partial_decryptions_no_update()` + `trg_partial_decryptions_no_update` (`BEFORE UPDATE`, unconditional reject), applied to the live DB.
- `backend/src/routes/keyshares.ts` — `submit-partial` changed from `.upsert()` to `.insert()`; a unique-constraint violation (Postgres `23505`) now surfaces as `{verified: false, reason: "already_submitted"}` per ballot instead of silently overwriting.

### 3.4 Low — no Content-Security-Policy anywhere in the app

`KeyCeremony.tsx` holds the keyholder's private DKG polynomial + ECDH private key in `sessionStorage` for the ceremony's duration (cleared only after round 3 confirms). Neither `frontend/index.html` nor the Express backend set any CSP — an XSS bug anywhere in the SPA had no defense-in-depth layer between it and that sessionStorage.

**Fix:** `frontend/index.html` now sets `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, and scoped `connect-src`/`style-src`/`font-src`. Flagged in-file: `connect-src`'s dev API origin (`http://localhost:3000`) is static per build and must be updated for a non-localhost deployment.

## 4. Verification

- `cd backend && npx tsc --noEmit && npx vitest run` — clean; 173 passed / 2 skipped (the 2 skips are the pre-existing gated-by-design live-DB suites, `vote.test.ts`/`anchorSmt.integration.test.ts`, which require a manually-configured `.env.test` — same as before this audit, not a regression).
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run build` — clean.
- New `partial_decryptions_no_update` trigger applied directly to the live Supabase project via SQL editor (schema.sql changes don't auto-apply — same manual-apply pattern as the prior DKG migration).

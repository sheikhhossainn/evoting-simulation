# AUDIT.md — Phase 1: Codebase & Existing-Documentation Audit

**Project:** E-Voting Simulation (`sheikhhossainn/evoting-simulation`)
**Branch audited:** `dev` (HEAD `48b2f18`, clean working tree — verified in Phase 0)
**Audit date:** 2026-09-23
**Method:** direct reading of files, commit history, and the lockfile-verified dependency tree; every non-trivial claim below is tagged with its source file (`path` + function/route/line where relevant). Claims not verified are tagged `UNKNOWN — REQUIRES VERIFICATION`.

This is a **factual inventory only** — no recommendations. Judgment/classification happens in Phase 2 (`METHODOLOGY.md`).

---

## 1. Repository structure

Monorepo with four packages + docs + evidence, orchestrated by a root `package.json` (npm workspaces are not used; scripts use `--prefix`). Source: `git ls-files`, `package.json`.

| Path | Purpose (verified) |
|---|---|
| `frontend/` | React 19 + Vite 8 + TS 6 + Tailwind 3 + react-router-dom 7 SPA (`frontend/package.json`). Voting, key-holder (DKG/partial decryption), and admin UIs. |
| `backend/` | Express 5 + TS + Zod 4 + Supabase JS + ethers 6 REST API, all voting/anchoring/tally logic, crypto, Merkle implementation (`backend/package.json`, `backend/src/index.ts`). |
| `blockchain/` | Hardhat 2 + Solidity 0.8.24. `MerkleRootStorage.sol` (batch-root + SMT anchoring) and `ElectionSetupCommitment.sol` (write-once candidate/constituency commitment) + deploy/benchmark scripts (`blockchain/package.json`, `blockchain/contracts/`). |
| `shared-interfaces/` | `types.ts` — shared TS types, header says "Keep in sync with backend/src/schema.sql" (it is NOT fully in sync — see §15). |
| `docs/` | Design/security/evidence docs (inventoried in §13). |
| `testing/` | Evidence artifacts of past adversarial runs (`vote_casting_output.md`, `concurrency_stress_output.json`, `race_condition_response.json`, `merkle_forgery_output.md`, `shamir_threshold_output.md`, `testing_evidence.md`, `elgamal_property_tests_evidence.md`, `anchoring/` PNGs). |
| `graphify-out/` | Graphify knowledge-graph snapshots (CLAUDE.md directs to them; they are derived artifacts, dated 2026-07-29/08-08 — superseded by later refactors; not authoritative). |
| Root docs | `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `context.md`, `METHODOLOGY.md`, `REFACTOR.md`, `FUTURE_WORK.md`, `FUTURE_IMPLEMENTATION.md` (§13). |
| `.github/workflows/ci.yml` | CI for PRs into `dev` (three jobs: frontend lint+build, backend tsc + merkle smoke + unit tests, contracts compile+test). |

**Branching model** (`CONTRIBUTING.md`): `main` ← `dev` ← `feature/*`; nobody pushes to `main`/`dev` directly.

---

## 2. Frontend

**Stack (verified in `frontend/package.json`):** React `^19.2.7`, react-dom `^19.2.7`, react-router-dom `^7.18.0`; dev: Vite `^8.1.0`, TypeScript `~6.0.2`, Tailwind `^3.4.19`, oxlint `^1.69.0`, postcss/autoprefixer. No state-management library (no Redux/Zustand) — state is passed through router location state and read from `?election_id=` URLs (`frontend/src/utils/nullifier.ts:30`); a mock/offline localStorage store is used as a demo fallback (§15.7).

**Routing** (`frontend/src/App.tsx`): `<BrowserRouter>`.
- Public (with `Layout`+`Navbar`): `/` LandingPage, `/how-to-vote`, `/about`, `/watchdog` PublicWatchdog, `/visualizer` TamperVisualizer.
- Standalone voter portal: `/voter/login` VoterLogin → `/voter/vote` VotingPage → `/voter/confirmation` VoteConfirmation.
- Standalone keyholder portal: `/keyholder/login`, `/keyholder/ceremony` (DKG), `/keyholder/submit` (partial decryption), `/keyholder/status`, `/tally` TallyingPage.
- Admin: `/admin/login` (UI mock — `backend/src/middleware/adminAuth.ts:4-8` calls it a "UI mock", corroborated by `context.md` "Admin portal uses ADMIN_SECRET … (intentional simulation scope)"), `/admin/dashboard`.

**Voter flow pages (cited):**
- `VoterLogin.tsx:27-66` — submits NID (11 digits, `/^\d{11}$/`) to `registerVoter`; blocks at the UI if `has_voted`; otherwise navigates to `/voter/vote` passing `{nid, nidHash, constituencyCode, voterId}` via router state.
- `VotingPage.tsx` — fetches real candidate roster (server-derived constituency), the election ElGamal public key; builds ciphertext + ZKP client-side (`frontend/src/utils/elgamal.ts:encryptCandidateIdWithProof`); includes a Benaloh-style cast-or-audit audit modal (`encryptCandidateIdForAudit` / `verifyEncryptedCandidateId`, `frontend/src/utils/elgamal.ts:284-315`); on confirm calls `submitVote` and navigates to confirmation.
- `VoteConfirmation.tsx:15-24` — shows the returned `vote_id`, but displays a **hard-coded mock `tx_hash`** (`"0x7a3f…e91b4c08d2f6a0b7e1c3d5f8a2b4c6d8e0f1a3b5c7d9e"`) even though anchoring is implemented in the backend (§15.3).

**Client-side crypto** (`frontend/src/utils/elgamal.ts`): full ElGamal encryption + Chaum–Pedersen OR-proof prover (`encryptCandidateIdWithProof`, lines ~200-277) + Benaloh audit helpers. `frontend/src/utils/nullifier.ts` — **no longer computes nullifiers** (removed; server computes them, `nullifier.ts:4-14`); still exports `DEFAULT_ELECTION_ID = "NATIONAL-2026-001"` and an unsalted `hashNid` "kept only for legacy display purposes".

**CSP** (`frontend/index.html:18`): meta-tag Content-Security-Policy `default-src 'self'; script-src 'self'; … connect-src 'self' http://localhost:3000`, with an explicit comment that the DKG ceremony holds key material in `sessionStorage` and that a production API origin must update the static CSP.

`frontend/public/candidates.json` exists (mock candidate list consumed only by the offline fallback path — see §15.7).

---

## 3. Backend

**Stack (verified `backend/package.json`):** express `^5.2.1`, zod `^4.4.3`, `@supabase/supabase-js ^2.108.2`, ethers `^6.13.5`, cors, dotenv, `secrets.js-grempe` (used only by legacy `crypto/shamir.ts`); dev: vitest `^4.1.10`, fast-check `^4.9.0`, ts-node, nodemon, TypeScript 6. Scripts: `test`→`vitest run`; `test:ci`→a fixed 4-file crypto/merkle subset. Type: `commonjs`.

**Server entry `backend/src/index.ts`:**
- Middleware: CORS allowing only `http://localhost:5173` / `http://127.0.0.1:5173` (L32-37), `express.json()` (no body-size limit, no rate limiting — absent from index.ts and both package.json files; corroborated by FUTURE_WORK.md §0).
- Routers mounted (L40-49): `/voter` (voter.ts), `/vote` (vote.ts, root), `/candidates` (candidates.ts, root), `/keyshares` (keyshares.ts), `/anchor` (anchor.ts), `/public` (public.ts), `/elections` (elections.ts), `/dkg` (dkg.ts).
- `GET /health` (L52); `GET /election/public-key` (L60-80) → `getElectionPublicKey` (electionContext.ts:79-89) reads `election_key_ceremony` (status `qualified`) and returns `{p,g,y}` — never from env.
- `setInterval(5 min)` → `maybeAutoAnchor()` (index.ts:99-101).

**Key modules:**
- `src/crypto/` — `identity.ts` (nid_hash, nullifier, constituency derivation), `elgamal.ts`, `zkp.ts`, `dleq.ts`, `shamirZq.ts`, `shamir.ts` (legacy GF(2^8); deprecated — `routes/keyshares.ts:12-16`), `dkg.ts` (combineFeldmanCommitments), `candidateCommitment.ts`.
- `src/merkle/merkleTree.ts` (dense tree; canonical, imported by blockchain tests), `src/merkle/sparseMerkleTree.ts` (SMT, position-aware hashing).
- `src/services/anchorBatch.ts` (runAnchorBatch + maybeAutoAnchor), `src/services/anchorSmtBatch.ts` (cumulative SMT per election), `src/services/electionContext.ts` (election resolution, public key).
- `src/blockchain/merkleContract.ts` (ethers bindings to `MerkleRootStorage`).
- `src/middleware/adminAuth.ts` (shared-secret header guard).
- `src/supabaseClient.ts` — service-role client; RLS bypassed.
- `src/schema.sql` — entire DB (§4).
- Scripts under `src/scripts/` (seed-constituencies, seed-voters, seed-keyholders, setup-keys, setup-shamir/-zq, run-schema, check-constituencies, reset-anchors, reanchor-dense-batch, backfill-smt, tamper-test, test-merkle-batch, probe-exec-sql, independent-verify-tally) and `backend/scripts/` (backfill-smt, reanchor-dense-batch).
---

## 4. Database (Supabase / PostgreSQL 15+, `backend/src/schema.sql`, 1,327 lines)

No automated migration runner — `src/scripts/run-schema.ts` only initializes a **fresh** DB and no-ops once `voters` exists; all later changes are appended idempotently to `schema.sql` and applied manually via the Supabase SQL editor (stated at `schema.sql:903-907`).

### 4.1 Tables (verified columns, keys, constraints; schema.sql line refs)

- **`constituencies`** (L41): PK `(election_id, code)` after migration (L398); `code VARCHAR(10)` CHECK `^[A-Z]{2,4}-\d{1,3}$`; `name`; `created_at`; FK→elections (L400). RLS enabled.
- **`voters`** (L66): PK `id UUID`; `nid_hash CHAR(64)` CHECK hex; `name`; `constituency_code`; `is_eligible BOOL`; `has_voted BOOL`; `registered_at`; `updated_at`; `election_id TEXT NOT NULL` (L404-406). Unique `(election_id, nid_hash)` (L408-410). RLS. **Raw NID never stored** (header L62-63).
- **`votes`** (L121): PK `id UUID`; `nullifier_hash CHAR(64)` NOT NULL; `constituency_code VARCHAR(10)` NOT NULL; `encrypted_vote JSONB` NOT NULL; `zkp_proof JSONB`; `tx_hash VARCHAR(66)` NULL until anchored; `status vote_status` default `'queued'`; `created_at`, `updated_at`; `election_id` (migration L987-995). Unique `(election_id, nullifier_hash)` (L994). Partial indexes `idx_votes_queued/confirmed/tx_hash`. RLS. **`voter_nid_hash` column does not exist** (ballot-secrecy redesign, L5-17) — the key privacy fact in this schema.
- **`candidates`** (L209): PK `id UUID`; `name`; `party`; `symbol`; `constituency_code`; `created_at`; `election_id` (L1025-1043); unique `(election_id, name, constituency_code)`; index `(election_id, constituency_code)`. RLS. Trigger `trg_candidates_immutable_after_commitment` (L847; per-election version L1132).
- **`key_shares`** (L450): PK id; `election_id`; `share_index INT 1..4`; `share_value TEXT` (legacy GF(2^8) — **no route writes it anymore**, `keyshares.ts:12-16`); `keyholder_id`; `keyholder_role`; `submitted`; `submitted_at`; `public_commitment TEXT` (new verifiable-tally column, L744-777). Unique `(election_id,keyholder_id)`, `(election_id,share_index)`. RLS.
- **`nullifiers`** (L532): PK id; `nullifier_hash CHAR(64)`; `election_id`; unique `(election_id,nullifier_hash)` (L552). RLS. **No delete guard** (integrity.test.ts:191).
- **`merkle_batches`** (L583): PK id; `batch_id BIGINT` (on-chain id); `root CHAR(66)`; `tx_hash`; `vote_ids JSONB`; `vote_count > 0`; `created_at`; `election_id` (L1047-1057); unique `(election_id,batch_id)`. RLS. **No immutability trigger on `root`** (tamper-test.ts:8).
- **`tally_results`** (L639): PK id; `election_id UNIQUE`; `tallied_at`; `shares_used`; `total_votes`; `valid_votes`; `invalid_votes`; `results JSONB`; one row per election; re-tally overwrites.
- **`smt_batches`** (L678): PK id; `smt_batch_id BIGINT`; `smt_root`, `previous_smt_root`, `new_keys_this_batch ≥ 0`, `total_keys_anchored ≥ 0` (monotonic ledger); `tx_hash`; `created_at`; `election_id`; unique `(election_id,smt_batch_id)`.
- **`election_key_ceremony`** (L760): PK id; `election_id UNIQUE`; `p_hex`, `g_hex`; `feldman_commitments JSONB` (NULL until qualified); `status` (`pending|round1|round2|qualified`).
- **`partial_decryptions`** (L780): PK id; `election_id`; `ballot_id UUID REFERENCES votes(id)`; `keyholder_index 1..4`; `d_i`; `proof_t1/t2/z`; `verified BOOL`; unique `(election_id,ballot_id,keyholder_index)`. Trigger `trg_partial_decryptions_no_update` (L1316-1324) blocks all UPDATEs.
- **`election_setup_commitments`** (L819): PK id; `election_id UNIQUE`; `commitment`; `candidates_root`; `constituencies_root`; `contract_address`; `tx_hash`; `anchored_at`.
- **`elections`** (L916): PK `election_id TEXT`; `name`; `constituency_count INT DEFAULT 8`; `status CHECK ('setup','voting','tallying','closed')` default `'setup'` (L924-926); `merkle_contract_address`; `election_setup_contract_address`; `created_at`. Seeded `NATIONAL-2026-001` with status `'tallying'` (L939-943).
- **`keyholders`** (L1181): PK `(election_id,keyholder_id)`; `role`; `share_index 1..4`; `passphrase_hash`; unique `(election_id,share_index)`.
- **`dkg_participants`** (L1245): PK `(election_id,keyholder_index)`; `commitments`, `ecdh_pubkey` (public only).
- **`dkg_shares`** (L1263): PK `(election_id,from_index,to_index)`; `ciphertext`, `iv` (AES-GCM sub-shares the server relays, cannot read).
- **`dkg_confirmations`** (L1279): PK `(election_id,keyholder_index)`; `confirmed_at`.

### 4.2 Enum, stored functions, triggers

- `vote_status ENUM ('queued','confirmed','rejected')` (L22).
- `fn_set_updated_at()` (L256) — triggers on `voters` and `votes` (L265, L273).
- **`fn_votes_immutable_guard()`** (L282; redefined L1003 adding `election_id`) + **`trg_votes_immutable`** (L301): BEFORE UPDATE raises if `nullifier_hash`, `constituency_code`, `election_id`, `encrypted_vote`, or `created_at` change. `status`/`tx_hash`/`zkp_proof` remain updatable (per the L19-21 comment).
- **`fn_votes_no_delete()`** (L310) + **`trg_votes_no_delete`** (L317): BEFORE DELETE always raises.
- **`fn_admin_delete_vote(p_vote_id UUID)`** (L331): `SECURITY DEFINER`; disables `trg_votes_no_delete` for exactly one DELETE, re-enables unconditionally (including on error). Used ONLY by the admin-gated demo route `POST /anchor/tamper/delete-vote` (anchor.ts:597-662).
- **`fn_cast_vote(...)`** (L369; current election-scoped version L1077-1124): `SECURITY DEFINER`; single transaction — ① `SELECT … FOR UPDATE` on `voters` by `(election_id, nid_hash)`; ② raise `P0002` if absent, `P0003` if not eligible, `P0004` if `has_voted`; ③ INSERT `votes(election_id, nullifier_hash, constituency_code, encrypted_vote, zkp_proof)`; ④ `UPDATE voters SET has_voted = true`; returns vote UUID. Atomic — all-or-nothing.
- **Candidate/constituency freeze**: `fn_candidates_immutable_after_commitment` / `fn_constituencies_immutable_after_commitment` (L847/L861; per-election L1132/L1154) raise on UPDATE/DELETE once a setup commitment exists for that election. The original versions were **global** (any election's commitment froze all); "fixed to check only the [election's own] commitment" per L1125-1130.
- **`fn_partial_decryptions_no_update()`** (L1316): blocks all UPDATEs on `partial_decryptions` ("DB-level backstop" to the route-level INSERT-not-UPSERT rule in keyshares.ts).

### 4.3 Row-Level Security

Every table has RLS **enabled** but no policies are defined; the backend uses the service-role key which bypasses RLS (`supabaseClient.ts:5-7`). `context.md` ("RLS policies: … intentional simulation scope") and `METHODOLOGY.md` ("DB-layer defenses (triggers, RLS) are **defense-in-depth**, not the core claim — a DB admin can bypass them") both state this is deliberate. Authorization lives in app code, DB triggers, and `SECURITY DEFINER` functions only.

---

## 5. Authentication & authorization

There is **no session-based authentication for any role**. Verified mechanisms:

1. **Voter "authentication" = possession of an 11-digit NID** (`/^\d{11}$/`):
   - `POST /voter/register` (voter.ts:54-146) takes raw `nid` + `election_id`; the server hashes with `NID_HASH_SALT` (`identity.ts:hashNidWithSalt`) and **creates the voter row with `is_eligible: true` if absent** (voter.ts:108-120). Nothing verifies the NID against an authoritative registry. (Observation, not judgment — Phase 2.)
   - `POST /vote` (vote.ts:71-273) takes the same raw NID and derives `nid_hash`/nullifier server-side.
   - `GET /candidates` derives constituency from the `x-voter-nid` header (candidates.ts:37-47) — the NID itself is the credential; there is no per-request token.
2. **Admin = shared secret header**: `requireAdminSecret` (adminAuth.ts:16-40) compares `x-admin-secret` against `ADMIN_SECRET` with `timingSafeEqual`, only when `ADMIN_SECRET` is configured (else 503). Applied to: `POST /elections` (elections.ts:36), `POST /anchor/batch`, `POST /anchor/tamper/*`, `POST /anchor/restore/root` (anchor.ts), `POST /keyshares/tally` (keyshares.ts), `POST /dkg/init` (dkg.ts:57). `AdminLogin.tsx` is a UI mock (adminAuth.ts:4-8; FUTURE_WORK.md §0).
3. **Keyholders = per-election passphrase**: `verifyKeyholderPassphrase(election_id, keyholder_id, passphrase)` (keyholders.ts:67-80) compares salted SHA-256 `passphrase_hash` from the `keyholders` table. Applied to: `POST /dkg/round1/2/3`, `POST /dkg/round2/inbox` (dkg.ts), `POST /keyshares/submit-partial` (keyshares.ts:81-84). Keyholder share_index is derived server-side (`getKeyholderIndex`, keyholders.ts:50-56).
4. **No rate limiting, no CAPTCHA, no WAF config** (absent from index.ts and both package.json files; FUTURE_WORK.md §0).
5. **No Supabase Auth integration**: `supabaseClient.ts` uses the service-role key with `auth:{autoRefreshToken:false, persistSession:false}`; Supabase `config.toml` auth defaults are untouched (no JWT verification middleware in index.ts).
---

## 6. Endpoint inventory (voting / elections / candidates / results / integrity)

All routes verified in the cited files. Every data-touching route requires `election_id` (via `resolveElectionId`, electionContext.ts:51-68 — 400 if missing, 404 if unknown; **no silent default**).

| Method | Path | Auth | Request (verified) | Response (verified) | Source |
|---|---|---|---|---|
| POST | `/voter/register` | none (NID is the credential) | `{nid: \d{11}, election_id}` | 201/200 voter profile; 403 ineligible; 409 dup | voter.ts:54 |
| POST | `/voter/check-nullifier` | none | `{nid, election_id}` | `{exists: bool}` (never the nullifier itself) | voter.ts:148 |
| POST | `/vote` | none | `{nid, election_id, encrypted_vote:{c1,c2}, zkp_proof:{challenges[],responses[]}}` | 201 `{status:"queued", vote_id}`; 400 schema/ZKP fail; 404 unregistered; 403 ineligible; 409 already-voted; 503 no key | vote.ts:71 |
| GET | `/candidates?election_id=` | none (header `x-voter-nid` preferred) | header NID or deprecated `?constituency=` | `{election_id, constituency_code, candidates[]}` | candidates.ts:24 |
| GET | `/election/public-key?election_id=` | none | — | `{p,g,y}` (from DKG ceremony) | index.ts:60 |
| POST | `/elections` | `x-admin-secret` | `{election_id, name, constituency_count?, merkle_contract_address?, election_setup_contract_address?}` | 201 election row; 409 dup | elections.ts:36 |
| GET | `/elections` · `/elections/:id` | none | — | list / single registry row | elections.ts:76,96 |
| GET | `/public/stats?election_id=` | none | — | voters/votes/key_shares/merkle_batches counts, turnout, key-ceremony progress, latest batch | public.ts:31 |
| GET | `/public/results?election_id=` | none | — | `{status:"not_tallied"}` or `{status:"tallied", tallied_at, results}` | public.ts:126 |
| POST | `/anchor/batch` | `x-admin-secret` | `{election_id}` | 201 `{batch_id, root, tx_hash, vote_count, smt}`; 503 chain unconfigured; 400 nothing to anchor | anchor.ts:54 |
| GET | `/anchor/verify/:voteId?election_id=` | none | — | `{batch_id, tx_hash, root, proof, included_locally, included_on_chain}`; **409 "Recomputed root does not match the anchored root — possible data tampering"** on mismatch | anchor.ts:89 |
| GET | `/anchor/verify-smt/:voteId?election_id=` | none | — | `{type: membership\|non-membership, root, proof, included_locally, included_on_chain}` | anchor.ts:204 |
| GET | `/anchor/latest?election_id=` | none | — | latest `merkle_batches` row (404 if none) | anchor.ts:285 |
| POST | `/anchor/tamper/root` | `x-admin-secret` | `{election_id, batch_id?}` | flips one nibble of stored root (demo; verify then returns 409) | anchor.ts |
| POST | `/anchor/restore/root` | `x-admin-secret` | `{election_id, batch_id?}` | recomputes & restores the true root (stateless) | anchor.ts |
| POST | `/anchor/tamper/ballot` | `x-admin-secret` | `{election_id, vote_id?}` | attempts `encrypted_vote` UPDATE; reports whether the trigger blocked it | anchor.ts:574 |
| Method | Path | Auth | Request (verified) | Response (verified) | Source |
|---|---|---|---|---|---|
| POST | `/dkg/init` | `x-admin-secret` | `{election_id}` | 201 `{election_id, group_params, status:"pending"}`; 409 if already init | dkg.ts:57 |
| POST | `/dkg/round1` | keyholder passphrase | `{election_id, keyholder_id, passphrase, commitments[3], ecdh_pubkey}` | 201 `{election_id, keyholder_id, index}` | dkg.ts:46 |
| GET | `/dkg/round1?election_id=` | none | — | published round-1 material per keyholder | dkg.ts:97 |
| POST | `/dkg/round2` | keyholder passphrase | `{election_id, keyholder_id, passphrase, shares:[{to_index, ciphertext, iv}]}` | 201 progress | dkg.ts |
| POST | `/dkg/round2/inbox` | keyholder passphrase | `{election_id, keyholder_id, passphrase}` | encrypted sub-shares addressed to the caller | dkg.ts |
| POST | `/dkg/round3` | keyholder passphrase | `{election_id, keyholder_id, passphrase}` | 201 `{…, confirmed_count, qualified}`; on the 4th confirmation the server combines public Feldman vectors → status `qualified` (dkg.ts:283-298, `combineAndQualify` L311-431) | dkg.ts:259 |
| GET | `/dkg/status?election_id=` | none | — | ceremony status + per-keyholder round progress | dkg.ts:434 |
| GET | `/keyshares/commitments?election_id=` | none | — | group params + keyholder public commitments (`y_i`) | keyshares.ts |
| GET | `/keyshares/status?election_id=&batch_id=` | none | — | per-batch, per-keyholder partial-submission counts (scoped to the batch's ballots) | keyshares.ts |
| POST | `/keyshares/submit-partial` | keyholder passphrase | `{election_id, keyholder_id, passphrase, partials:[{ballot_id, d_i, proof:{t1,t2,z}}]}` | 201 per-ballot `{verified, reason?}`; **INSERT-not-UPSERT** (409 `already_submitted` on dup) | keyshares.ts:67 |
| POST | `/keyshares/tally` | `x-admin-secret` | `{election_id, batch_id}` (explicit batch — no "latest" fallback, keyshares.ts:31-51) | tally record: `total_votes`, `valid_votes`, `invalid_votes`, `rejected_votes[]`, per-constituency candidate counts; upserts `tally_results` (L402-421) | keyshares.ts (tally) |
| GET | `/keyshares/verification-bundle?election_id=&batch_id=` | none | — | full independent-recount bundle: ballots (ciphertexts), dense+SMT roots, partials + DLEQ proofs, per-ballot SMT membership proofs, setup commitment, published results (L714-756) | keyshares.ts:433 |
| GET | `/health` | none | — | `{status:"ok"}` | index.ts:52 |

**Coverage note:** there is **no HTTP route that creates/updates candidates** (the candidates table is populated by SQL/scripts only — `vote.test.ts:63-65` references "run seed-constituencies/seed-candidates first", but **no `seed-candidates` script exists in the repo**; see §15.6), **no route that transitions an election's `status`**, and **no production route that modifies or deletes a vote** (only the three admin-secret demo tamper routes). No route writes `votes.status='rejected'` (enum member exists; see §15.4).

---

## 7. The complete vote lifecycle (traced through actual code)

**Step 0 — Election & key ceremony (preconditions):**
- An `elections` row must exist — via `POST /elections` (elections.ts:36, admin secret) or the schema seed (schema.sql:939-943).
- `POST /vote` requires `election_key_ceremony.status='qualified'` (returns 503 otherwise; vote.ts:178-184 via electionContext.ts:79-89). Ceremony: `POST /dkg/init` (dkg.ts:57) → 4× `POST /dkg/round1` (dkg.ts:46) → 4× `POST /dkg/round2` (sub-shares relayed, server cannot read) → 4× `POST /dkg/round3` (dkg.ts:259); on the 4th confirmation `combineAndQualify` (dkg.ts:311-431) combines **public** Feldman vectors → `qualified`.
- An anchored election setup commitment is required: `POST /vote` returns **412** if none exists (vote.setupCommitment.test.ts; docs/tally-verifiability-design.md §8.2.5).

**Step 1 — Voter login/registration (UI):** `VoterLogin.tsx:27-66` → `registerVoter(nid, electionId)` (api.ts:122) → `POST /voter/register` (voter.ts:54). Server derives `nid_hash = SHA-256(nid‖NID_HASH_SALT)` (identity.ts:20-23) and `constituency = CON-((first4 mod count)+1)` (identity.ts:51-55); upserts `voters` with `is_eligible=true` (voter.ts:108-120). UI navigates to `/voter/vote` with `{nid, nidHash, constituencyCode, voterId}` in router state.

**Step 2 — Ballot construction (browser):** `VotingPage.tsx` fetches `GET /election/public-key` (api.ts:67) and `GET /candidates` (header `x-voter-nid`, api.ts:90-98; server derives constituency, candidates.ts:37-47). The browser computes an ElGamal ciphertext with a **fresh random `k`** and a Chaum–Pedersen OR-proof over the **server-supplied candidate ids** (`frontend/src/utils/elgamal.ts:encryptCandidateIdWithProof`). A Benaloh cast-or-audit modal lets the voter audit `r` and re-verify the ciphertext locally (elgamal.ts:284-315).

**Step 3 — Submission:** `submitVote(...)` (api.ts:35-61) → `POST /vote` (vote.ts:71):
1. Zod validation `{nid(11 digits), encrypted_vote{c1,c2}, election_id, zkp_proof}` (vote.ts:45-67).
2. Election lookup (vote.ts:81), `getElectionPublicKey` (vote.ts:178-184), setup-commitment precondition.
3. Server derives `nid_hash`, `nullifier_hash = SHA-256(nid‖election_id‖NULLIFIER_SECRET)` (identity.ts:33-38), `constituency_code`.
4. Server loads the **valid candidate set itself**: `SELECT id FROM candidates WHERE election_id=? AND constituency_code=? ORDER BY name` (vote.ts:157-176).
5. **Mandatory ZKP check** `verifyBallotValidity(c1, c2, pubKey, candidateIds, proof)` (zkp.ts:201-265); 400 on failure (vote.ts:186-197).
6. `supabase.rpc("fn_cast_vote", …)` (vote.ts:205-215) → atomic stored proc (schema.sql:1077-1124, §4.2).
7. PG error mapping: `P0002`→404, `P0003`→403, `P0004`/`23505`→409 (vote.ts:220-243).
8. **Best-effort** insert into `nullifiers` (vote.ts:246-263) — failure logged, never fatal.
9. Returns `201 {status:"queued", vote_id}`.

**Step 5 — Batch anchoring (background):** `maybeAutoAnchor()` runs every 5 min (index.ts:99-101) and fire-and-forget after casts; per-election trigger when unanchored count ≥ `AUTO_ANCHOR_THRESHOLD=50` OR oldest unanchored vote ≥ `AUTO_ANCHOR_MAX_AGE_MS=30 min` (anchorBatch.ts:22-37, 190-238). `runAnchorBatch(electionId)` (anchorBatch.ts:60-156): unanchored votes ordered by `created_at` → leaves `hashVoteLeaf(id,c1,c2,createdAt)` → `buildMerkleTree` (merkleTree.ts:30-72) → `contract.anchorRoot(electionId, root, count)` (`onlyOwner`, MerkleRootStorage.sol:53-71) → `batchId` parsed from the `BatchAnchored` receipt → INSERT `merkle_batches(batch_id, root, tx_hash, vote_ids)` (anchorBatch.ts:107-125 area) → **UPDATE `votes SET tx_hash, status='confirmed'`** → `runAnchorSmtBatch` (cumulative SMT; SMT failure logged, not thrown — anchorBatch.ts:140-147). Manual trigger: `POST /anchor/batch` (anchor.ts:54, admin secret).

**Step 6 — Verification (anyone):** `GET /anchor/verify/:voteId` (anchor.ts:89) re-derives leaves from the `votes` table **in the stored `vote_ids` order**, verifies `recomputedRoot == storedRoot` (else **409 "Recomputed root does not match the anchored root — possible data tampering"**, anchor.ts:132-139 in extracted source), builds the inclusion proof, checks it locally and on-chain (`readContract.verify(electionId, batchId, leaf, proof)`). `GET /anchor/verify-smt/:voteId` does the SMT membership/non-membership counterpart (anchor.ts:204-275). The standalone `scripts/independent-verify-tally.ts` re-derives everything from the public bundle + on-chain roots (§12).

**Step 7 — Tally (verifiable threshold decryption):** 3+ keyholders each compute `d_i = c1^(x_i) mod p` in their own browser + a DLEQ proof binding `(election_id, ballot_id, y_i, c1, d_i)` (dleq.ts:100-189) → `POST /keyshares/submit-partial` (keyshares.ts:67) verifies the DLEQ (INSERT-not-UPSERT) → `POST /keyshares/tally` (admin, explicit `batch_id`, keyshares.ts:31-51) re-verifies and combines ≥3 valid partials per ballot homomorphically (`combinePartialDecryptions`, dleq.ts:202-223; **never reconstructs `x`**), decrypts → candidate UUID → joins candidates, rejects with reasons (`decryption_failed`, `candidate_not_found`, `constituency_mismatch`, `duplicate_nullifier`, `invalid_signature`, `insufficient_valid_shares`), persists aggregates to `tally_results` (keyshares.ts:402-421).

**Step 8 — Result publication:** `GET /public/results` reads `tally_results` (public.ts:126-161); `GET /keyshares/verification-bundle` exposes the full independent-recount evidence (keyshares.ts:433-761).

**Frontend/backend boundary:** all voter-flow API calls live in `frontend/src/utils/api.ts` (registerVoter L122, checkNullifier L148, submitVote L182, getElectionPublicKey, getCandidates, verifyVoteAnchor L211, runTally, DKG/anchor/tamper helpers L420-809).

---

## 8. Voter eligibility — determination & enforcement

- **Eligibility is a boolean on the DB row** (`voters.is_eligible`), enforced inside `fn_cast_vote` (schema.sql:1098-1102: `IF NOT v_voter.is_eligible THEN RAISE … P0003`), which maps to HTTP 403 (vote.ts:227-230).
- **How a voter becomes registered/eligible:** `POST /voter/register` **self-registers any well-formed 11-digit NID with `is_eligible=true`** when the NID hashes to no existing row (voter.ts:108-120). No external eligibility check exists in code.
- **Seed path:** `seed-voters.ts` upserts 20 deterministic mock NIDs with `is_eligible=true` (seed-voters.ts:126-151); `check-constituencies.ts` and `seed-constituencies.ts` seed constituencies. **No script in the repo seeds candidates** (see §15.6).
- **Enforcement points verified:** `fn_cast_vote` lock+check (schema.sql:1090-1102); `/voter/register` returns 403 if an existing row has `is_eligible=false` (voter.ts:93-95).
- **No mechanism anywhere verifies that an NID belongs to a real person** — the NID format check is the only gate (`/^\d{11}$/`, voter.ts:34, vote.ts:46). (Phase 2 classification; documented in FUTURE_WORK.md §0 as "NID only — salted SHA-256 hash … no second factor".)

---

## 9. Duplicate-vote prevention

Verified defense layers (all server/DB-side; the client submits only the raw NID + ciphertext):

1. **Row lock inside a transaction:** `fn_cast_vote` does `SELECT … FROM voters WHERE election_id=? AND nid_hash=? FOR UPDATE` then checks `has_voted` (schema.sql:1090-1097) — concurrent duplicate casts serialize on the row lock.
2. **`has_voted` flip is in the same transaction** as the INSERT (schema.sql:1119-1120) — no window where a vote exists but `has_voted=false`.
3. **Vote-table uniqueness:** `uq_votes_election_nullifier_hash UNIQUE (election_id, nullifier_hash)` (schema.sql:994) — a second row for the same nullifier violates the constraint (23505 → 409, vote.ts:237-240).
4. **Voter-table uniqueness:** `uq_voters_election_nid_hash` (schema.sql:408-410).
5. **Nullifier ledger:** `uq_nullifier_per_election` (schema.sql:552); the route also inserts into `nullifiers` after the vote row (vote.ts:246-263) — best-effort secondary check used by `/voter/check-nullifier` (voter.ts:148-182).
6. **Test evidence:** N=50 concurrent `POST /vote` stress (vote.test.ts, `it.skip` currently — see §12), plus `integrity.test.ts` categories for the raw constraints (also skipped, see §12).

**Replay note (verified fact, not recommendation):** a replayed identical `POST /vote` body re-derives the same `nid_hash` and `nullifier_hash`; the second attempt is rejected by `has_voted` (P0004) — i.e., replay *after* a successful cast yields 409. The schema/ZKP/ciphertext contain **no timestamp, nonce, or signature** — see Phase 2 for classification of e.g. replay *before* cast, and the tally-side DLEQ nonce binding (dleq.ts `PROOF_TAG` + election/ballot binding at dleq.ts:74-98).

---

## 10. Can a stored vote be modified or deleted? (verified code paths)

**UPDATE of integrity columns — blocked.**
- `trg_votes_immutable` / `fn_votes_immutable_guard` (schema.sql:282-306; election-scoped redefinition L1003-1021) raises on changes to `nullifier_hash`, `constituency_code`, `election_id`, `encrypted_vote`, `created_at`.
- **Allowed updates:** `status` ('queued'→'confirmed' only by anchorBatch.ts:129), `tx_hash` (anchorBatch.ts:129), `zkp_proof` (no writer found beyond the original insert — see §16), `updated_at` (trigger). No route writes `status='rejected'` (§15.4).
- Tested: vote.test.ts "enforces DB immutability trigger for SQL UPDATEs" (`/immutable after insertion/`).

**DELETE — blocked, with one audited exception.**
- `trg_votes_no_delete` / `fn_votes_no_delete` (schema.sql:310-318) rejects every DELETE.
- Exception: **`fn_admin_delete_vote(p_vote_id)`** (schema.sql:331-347) — `SECURITY DEFINER`, disables the guard for exactly one DELETE, re-enables unconditionally; reachable only via `POST /anchor/tamper/delete-vote` (anchor.ts:597-662, admin secret), built solely for the SMT deletion-detection demo (docs/smt-design.md §13 test 19). threat_model.md §2 notes a DB admin with direct SQL could call it or drop triggers regardless.

**Other tables relevant to vote integrity:**
- `partial_decryptions` — UPDATE blocked (`trg_partial_decryptions_no_update`, L1316-1324); DELETEs NOT blocked (trigger body only raises on UPDATE).
- `merkle_batches` — **no immutability trigger**; `POST /anchor/tamper/root` deliberately edits `root`; tamper-test.ts:8-10 documents that the edit succeeds at the DB level and detection relies on re-computation (verify → 409), not DB prevention.
- `candidates`/`constituencies` — UPDATE/DELETE blocked once a setup commitment exists for that election (L847-894; per-election L1132-1180).
- `nullifiers`, `tally_results`, `election_key_ceremony`, `elections`, `key_shares` — no immutability triggers found (nullifiers explicitly deletable per integrity.test.ts:191-196).

**Admin GUI:** `AdminDashboard.tsx` candidate form operates on **sample data only** (source comment at L62-65: "still a UI mock over sample data"); it does not modify the DB.

---

## 11. Cryptographic / hashing / signing / anchoring mechanisms in the voting path

All verified by reading the cited files. Each mechanism listed with what it is applied to and where it is invoked.

| Mechanism | Applied to | Inputs / Outputs | Where invoked |
|---|---|---|---|
| SHA-256 (salt optional) | `nid_hash = SHA-256(nid‖NID_HASH_SALT)` (empty salt warns, index.ts:87-91) | nid → 64-hex | `identity.ts:20-23`; voter lookups |
| SHA-256 with server secret | `nullifier_hash = SHA-256(nid‖election_id‖NULLIFIER_SECRET)` | nid+election+secret → 64-hex; server-only | `identity.ts:33-38`; `vote.ts`, `voter.ts` |
| ElGamal (256-bit safe prime p=2q+1, order-q subgroup) | ballot choice = candidate UUID (128-bit) | `(p,g,y)` → `(c1=g^k, c2=m·y^k)`; decrypt validates c1∈subgroup | `crypto/elgamal.ts`; client `frontend/src/utils/elgamal.ts`; same group used by ZKP/DKG/DLEQ |
| Chaum–Pedersen disjunctive OR-proof (CDS94, Fiat–Shamir/SHA-256) | c1,c2 encrypt one allowed candidate UUID, without revealing which | `(c1,c2,pubkey,candidateIds)` → `{challenges[],responses[]}` | prover `frontend/src/utils/elgamal.ts:encryptCandidateIdWithProof`; verifier `zkp.ts:verifyBallotValidity`; mandatory at vote.ts:186-197 |
| Merkle tree (keccak256 double-hash leaf, commutative sorted pair) | each anchored vote batch | leaf=`keccak256(keccak256(abi.encode(voteId,c1,c2,createdAt)))`; root 0x64 | `merkleTree.ts`; anchored by `anchorBatch.ts`; proofs `anchor.ts`; contract `MerkleRootStorage.sol` |
| Sparse Merkle Tree (256-bit, position-aware node hashing) | cumulative set of anchored `nullifier_hash` keys | membership/non-membership proofs; root chains via `previous_smt_root` | `sparseMerkleTree.ts`, `anchorSmtBatch.ts`; on-chain `verifySmtMembership/NonMembership` (MerkleRootStorage.sol) |
| Feldman VSS over Z_q | private-key shares across (3,4) keyholders + public commitments | secret → 4 shares + `FeldmanCommitments`; combine = elementwise product | `shamirZq.ts`, `crypto/dkg.ts:combineFeldmanCommitments`; ceremony dkg.ts |
| Chaum–Pedersen DLEQ (domain tag `EVOTING-PARTIALDEC-DLEQ-v1`, binds election_id+ballot_id) | correctness of partial decryption `d_i=c1^(x_i)` | `(election_id,ballot_id,y_i,c1,d_i)` → `{t1,t2,z}` | `dleq.ts:proveDleq/verifyDleq`; keyshares.ts submit + tally |
| Keccak256 write-once on-chain commitment | exact candidate+constituency set before voting opens | TLV-canonical leaves → roots → `keccak256(tag‖election_id‖candidatesRoot‖constituenciesRoot)` | `candidateCommitment.ts`; `ElectionSetupCommitment.sol`; precondition for `/vote` (412) |
| AES-GCM + ECDH (P-256), browser-side | DKG round-2 sub-share relay (server stores/forwards, cannot decrypt) | keyholder↔keyholder ciphertexts/ivs (`dkg_shares`) | `frontend/src/utils/dkgCrypto.ts`; relay dkg.ts |
| `timingSafeEqual` | admin header vs `ADMIN_SECRET`; keyholder passphrase vs hash | constant-time equality | `adminAuth.ts:34`, `keyholders.ts:76-79` |

**No per-ballot signing** (no Ed25519/RSA — the `invalid_signature` label in TallyingPage.tsx:48 is UI copy only; §15.5). **No TLS pinning / client certs** (threat_model.md §2; FUTURE_WORK.md §11.2).

---

## 12. Automated test inventory (what each suite actually asserts)

**Runner:** Vitest (`backend/`). CI runs only the pure-logic subset (`test:ci` = elgamal/identity/zkp/merkleTree; .github/workflows/ci.yml backend job) because DB/chain-dependent tests need a live backend + Supabase. Blockchain tests: Hardhat (`blockchain/test/`, `npm run contracts:test`). REFACTOR.md §8 records a fresh full run: **173 passed / 2 skipped (Vitest), 35 passed (Hardhat)**.

**Voting / registration / eligibility (HTTP-level, live Supabase; gated by `loadTestSupabaseEnv` + REQUIRED_ENV, vote.test.ts:11-20):**
- `vote.test.ts` "Vote Casting Adversarial Tests": rejects unregistered voter (404); rejects ineligible voter (403); rejects malformed payload (400); **rejects a vote with NO zkp_proof (mandatory)**; **ignores a client-supplied candidate set — proof checked against the server-derived set** (the "forged candidate set" trust-boundary regression); `it.skip` N=50 concurrent double-cast (exactly 1×201, N−1×403/409, exactly 1 DB row per trial — evidence persisted to `testing/concurrency_stress_output.json`); enforces DB immutability trigger for SQL UPDATEs; secure server-side nullifier formula (`SHA-256(nid‖eid‖secret)` ≠ client-only hash); schema has no `voter_nid_hash`/`nid_hash` column on `votes`.
- `vote.setupCommitment.test.ts`: POST /vote returns **412** with no anchored setup commitment; proceeds once anchored.
- `integrity.test.ts` (direct-to-DB, bypasses routes): DELETE immutability (`it.skip`), FK integrity (voters/votes/candidates→constituencies, expects 23503), votes.nullifier_hash uniqueness (`it.skip`), nullifiers uniqueness (tested). Several tests skipped because there is **no dedicated test DB** — they'd pollute the live project (file comments).
- `anchorSmt.integration.test.ts` — SMT/dense anchoring integration (live, gated).

**Tally / partial decryption / DLEQ (`crypto/dleq.test.ts`):** combining 3 valid partials = direct decryption; genuine proof verifies; **out-of-subgroup c1** rejected cleanly across 1000 trials; forgery rejection (tampered t1/t2/z/d_i/y_i); **binding regressions** — proof for (keyholder i, ballot A) fails against ballot B / keyholder j / another election_id; different 3-subsets produce the same plaintext; refuses <3 partials.
**DKG (`crypto/dkg.test.ts`, `routes/dkg.test.ts`):** combined C₀ = g^(Σ secrets); deriveShareCommitment matches F(index); error paths; full ceremony flow (mock Supabase, route-level).

**Keyshares scoping (`routes/keyshares.batchScoping.test.ts`):** POST /keyshares/tally rejects missing batch_id (400); batch_id=0 vs batch_id=2 tally to their own roots/sets (no cross-batch leakage); 409 when SMT coverage check fails.
**Election setup commitment (`crypto/candidateCommitment.test.ts`):** deterministic serialization vs hand-checked vector; root rebuild equality; single-field/constituency mutations change the root; add/remove/reorder (order-invariant) behavior; different election_id → different commitment.
**ElGamal (`crypto/elgamal.test.ts` + fast-check props):** UUID round-trips (incl. min/max); homomorphism over 10k pairs; 10k re-encryptions never collide; malformed/out-of-group ciphertext rejection (non-hex, c1≡0, c2≥p, non-QR c1, empty).
**ZKP (`crypto/zkp.test.ts`):** valid proofs verify; forged candidate set rejected; tampered challenge/response fails.
**Identity (`crypto/identity.test.ts`):** nid_hash/nullifier/constituency derivations.
**Shamir (`crypto/shamir.test.ts`):** (3,4) reconstruction from every triple, order-independence, 2-share subsets recover zero key material (both `reconstructKey` throws and raw `secrets.combine` ≠ secret).
**Merkle (`merkle/merkleTree.test.ts`):** every leaf verifies; tampered leaf fails; **reordering honesty block** (same-pair swaps are root-identical by design; cross-pair reorder changes root — documented limitation).
**SMT (`merkle/sparseMerkleTree.test.ts`):** 19 tests incl. membership/non-membership proof verification up to 10,000 keys and **anti-relabeling** (K1/K2 key-swap rejection).
**Anchor batching (`services/anchorBatch.test.ts`):** maybeAutoAnchor count trigger, age-based fallback trigger, no false trigger below thresholds.
**Independent verifier (`scripts/independent-verify-tally.test.ts`):** genuine bundle passes; rejects substituted/tampered dense_root; tampered setup commitment; completeness-mismatch flags (M2); results-vs-recount mismatch; ballot with only 2 valid partials; unreachable-but-claimed on-chain SMT batch (M1); per-ballot SMT membership proof mismatch/omitted/non-membership-only/different-leaf (hash-only attack regression).
**Blockchain (`blockchain/test/`):** dense anchoring, multi-election isolation, on-chain/off-chain root binding up to 1,000 leaves, SMT genesis + chain continuity, on-chain membership/non-membership verification, forgery rejection, ElectionSetupCommitment write-once.

**Note:** the highly relevant DB-level tests (DELETE guard, nullifier unique) and the N=50 concurrency test are **`it.skip`** pending a dedicated test DB — relevant to Phases 3/6.

---

## 13. Existing planning / design / threat-model / roadmap docs (Rule 5 inventory)

All verified by reading the files (or their opening sections) + `git log -- <path>`. Last-modified commit shown as `(commit <hash> <date>)`.

| Doc | Stated scope (verified) | Context |
|---|---|---|
| `README.md` | System overview; **explicitly: "a working simulation of the cryptographic mechanisms behind real E2E-V voting systems — not a production election platform"** | (1ab1987 2026-08-15) |
| `METHODOLOGY.md` | **Research methodology** — adversary model (DB read/write attacker, honest verifier), 9 property/attack/expected-result rows (double-vote, ballot secrecy, nullifier unlinkability, immutability, tamper-detect edit/delete, pre-anchor window, candidate-set integrity, threshold decryption), publication goal; DB defenses explicitly "defense-in-depth, not the core claim." | (f20530e 2026-09-07) |
| `context.md` | Agent handoff: architecture, stack, env keys, deployed addresses (MerkleRootStorage `0x4b5C…01b6`, ElectionSetupCommitment `0xf635…79C` on Sepolia), routes table, key decisions, known limitations (pre-anchor window, ADMIN_SECRET, no RLS policies). | (f20530e 2026-09-07) |
| `REFACTOR.md` | 2026-09-07 session record: ground truth at `8d2fe85`, SMT forensic verification, 5 doc fixes, pruning 7 obsolete files, **preserving mobile roadmap in FUTURE_WORK + FUTURE_IMPLEMENTATION**, cross-reference audit, test validation (173/2 + 35). | (f20530e 2026-09-07) |
| `FUTURE_WORK.md` | **Mobile-first roadmap** ("retire the voter-facing website, ship a React Native (Expo) mobile app with biometric + face-liveness MFA…"). Baseline stated vs commit `72370ab5`; §0 "Current State" is **partially stale** (§15.1). | (08782df 2026-08-14) |
| `FUTURE_IMPLEMENTATION.md` | **Byte-identical duplicate of FUTURE_WORK.md** (full contents match; REFACTOR.md confirms both kept). **Duplicate planning docs — flagged per Rule 5.** | (f20530e 2026-09-07) |
| `docs/threat_model.md` | Attackers, trust assumptions, property lists, pre-anchor window detail (§6), **voter-verifiable receipt: "design, not implemented"** (§8), adversarial test matrix (§9), non-goals (§10). | (f20530e 2026-09-07) |
| `docs/explicit-assumptions-and-nongoals.md` | Two load-bearing gaps: (1) ballot-set **completeness not proven before first anchor**; (2) **coercion-resistance is a non-goal** (cast-as-intended receipt = "design sketch only, not implemented"). | (a2ec915 2026-08-15) |
| `docs/formal-security-definitions.md` | Security games/definitions; §5 = ballot-privacy definition + honest limits. | (e1e371d 2026-09-12) |
| `docs/system-overview-and-evaluation.md` | Full system lifecycle + measurement methodology + current results ("start here" per README). | (f20530e 2026-09-07) |
| `docs/smt-design.md` | SMT design: deletion-detection, position-aware hashing, on-chain/off-chain binding, what SMT does/doesn't prove (§8), test mapping. | (48b2f18 2026-09-12, HEAD) |
| `docs/tally-verifiability-design.md` | Verifiable-tally design: Shamir-over-Z_q + Feldman + DLEQ, domain separation, explicit batch_id rule (§8), candidate-set commitment (§8.2), adversarial cases table. | (2eea30f 2026-08-14) |
| `docs/tally-verifiability-implementation-report.md` | Implementation + live-run report; methodology-audit fixes C1/C2, M1-M3, m1-m3; batch-2 contamination table corrected 2026-09-07. | (9672b29 2026-09-07) |
| `docs/dkg-security-analysis.md` | Formal analysis + live evidence of the 4-party Pedersen DKG replacing the trusted-dealer script. | (1ab1987 2026-08-15) |
| `docs/dkg-tally-security-audit-fixes.md` | 2026-08-16 audit: 15 attack scenarios across 5 categories run against actual code; fixes (key binding, SMT proof binding, partial-decryption immutability, CSP). | (c15819d 2026-08-16) |
| `docs/tamper-proof-demo.md` | Live Sepolia tamper demo walkthrough (2026-07-26). | (f20530e 2026-09-07) |
| `docs/anchoring-cost-analysis.md` / `docs/scalability-benchmark-results.md` | Measured gas/cost & 50k-ballot scalability benchmarks. | (f20530e 2026-09-07 / a2ec915) |
| `docs/evidence/README.md` + `verification-bundle-batch3-2026-08-14.json` + `verifier-output-batch3-2026-08-14.txt` | Frozen reproducible evidence: 11 checks, `ALL CHECKS PASSED` from public bundle + Sepolia RPC, no admin access. | (2eea30f 2026-08-14) |
| `docs/design-system.html` | Frontend design-system reference (HTML). | (—) |

**Rule 5 conflict flag (pre-existing):** `FUTURE_WORK.md` / `FUTURE_IMPLEMENTATION.md` are duplicates; and FUTURE_WORK's "Current State" baseline (§0) contradicts current code in at least the ways listed in §15.1 below.

---

## 14. Deployment / infrastructure dependencies & environment variables

**Backend env (`backend/.env.example`):** `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NID_HASH_SALT`, `ELGAMAL_P`, `ELGAMAL_G`, `ELGAMAL_PUBLIC_KEY`, `ELGAMAL_PRIVATE_KEY` (dev script output; the vote path reads the public key from `election_key_ceremony`, electionContext.ts:79-89), `NULLIFIER_SECRET`, `KEYHOLDER_PASSPHRASE_SALT`, `ADMIN_SECRET`, `AMOY_RPC_URL` (legacy name now holding the **Sepolia** RPC URL), `MERKLE_CONTRACT_ADDRESS`, `ANCHOR_PRIVATE_KEY`. Additional vars read by scripts: `CEREMONY_ELECTION_ID` (seed-voters.ts:34, seed-keyholders.ts:25), `KEYHOLDER_PASSPHRASE_1..4` (seed-keyholders.ts:56), `AUTO_ANCHOR_MAX_AGE_MS` (anchorBatch.ts:35), `BASE_URL` (tamper-test.ts:29), plus Supabase creds for test tooling. Missing Supabase creds → hard exit (supabaseClient.ts:17-23).
**Frontend env:** `VITE_API_BASE` (api.ts:17), default `http://localhost:3000`.
**Blockchain env (`blockchain/.env.example`):** `AMOY_RPC_URL`, `DEPLOYER_PRIVATE_KEY` (testnet-only wallet). Hardhat networks `amoy` (chainId 80002) and `sepolia` (chainId 11155111) (hardhat.config.ts:21-36).
**Live deployment (documented; not verifiable from code alone):** Sepolia `MerkleRootStorage` = `0x4b5C381c62876d34bBDDefDe02e872E5a93401b6`, `ElectionSetupCommitment` = `0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C` (context.md; schema.sql:940-942; docs/evidence/README.md). tamper-proof-demo.md records an older contract address `0x7f2289…d928` (2026-07-26) — contracts have been re-deployed.
**CI (`.github/workflows/ci.yml`):** on PR → `dev` only; frontend `npm ci && lint && build`; backend `npm ci && tsc --noEmit && ts-node scripts/test-merkle-batch.ts && npm run test:ci`; contracts `npm ci` (backend+blockchain) && compile && test. **No DB, no chain, no deployment job.**
**Supabase local config (`backend/supabase/config.toml`):** local ports 54321/54322, schemas `public`+`graphql_public`, `max_rows=1000`; Auth not integrated (§5).
**No Dockerfile, terraform, or production deployment manifest exists in the repo.** README setup targets live Supabase + local Express/Vite; anchoring needs a funded testnet wallet + public RPC.

---

## 15. Observations — unfinished, inconsistent, or contradicted (no fixes proposed here)

1. **Duplicate mobile-planning docs & stale baseline:** `FUTURE_WORK.md` and `FUTURE_IMPLEMENTATION.md` are identical files (Rule 5 flag). Their §0 "Current State" is **partially stale vs the code** (DOC SAYS X, CODE SHOWS Y): they describe keyholders submitting raw Shamir shares via web form + `POST /keyshares/submit` reading `shamir.ts`/`key_shares.share_value` — but `routes/keyshares.ts:12-16` removed that flow; current flow is DKG + DLEQ partial decryption. Baseline commit `72370ab5`; current HEAD `48b2f18`.
2. **`shared-interfaces/types.ts` stale** vs `schema.sql` despite its "Keep in sync" header: `Vote.voter_nid_hash` (types.ts:62) no longer exists on `votes`; `Voter` (types.ts:30-39) lacks `election_id`; `AdminLoginRequest/Response` (types.ts:109-113,140-144) reference `POST /admin/login` which has **no matching route**; `Candidate` lacks `election_id`.
3. **`VoteConfirmation.tsx:15-24` displays fabricated data:** hard-coded mock `tx_hash` and a random `vote_id` fallback (`"EVT-"+Math.random()…`) — the UI can show values no server ever produced.
4. **Dead states:** `votes.status='rejected'` (schema enum L22) has **no writer** in any route/service reviewed; `elections.status` never transitions from its insert value ('setup' from POST /elections; seed row 'tallying') — no route or script `UPDATE`s it (codebase search: only the CHECK constraint and the seed INSERT match).
5. **Misleading UI security copy:** TallyingPage.tsx:48 "The vote's Ed25519 signature failed verification" — no Ed25519 exists anywhere in the voting path (repo-wide search; §11). The `invalid_signature` enum value exists at the type level (api.ts:406, keyshares.ts:459) without a backing mechanism.
6. **No candidate-seeding script:** `vote.test.ts:63-65` says "run seed-constituencies/seed-candidates first"; no `seed-candidates` file exists in the repo (`git ls-files`). `frontend/public/candidates.json` is a mock consumed only by the offline path.
7. **Client-side offline mocks can fabricate a "successful vote":** `api.ts` `registerVoter` (L122-146), `checkNullifier`, `submitVote` (L182-207), `getElectionPublicKey`, `getCandidates`, and `getPublicStats` (L282-344) catch transport `TypeError` and return localStorage/mock data — `submitVote` records the NID in `localStorage.mock_voted_nids` and returns `vote_id:"mock-vote-…"`. The mock ElGamal key `{p:"ffff…ff", g:"2", y:"3"}` is not a valid subgroup public key; mock candidate ids are synthesized UUIDs. These are demonstration artifacts, **not part of the real ballot path** — but their presence means an unreachable backend yields a fake success screen (Phases 3/4 material).
8. **Evidence docs predate the current flow:** `testing/testing_evidence.md`, `shamir_threshold_output.md`, `vote_casting_output.md` describe the **old** `POST /keyshares/submit` + `share_value` flow and old client-side nullifier; current code has neither. Historical artifacts, not current-behavior docs.
9. **README references nonexistent files:** README.md "Docs" links `docs/evaluation_writeup.md`, `docs/anchoring-flow-diagram.md`, `docs/batching-vs-per-vote.md` — none in `git ls-files` → REFACTOR.md's "zero broken links" claim does not hold for README.
10. **Anchor-vs-DB atomicity is intentionally loose:** in `runAnchorBatch` the on-chain tx commits first; `merkle_batches`-insert and `votes`-UPDATE failures are logged, not rolled back (anchorBatch.ts:107-125; "chain state is source of truth"). A vote can be on-chain but still `status='queued'`/`tx_hash=NULL` after a partial failure.
11. **Localhost-bound by default:** CORS (index.ts:33-37), `VITE_API_BASE` default (api.ts:17), CSP `connect-src http://localhost:3000` (index.html:18). Directly relevant to mobile migration (Phases 3-5).
12. **Legacy env naming:** `AMOY_RPC_URL` now carries the Sepolia RPC URL (backend/.env.example:32-36; context.md).
13. **Documented gaps (project's own docs, not new):** pre-anchor tamper window (METHODOLOGY.md row 7; threat_model.md §6); ballot-set completeness not proven before first anchor (explicit-assumptions-and-nongoals.md §1); no implemented voter-verifiable receipt (threat_model.md §8; FUTURE_WORK.md §7); coercion-resistance out of scope (§2).
14. **`zkp_proof` mutable in principle:** not in `fn_votes_immutable_guard`'s blocked set (schema.sql:1004-1019); no writer found in reviewed code paths (§16).

---

## 16. UNKNOWN — REQUIRES VERIFICATION register

Every gap below could not be resolved from the repository alone. Each states what would resolve it.

1. **How the live `candidates` rows were created.** No HTTP route and no seed script exists (`vote.test.ts` references one that isn't there). *To verify:* inspect the live Supabase `candidates` table + any manual SQL runbook; or add a seed script as part of the migration.
2. **Writers of `votes.zkp_proof` after insert.** The column is updatable (not in the immutable guard) but no route/service in reviewed code updates it. *To verify:* repo-wide grep for `zkp_proof` in `.update(` calls; live-DB audit.
3. **Any writer of `votes.status='rejected'`.** Enum member has no writer found. *To verify:* full-repo grep for `'rejected'` (beyond schema/test files) + DB audit.
4. **Election status transitions.** `elections.status` appears static ('setup' on create; seed row 'tallying'); no updater found. *To verify:* grep for `from("elections").update(`; confirm intent in FUTURE_WORK/design docs (none found in this phase).
5. **Full behavior of every remaining frontend page not exhaustively read** (LandingPage, HowToVote, About, PublicWatchdog, TamperVisualizer, KeyShareStatus, KeyShareSubmit remainder, AdminLogin, dkgCrypto/keyholderCrypto internals). Headers/routes verified; fine-grained behavior (polling loops, exact render conditions) not fully traced. *To verify:* read the remaining files (deferred to Phase 4, where the screens matter).
6. **The exact response shape of `GET /anchor/latest` and the dkg.ts round-2/round-2-inbox handlers** were verified at route/schema level; the precise round-2 response fields were summarized from the client contract (api.ts), not from a full read of the handler. *To verify:* full read of dkg.ts:103-250.
7. **Runtime state of the live deployment** (current on-chain batch counts, whether the deployed contract address in the seed row is current, DB contents). The repo pins documented addresses/evidence snapshots that may be superseded. *To verify:* live RPC + DB queries (out of scope for a repo-only audit).
8. **Whether any other mechanism (ops script, cron, Supabase edge function) transitions `votes.status` or `elections.status` outside the Express app.** No such artifacts are in the repo. *To verify:* Supabase scheduled functions / external jobs inventory.
9. **Rate-limit/enumeration resistance of `/voter/register`.** No rate limiting or CAPTCHA is present in the repo; whether infra provides it elsewhere is unverifiable here. *To verify:* infra/WAF config outside the repo.

---

## 17. Post-Phase-4 corrections (added at build time; see `BUILD_NOTES.md`) — the Phase-1 record above is deliberately left intact

- **§15.6 and §16.1 are INCORRECT:** a candidate-seeding script **does** exist. `backend/src/scripts/seed-constituencies.ts` seeds the 8 constituencies **and then seeds candidates** (lines 91-137) from `frontend/public/candidates.json` — 48 rows, 6 per constituency, full CON-01..08 coverage, `onConflict: "election_id,name,constituency_code"`. The §16.1 resolution step ("add a seed script") is therefore unnecessary; the build brief's P0 task to create `seed-candidates.ts` was cancelled on this basis.
- **§12/§14 omit two existing test-infra pieces:** `backend/.env.test.example` exists (untracked) with all required keys, and `backend/src/testUtils/testSupabaseEnv.ts` already implements the fail-closed `.env.test` guard (refuses missing `.env.test`; refuses a `.env.test` whose `SUPABASE_URL` matches production).
- **Phase-4-introduced citations re-verified at build time** (BUILD_NOTES §2): `VotingPage.tsx:71-76` **CONFIRMED**; `VoterLogin.tsx:138-148` **CONFIRMED** (the `<input>` element ends at 149); `VoterLogin.tsx:116` — the line exists but the "contrast risk" characterization was **wrong** (line 116 is `#0A2540` on a light card, ≈13:1; the real failures are `#627d98` at 14px ≈3.9:1 and `#C8920A` at 12px ≈2.5–2.8:1); `candidates.ts:48-73` and `:43-46` are **consistent** with this file's §5/§6 citations (no mismatch); the a11y grep counts are **CONFIRMED exactly** (`aria-` = 3, `role=` = 0 across 22 `.tsx` files).
- **Superseded in P0 (same pass):** this file's statements that the three integrity tests are skipped are now historical — §4 item 6, §9 (A-6 row), §12 (both `it.skip` entries), §15.6/§16.1. P0 unskipped all three, replaced `integrity.test.ts`'s production-`.env` fallback with the fail-closed `loadTestSupabaseEnv()`, and added the gated `live-integrity` CI job (`BUILD_NOTES.md` §4). The original text is intentionally **not** rewritten; the correction stands alongside it.

---

## Closing note

This completes the Phase 1 factual inventory. No recommendations or A/B/C/D classifications are made here — those belong to Phase 2 (`METHODOLOGY_CLASSIFICATION.md`), which re-reads this document and classifies each verified behavior strictly from the evidence above. The Phase 0 warning about `METHODOLOGY.md` (repo-root file colliding with the Phase 2 deliverable name) was honoured: the Phase 2 deliverable was written to the distinct filename `METHODOLOGY_CLASSIFICATION.md`, leaving the research `METHODOLOGY.md` untouched. Corrections found after Phase 1 (including one error in §15.6/§16.1) are recorded in §17 above and in `BUILD_NOTES.md` rather than by rewriting the original findings.

# VERIFICATION_AND_TESTING.md — Phase 6: Verification & Testing Framework

**Status:** Phase 6 deliverable. One artifact covering integrity-demonstration and the mobile test strategy (per the phase brief). Grounded in: `AUDIT.md` §12 (existing suites, what each asserts; the three `it.skip` integrity tests were unskipped in P0 — see `BUILD_NOTES.md` §4), `METHODOLOGY_CLASSIFICATION.md` Parts 5–6 (A/B/C/D), `THREAT_MODEL_AND_SECURITY.md` (T1–T22, D1–D6, §4, §7), `DATA_AND_API_MIGRATION.md` (§2/§2.1 endpoints, §3 error envelope).

## 1. Test infrastructure (the enabling prerequisite)

AUDIT.md §12 recorded the blocker: **three integrity-critical tests were `it.skip` because no dedicated test DB existed** — (1) the N=50 concurrent double-cast (vote.test.ts), (2) DELETE-immutability and (3) votes-nullifier-uniqueness (integrity.test.ts Categories 1/3). **P0 unskipped all three (`BUILD_NOTES.md` §4)** and fixed `integrity.test.ts`'s production-fallback so both files now use the fail-closed `loadTestSupabaseEnv()`; they cannot execute until the dedicated test project (`backend/.env.test`) is provisioned.

**Required before Phase-7 testing starts:** a dedicated Supabase test project with `backend/.env.test` (`SUPABASE_URL`, `SERVICE_ROLE_KEY`, `NID_HASH_SALT`, `NULLIFIER_SECRET`, `ELGAMAL_*`), schema from the appended `schema.sql`, seed scripts (`seed-constituencies` — which **already seeds candidates** from `frontend/public/candidates.json` (48 rows, 6 per constituency); see `BUILD_NOTES.md` §2.6 — plus `seed-voters`, `seed-keyholders`), and a test election (via `POST /elections` + DKG, or the `setup-shamir-zq` dev shortcut for test-only). A gated CI job was added in P0 (§5).

Existing conventions to follow (AUDIT §12): pure-logic vitest (no DB/chain); mock-Supabase route tests (`routes/dkg.test.ts`, `keyshares.batchScoping.test.ts` pattern); live-gated vitest (vote.test.ts pattern); Hardhat contract tests; standalone scripts (`tamper-test.ts`, `independent-verify-tally.ts`) writing artifacts under `testing/`. Every new test below uses these conventions.

---

## 2. Integrity attack matrix (the eight mandated scenarios, mapped to THIS system)

**Conventions:** "audit evidence" states what exists today and what the Phase-5 migration adds (sessions/admin_actions/tally_runs) — it does not invent evidence that doesn't exist yet. Expected responses assume the Phase-5 error envelope where the endpoint changes; today's equivalents are noted.

### A-1. Attempting to vote twice (sequential)
- **Setup:** voter NID registered (web: `POST /voter/register`; mobile: `POST /voter/session`). First cast `201 {status:"queued", vote_id}`.
- **Execution:** second `POST /vote` with the same identity (same session after re-login, or second device/session with the same NID — T8).
- **Expected system response:** `409 VOTE_ALREADY_CAST` (today `409 "You have already voted"`) — from `fn_cast_vote` P0004 / 23505 mapping (vote.ts:220-243).
- **Expected DB state:** exactly **1** `votes` row for that nullifier; `voters.has_voted = true`; 1 `nullifiers` row. Second attempt touches nothing.
- **Audit evidence produced:** today — row counts + `check-nullifier`/`/voter/me` boolean; after migration — `sessions` lifecycle rows plus the (unchanged) 1-row invariant.
- **UI feedback:** web `VoterLogin` "You have already voted in this election." (VoterLogin.tsx:37-41); mobile Voter-status terminal state (Phase 4 §3).
- **Automated test proving it:** **new dedicated test** in `routes/vote.test.ts` (the current inventory has no explicit sequential 201-then-409 test — the N=50 test implies but does not assert it): register → cast 201 → cast again 409, same- and cross-session.
- **Pass/fail:** pass iff exactly one 201 per trial, every later cast 409, DB count stays 1, `has_voted=true`.

### A-2. Modifying a vote request in transit
- **Setup:** an on-path proxy (e.g. mitmproxy) intercepts `POST /vote` between client and backend.
- **Execution:** (a) flips a byte of `encrypted_vote.c1`; (b) flips a byte of `zkp_proof.responses[]`; (c) swaps/removes the session token (post-D1) or `nid` (today); (d) changes `election_id`.
- **Expected system response:** (a)/(b) `400 INVALID_BALLOT` (ZKP fails — zkp.ts:201-265; there is no plaintext candidate to fall back to); (c) `401` invalid session (after D1; today the NID *is* the identity — precisely the D1 motivation, threat T14); (d) `404 ELECTION_UNKNOWN` or ZKP failure against the wrong election's candidate set.
- **Expected DB state:** **no `votes` row** in any variant; no `nullifiers` row from a rejected request.
- **Audit evidence produced:** server rejection log (status + code); `sessions` revocation trail for (c); no ballot artifact anywhere.
- **UI feedback:** plain error copy with retry guidance; **never** a success screen (only a 2xx renders success — Phase 4 §4).
- **Automated test proving it:** extend `crypto/zkp.test.ts` (exists: tampered proof → false) with **request-level** cases: byte-flipped ciphertext → 400; malformed/absent session → 401 (new session-middleware spec); swapped `election_id` → 404/400. Live-gated.
- **Pass/fail:** all four variants rejected with zero DB writes; a valid request in the same run still yields 201.

### A-3. Replaying a previously valid vote request
- **Setup:** capture a valid `POST /vote` (ciphertext + proof + NID/session) that produced 201.
- **Execution:** re-send the identical request (a) after the cast, (b) simultaneously with the original (T7), (c) under a different NID (cross-identity).
- **Expected system response:** (a) `409 VOTE_ALREADY_CAST` (same nullifier, A1); (b) exactly one 201 + one 409 (row lock); (c) 201 — a **new** ballot with a new nullifier (valid ZKP; this is the documented coercion/ballot-buying vector, explicitly out-of-scope — AUDIT §9, Phase 2 T6).
- **Expected DB state:** (a)/(b) 1 row for the original nullifier; (c) N+1 rows, expected under the threat model.
- **Audit evidence produced:** response statuses; `votes`/`nullifiers` counts; `sessions.revoked_at` if the token was rotated meanwhile.
- **UI feedback:** (a) already-voted terminal state; (b) one success + one conflict; (c) not an error (scope boundary).
- **Automated test proving it:** **new** replay case in vote.test.ts; the unskipped N=50 test re-proves (b); (c) documented as a non-goal, not asserted against.
- **Pass/fail:** (a)/(b) never create a second row; (c) is a documented scope boundary, not a failure condition.

### A-4. Attempting to modify an already-cast vote through normal APIs
- **Setup/execution:** (a) `PUT/PATCH /vote/:id` — **no such route exists** (Express 404, AUDIT §6 coverage note); (b) `supabase.from("votes").update(...)` with the service-role key; (c) the existing demo-only `POST /anchor/tamper/ballot`.
- **Expected system response:** (a) `404`; (b) DB trigger error `"…immutable after insertion"` (fn_votes_immutable_guard); (c) the demo route reports the trigger rejection (anchor.ts:574-583).
- **Expected DB state:** vote row byte-identical (`id, nullifier_hash, constituency_code, encrypted_vote, zkp_proof, created_at`), including after (c).
- **Audit evidence produced:** HTTP 404; DB error text; tamper-test vector-2 output.
- **UI feedback:** no client surface for modification; demo route returns the block message.
- **Automated test proving it:** vote.test.ts "enforces DB immutability trigger" (exists) + **new** unsupported-method 404 assertion; unskip integrity.test.ts Category 1 (DELETE).
- **Pass/fail:** no code path (route, RPC, SQL) alters the integrity columns; row hash-identical before/after.

### A-5. Unauthorized / admin-level tampering attempt
- **Setup/execution:** (a) call `POST /anchor/batch`, `POST /keyshares/tally` with no (or wrong) `x-admin-secret` → `401` (adminAuth.ts:16-40); (b) with the correct secret but in production config (no `ENABLE_TAMPER_DEMO`), call the tamper routes → **`404`** (Phase-5 §2 change); (c) legitimately anchor with per-admin identity → `admin_actions` row; (d) a rogue admin *still* deletes a vote via the flag-enabled demo route → detection path.
- **Expected system response:** (a) 401; (b) 404 (route absent in prod); (c) 201 + audit row; (d) 200 from the demo route, then every later verification fails.
- **Expected DB state:** (a)/(b) no change; (c) `merkle_batches` row + votes `status/tx_hash` updates + `admin_actions` row; (d) one `votes` row deleted via `fn_admin_delete_vote` **and** SMT/`merkle_batches` state that no longer reconciles.
- **Audit evidence produced:** `admin_actions` rows (who/what/when/result); HTTP statuses; verifier output; SMT proof type flips membership → non-membership (A6).
- **UI feedback:** watchdog/visualizer and the independent verifier show the batch as inconsistent; the deleted key's proof is non-membership.
- **Automated test proving it:** **new** 401 cases for every admin route (missing + wrong secret); **new** 404 cases for tamper routes in prod config; tamper-test.ts vectors (exists); independent-verify-tally.test.ts "rejects … SMT membership proof mismatch/omitted" (exists); **new** assertion that a genuinely deleted key's membership proof still verifies against the old root (sparseMerkleTree.test.ts pattern).
- **Pass/fail:** unauthorized → 401 with no effect; prod config hides demo routes; every admin op attributable; deleted-key tamper is *detected* (adversary model: prevention for ordinary attackers, detection against DB-grade admins).

### A-6. Concurrent vote submission (same voter, multiple simultaneous requests)
- **Setup:** one registered NID; test robot fires N=50 identical parallel `POST /vote` bodies (and a two-session/two-device variant for T8/T22).
- **Execution:** `Promise.all` of N requests (as the existing (skipped) test does — vote.test.ts:236-244).
- **Expected system response:** exactly **1×`201`**, `N−1 × (403/409)`; no 500s.
- **Expected DB state:** exactly **1** `votes` row (nullifier unique + `has_voted` flip atomic via `fn_cast_vote`); `voters.has_voted=true`; 1 `nullifiers` row.
- **Audit evidence produced:** response status histogram; `testing/concurrency_stress_output.json` regenerated (the established artifact format); `sessions` rows for the two-session variant.
- **UI feedback:** the winning device shows a receipt; every losing device shows the already-voted/conflict copy — **no device claims success without a 2xx**.
- **Automated test proving it:** **unskip** the N=50 test in vote.test.ts (test-DB prerequisite, §1); **new** two-session/two-device variant (Phase 3 T8/T22).
- **Pass/fail:** across ≥3 trials: exactly one 201, ≥N−1 rejections, DB count 1 each trial — matching the existing expected values the skipped test already encodes (vote.test.ts:255-257).

### A-7. Direct database tampering attempt
- **Setup/execution** (assumes the repo's own adversary model: full DB read/write; the honest verifier is *not* attacker-controlled — METHODOLOGY.md): (a) `UPDATE votes SET encrypted_vote=…` / `nullifier_hash` / `constituency_code` / `created_at`; (b) `DELETE FROM votes`; (c) duplicate INSERT with an existing nullifier; (d) edit `merkle_batches.root`; (e) post-anchor row deletion via the one audited path.
- **Expected system response:** (a) trigger error "immutable after insertion"; (b) trigger error "cannot be deleted"; (c) `23505 unique_violation`; (d) *succeeds at the DB layer* but `GET /anchor/verify/:id` then returns **409 "possible data tampering"** (anchor.ts:132-139) and the on-chain verify returns false; (e) verification bundle rebuild fails ("Batch vote set is incomplete") and SMT returns non-membership for the deleted key.
- **Expected DB state:** (a)-(c) unchanged; (d) root edited (local state lies), votes unchanged; (e) one fewer row, matching nothing.
- **Audit evidence produced:** DB error text/codes; verify endpoint 409 body; `included_on_chain:false`; SMT proof `type:"non-membership"`; independent-verifier rejection output.
- **UI feedback:** verify screen renders "Possible data tampering" / "verification failed" states (Phase 4 Verify screen copy).
- **Automated test proving it:** integrity.test.ts Categories 1–4 **unskipped** (a-c); tamper-test.ts vector 1 (root flip → 409, exists) and vector 2 (b, exists); independent-verify-tally.test.ts deletion cases (exists); sparseMerkleTree.test.ts non-membership (exists).
- **Pass/fail:** every mutation is rejected at the DB (a-c) or *detected* by the honest-verifier path (d/e) with the exact evidence strings above. Prevention of (d)/(e) against a DB admin is **not claimed** — a documented boundary (METHODOLOGY.md adversary model), not a failure.

### A-8. Result verification (published result traceable to underlying valid votes)
- **Setup:** complete cycle on the test DB: ≥3 votes cast → anchor batch → DKG-qualified key → 3 keyholders submit DLEQ partials → `POST /keyshares/tally` (explicit `batch_id`) → `GET /public/results` + `GET /keyshares/verification-bundle`.
- **Execution:** run the standalone verifier (`independent-verify-tally.ts`) against the bundle; then feed it tampered variants.
- **Expected system response:** genuine bundle → `ALL CHECKS PASSED`, and `valid_votes` from the independent recount **equals** `published_results.valid_votes`; tampered variants (substituted ballot, tampered dense root, relabeled setup commitment, missing/different-leaf SMT proof, forged partials) → verifier FAIL with the specific reason.
- **Expected DB state:** `tally_runs` (post-T19) holds the append-only run and is the **sole** store read by `GET /public/results` (BUILD-BRIEF C3 — the legacy `tally_results` is not read or written); ciphers remain decryptable only threshold-wise (no plaintext stored).
- **Audit evidence produced:** verifier output file (`testing/` artifact, matching `docs/evidence/verifier-output-batch3-…txt` format); bundle JSON; response `status:"tallied"`.
- **UI feedback:** Results tab shows aggregates; a failing verifier is surfaced to auditors, not to voters.
- **Automated test proving it:** independent-verify-tally.test.ts (genuine + 11 rejection paths — exists, AUDIT §12); **new** end-to-end tally test on the test DB exercising the whole chain once (register→cast→anchor→partials→tally→bundle→verifier→results).
- **Pass/fail:** recount == published counts on the genuine run; every documented tamper variant is rejected with its named reason.

---

## 3. Mobile app test plan (Expo) — unit / integration / E2E, with backend interaction

### 3.1 Unit — `core-crypto` (port-validation, no devices, vitest in the backend suite convention)
- **Port-equivalence (the critical one):** for every ballot generated by the ported prover (N≥200 candidates across all constituencies, fresh `k` each), the **backend's** `verifyBallotValidity` must return true, and the serialized JSON (`c1`, `c2`, `challenges[]`, `responses[]`) must match the web prover's shape byte-for-byte (D4). This cross-validation runs the backend verifier in the same vitest process — the "one implementation, both sides verify" pattern (merkleTree.ts precedent).
- **Known-answer vectors:** replay the existing `zkp.test.ts` vectors through the port (deterministic challenge/response for fixed inputs) — catches RNG/algorithm drift.
- **Benaloh audit:** `encryptCandidateIdForAudit` → `verifyEncryptedCandidateId` round-trip; audited ciphertext must **not** equal a fresh cast ciphertext (fresh `k` invariant, A13).
- **RNG sanity:** N draws from the ported CSPRNG are non-repeating and boundary-correct (statistical sanity; not a proof of entropy).
- **Negative:** malformed hex / out-of-subgroup `c1` inputs fail the same way the backend does (parity with `elgamal.ts:295-335`).
- Pass/fail: 100% of cross-validated ballots verified by the backend; vectors match; negative parity holds.

### 3.2 Unit — `core-api` (typed client)
- Serialization matches the **zod** schemas of `POST /voter/session`, `GET /voter/me`, `POST /vote`, `GET /candidates`, `GET /public/*` (contract tests against the Phase-5 schemas — resolving B7 by sharing types).
- Error-envelope parsing: `{code, message, retryable}` → correct UI copy + retry decisions; unknown code → safe default "try again later" (never fabricated success).
- **No-log guarantee:** the client never writes the token/NID into logs or error payloads (asserted via a test that injects a logging spy).
- Pass/fail: contract matches; envelope decisions are exhaustive for the documented codes (§3 of DATA_AND_API_MIGRATION).

### 3.3 Integration (mock-Supabase, backend-only — `routes/*.test.ts` pattern)
- **Session lifecycle:** `POST /voter/session` → `GET /voter/me` → `POST /voter/session/refresh` (old token 401s, new works) → `POST /voter/session/revoke` (401 after) — mocked like the existing `dkg.test.ts`/`keyshares.batchScoping.test.ts` suites.
- **Two sessions, one NID:** cast with session A (201), cast with session B (409) — proves D1 never becomes a second eligibility axis (A1).
- **Window gate:** `/vote` with election status ≠ `'voting'` → `403 ELECTION_NOT_OPEN`; after `PATCH …/status` → 201 (T13).
- **Device binding:** token presented with a different `device_id` → 401 (T15).
- Pass/fail: each mocked flow ends in the exact documented status + DB-like state (mocked rows).

### 3.4 E2E (Detox, against a staging backend + test DB)
- Full happy path: Election Hub → Authenticate (NID + numeric keypad) → Voter status → Ballot → **Audit → Back → reselect** → Cast → Confirm → Receipt (real `vote_id`, "awaiting anchoring") → Verify (local+on-chain) → Watchdog/Results tabs.
- Already-voted path: second device/relaunch → Voter status shows terminal state; second cast attempt blocked.
- **Offline states (D3):** airplane-mode at each journey step → overlay copy asserted; re-firing `POST /vote` after reconnect → 201 or 409, exactly one receipt (idempotency).
- **Session hygiene:** "sign out everywhere" revokes all sessions; app-data-clear forces re-authentication (new `device_id`).
- Pass/fail: the E2E matrix (happy path, double-vote, offline × every step, revocation) passes on iOS & Android emulators; no step shows success without a 2xx.

---

## 4. Mobile-specific security testing (every item justified by the Phase 3 threat model — nothing by default)

### 4.1 Secure token storage (D2 — justified by T15)
- **What is tested:** (a) after `POST /voter/session`, the returned token exists in OS secure storage and nowhere else — screenshots of device storage/plain files/Debug logs contain no token, no `token_hash`, no NID; (b) `GET /voter/me` works from the secure store; (c) sign-out wipes the secure-store entry; (d) app-data-clear or reinstall changes `device_id` → old session becomes orphaned → re-authentication required (D6).
- **Evidence:** storage-dump diff before/after; server `sessions` rows show only `token_hash`; HTTP 401 after revocation.
- **Pass/fail:** token appears only in secure storage and server hash column; wipe-on-sign-out verified.

### 4.2 "Rooted / jailbroken device" behavior (justified by Phase 3 §5 + the repo's adversarial client model)
- **What is NOT tested (honestly):** the claim "a rooted device cannot act as its user" — Phase 3 §5 states plainly that a root attacker can read the token from memory, and no app code changes that (it is a legal/commercial boundary).
- **What IS tested — client-is-untrusted:** a hostile client (custom script / modified app build that omits encryption, forges proofs, fabricates success UIs, skips session, replays) must still fail against the server: (a) missing/invalid ZKP → 400 (A3/A4 — exists in zkp/vote tests); (b) same-NID double-cast → 409 (A1 — A-1/A-6); (c) stored-vote modification → trigger error (A5 — A-4); (d) a fake "success" the server never returned is **impossible** because no endpoint returns success without casting (assert: the only 2xx producer is the real DB transaction — a property of the API surface, §3 of DATA_AND_API_MIGRATION).
- **Evidence:** HTTP statuses + DB rows from a hostile-client harness (effectively extended A-2/A-3/A-6).
- **Pass/fail:** every hostile-client attempt is rejected or detected through the existing A-item controls; the integrity guarantees hold **regardless of client behavior** — which is the exact property Rule 7 requires.

### 4.3 Certificate handling (justified per Phase 3 §6.2 — pinning deliberately NOT added, Rule 8)
- **What is tested, since pinning was rejected:** (a) release builds refuse `http://` API bases (only `https://` accepted by `core-api` config validation); (b) the deployed API sends `Strict-Transport-Security`; (c) a MITM presenting an untrusted/self-signed cert fails OS-level TLS validation (no custom trust store is installed by the app).
- **What is NOT tested:** HPKP-style certificate pinning — **because Phase 3 §6.2 decided against it** (concrete-cost/higher-benefit analysis; OS TLS + HSTS covers the stated trust model). If the threat model ever changes (state-level CA compromise becomes in-scope), the same threat→control→test→evidence discipline re-evaluates pinning; the test would then verify a pinned-cert mismatch aborts every request.
- **Evidence:** config-validation test (http base rejected); HSTS header assertion; MITM test on a staging proxy.
- **Pass/fail:** HTTPS-only enforced; HSTS present; untrusted-cert requests fail closed.

---

## 5. CI wiring & evidence artifacts

- **New CI (extend `.github/workflows/ci.yml`):** `core-crypto` unit job (pure vitest — runs on every PR, no DB); `core-api` contract job (no DB); `mobile` job: typecheck + build (Expo export) + run the pure suites; the live-DB suites (unskipped integrity/concurrency/vote.test.ts + A-8 E2E tally) run in a **separate gated job** (manual/schedule, test project only — matching the repo's rule that live tests must never run against production data, vote.test.ts:11-13).
- **Artifacts (repo convention — `testing/` + `docs/evidence/`):** regenerate `concurrency_stress_output.json` (A-6); add `session_lifecycle_output.json` (3.3/4.1), `hostile_client_output.json` (4.2), `offline_matrix_output.json` (3.4), and a new `verifier-output-mobile-YYYY-MM-DD.txt` (A-8) in the `verifier-output-batch3` format.
- **Test count target (Phase 7 DoD input):** a published "N passed / M skipped" line for each suite in CI logs and README, with **zero skips** on the integrity-critical tests after the test-DB job lands.

---

## 6. Consolidated pass criteria (fed to Phase 7's Definition of Done)

| Criterion | Proven by | On failure |
|---|---|---|
| Duplicate voting is demonstrably prevented | A-1 (sequential), A-6 (N=50 + two-session), DB row counts | any trial >1 row or >1×201 |
| Vote modification is prevented (normal paths) | A-4 (route absence, trigger), A-7 (a–c) | any mutation succeeds |
| Vote tampering is detected (DB-grade adversary) | A-7 (d/e): verify→409, `included_on_chain:false`, SMT non-membership, verifier FAIL | any tampered variant verifies clean |
| Request/response integrity on the wire | A-2 (all four variants rejected, zero writes) | any tampered request yields 201 |
| Replay is bounded | A-3 (same-NID 409; cross-NID documented out-of-scope) | a second row for one nullifier |
| Admin impact is attributable | A-5 (401/404/audit rows) + `admin_actions` spec | an admin op leaves no audit row |
| Result traceability | A-8 (recount == published; verifier genuine+11 rejections) | mismatch or any listed tamper passes |
| Election window is honored | 3.3 (window gate), A-* cross-check after `/vote` change (T13) | `/vote` accepts while status ≠ `voting` |
| Mobile client is untrusted-verified | 3.1 (port-equivalence), 4.2 (hostile client), 3.2 (envelope), 3.4 (offline) | hostile client produces any server-side effect |
| Tokens are stored/revoked correctly | 4.1, 3.3 (session lifecycle) | token found in plaintext/logs; revocation fails |
| TLS posture is as designed | 4.3 (HTTPS-only, HSTS, untrusted cert fails) | http base accepted in release |
| Integrity-critical suites have zero skips | §1 test-DB + §5 gated CI job | any `it.skip` remains on the integrity list |

**Explicit non-claims (not failures):** a rooted device extracting the token in memory (§4.2); cross-NID ballot transfer (coercion, out-of-scope per Phase 2 T6); a state-level CA issuing a trusted cert (Phase 3 §6.2 pinning decision); a DB admin dropping triggers (detection-backed by design, METHODOLOGY.md adversary model). Each is documented with the exact control (or scope boundary) in the table above.
# ROADMAP_RISKS_DOD.md — Phase 7: Roadmap, Risks, and Definition of Done

**Status:** Phase 7 deliverable. Synthesizes Phases 2–6 into an executable plan. Every phase names **real files/modules** (from AUDIT.md), the tests that gate it (VERIFICATION_AND_TESTING.md A-*/§3/§4), and measurable completion criteria.
> **BUILD-BRIEF OVERRIDES APPLIED (see `BUILD_NOTES.md`):** C2 per-admin identity is **out of scope** (all admin routes keep `x-admin-secret`; `admin_actions.actor_admin_id` = static `"shared-admin"`); C3 `tally_runs` is the **sole** results store and `tally_results` is dropped from the migration; C4 the P3 trio ships atomically. Also, re-verification showed the candidate-seed task in P0 was based on a wrong AUDIT claim — see P0 below.

Two decisions flagged as open in earlier phases are **closed here** with rationale:
- **B3 (`votes.status='rejected'`):** keep the enum (live DBs already carry the type; Postgres cannot cheaply remove an enum value), add **no** writer, add a code-comment deprecation, and fix the UI copy (C4). Rationale: nothing needs the state today; forcing a writer would invent an admin path.
- **B1 (authoritative eligibility):** rate limiting + CAPTCHA ship now (T10); an authoritative roll is **out of scope for the simulation** (the repo's stated claims don't include enrollment integrity — Phase 3 §6.1) and is logged as a product decision, not a silent gap.

---

## 1. Phased implementation roadmap

### P0 — Test infrastructure & integrity-test unskip (the enabler)
- **Objective:** make the skipped integrity proofs runnable so every later phase can prove regressions.
- **Tasks:** provision the dedicated Supabase test project + real `backend/.env.test` (the `.env.test.example` template and the fail-closed `testUtils/testSupabaseEnv.ts` guard **already exist**); unskip `vote.test.ts` N=50 and `integrity.test.ts` Categories 1/3; add a gated CI job (manual/schedule, test project only). ~~add `backend/src/scripts/seed-candidates.ts`~~ — **CANCELLED by re-verification: `backend/src/scripts/seed-constituencies.ts:91-137` already seeds candidates** (48 rows, 6 per constituency, full CON-01..08 coverage) from `frontend/public/candidates.json`; a second script would duplicate it (BUILD_NOTES §2.6).
- **Affected files:** `backend/.env.example`, `backend/vitest.config.ts`, `backend/src/routes/vote.test.ts`, `backend/src/db/integrity.test.ts`, `backend/src/testUtils/testSupabaseEnv.ts` (already existed), `.github/workflows/ci.yml`. **No `seed-candidates.ts`** — cancelled (see above).
- **Required tests:** A-1 (new sequential), A-6 (N=50), A-7 (a–c); regenerate `testing/concurrency_stress_output.json`.
- **Completion criteria:** zero `it.skip` on the integrity-critical list; A-1/A-6/A-7(a–c) green in the gated job.

### P1 — Schema append & backend hardening (Phase 5 §1 + Phase 3 T10/T20)
- **Objective:** lay the data-layer foundation: sessions/admin/tally/status-event tables, `zkp_proof` immutability, error envelope, rate limiting, tamper-demo flag.
- **Tasks:** append DDL+tests-guarantees to `backend/src/schema.sql` (`sessions` — C1 CHECK fixed, `admin_actions`, `tally_runs`, `election_status_events` + guard triggers; extend `fn_votes_immutable_guard` to block `zkp_proof`); add error-envelope helper; add `express-rate-limit` + CAPTCHA hook (registration/vote tiers); add `ENABLE_TAMPER_DEMO` gating for the four demo routes (anchor.ts:340-662); add a `tally_runs` insert in `POST /keyshares/tally` (keyshares.ts:402-421) and switch `GET /public/results` to `tally_runs ORDER BY tallied_at DESC LIMIT 1` (public.ts:126) — **C3: no `tally_results` write or cache-sync is built**; `admin_actions` rows use the static actor `"shared-admin"` (C2).
- **Affected files:** `backend/src/schema.sql`, `backend/src/index.ts`, `backend/src/middleware/adminAuth.ts` (+ new `errorEnvelope.ts`, `rateLimit.ts`), `backend/src/routes/anchor.ts`, `keyshares.ts`, `public.ts`, `backend/.env.example`.
- **Required tests:** A-7 (c) `zkp_proof` guard; T10 rate-limit burst → 429; T19 append-only `tally_runs` + results-vs-history; schema assert tests (triggers exist).
- **Completion criteria:** all new tables/triggers present on a fresh DB (`run-schema.ts`) and on the test DB; `zkp_proof` blocked; tamper routes 404 without the flag; 429 under burst.

### P2 — Session API (Phase 5 §2.1, Phase 3 §4.1, D1/D6/T15)
- **Objective:** replace raw-NID-per-request with server-issued, hash-stored, device-bound, revocable sessions; migrate the voter-scoped endpoints.
- **Tasks:** `POST /voter/session`, `GET /voter/me`, `POST /voter/session/refresh|revoke|revoke-all`; session middleware; switch `POST /vote` and `GET /candidates` to bearer auth; delete the deprecated `?constituency=` path (candidates.ts:48-73); correct `shared-interfaces/types.ts` (B7).
- **Affected files:** `backend/src/middleware/sessionAuth.ts` (new), `backend/src/routes/voter.ts`, `vote.ts`, `candidates.ts`, `backend/src/supabaseClient.ts` (unchanged), `shared-interfaces/types.ts`.
- **Required tests:** 3.3 session lifecycle (mock-Supabase), A-2(c) token tamper → 401, T15 token stored hash-only, **two sessions one NID → one 201 one 409** (A1 must not weaken).
### P3 — Election lifecycle enforcement + admin audit (Phase 5 T13/T16)
- **Objective:** make "open/closed" real and make admin actions attributable.
- **Tasks:** `PATCH /elections/:id/status` (validated `setup→voting→tallying→closed`, idempotent close; **`x-admin-secret` — per-admin identity out of scope, BUILD-BRIEF C2**) writing `election_status_events` + `admin_actions`; status gate in `POST /vote` (403 `ELECTION_NOT_OPEN`) and in `GET /elections` response as `availability`; wire `admin_actions` into `POST /anchor/batch`, `POST /keyshares/tally`, `POST /elections` (actor = `"shared-admin"`). **BUILD-BRIEF C4: these ship together in one phase — never the `/vote` gate before the transition endpoint, or every election is stuck in `'setup'` with no way to open voting.**
- **Affected files:** `backend/src/routes/elections.ts`, `vote.ts`, `anchor.ts`, `keyshares.ts`, `backend/src/middleware/adminAuth.ts` (actor identity), web `frontend/src/pages/AdminDashboard.tsx`.
- **Required tests:** A-5 (401/404/audit rows), T13 (3.3 window gate), PATCH transition audit rows, `closed→closed` idempotence.
- **Completion criteria:** `/vote` rejects outside `voting`; every transition and admin op produces exactly one audit row; GET /elections reflects server truth.

### P4 — `core-crypto` port (Phase 4 §1, Phase 6 §3.1, D4)
- **Objective:** the mobile prover with byte-identical request bodies, validated by the **unchanged** backend verifier.
- **Tasks:** create `packages/core-crypto` (pure TS, no Expo imports); port `frontend/src/utils/elgamal.ts` (encrypt + OR-proof prover + Benaloh helpers) and the SHA-256/Fiat–Shamir pieces with a crypto source that is secure under Expo (OS-backed CSPRNG); vitest suite incl. **port-equivalence** (≥200 ballots verified by backend `verifyBallotValidity`) and known-answer vectors.
- **Affected files:** `packages/core-crypto/**` (new), root `package.json` workspace wiring, backend test-suite import for cross-validation.
- **Required tests:** §3.1 suite (equivalence, vectors, Benaloh fresh-`k`, RNG sanity, negative parity).
- **Completion criteria:** 100% cross-validation pass; vectors match; serialized request shape byte-for-byte equal to the web prover.

### P5 — `core-api` + Expo app scaffold (Phase 4 §3 screens, Phase 6 §3.2/3.4)
- **Objective:** the typed mobile client and the voter journey, in lifecycle order, with secure storage and honored offline behavior.
- **Tasks:** `packages/core-api` (typed client: sessions, `/vote`, `/candidates`, `/public/*`, verify; error-envelope parsing; no-log guarantee; HTTPS-only validation); Expo app (`packages/mobile-app`) with the screen set S0→S7 (Election Hub → Authenticate → Voter status → Ballot → Cast-or-audit → Confirm → Receipt → Verify) + Watchdog/Results/Settings; `expo-secure-store` for token/device_id/opt-in audit data; offline banner/overlay (D3); a11y per Phase 4 §5.
- **Affected files:** `packages/core-api/**` (new), `packages/mobile-app/**` (new), mobile `package.json`/config.
- **Required tests:** §3.2 (contract/envelope/no-log), §3.4 E2E (Detox happy path, double-vote, offline × every step, revocation), §4.1 (token storage).
- **Completion criteria:** full journey green on iOS+Android emulators; no success screen without a 2xx; token only in secure storage; offline fail-closed verified at every journey step.

### P6 — Mobile security hardening (Phase 6 §4)
- **Objective:** prove the client-is-untrusted property and the TLS posture on real devices.
- **Tasks:** hostile-client harness (script that sends forged/omitted-proof/replayed requests exactly at the HTTP layer — must produce only 400/401/409 and zero DB effects); HTTPS-only config validation in `core-api`; HSTS header assertion; device tests for token wipe on sign-out and re-auth after app-data-clear.
- **Affected files:** `packages/core-api/**`, `packages/mobile-app/**` (security/config), `testing/` artifacts (`hostile_client_output.json`).
- **Required tests:** §4.1, §4.2 (A-2/A-3/A-6 from a hostile client), §4.3.
- **Completion criteria:** every hostile-client attempt rejected/detected; HTTPS-only enforced in release; token storage invariants hold on iOS+Android.

### P7 — Full-cycle rehearsal & cutover (FUTURE_WORK §11.6 + Phase 6 §5)
- **Objective:** prove the whole methodology once on staging and decide the web-app cutover.
- **Tasks:** full-cycle rehearsal (register → vote via mobile → anchor → tally → verifier → results; simulated tamper → detected → voter-visible verify failure); archive evidence (`testing/`, `docs/evidence/verifier-output-mobile-…txt`); decide the fate of voter-facing web pages (keep as read-only public-info pages per FUTURE_WORK §1 vs delete); update `README.md`, `context.md`, `CLAUDE.md`; `graphify update .`.
- **Affected files:** docs set above; `docs/` and `testing/` artifacts.
- **Completion criteria:** rehearsal runbook green end-to-end; tamper demo detected through the verifier path; docs reflect mobile-first architecture; CI publishes "N passed / M skipped" with zero integrity-critical skips.

### Dependencies & parallelization
```
P0 ──────────────► P1 ──► P2 ──► P3     (backend hardening is a chain)
P0 ─► P4 ──► P5 ────────────────► P6    (crypto/mobile is a parallel chain)
P1/P2 ──────────► P5 (mobile needs the session API + envelope)
P3/P6 ─► P7 (rehearsal needs window enforcement + hardened app)
```
- **Parallelizable:** P4 (crypto) with P1/P2 (backend); P6 depends on P5; P1 standalone against P4.
- **Blocking dependencies:** P5 cannot go to staging without P2 (sessions) and P3 (window gate); P7 requires P0 (test DB, so the rehearsal evidence is generated against the gated environment).

---

## 2. Risk register (Risk → Impact → Probability → Mitigation → Verification)

| # | Category | Risk | Impact | Probability | Mitigation (phase) | Verification (test) |
|---|---|---|---|---|---|---|
| R1 | Security | Session token theft on a rooted/compromised device | High — attacker votes as the victim (once; A1 bounds the count) | Medium | Honest boundary (Phase 3 §5); short TTL, device binding, server revocation (D1/D6) | §4.1, §4.2 hosted-client harness |
| R2 | Security/Integrity | Enrollment inflation persists while B1 is unadopted (any NID self-registers) | High — ballot-count integrity in a public demo | High | Rate limit + CAPTCHA on register/session (T10); explicit scope note | T10 burst → 429; A-1/A-6 integrity still holds |
| R3 | Migration | Status-enforcement ordering bug: `/vote` gate lands before transitions exist, or close races an anchor batch | Medium | Medium | P1 (schema) before P3 (gate); status in same transaction as event row; idempotent close | T13/3.3; A-5; race test (201-or-403, never both) |
| R4 | Mobile | Ported prover diverges from the backend verifier (serialization/domain drift) | Critical — every ballot rejected or, worse, valid-looking where invalid | Low | Single pure-TS `core-crypto`; port-equivalence suite; byte-identical shape assertions (D4) | §3.1 (≥200 cross-validated; KAT vectors) |
| R5 | Usability/Privacy | Offline UX regression: users expect to queue ballots offline | High — would silently reintroduce C1's fake success | Medium | Fail-closed policy + explicit copy (D3); no offline ballot path exists in the API | §3.4 offline × every step; §4.2 hostile client |
| R6 | Testing/Data safety | Live-gated tests pointed at production data by a config mistake | Critical | Low | Existing `loadTestSupabaseEnv` guard (vote.test.ts:11-20); gated CI job; `.env.test` required | §1; CI gated job refuses prod env vars |
| R7 | Auth | Sessions table becomes a new attack surface (token guess, hash timing, enumeration) | Medium | Low | 256-bit CSPRNG tokens; hash-only lookup; timing-safe compare; rate-limited login (T15) | §3.3 lifecycle; A-2(c) |
| R8 | Privacy/Coercion | Saved Benaloh audit data used as a receipt | Medium (privacy) | Medium | Opt-in only; secure store; delete UX; coercion warning copy (Phase 4 §5; docs non-goal §2) | §4.1 wipe/delete; UI copy review |
| R9 | Auditability | An admin path bypasses `admin_actions` | Medium — an unaudited admin action (attribution is the static `"shared-admin"` this pass — BUILD-BRIEF C2) | Medium | Single middleware write point (P1); route registry test enumerates every admin route | A-5: "exactly one row per admin op" |
| R10 | Deployment | Horizontal scaling breaks single-process assumptions (in-memory auto-anchor lock, SMT cache, rate-limit store) | Medium | Medium | Document single-instance assumption; reconcile via on-chain truth (T20); swap rate-limit store when scaling | T20 reconciliation job; load test |
| R11 | Usability/Fairness | Tight rate limits deny legitimate voters at deadline | Medium | Medium | Tiered limits; headroom before close; CAPTCHA not on cast for session holders | §3.4 deadline-path E2E; load test |
| R12 | Scalability | Client BigInt modpow + ZKP too slow on low-end phones | Medium — usability | Medium | Benchmark during P5; target (<2 s ballot build on mid-tier device); pure-TS arithmetic is already 256-bit-only | §3.1 perf bounds; device matrix |
| R13 | Usability/A11y | Phase 4 §5 accessibility bar not met | Medium | Medium | Automated a11y checks + screen-reader walkthrough in DoD; radio/live-region semantics in screen set | DoD a11y criteria |
| R14 | Migration/Policy | Ambiguity of a vote submitted in the seconds around official close | Medium | Medium | Define cutover rule: server clock is authority; `status` change rejects late ballots atomically (403 ELECTION_NOT_OPEN); UI copy explains | T13 gate test; §3.4 close-window E2E |

---

## 3. Definition of done (per area — measurable; none is a restatement of "it works")

| Area | Criterion (how it is verified) |
|---|---|
| **Voting integrity** | A-1..A-8 pass on the test DB in the gated CI job. N=50 × 3 trials → exactly 1×201 per trial and DB count 1. `GET /anchor/verify/:id` on a tampered root returns HTTP 409 with the documented body. Independent verifier reports `ALL CHECKS PASSED` **and** `valid_votes(recount) == valid_votes(published)`. Zero `it.skip` remains on the integrity-critical list. |
| **Security** | §4.2 hostile-client harness produces only 400/401/409 and zero DB effect. Sessions store only `sha256(token)` (asserted by a schema/DB test). Tamper demo routes are 404 unless `ENABLE_TAMPER_DEMO=1`. Every admin operation yields exactly one `admin_actions` row. No client-side source references `NULLIFIER_SECRET`/`NID_HASH_SALT` (CI grep check). |
| **Privacy** | `votes` has no joinable identity column (information_schema assertion). `nullifiers`/`votes` linkage requires the server secret (nullifier derivation test). The mobile client never calls the participation oracle (core-api exclusion test). Benaloh audit data exists on-device **only** with explicit opt-in (storage test). Raw NID appears in no persisted client store and no log (log-spy test). |
| **Concurrency** | Same-voter N=50 exactly-one invariant holds on the test DB; two-session/two-device variant: one 201 + one 409. Rate-limited burst behaves per configured tiers (429 after quota, 201 within). Load test at the intended peak shows p95 < the CI-benchmarked budget with zero 500s. |
| **Accessibility** | Automated checks report 0 critical/0 serious violations on the ballot/audit/authenticate screens; touch targets ≥44px; text contrast ≥4.5:1 on all static + error copy; a recorded screen-reader walkthrough of the full journey passes with no unlabeled control. |
| **API reliability** | Every documented error code (§3 of DATA_AND_API_MIGRATION) has a contract test; `retryable` semantics honored by the client (no infinite retry on non-retryable); unknown-code default is safe; **no endpoint may return a 2xx without a real DB transaction** (asserted over the route table). |
| **DB integrity** | Schema tests assert the existence + behavior of: `trg_votes_immutable` (incl. `zkp_proof` after P1), `trg_votes_no_delete`, `trg_partial_decryptions_no_update`, `sessions`/`admin_actions`/`tally_runs`/`election_status_events` append-only guards, and the candidate/constituency freeze triggers. A fresh `run-schema.ts` DB passes the same suite as the migrated test DB. |
| **Auditability** | For every admin op and every election-status transition there is exactly one audit/event row (route-registry test enumerates all admin routes; T13 transition test). The verifier output and the `merkle_batches`/`sessions` evidence are archived in `testing/`/`docs/evidence/` per the repo's artifact format (verifier-output-batch3 precedent). |
| **Testing** | CI publishes "N passed / M skipped" per suite; integrity-critical skips = 0; the gated live-DB job is the only place those suites run; port-equivalence ≥200 ballots; Detox matrix (happy path, double-vote, offline × every step, revocation, close-window) green on iOS+Android emulators. |
| **Production readiness** | Release build enforces HTTPS-only (config-validation test); server sends HSTS; `ENABLE_TAMPER_DEMO` unset in deployed config; **no** demo/mock data path compiles into the mobile app (C1/C2 cannot exist — asserted by source-presence CI checks for `mock-vote-`/fabricated `tx_hash`); secrets are env-injected (no credentials in repo); README/context/CLAUDE updated to mobile-first (P7). |

**Closing note on what "done" intentionally does not include:** biometric/liveness MFA (Phase 3 §6.1 — not justified by this system's claims), certificate pinning (Phase 3 §6.2 — rejected by Rule-8 analysis), coercion-resistance (explicit non-goal), and authoritative voter enrollment (product decision, logged). Each is recorded with its rationale and its re-evaluation trigger, so "done" here means *done against the documented threat model and scope*, not *done against a generic election platform's expectations*.
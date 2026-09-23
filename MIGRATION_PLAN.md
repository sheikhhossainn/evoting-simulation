# MIGRATION_PLAN.md — Web-to-Mobile Migration Plan (Secure E-Voting Simulation)

**Scope:** migration of the existing web voting system (repository `sheikhhossainn/evoting-simulation`, branch `dev` @ `48b2f18`) to a **React Native (Expo)** mobile application **while preserving and validating the existing voting methodology**.
**Companion deliverables (this plan is their compiled master document):**

| Deliverable (Phase) | File |
|---|---|
| P1 — Codebase & documentation audit | `AUDIT.md` |
| P2 — Methodology extraction & A/B/C/D classification | `METHODOLOGY_CLASSIFICATION.md` |
| P3 — Threat model & security architecture | `THREAT_MODEL_AND_SECURITY.md` |
| P4 — Mobile architecture & UX plan | `MOBILE_UX_ARCHITECTURE.md` |
| P5 — Data & API migration plan | `DATA_AND_API_MIGRATION.md` |
| P6 — Verification & testing framework | `VERIFICATION_AND_TESTING.md` |
| P7 — Roadmap, risks, DoD | `ROADMAP_RISKS_DOD.md` |

> **Build-brief overrides are authoritative (see `BUILD_NOTES.md`):** C1 `sessions` CHECK references `voter_nid_hash`; C2 per-admin identity is out of scope (admin routes keep `x-admin-secret`; audit actor = static `"shared-admin"`); C3 `tally_runs` is the sole results store (`tally_results` dropped); C4 the P3 election-window trio ships atomically. The same file records the mandated citation re-verification, including one Phase-1 error it caught (a candidate-seed script **does** exist).

---

## Executive summary

**What this system actually is** (verified, not assumed): a research-grade E2E-verifiable voting *simulation* whose core claim is **tamper-evidence**: encrypted ballots (ElGamal + mandatory Chaum–Pedersen ZKP of validity), server-side nullifiers for unlinkability, votes made immutable and undeletable in Postgres, batch roots anchored to Ethereum Sepolia (dense Merkle + Sparse Merkle Tree, with actual on-chain commitments), a 4-party DKG where the secret key never exists in one place, and a verifiable threshold tally that never reconstructs the key (`AUDIT.md` §§4,7,11; `METHODOLOGY_CLASSIFICATION.md` Part 5). The repository itself states it is "a working simulation … not a production election platform" (`README.md`).

**The migration thesis, in one sentence:** the methodology that gives this system its guarantees lives **server/DB/chain-side** and is preserved *unchanged* (A1–A16 in `METHODOLOGY_CLASSIFICATION.md` Part 6); the mobile migration therefore consists of **replacing four actively-wrong client artifacts (C1–C4), fixing nine weaknesses the mobile context amplifies (B1–B9), and adding six genuinely mobile-only mechanisms (D1–D6)** — sessions instead of raw-NID-per-request, OS secure storage, a fail-closed offline policy, a ported client prover validated by the unchanged backend verifier, HTTPS/deploy config, and device/session lifecycle handling.

**The three findings that matter most, because they affect the server even before any app code:**
1. **Enrollment inflation is unaddressed** — any 11-digit NID self-registers as eligible with no rate limit (T10). Mitigation: rate limit + CAPTCHA now; authoritative eligibility is a logged product decision.
2. **"Voting open/closed" is not enforced anywhere** — `elections.status` is a descriptive enum with no transitions, and `POST /vote` never checks it (T13/B2). Plan: transition endpoint + window gate + audit (P3).
3. **Admin is one shared secret with zero attribution** (T4/T16/B5). Plan: append-only `admin_actions` audit (**per-admin identity is out of scope this pass — BUILD-BRIEF C2**); production-flag off the demo tamper routes.
**Plus one hard constraint that shapes the whole mobile UX:** there is **no offline vote creation** (ZKP validity, duplicate-vote prevention, and nullification are server-authoritative — Rule 7; the app fails closed and never shows a success screen without a real 2xx).

The roadmap (P0–P7) sequences: test infrastructure → schema/session layer → election window + audit → crypto port → Expo app → mobile security hardening → full-cycle rehearsal. Gating the whole effort is one prerequisite: **a dedicated test database** — the three integrity-critical tests were `it.skip` for its absence, and **P0 has now unskipped them** (`BUILD_NOTES.md` §4), so they need `backend/.env.test` to actually run.

---

## 1. Existing System Analysis (Phase 1 — see `AUDIT.md`)

Condensed verified inventory:

- **Stack:** React 19 + Vite + Tailwind (web SPA) · Express 5 + TypeScript + Zod + Supabase/Postgres + ethers (backend) · Hardhat + Solidity (anchoring contracts) · Web Crypto API (client crypto) (`AUDIT.md` §§2–3).
- **Database (17 tables):** `elections`, `constituencies`, `voters`, `candidates`, `votes` (identity-free; keyed by server-derived `nullifier_hash`), `nullifiers`, `key_shares`, `merkle_batches`, `smt_batches`, `tally_results`, `partial_decryptions`, `election_setup_commitments`, `election_key_ceremony`, `keyholders`, `dkg_participants/shares/confirmations`. Immutability & no-delete triggers on `votes`; candidate/constituency freeze-after-commitment; atomic `fn_cast_vote` (§4).
- **Authentication model:** *no sessions for anyone*. Voter "credential" = the raw 11-digit NID (sent per request); admin = shared `x-admin-secret`; keyholders = per-election passphrase. No rate limiting; RLS enabled but bypassed (service-role key, §5).
- **Verified vote lifecycle** (the one the plan must preserve): NID entry → (server derives `nid_hash`, `nullifier_hash`, constituency) → client encrypts choice + builds ZKP over the **server-derived** candidate set → `POST /vote` verifies ZKP → atomic `fn_cast_vote` → `queued` → background batch anchors → `confirmed`+`tx_hash` → public verify endpoints → threshold tally → aggregate results (§7).
- **Headline observations (15):** duplicate planning docs (`FUTURE_WORK` = `FUTURE_IMPLEMENTATION`), stale `shared-interfaces/types.ts`, fabricated receipt/tx_hash UI, dead `'rejected'`/`elections.status` states, misleading "Ed25519" copy, missing candidate-seed script, client offline mocks that fake success, stale evidence docs, README broken links, non-atomic anchor/DB flow, localhost-only config, legacy env naming (§15).
- **Unknowns (9):** how live candidates were seeded; writers of `zkp_proof`/`status` outside reviewed code; any out-of-tree `elections.status` updater; remaining page details; live-deployment state; infra-level rate limiting (§16).

## 2. Existing Methodology — with A/B/C/D classification (Phase 2 — see `METHODOLOGY_CLASSIFICATION.md`)

- **Real election state machine:** `elections.status` is descriptive only (no transitions); the *actual* gates on vote acceptance are existence (404) → DKG-qualified key (503) → setup commitment (412) (§Part 1). **Real vote state machine:** `queued → confirmed` (anchor) only; `'rejected'` is never written (§Part 2).
- **Linkability, stated plainly (Part 4):** the cast ballot is **anonymous** (no identity column; nullifier needs the server secret) — but the **server can link at cast time** (it derives identity and nullifier from the same NID and holds the secret), and the unauthenticated `check-nullifier` endpoint is a **participation oracle** (reveals whether a known NID has voted). "Voter authenticated" ≠ "vote anonymous" — two separate properties, kept separate in the mobile design.

**Classification (full table in Part 6 of the phase file):**

| Class | Items | One-line meaning |
|---|---|---|
| **A — preserve (16)** | A1 atomic cast+duplicate prevention · A2 server-side secret nullifier · A3 mandatory client ZKP vs server set · A4 server-derived candidate authority · A5 vote immutability/no-delete triggers · A6 dense+SMT anchoring · A7 public verification surface · A8 DLEQ threshold tally (key never rebuilt) · A9 setup commitment + freeze · A10 multi-election isolation · A11 keyholder passphrases · A12 per-election key from ceremony · A13 Benaloh cast-or-audit · A14 DKG relay (server can't read sub-shares) · A15 aggregate-only results · A16 timing-safe compares | The voting method itself — server/DB/chain-side, UNCHANGED |
| **B — improve (9)** | B1 self-registration eligibility · B2 dead election window · B3 dead 'rejected' state · B4 no rate limiting · B5 shared single admin secret · B6 `zkp_proof` updatable · B7 stale shared types · B8 participation oracle · B9 localhost-only config | Works; concrete cited weakness in the mobile context |
| **C — replace (4)** | C1 client offline mock fallbacks (fake "vote recorded") · C2 fabricated receipt/tx_hash UI · C3 legacy GF(2⁸) Shamir path · C4 misleading "Ed25519" copy | Actively wrong — never port to mobile |
| **D — new for mobile (6)** | D1 server-issued sessions · D2 OS secure storage · D3 fail-closed offline · D4 client-crypto port · D5 API/TLS config · D6 device/session lifecycle | Gaps that only exist because of the mobile context |

---

## 3. Threat Model & Security Architecture (Phase 3 — see `THREAT_MODEL_AND_SECURITY.md`)

- **Adversary model (the repo's own):** attacker has full DB read/write, can fire arbitrary API requests, knows public parameters; cannot write to the chain contracts, cannot derive nullifiers without the server secret, cannot corrupt the honest independent verifier (`METHODOLOGY.md`). DB defenses are defense-in-depth; the guarantee is *detection* via the chain + honest verifier.
- **Threat register (22 threats, filtered — none padded):**
  - *MITIGATED by preserved A-items:* direct DB modification/deletion (T1/T18), ballot manipulation (T3/T9), sequential/concurrent/cross-device double-vote (T5/T7/T8/T22 — row lock), timestamp tampering (T11), client bypass (T12).
  - *PARTIAL (detection-backed or attribution-missing):* root manipulation (T2), malicious admin (T4), shared-secret admin (T16), `tally_results` tamper (T19), anchor/DB reconciliation (T20), keyholder 3-of-4 threshold (T17).
  - *NOT ADDRESSED (server-side controls required):* **enrollment inflation** (T10), **no election-window gate** (T13), token-less identity (T14 → D1), **session-token theft** (T15 → D1).
- **Mobile security architecture (D1–D6):** opaque 256-bit session tokens, server stores only `sha256(token)`, 20-min sliding TTL, device-bound, revocable; OS-backed secure storage (iOS Keychain / Android Keystore, `expo-secure-store`); **no offline ballot creation** (fail-closed); ported prover validated by the unchanged backend verifier; HTTPS/HSTS-only release.
- **Deliberately NOT added (Rule 8 — threat-model justified):** biometric/face-liveness MFA (the system's own claims don't include "only the true person voted"); certificate pinning (OS TLS + HSTS cover the stated trust model; high operational cost); push tamper alerts (notification-timeliness only, not an integrity gap).
- **Honest coverage limits:** rooted devices (root can read the token — legal/commercial boundary), coercion/identity theft with a genuinely-known NID (explicit non-goal), compromised server (honest-server assumption).

## 4. Mobile Architecture & UX (Phase 4 — see `MOBILE_UX_ARCHITECTURE.md`)

- **Framework — React Native via Expo**, and the audit made the decision, not preference: frontend is already React 19 + TS; the ballot crypto is already TS in `frontend/src/utils/elgamal.ts` (near-zero algorithm churn); cross-package types are TS; and the repo's own roadmap (`FUTURE_WORK.md`) already specifies Expo. Flutter/native would mean re-deriving the crypto in new languages. Shape: `packages/core-crypto` (pure TS, vitest, shared with backend for cross-validation — the repo's own "one implementation" pattern, cf. `merkleTree.ts`) + `packages/core-api` (typed client) + `packages/mobile-app` (Expo).
- **Verified UX/a11y defects in the current UI (7):** ballot screen reachable unauthenticated with a fabricated all-zero NID (`VotingPage.tsx:71-76`); success/receipt can show data no server produced (C1/C2); no sessions → NID re-entered every visit, refresh wipes the flow; NID input is plain `type="text"`; **`role=` = 0 / `aria-*` = 3 across the entire frontend**; DKG secrets in `sessionStorage`; election context URL-only. (Phase doc §2.2)
- **Screen set derived from the vote lifecycle (no generic screens):** Election Hub → Authenticate → Voter status → Ballot → Cast-or-audit (Benaloh) → Confirm & submit → Receipt/anchoring status → Verify, plus read-only Watchdog/Results and Settings — each row of the mapping table cites the lifecycle step, the real endpoint, and the Phase-3 element it exercises (Phase doc §3).
- **Offline decision — explicit:** **no offline vote creation.** Ballot validity is proven only by the server's ZKP check; duplicate-vote prevention is a DB row-lock transaction; the nullifier is server-derived; anchoring/verification are server-side. The app fails closed and renders success screens only from real 2xx responses (making the C1 fake-success class structurally impossible). Read-only public pages may cache public-by-construction data only.

---

## 5. Data & API Migration (Phase 5 — see `DATA_AND_API_MIGRATION.md`)

- **Schema (append-only, repo convention — no destructive step, no backfill):**
  - *New tables:* `sessions` (hash-only opaque tokens, device-bound, revocable, append-only guards), `admin_actions` (append-only audit; actor = static `"shared-admin"`), `tally_runs` (**append-only tally history and the sole results store** — C3; `tally_results` is dropped from the migration, no cache-sync step), `election_status_events` (window-transition audit). `admin_users` is cancelled (C2).
  - *Alterations:* `zkp_proof` added to the `votes` immutability guard (B6); `elections.status` gains real transitions; `vote_status` enum untouched (B3 resolved as "deprecate, don't write").
  - *Integrity ledger published:* for each voting-integrity property — what enforces it today, what enforces it after (one-person-one-vote, duplicate rows, immutability, undeletability, ballot validity, unlinkability, freeze triggers, tally integrity, plus the three new properties: window gate, session authenticity, admin attribution).
- **Per-endpoint migration table** — every endpoint from `AUDIT.md` §6 with authz→after, validation, DB ops, security controls, mobile change; new endpoints: `POST /voter/session`, `GET /voter/me`, `POST /voter/session/refresh|revoke|revoke-all`, `PATCH /elections/:id/status`.
- **API redesign — justified by four concrete problems** (not taste): (1) raw NID is the credential on every request → session layer; (2) no election-window check anywhere → status gate + `availability` on `GET /elections`; (3) PG→HTTP error mapping works by **string-matching messages** in `vote.ts:220-243` → stable `{code, message, retryable}` envelope (`ELECTION_NOT_OPEN`, `VOTE_ALREADY_CAST`, …); (4) the API cannot express "recorded but not yet anchored" → receipt renders `queued`/`confirmed` from real anchor data only.
- **Deliberately NOT redesigned:** the vote protocol semantics (byte-for-byte preserved), the public verification surface, the chain path, and admin/keyholder web portals (mobile scope excludes them).

## 6. Verification & Testing (Phase 6 — see `VERIFICATION_AND_TESTING.md`)

- **Prerequisite:** a dedicated Supabase test DB (`backend/.env.test`) — **P0 done**: the three integrity tests unskipped, `integrity.test.ts` switched to the fail-closed loader, and a gated CI job added. Candidate seeding already exists via `seed-constituencies.ts` (`BUILD_NOTES.md` §2.6).
- **Eight mandated attack scenarios (A-1..A-8), each specified with setup / execution / expected response / expected DB state / audit evidence / UI feedback / automated test / pass-fail:** double vote (sequential 409, exactly one row); in-transit modification (byte-flip → 400; bad session → 401; wrong election → 404 — zero writes); replay (same-NID → 409; concurrent → one 201/one 409; cross-NID = documented out-of-scope coercion); modify-a-cast-vote (404 route absence + trigger errors); admin tampering (401 unauthorized, demo routes 404 in prod, audit rows, deletion *detected* via SMT/verifier); concurrent N=50 + two devices (exactly one 201); direct DB tamper (triggers reject; root flip → verify 409 + on-chain false; deletion → SMT non-membership); result verification (recount == published; 11 verifier rejection paths).
- **Mobile plan:** `core-crypto` port-equivalence (≥200 ballots verified by the backend verifier — the D4 proof), known-answer vectors, Benaloh invariants; `core-api` contract + error-envelope + no-log; session lifecycle/window-gate/device-binding integration; Detox E2E (happy path, double-vote, offline × every step, revocation).
- **Mobile security tests (threat-model-gated only):** token-storage invariants; **rooted-device behavior tested honestly** — not "root can't read memory", but "a hostile/modified client still fails server-side" (Rule 7); **certificate pinning not tested because deliberately not added** (Phase 3 §6.2) — instead HTTPS-only + HSTS + untrusted-cert-fails-closed.
- **Consolidated pass criteria** feed the DoD (§9 of this plan).

---

## 7. Roadmap (Phase 7 — see `ROADMAP_RISKS_DOD.md` §1)

| Phase | Focus | Key output | Gate |
|---|---|---|---|
| **P0** | Test infra + integrity-test unskip (**done**: unskips + fail-closed loader + gated CI job; `seed-candidates.ts` cancelled — already covered by `seed-constituencies.ts`) | `.env.test` (blocked on credentials), gated CI job | A-1/A-6/A-7(a–c) green; zero integrity skips |
| **P1** | Schema append + hardening | sessions/admin/tally/status tables, `zkp_proof` guard, error envelope, rate limits, demo-route flag | schema tests; 429 burst; tamper routes 404 in prod |
| **P2** | Session API | `POST /voter/session` + `/voter/me` + revoke/refresh; `/vote`+`/candidates` bearer-auth | A-2(c); two-session 409; hash-only storage |
| **P3** | Election window + admin audit | `PATCH /elections/:id/status` + status gate + `admin_actions` | T13; A-5 |
| **P4** | `core-crypto` port | pure-TS prover + port-equivalence suite | ≥200 cross-validated ballots |
| **P5** | `core-api` + Expo app | screens S0–S7, secure store, offline fail-closed, a11y | §3.2/§3.4/§4.1 |
| **P6** | Mobile security hardening | hostile-client harness, HTTPS-only, token invariants on iOS/Android | §4.1–4.3 |
| **P7** | Full-cycle rehearsal & cutover | staging runbook, evidence archive, docs update, web cutover decision | runbook green; tamper detected via verifier |

Dependencies: `P0 → P1 → P2 → P3` (backend chain) and `P0 → P4 → P5 → P6` (mobile chain) parallelize; `P7` needs P3 (window) + P6 (hardened app) + P0 (test DB).

## 8. Risk Register (Phase 7 — see `ROADMAP_RISKS_DOD.md` §2; full Impact/Probability/Mitigation/Verification rows there)

Top risks, condensed: **R1** session-token theft on rooted devices (mitigated: short TTL + device binding + revocation; honest boundary); **R2** enrollment inflation while B1 unadopted (rate limit + CAPTCHA now); **R3** window-gate ordering bugs (schema before gate; race test); **R4** ported-prover divergence from the backend verifier (port-equivalence suite — most load-bearing risk); **R5** offline UX regression reintroducing fake success (fail-closed + copy); **R6** test suites pointed at production (existing guard + gated job); **R7** sessions as a new attack surface (CSPRNG + hash-only + timing-safe); **R8** saved Benaloh audit data as coercion receipt (opt-in + secure store + delete UX); **R9** an admin path bypassing audit (single middleware write point + route registry test); **R10** scaling breaks single-process assumptions (document; T20 reconciliation; swap stores when scaling); **R11** rate limits harming deadline voters (tiered + headroom); **R12** slow crypto on low-end phones (benchmark target <2 s ballot build); **R13** a11y debt; **R14** close-window ambiguity (server clock authority; atomic 403; copy explains).

---

## 9. Definition of Done (Phase 7 — see `ROADMAP_RISKS_DOD.md` §3; measurable, no "it works")

| Area | Core criterion (summary) |
|---|---|
| Voting integrity | A-1..A-8 green on the test DB; N=50 exact-one invariant; tampered root → HTTP 409; verifier `ALL CHECKS PASSED` and recount == published; zero integrity skips |
| Security | hostile client → only 400/401/409, zero DB effect; sessions store only `sha256(token)`; demo routes 404 in prod; every admin op → one `admin_actions` row |
| Privacy | `votes` join-free (schema assertion); nullifier requires server secret; mobile never calls the participation oracle; audit data opt-in only; NID in no client store/log |
| Concurrency | same-voter N=50 and two-session exactly-one; tiered rate limits behave; load p95 within budget, zero 500s |
| Accessibility | 0 critical/serious automated violations; ≥44px targets; ≥4.5:1 contrast; screen-reader walkthrough passes |
| API reliability | every documented error code has a contract test; retryable honored; **no 2xx without a real DB transaction** |
| DB integrity | schema tests assert every trigger (incl. `zkp_proof`), append-only guards, freeze triggers; fresh DB == migrated DB |
| Auditability | exactly one audit row per admin op/transition; evidence archived in repo's `testing/`/`docs/evidence/` format |
| Testing | CI publishes N/M with integrity-critical skips = 0; port-equivalence ≥200; Detox matrix green on both platforms |
| Production readiness | HTTPS-only release, HSTS, no demo/mock code path in the app (source-presence CI checks), env-injected secrets, docs updated |

---

## 10. Open Questions (compiled from `AUDIT.md` §16 + decisions deferred to product owners)

| # | Question | What would resolve it |
|---|---|---|
| 1 | How were the live `candidates` rows created (no seed script exists)? | Inspect the live Supabase `candidates` table; P0 adds a seed script either way |
| 2 | Any writer of `votes.zkp_proof` / `votes.status='rejected'` outside reviewed code? | Repo-wide grep + live-DB audit (P1 adds the `zkp_proof` guard regardless) |
| 3 | Any out-of-tree `elections.status` updater (cron/edge function)? | Supabase scheduled-jobs inventory (P3's transition endpoint + audit makes this moot) |
| 4 | Full behavior of remaining web pages (Watchdog, Visualizer, KeyShareStatus, …)? | Deferred reads in Phase 4 §16.5 — they are out of the mobile scope |
| 5 | Live deployment state (contract addresses, batch counts, DB contents)? | Live RPC + DB queries (out of repo-only scope) |
| 6 | Infra-level rate limiting/WAF outside the repo? | Ops inventory (P1 ships app-level limits regardless) |
| 7 | **Product decision — authoritative voter eligibility (B1)?** | Owner decision; default is rate-limit+CAPTCHA + explicit scope note |
| 8 | **Product decision — per-admin identity (B5) vs. keeping the shared secret?** | Owner decision; P1/P3 ship `admin_actions` either way |
| 9 | **Product decision — fate of the voter-facing web pages after mobile cutover?** | FUTURE_WORK §11.6: keep read-only vs delete |
| 10 | **Doc conflict — `FUTURE_WORK.md` and `FUTURE_IMPLEMENTATION.md` are duplicates; which survives?** | Maintainer decision (flagged per Rule 5) |
| 11 | **Access needed:** dedicated Supabase test-project credentials (`backend/.env.test`) to execute P0+ | Provide or provision credentials |
| 12 | **Commit-point:** publish these plan documents to `dev` when approved? | Reviewer approval; the plan is currently uncommitted working-tree files |

---

## 11. Self-check against the mandated checklist (yes / no / partial, with pointers)

| Checklist item | Answer | Where addressed | Notes / what is still unresolved |
|---|---|---|---|
| Every critical voting rule enforced server-side? | **YES today, with one planned exception** | A1/A3/A4/A5 + `fn_cast_vote` + triggers (`METHODOLOGY_CLASSIFICATION.md` Part 5-6; `THREAT_MODEL_AND_SECURITY.md` §2) | The **election window** is not enforced yet (B2/T13) — `POST /vote` never checks `elections.status`. Planned YES: P3 adds the status gate + audit. Enrollment (B1) is a documented product decision, not a server rule gap for the simulation's stated claims. |
| Duplicate voting demonstrably prevented? | **YES in code; PARTIAL in demonstrated test evidence today** | A1: row lock + `has_voted` + 3 unique constraints (`METHODOLOGY_CLASSIFICATION.md` A1; `AUDIT.md` §9) | The proof tests (N=50 concurrency; unique-constraint) were unpinned from `it.skip` in **P0** (`BUILD_NOTES.md` §4) but have **not yet executed** — they require `backend/.env.test`. Remaining blocker: test-DB credentials. Cross-device variant added (Phase 6 A-1/A-6). |
| Replay attacks demonstrably prevented? | **PARTIAL (by design)** | `AUDIT.md` §9 replay note; Phase 6 A-3 | Same-NID replay → 409 (prevented). Cross-NID replay is a *new, valid ballot* — that is the documented coercion/ballot-buying vector, explicitly out of scope (`explicit-assumptions-and-nongoals.md` §2). No timestamp/nonce/signature in the protocol by design. |
| Vote modification demonstrably prevented or detected? | **YES (both, at their proper layers)** | Prevented: `trg_votes_immutable`/`trg_votes_no_delete` + route absence (A5; `AUDIT.md` §10). Detected: Merkle/SMT + on-chain roots → verify 409, `included_on_chain:false`, SMT non-membership (A6/A7; Phase 6 A-4/A-7) | The demo-only `fn_admin_delete_vote` exception and the DB-admin-bypass boundary are documented (`AUDIT.md` §10; `THREAT_MODEL_AND_SECURITY.md` §5). P1 also locks `zkp_proof` (B6). |
| Concurrency scenarios tested? | **UNSKIPPED in P0, NOT YET EXECUTED** | Phase 6 A-6/A-7, §3.3, §3.4 | The N=50 stress test was unpinned from `it.skip` in P0 (`BUILD_NOTES.md` §4); the two-session/two-device variant is still to be written (Phase 6). Both are blocked on `backend/.env.test`. Load test at intended peak is a P1/P7 task (R10/R11). |
| Administrator actions auditable? | **NO today → YES planned** | `AUDIT.md` §5.2/§15; `THREAT_MODEL_AND_SECURITY.md` T4/T16; `DATA_AND_API_MIGRATION.md` §1.1 | Today: single shared `ADMIN_SECRET`, no per-admin identity, no audit (B5). Planned: append-only `admin_actions` (P1/P3), per-admin identity is an open product decision (Open Questions #8). A-5 test: exactly one audit row per admin op. |
| Ballot privacy explicitly addressed, and correctly distinguished from authentication? | **YES** | `METHODOLOGY_CLASSIFICATION.md` Part 4 (4.1 "authenticated" vs 4.2 "anonymous"; 4.3 where they ARE linkable); `THREAT_MODEL_AND_SECURITY.md` §4.5; DoD Privacy row | Stated plainly: ballot is anonymous vs. everyone except the server process (which can link at cast time and holds `NULLIFIER_SECRET`); the participation oracle (B8) is noted and excluded from mobile; coercion-resistance is an explicit non-goal. |
| Every security claim backed by a specific test? | **YES with one conditional** | Phase 6 §6 pass-criteria table maps every claim → A-item → test → evidence | The conditional: the backing tests are no longer skipped (**P0 — `BUILD_NOTES.md` §4**) but cannot execute until the test project exists; the gated CI job is the enforcement point. "Detection" claims remain backed today by the tamper-test and independent-verifier suites (which run without a DB). |
| Every major decision traceable to something actually found in the code, or explicitly marked new and justified? | **YES** | Each phase doc cites `AUDIT.md`/files; new mechanisms are class D (mobile) with threat-model justification (Phase 3 §§4-6) | Examples: sessions D1 ← T15/T14 (no sessions, NID-per-request, `vote.ts`/`candidates.ts`); error envelope ← string-matching PG mapping `vote.ts:220-243`; fail-closed offline ← A1/A3/A2 server-authority (Rule 7); MFA/pinning explicitly *rejected* with Rule-8 reasoning (Phase 3 §6). |
| Every unknown clearly marked, with what would resolve it? | **YES** | `AUDIT.md` §16 (9 items) + this plan §10 (12 items incl. product decisions) | Every item has a resolution path. Two need human input to proceed: test-DB credentials (Open Q.11) and the four product decisions (Open Q.7–10). |

**Closing statement:** this migration plan is deliberately conservative — it changes the *delivery surface* (web → Expo mobile app, session layer, secure storage, transport) while treating the *voting methodology* (server/DB/chain verified mechanisms A1–A16) as fixed and re-proving it (P0/P6/P7) rather than re-inventing it. Every weakness it acts on, every mechanism it preserves, and every mechanism it declines to add is traceable to code read in Phase 1, a threat-scenario in Phase 3, or an explicit, justified new-mobile decision — and the stated boundaries (rooted devices, coercion, enrollment authority, state-level TLS) are named as boundaries, not silent assumptions.
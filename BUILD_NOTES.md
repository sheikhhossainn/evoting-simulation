# BUILD_NOTES.md — Build-brief corrections & citation re-verification

**Purpose:** records (a) the build-brief corrections that **override** the plan documents, and (b) the citation re-verification the brief mandated (item 4), performed against the live repository **before** any of those citations were treated as fact. This file is authoritative where it conflicts with the plan docs.

---

## 1. Build-brief corrections applied (override the plan documents)

| # | Correction | Where it changes the build |
|---|---|---|
| C1 | `sessions` DDL: the `voter_nid_hash` CHECK must reference `voter_nid_hash`, not `nid_hash` (typo in `DATA_AND_API_MIGRATION.md` §1.1). | DDL now reads `CONSTRAINT ck_sessions_voter_nid_hash_hex CHECK (voter_nid_hash ~ '^[a-f0-9]{64}$')`. Fixed in the plan doc and in P1's schema append. |
| C2 | **Per-admin identity is OUT OF SCOPE this pass.** Every admin endpoint (including the new `PATCH /elections/:id/status`) keeps `x-admin-secret` + `timingSafeEqual`. `admin_actions.actor_admin_id` is populated with the static string `"shared-admin"`. | `admin_actions` ships as an **audit** table only (what/when/result), not an identity system. The optional `admin_users` table is **cancelled**. All "per-admin identity" wording in the plan docs is overridden. |
| C3 | **`tally_results` is dropped from the migration.** `GET /public/results` reads `tally_runs ORDER BY tallied_at DESC LIMIT 1` directly. **No cache-sync step is built.** If `tally_results` already exists in a live DB it is left in place and simply no longer read or written (same treatment as the legacy `key_shares.share_value` column). | `tally_runs` is the sole results store going forward; `POST /keyshares/tally` appends to it; `GET /public/results` queries it. |
| C4 | **Election-window build order:** `PATCH /elections/:id/status` + the `/vote` status gate + `election_status_events` ship **together in one phase (P3)**. The `/vote` gate must never land before the transition endpoint exists, or every election is stuck in `'setup'` with no way to open voting. | P3 is atomic; the roadmap's P1→P3 ordering reflects this and is now stated as a hard constraint. |

---

## 2. Citation re-verification (brief item 4) — method: direct reads + a fresh repo-wide grep, run before treating the citations as fact

### 2.1 `VotingPage.tsx:71-76` — **CONFIRMED**
Direct read of lines 62-90. Line 71 is exactly `const voterNid = state?.nid ?? "00000000000";`, and lines 74-76 are the constituency fallback. The U1 claim in `MOBILE_UX_ARCHITECTURE.md` §2.2 stands unchanged.

### 2.2 `VoterLogin.tsx:138-148` — **CONFIRMED** (end line off by one: the `<input>` element ends at 149)
Direct read of lines 104-163. `type="text"` confirmed; **no** `inputMode`, `pattern`, or `type="tel"`; `autoComplete="off"`; the validation hint is a separate `<p>` (lines 151-158) with no `aria-describedby`. U4 stands.

### 2.3 `VoterLogin.tsx:116` — **CITATION REAL, CLAIM WRONG → corrected**
Line 116 is `style={{ color: "#0A2540" }}` on the NID `<label>` — dark navy on a light card, i.e. **high** contrast (≈13:1), not a risk. `MOBILE_UX_ARCHITECTURE.md` §5's phrase "the web's inline hex colors in `VoterLogin.tsx:116` etc. are a contrast risk to audit" was an unsupported inference attached to a real line number.
**Corrected finding — the actual measurable contrast concerns in the same file (computed from the hex values via the WCAG relative-luminance formula; an estimate to be re-measured in the app):**
- `#627d98` muted text at `text-sm` (14px), e.g. line 80 — ≈ **3.9:1** on `#F2F5FA` → **fails WCAG AA (4.5:1)** for normal text.
- `#C8920A` amber validation hint at `text-xs` (12px), lines 152-155 — ≈ **2.5–2.8:1** → **fails clearly**.
Action: `MOBILE_UX_ARCHITECTURE.md` §5 wording corrected; these recorded as the a11y baseline for the mobile screens (DoD already requires ≥4.5:1).

### 2.4 `candidates.ts:48-73` and `:43-46` — **CONSISTENT with AUDIT.md; the brief's suspicion is NOT confirmed**
Full numbered read of `candidates.ts` (100 lines):
- `:24` = `router.get("/candidates", …)` (AUDIT §6's citation — correct)
- `:37-47` = header read → NID format check → `constituencyFromNid` (AUDIT §5's citation — correct)
- `:43-46` = the NID format check — a **sub-range of** `:37-47`, cited in Phase 4/5 for the validation step specifically
- `:48-73` = the deprecated `?constituency=` branch (the path Phase 5 removes)
No contradiction exists; the ranges cite different parts of the same file. **No correction needed.**

### 2.5 Repo-wide a11y grep (`role=` / `aria-*`) — **CONFIRMED EXACTLY**
Re-run over all `frontend/src/**/*.tsx` (22 files): `aria-` = **3**, `role=` = **0**, `htmlFor` = 16, `<label` = 24, `alt=` = 0, `<input` = 22. U5 stands unchanged.

### 2.6 Additional findings from the same pass (not requested; they change P0)

- **`AUDIT.md` §15.6/§16.1 are WRONG — a candidate-seeding script DOES exist.** `backend/src/scripts/seed-constituencies.ts` seeds the 8 constituencies **and then seeds candidates** (lines 91-137) from `frontend/public/candidates.json` — 48 candidates, 6 per constituency, `onConflict: "election_id,name,constituency_code"`. **Consequence: P0's "add `seed-candidates.ts`" task is CANCELLED** — a second script would duplicate an existing one and risk conflicting upserts. `vote.test.ts`'s "run seed-constituencies/seed-candidates first" is already satisfied.
- **`backend/.env.test.example` already exists** (untracked) and already lists every key the live suites need (`SUPABASE_URL`/`ANON`/`SERVICE_ROLE`, `NID_HASH_SALT`, `ELGAMAL_*`, `NULLIFIER_SECRET`, `KEYHOLDER_PASSPHRASE_SALT`, `ADMIN_SECRET`). P0's env scaffolding is therefore done; the only missing piece is the real `.env.test` (credentials — Open Question #11).
- **The fail-closed test-env guard already exists**: `backend/src/testUtils/testSupabaseEnv.ts` refuses to run without `.env.test` and refuses a `.env.test` whose `SUPABASE_URL` matches production. P0's guard requirement is met.
- **Likely origin of the mistaken "no candidate seed script" claim:** the repo's own `context.md:150` lists `seed-candidates.ts ← Seed candidates` in its script tree, although no such file exists. That pre-existing doc error is the plausible source of the Phase-1 mistake; `context.md` is **not** edited here (it is a tracked doc outside this brief) — logged as a residual doc inaccuracy to fix in P7's doc pass.

---

## 3. Doc patches applied (so the plan docs stop contradicting the build)

- `DATA_AND_API_MIGRATION.md` — §1.1 sessions CHECK fixed (C1); `admin_actions.actor_admin_id` comment → static `"shared-admin"` (C2); `tally_runs` is the sole store, `tally_results` no longer read/written (C3); endpoint rows for `POST /elections`, `POST /anchor/batch`, `POST /keyshares/tally` now say "shared secret (unchanged) + `admin_actions` audit"; `admin_users` removed; banner pointing here.
- `ROADMAP_RISKS_DOD.md` — P0 task list corrected (candidate-seed task cancelled; env/guard already exist); P1 `admin_actions` scope = audit only; P3 states the atomic-ship constraint (C4) and `x-admin-secret` for the PATCH; R9 re-scoped to "audit rows for shared-secret admin".
- `THREAT_MODEL_AND_SECURITY.md` — T19 row and §3.T19: control is "append-only `tally_runs`; legacy `tally_results` no longer read or written".
- `VERIFICATION_AND_TESTING.md` — A-8 expected-DB-state wording updated to `tally_runs`-only.
- `MOBILE_UX_ARCHITECTURE.md` — §5 contrast wording corrected per §2.3.
- `AUDIT.md` — annotated correction appended (§17) for the candidate-seed claim, preserving the Phase-1 record rather than silently rewriting it.
- `MIGRATION_PLAN.md` — executive-summary/§5 wording aligned; pointer to this file added.

---

## 4. P0 — scope revision & execution log

| P0 task (as originally written) | Status |
|---|---|
| Dedicated Supabase test project + real `backend/.env.test` | **BLOCKED — needs credentials** (Open Question #11). Template + fail-closed loader already existed. |
| Add `backend/src/scripts/seed-candidates.ts` | **CANCELLED** — `seed-constituencies.ts:91-137` already seeds candidates (48 rows, full CON-01..08 coverage). |
| Unskip the 3 integrity-critical tests | **DONE** — `vote.test.ts` N=50; `integrity.test.ts` Category 1 (DELETE) and Category 3 (duplicate nullifier). Zero `it.skip` remains anywhere in `backend/src/**/*.test.ts` (verified by grep). |
| Gated CI job for the live-DB suites | **DONE** — new `live-integrity` job in `.github/workflows/ci.yml`, `workflow_dispatch` only, writes `.env.test` from `TEST_*` secrets and fails the job if `TEST_SUPABASE_URL` is unset; uploads `testing/*.json` evidence. |
| Regenerate `testing/concurrency_stress_output.json` | **BLOCKED** — requires a live run against the test DB (the test now rewrites it on every run). |

### P0 execution log (this pass)

1. **Additional safety defect found and fixed (not in the original P0 list).** `backend/src/db/integrity.test.ts` loaded its environment by checking for `.env.test` and **falling back to `backend/.env` (production)** — the exact silent-fallback pattern `testUtils/testSupabaseEnv.ts` was written to prevent (and which its own comment wrongly claimed to share). This was only survivable while its destructive tests were skipped. Fix: the file now calls `loadTestSupabaseEnv()` (unused `dotenv`/`path`/`fs` imports removed).
2. Three `it.skip` → `it` conversions with comments updated to state the new precondition (dedicated test project enforced by the loader); stale "no separate test DB yet" comments replaced.
3. **Verification run:** `npx tsc --noEmit` → exit 0; `npm run test:ci` (the PR-gating fast suite) → **4 files / 47 tests passed**; `npx vitest run src/db/integrity.test.ts` without `.env.test` → **exit 1** with `FATAL: backend/.env.test is required for tests that write to Supabase, and it does not exist … Refusing to fall back to backend/.env (production)` — i.e. fail-closed proven, no production write path.
4. **Not affected:** the `test:ci` subset and all pure-logic suites are unchanged; no runtime (non-test) code was modified in P0.

---

## 5. P1 progress log

**P1 part 1 — schema append (`schema.sql`). Status: DONE, UNEXECUTED.**

`backend/src/schema.sql` grew by 268 lines (1327 → 1595) with one idempotent, append-only migration section:

| Object | Purpose (trace) |
|---|---|
| `sessions` + `fn_sessions_guard` / `fn_sessions_no_delete` + 3 indexes + RLS | Session layer (D1/T15). C1 CHECK fixed: `ck_sessions_voter_nid_hash_hex CHECK (voter_nid_hash ~ …)`. Only `expires_at` / `last_seen_at` / `revoked_at` may change; delete is blocked (revoke instead). |
| `admin_actions` + no-update / no-delete guards + 2 indexes + RLS | Append-only admin audit (T4/T16). C2: `actor_admin_id` defaults to the static `'shared-admin'`. |
| `tally_runs` + no-update / no-delete guards + `idx_tally_runs_latest` + RLS | Append-only tally history and **sole** results store (T19/C3); `UNIQUE (election_id, batch_id, tallied_at)`. The index is **`(election_id, tallied_at DESC)`** — election-scoped, NOT `tallied_at` alone — and serves `WHERE election_id = $1 ORDER BY tallied_at DESC LIMIT 1`. |
| `election_status_events` + no-update / no-delete guards + index + RLS | Open/close transition audit (T13/B2), with the C4 atomic-ship note in its header. |
| `fn_votes_immutable_guard()` (CREATE OR REPLACE) | Extended to also block `zkp_proof` edits (B6). The existing `trg_votes_immutable` already points at this function, so no trigger change was needed. |

**Verification performed:** `$$` bodies balanced (44 markers = 22 functions); all four `CREATE TABLE IF NOT EXISTS`, all nine `CREATE OR REPLACE FUNCTION` and all eight `CREATE TRIGGER` statements present; the C1 CHECK references `voter_nid_hash`; the `"zkp_proof is immutable after insertion"` clause exists exactly once.
**Verification NOT possible yet:** the DDL has **not been applied to any database**. Applying it needs the Supabase SQL Editor (repo convention for existing DBs) or `run-schema.ts` (fresh DB), both of which need credentials. **No database state was changed by this work.**

**P1 part 2 — hardening layer + C3 route migration. Status: DONE for code,
typecheck and unit tests; the DDL and route changes still have not executed
against a real database (blocked on Open Question #11 — no `.env.test`).**

New middleware in `backend/src/middleware/`:

- **`errorEnvelope.ts`** — the stable `{ error, code, retryable }` envelope plus
  `mapCastVoteError()`. `error` is byte-identical to what the route said before,
  so the change is *purely additive* for the web client: the mobile app can branch
  on `code`, and nothing that reads `error` breaks.
- **`rateLimit.ts`** — dependency-free fixed-window limiter (T10).
- **`captcha.ts`** — inert unless `CAPTCHA_SECRET` is set (T10).
- **`tamperDemo.ts`** — 404 unless `ENABLE_TAMPER_DEMO=1` (T4).

Wiring: `POST /voter/register` = 10/min **and** the CAPTCHA gate;
`POST /voter/check-nullifier` = 60/min (it is inherently an enumeration oracle);
`POST /vote` = 30/min; the four `anchor/tamper|restore` routes gated; `index.ts`
prints a **startup posture report** for both optional gates; `.env.example`
documents both variables; `test:ci` now runs `src/middleware/middleware.test.ts`.

C3 completion in the same commit: `POST /keyshares/tally` appends to
`tally_runs`, and `GET /public/results` reads the latest `tally_runs` row
(`tallied_at DESC`, backed by the already-correct `idx_tally_runs_latest`).
`tally_results` is no longer written or read anywhere.

Decisions worth keeping:

1. **No new npm dependency.** `express-rate-limit` would add an install step and
   lockfile churn to the backend for one primitive; the limiter here is ~60 lines
   with an opportunistic sweep so distinct client keys cannot grow the map
   unboundedly. Its **single-instance assumption is stated in the file**, not
   hidden, and is carried as risk R10 — a scaled deployment needs a shared store.
2. **Gates that are off must say so.** An inert gate that looks active is worse
   than no gate, so startup logs the state of both optional gates.
3. **`ENABLE_TAMPER_DEMO` fails safe:** only exactly `"1"` enables it, so a typo
   (`true`, `yes`, `0`, empty) can never expose the route that deletes votes.
4. **`vote.ts`'s cast-vote mapping is now code-first** (P0002/P0003/P0004/23505)
   with the message substring retained only as a fallback. Deliberate tightening:
   a bare `"already"` no longer means "duplicate vote" — `"relation already
   exists"` used to be reported to a voter as "You have already voted" (409).
5. **`sendEmail`-style silent no-ops were avoided**: the CAPTCHA provider being
   unreachable returns `503 UPSTREAM_UNAVAILABLE` (retryable) rather than
   pretending the request was fraudulent.
6. **Three plan docs claimed `express-rate-limit`; the code does not use it.**
   Corrected rather than left to drift: `METHODOLOGY_CLASSIFICATION.md` (B4),
   `THREAT_MODEL_AND_SECURITY.md` (T10 control) and `ROADMAP_RISKS_DOD.md` (P1
   tasks) now describe the dependency-free limiter that actually exists. The
   per-NID tier those docs also promised is explicitly **deferred**, with the
   reason stated: the nullifier is derived *inside* the route, so a middleware
   key would either hold raw NIDs in process memory or duplicate identity
   derivation.

Evidence:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run test:ci` | 5 files / **63 tests passed** (was 47 before; +16 new) |
| No whole-body assertions to break | grep confirmed `vote.test.ts` asserts only on `status` and on `body.error` via `.toMatch(...)` — never `toEqual` on a body |
| Not yet evidenced | the P1 DDL and the route/middleware changes have never run against live Supabase → no `concurrency_stress_output.json` regeneration, no request through the limiter/gate in a running server |

**Deliberately not done in P1 (carried, not silently dropped):**
`express.json()` still has **no** body-size limit; the limits cover
`/voter/register`, `/voter/check-nullifier` and `/vote` only — public GETs,
`/keyshares/submit` and `/keyholder/request` remain unthrottled; and the windows
are fixed, not the progressive-backoff tiers the source roadmap asks for.
`FUTURE_WORK.md` §6.1 reads "`express-rate-limit` *(or equivalent)*, per-route",
so the limiter above satisfies that item **in substance**; the sub-items just
listed are what remains, and the duplicated `FUTURE_WORK`/`FUTURE_IMPLEMENTATION`
pair is still Open Question #10 (untouched here on purpose).

A defect caught only by running the suite, recorded so it is not repeated: the
first draft of the test helper `withEnv()` was not `async`, so its `finally`
restored the environment variable *before* the awaited test body had finished —
which silently disabled the CAPTCHA gate halfway through a test and made it
report a pass-through that never happened. Fixed by awaiting the body.
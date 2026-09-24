# HANDOFF — mobile migration (E2E-verifiable e-voting simulation)

**Written:** 2026-09-24 · **Author:** previous agent session (P0 → P2 + P4)
**Purpose:** let a fresh agent continue **P3** without re-deriving anything.

This file deliberately does **not** restate phase specs, acceptance criteria or
architecture rationale — those already exist and are authoritative. It records
*state*, *evidence*, *how to verify*, *traps*, and *the P3 plan*.

## 0. Read these first (do not duplicate them)

| Artifact | What it holds |
|---|---|
| `BUILD_NOTES.md` | Progress logs §5 (P1), §6 (P4, on the other branch), §7 (P2 + the decision-A record). **Start here.** |
| `ROADMAP_RISKS_DOD.md` | Phase specs P0–P7, DoD per phase, risks R1–R14, `Status (P2): DONE` line |
| `MIGRATION_PLAN.md` | Doc index, build-brief overrides C1–C4, phase table |
| `THREAT_MODEL_AND_SECURITY.md` | T1–T21, §4.1 session/token design, §4.T10/T13 controls |
| `DATA_AND_API_MIGRATION.md` | Per-endpoint migration table, `sessions`/`election_status_events` DDL, new endpoints |
| `AUDIT.md` | Pre-migration audit (findings carry "as audited" notes where P1 superseded them) |
| `VERIFICATION_AND_TESTING.md`, `MOBILE_UX_ARCHITECTURE.md`, `METHODOLOGY_CLASSIFICATION.md` | Test strategy, screens S0–S7, B1–B8 backlog items |

## 1. Git state (verified, nothing pushed)

```
dev                          48b2f18   (== origin/dev, untouched by this work)
feature/mobile-migration-p0  c5fea40   ← thread A, checkout & continue here
feature/core-crypto          32b3257   ← thread B (P4, complete)
```

Thread A (`feature/mobile-migration-p0`), newest first:

| Commit | Content |
|---|---|
| `c5fea40` | P2 decision A — session captures the ballot nullifier; `/vote` needs no NID |
| `d7a5e24` | P2 — session API (hash-only tokens, device binding, revocation) |
| `c0ed816` | docs — align P1 claims with the code (dependency-free limiter) |
| `3b45234` | P1 part 2 — error envelope, rate limits, CAPTCHA hook, tamper-demo gate, C3 routes |
| `e33e152` | docs — name the `tally_runs` index columns |
| `e6305f5` | P1 part 1 — `sessions`/`admin_actions`/`tally_runs`/`election_status_events` + `zkp_proof` guard |
| `98d6385` | P0 — fail-closed test env, unskipped integrity suites, migration plan |

Thread B (`feature/core-crypto`): `c9e0249` (P4 port), `43d3976` (npm workspace),
`32b3257` (P4 log). **Both threads branch from `e6305f5`.**

`git stash list` holds one **unrelated** older entry from
`feature/task8a-elgamal-property-tests` — leave it alone.

**Merge note:** `BUILD_NOTES.md` is edited on both threads (§5/§7 vs §6) — expect
a small conflict there whenever they merge.

## 2. Done, with the evidence that proves it

| Phase | State | Evidence (all re-runnable) |
|---|---|---|
| **P0** | ✅ | `test:ci` includes the 3 formerly-skipped integrity tests; `integrity.test.ts` no longer falls back to production `.env` (a real safety bug); `live-integrity` CI job is gated |
| **P1** | ✅ code, ⚠️ DDL unexecuted | `tsc --noEmit` exit 0; `test:ci` 5 files/63 tests at the time; wiring greps (3 `rateLimit({`, 5 `requireTamperDemo`, 7 `sendError(` in `vote.ts`) |
| **P2** | ✅ | `tsc --noEmit` exit 0; `test:ci` **7 files / 104 tests**; the A1 equality is asserted in `services/castIdentity.test.ts` |
| **P4** | ✅ (thread B) | 13/13 in-repo **and** in a fresh clone; `npm ci` 48 pkgs in the clone; backend `npm ci` still green (195 pkgs) |
| **P3, P5, P6, P7** | ❌ not started | — |

**Run these before claiming anything:**

```powershell
cd backend; npx tsc --noEmit          # must be exit 0
cd backend; npm run test:ci           # 104 tests, no DB needed
# P4 only (needs a root install):
npm ci; npm test --workspace=packages/core-crypto
```

**What is NOT proven anywhere:** every P1/P2 DDL statement and every new route
has **never run against a live database** — Open Question #11 (no
`backend/.env.test`). The session lifecycle is proven against an in-memory port
(`src/testUtils/fakeSessionRepo.ts`), the A1 equality against pure helpers.
`concurrency_stress_output.json` therefore still reflects the pre-P2 code.

## 3. How this work is done (preserve these conventions)

These are not style preferences — each exists because breaking it caused a real
defect here, and reviewers check for them.

1. **Every claim maps to a command + output.** Docs carry an *Evidence* table and
   an explicit *"Not yet evidenced"* line. If you cannot run it, say so.
2. **Response changes are additive.** The error envelope ADDS `code`/`retryable`
   and keeps `error` byte-identical. That is safe only because a grep proved no
   test asserts a whole response body — re-verify that before widening it.
3. **Never import `supabaseClient` into a module a test imports.** It calls
   `process.exit(1)` when credentials are missing, which kills the vitest
   process. Use an injected port (`SessionRepo`, `CastIdentityDeps`) and build the
   Supabase implementation at the route (composition root).
4. **No new npm dependency without a decision.** P1's limiter is ~60 lines of
   local code; P4 added a real workspace rather than a machine-local junction.
5. **Fail loud, fail closed.** An inert gate announces itself at startup
   (CAPTCHA). An unconfigured demo route answers 404, not 403. A store outage is
   a retryable `503`, not a `401`. `ENABLE_TAMPER_DEMO` needs exactly `"1"`.
6. **When code changes, the doc claim changes in the same commit.** Happened three
   times: `express-rate-limit` (P1), `AUDIT.md` forward pointers, decision A's
   unlinkability claim (P2).
7. **Encode un-runnable DB contracts as runnable assertions.**
   `fakeSessionRepo` records UPDATE field names so `fn_sessions_guard`
   compatibility fails in CI rather than on the first live request.
8. **Check the branch before editing.** Work was lost twice to editing the *other*
   thread's files (git silently created a stub instead of editing). Run
   `git rev-parse --abbrev-ref HEAD` first; the two feature branches share every
   doc file.
9. **Windows shell quirks:** use `$LASTEXITCODE` (not `$?`); a long vitest run
   makes the tool return partial output, so redirect (`*> file.txt`) and read the
   file afterwards.

## 4. What is left: 4 phases — P3, P5, P6, P7

"How many P3's are left" reads two ways, so both answers:

- **Phases remaining: 4.** `P3` (next) → `P5` → `P6` → `P7`.
- **P3 itself: 3 parts**, and per **BUILD-BRIEF C4 they ship atomically in one
  commit** — the transition endpoint, the `/vote` gate, and the status-event
  audit. Shipping the gate first would strand every election in `'setup'` with no
  way to open voting.

Dependencies for the rest: **P5 cannot reach staging without P3** (window gate)
and P2 (sessions, ✅ done). **P7 requires P0 + P3 + P6.** P6 needs P5. So **P3 is
the only unblocked phase**, and it is pure backend — no device or emulator.

## 5. P3 — how it will be addressed

**Objective (roadmap):** make open/closed real, and make admin actions
attributable. **Exit criteria:** `/vote` rejects outside `voting`; every
transition and admin op produces exactly one audit row; `GET /elections` reflects
server truth.

### 5.1 Deliverables — ONE commit (C4)

1. **`PATCH /elections/:id/status`** in `routes/elections.ts`, guarded by the
   existing `requireAdminSecret` (C2: per-admin identity stays out of scope, actor
   is the static `"shared-admin"`). Body `{status}` validated against
   `setup|voting|tallying|closed`; **forward-only single-step** transitions, with
   **`closed→closed` idempotent → 200** (an explicitly required test). Writes, in
   this order: `elections.status` → `election_status_events`
   (`from_status`, `to_status`, `changed_by='shared-admin'`) → exactly one
   `admin_actions` row.
2. **`/vote` window gate** — reject `status !== 'voting'` with **403
   `ELECTION_NOT_OPEN`**. Placement is a decision to document, not an accident:
   immediately after the election-existence check (404) and identity resolution,
   and **before** the setup-commitment (412) and key-not-ready (503) checks —
   "this election is not accepting votes" outranks "its setup is incomplete". Do
   not let it land after the nullifier check.
3. **`availability` on `GET /elections`** (and `/elections/:id`) — a computed,
   server-truth field for the mobile Election Hub, so the hub can never advertise
   an election that is not accepting votes.
4. **Audit wiring** into `POST /elections`, `POST /anchor/batch`,
   `POST /keyshares/tally` and the new PATCH, through a **single write point**
   (`services/adminAudit.ts` → `recordAdminAction({action, electionId,
   requestSummary, httpStatus})`). Risk **R9** is precisely "an admin path
   bypassing audit", and its stated test is a route-registry check that every
   `requireAdminSecret` route also audits — implement that as a source/stack test
   so a future route that forgets fails CI.

### 5.2 Tests — all in `test:ci`, no database

- Pure transition validator: the legal chain, illegal jumps, `closed→closed`
  idempotence, unknown status.
- Pure `availability` computation plus one shared `isAcceptingVotes(status)`
  predicate used by **both** the gate and the hub field — the gate and the
  advertised availability must not be able to disagree.
- `recordAdminAction`: correct shape, and a decision (recorded, not implied) on
  whether a failed audit write logs-and-continues or fails the request.
- The R9 route-registry test.
- **Live tests, blocked on Open Question #11:** PATCH produces audit rows;
  `/vote` outside the window → 403; a second `closed→closed` returns 200 with no
  second event row; `concurrency_stress_output.json` regenerated.

### 5.3 Pre-checks to do BEFORE writing code (I did not verify these)

- **Does `services/electionContext.ts` cache election rows?** If it does, the gate
  may read a stale `status` — the window would then be quietly wrong. Read it
  first; if cached, the status read needs a bypass or an invalidation hook.
- Confirm `elections.status`'s CHECK constraint values (schema.sql ~L925) match the
  zod enum exactly; a mismatch turns a legal transition into a 500.
- `admin_actions.election_id` is `NOT NULL REFERENCES elections`, so the audit
  write for `POST /elections` must happen **after** the row exists.
- `frontend/src/pages/AdminDashboard.tsx` is in P3's affected files — the web
  admin needs a control for PATCH (Open Question #9 governs the web's wider fate,
  not this button).
- `election_status_events` (schema.sql ~L1513): `from_status`/`to_status` are
  CHECK-constrained and the table is already append-only via P1 triggers.

### 5.4 Evidence P3 must produce

`npx tsc --noEmit` exit 0; `npm run test:ci` green with the new count stated;
greps proving the wiring (audit call sites, gate presence); plus an explicit
"not evidenced" list naming `.env.test` as the blocker — same format as
`BUILD_NOTES.md` §5 and §7.

## 6. Open items that shape the work

| # | Item | Effect |
|---|---|---|
| **#11** | **No test-DB credentials** (`backend/.env.test`) | Blocks: running the P1/P2 DDL, any HTTP-level evidence, regenerating `concurrency_stress_output.json`. **Supplying `.env.test` is the single highest-value unblock** — it converts much of P1/P2/P3's evidence from inference to observation. `.env.test.example` and the fail-closed loader already exist. |
| #9 | Fate of the web page | Determines when the legacy `nid` field can leave `/vote` and whether the SPA moves to sessions (compat path currently kept on purpose) |
| #7–#8, #10 | Authoritative eligibility, per-admin identity, duplicate `FUTURE_WORK`/`FUTURE_IMPLEMENTATION` pair | Already scoped out in C1–C4; do not silently re-open them. Per-admin identity (B5) is **out of scope** this pass. |
| R11 | Rate limits vs. deadline voters | Tiers chosen for a demo; revisit before any real load test |

Report the P2 decision record too: **decision A** was the user's call
(`sessions.nullifier_hash` capture) and its accepted cost — a database-only reader
can link voter→session→vote — is written into `DATA_AND_API_MIGRATION.md` and
`THREAT_MODEL_AND_SECURITY.md`. Do not "fix" that by reverting the capture without
re-reading `BUILD_NOTES.md` §7: without it, `/vote` cannot derive a nullifier and
A1 would break under mixed web/mobile voting.

## 7. Commands cheat sheet

```powershell
# backend (no DB needed)
cd backend; npx tsc --noEmit
cd backend; npm run test:ci                       # 7 files / 104 tests today
cd backend; npx vitest run src/services/castIdentity.test.ts   # targeted

# P4 (thread B) — needs the root workspace install
npm ci
npm test --workspace=packages/core-crypto

# git hygiene
git rev-parse --abbrev-ref HEAD                   # ALWAYS before editing
git --no-pager log --oneline dev..HEAD
```

## 8. Suggested skills for the next agent

Call the Skill tool for: **`tdd`** (P3's pure validators are ideal first tests —
transition legality, `availability`, `isAcceptingVotes`), **`code-review`** before
committing the P3 trio, **`git-guardrails-claude-code`** if you need branch/commit
protection, and **`handoff`** again when you stop. If you instead pick up the
mobile chain (P5), add **`react-native-best-practices`** and **`pick-ui-library`**.

## 9. Definition of done for the next session (P3)

1. All four deliverables of §5.1 in **one** commit on
   `feature/mobile-migration-p0` (never split the trio — C4).
2. The tests in §5.2 exist and run in `test:ci`; `tsc --noEmit` exit 0.
3. Docs updated in the same commit: `BUILD_NOTES.md` §8 (P3 log, with evidence and
   a "not evidenced" line), `ROADMAP_RISKS_DOD.md` P3 status, and any doc claim
   that P3's code makes stale.
4. Working tree clean; nothing pushed unless asked; report the exact test count and
   the commit hash.

## 10. Kickoff prompt for the next agent (paste as-is)

```
Repo: d:\Coding\evoting-simulation (Windows, PowerShell). You are continuing a
7-phase migration of a web e-voting simulation to a React Native/Expo client.
P0, P1, P2 and P4 are done. YOUR TASK IS P3.

Do this first, in order — do not skip step 3:
 1. `git rev-parse --abbrev-ref HEAD` must be `feature/mobile-migration-p0`, and
    `git merge-base --is-ancestor 1cbad76 HEAD` must succeed (that is the handoff
    commit; later commits on this branch are fine). `dev` is untouched, nothing is
    pushed, leave the older unrelated stash alone.
 2. Read HANDOFF.md: §0 (which doc holds what), §1 (git state), §3 (conventions),
    §5 (the P3 plan, with the pre-checks I did NOT verify), §6 (open questions),
    §9 (definition of done).
 3. PROVE THE BASELINE before changing anything:
    cd backend; npx tsc --noEmit      -> expect exit 0
    cd backend; npm run test:ci       -> expect 7 files / 104 tests
    If that does not match HANDOFF.md, stop and report: the tree is not what the
    handoff describes.
 4. Read BUILD_NOTES.md §7 (P2 + the "decision A" record) so you do not undo the
    nullifier capture — reverting it breaks A1 under mixed web/mobile voting.

SCOPE: P3 only. Per BUILD-BRIEF C4 its three parts ship in ONE commit:
 (a) PATCH /elections/:id/status writing elections.status +
     election_status_events + exactly one admin_actions row;
 (b) the /vote gate answering 403 ELECTION_NOT_OPEN outside 'voting'
     (placement matters — see HANDOFF.md §5.1 item 2);
 (c) audit wiring for the admin routes through a single write point
     (R9's route-registry test is required).
Do NOT start P5–P7. Do NOT re-open build-brief overrides C1–C4.

NON-NEGOTIABLE CONVENTIONS (each exists because breaking it caused a defect):
 - response changes are additive only: `error` stays byte-identical, add
   `code`/`retryable`;
 - never import supabaseClient into a module a test imports (it process.exit(1)s
   without credentials and kills vitest) — inject a port;
 - no new npm dependency without asking the user;
 - every claim must map to a command + output, and state what stays unevidenced;
 - update docs in the SAME commit as the code, including any claim your change
   makes false;
 - do not push; do not touch the stash.

ASK THE USER (never decide silently) if you hit: a product-scoped choice
(per-admin identity, the web page's fate, authoritative eligibility), or whether
to stop and unblock the test database first — supplying backend/.env.test turns
most of P1/P2/P3's evidence from inference into observation.

Suggested skills: `tdd` (write the transition + `isAcceptingVotes`/`availability`
predicates first), `code-review` before committing, `handoff` when you stop.
```

Nothing else needs to travel with it: every document referenced above is
committed on the branch.



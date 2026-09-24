# Serial team assignments — mobile migration

This plan assigns work to Humaira, Shahi, Urmi, and Nabiha when only one person
can modify the repository at a time. Work proceeds in the order below. Each
person starts from the previous person's merged `dev` commit, so there are no
parallel branches to reconcile.

## Queue

| Order | Owner | Assignment | Branch | Start gate |
|---:|---|---|---|---|
| 1 | **Humaira** | Mobile UI architecture, complete screen states, accessibility | `feature/mobile-ui-humaira` | Ready now |
| 2 | **Shahi** | API/session integration and client contract hardening | `feature/mobile-integration-shahi` | Humaira merged into `dev` |
| 3 | **Urmi** | Detox automation, offline matrix, secure-storage/device QA | `feature/mobile-e2e-urmi` | Shahi merged into `dev` |
| 4 | **Nabiha** | Staging rehearsal, hostile-client evidence, release/cutover report | `feature/mobile-release-nabiha` | Urmi merged and staging prerequisites available |

Only the active owner changes repository files. The next owner begins after the
previous branch is reviewed and merged into `dev`.

## Shared start and handoff protocol

Every owner reads `MOBILE_AGENT_HANDOFF.md` first and follows its baseline,
security, evidence, and completion rules. Task-specific documents are listed
inside each assignment below.

Start a turn:

```powershell
git switch dev
git pull --ff-only origin dev
git status --short
git switch -c <assigned-branch>
```

Finish a turn:

1. Run the assignment's acceptance commands and `git diff --check`.
2. Update `BUILD_NOTES.md` with commands, observed results, and explicit
   blockers. Evidence means observed output, not an expected result.
3. Commit the code, tests, and changed documentation together.
4. Open one focused PR into `dev`; stop after handoff. The next owner waits for
   that PR to merge.

Each handoff comment uses this format:

```text
Owner:
Branch and commit:
Delivered:
Files changed:
Commands and observed results:
Pending or blocked:
Safe starting point for next owner:
```

Keep the existing unrelated stash untouched. `main` is updated only after all
four assignments are complete and the project owner approves the release merge.

---

## 1. Humaira — mobile UI architecture and accessibility

### Objective

Turn the existing single-file Expo shell into a maintainable voter app while
preserving the implemented API and cryptographic behavior. This assignment is
independent: it requires no database credentials, staging service, backend
change, or emulator evidence.

### Read before editing

- `MOBILE_AGENT_HANDOFF.md`
- `MOBILE_UX_ARCHITECTURE.md` §3–§5
- `packages/mobile-app/App.tsx`
- `packages/mobile-app/src/secureSessionStore.ts`

### Owned files

- `packages/mobile-app/App.tsx`
- New files under `packages/mobile-app/src/screens/`
- New files under `packages/mobile-app/src/components/`
- New files under `packages/mobile-app/src/state/` or `src/theme/`
- `packages/mobile-app/package.json` and `app.json` only when required by this
  UI refactor

Humaira does not change backend routes, `core-api` contracts, or `core-crypto`.
Any discovered contract gap goes into the handoff for Shahi.

### Deliverables

- Extract Election Hub, Authenticate, Voter status, Ballot, Cast-or-audit,
  Confirm, Receipt, Verify, Watchdog, Results, and Settings into clear screen
  components.
- Put journey transitions and shared state in one explicit state/controller
  seam instead of distributing transitions across screen components.
- Preserve real API calls, real `vote_id` receipts, fresh encryption after an
  audit, secure storage, and the existing offline fail-closed behavior.
- Complete loading, empty, validation, API-error, retry, election-closed,
  already-voted, and verification-pending presentation states.
- Add accessible names and state to interactive controls; ensure errors and
  status changes are announced; support font scaling and at least 44×44 touch
  targets; use color-independent selected/error states.
- Keep any preview fixture or sample data test-only. The production bundle has
  no mock-success path.
- Record screenshots or a short screen inventory only if they were actually
  produced; screenshots are useful review material, not proof of server flow.

### Acceptance

```powershell
npm run typecheck --workspace=@evoting/mobile-app
npm test --workspace=@evoting/core-api
npm test --workspace=@evoting/core-crypto

Push-Location packages/mobile-app
npx expo export --platform android
Pop-Location

git diff --check
```

Done means every existing mobile screen and state still has a reachable path,
the commands above pass, Android export succeeds, and no backend/core contract
file changed. Humaira's handoff lists every contract or device-test need for
Shahi and Urmi.

---

## 2. Shahi — API/session integration hardening

### Start gate

Humaira's PR is merged into `dev`. Start from that updated branch and preserve
her component boundaries; this task owns behavior behind the screens, not a UI
redesign.

### Read before editing

- `MOBILE_AGENT_HANDOFF.md`
- Humaira's handoff comment
- `DATA_AND_API_MIGRATION.md`
- `THREAT_MODEL_AND_SECURITY.md` §4
- `packages/core-api/README.md`

### Owned files

- `packages/core-api/**`
- Integration/controller modules under `packages/mobile-app/src/`
- `backend/**` only when a failing contract test demonstrates a real server gap

### Deliverables

- Cover every mobile-used API method with request/response contract tests,
  including authentication headers, election scoping, and stable error mapping.
- Verify the mobile `/vote` request contains no NID and only reaches Receipt
  after the real successful response.
- Centralize handling for session expiry, revocation, device mismatch,
  election closure, duplicate vote, rate limit, retryable outage, and unknown
  server errors.
- Complete session refresh/revoke/revoke-all behavior and ensure local secure
  session state clears on successful sign-out.
- Preserve HTTPS-only release configuration and no-log guarantees for NIDs,
  tokens, ciphertext/proofs, and raw server payloads.
- Convert Humaira's recorded contract gaps into tests before implementation.
  A backend change includes a regression test and additive response behavior.

### Acceptance

```powershell
Push-Location backend
npx tsc --noEmit
npm run test:ci
Pop-Location

npm test --workspace=@evoting/core-api
npm run typecheck --workspace=@evoting/core-api
npm test --workspace=@evoting/core-crypto
npm run typecheck --workspace=@evoting/mobile-app

Push-Location packages/mobile-app
npx expo export --platform android
Pop-Location

git diff --check
```

Done means every client behavior changed by this task has a passing contract
test, backend regression tests remain green, no sensitive value is logged, and
Urmi receives a stable flow plus the exact test accounts/configuration still
needed for device automation.

---

## 3. Urmi — automated mobile QA and device security

### Start gate

Shahi's PR is merged into `dev`, the API contract is stable, and test-only
credentials/configuration are available where a live flow is expected.

### Read before editing

- `MOBILE_AGENT_HANDOFF.md`
- Shahi's handoff comment
- `VERIFICATION_AND_TESTING.md` §3.4 and §4.1
- `testing/P7_REHEARSAL_RUNBOOK.md`

### Owned files

- Detox configuration and E2E tests under `packages/mobile-app/`
- Test-only mobile configuration and fixtures
- `testing/offline_matrix_output.json` and session/device evidence artifacts
- Minimal `testID`/accessibility hooks in mobile components when automation
  requires them

Urmi avoids product redesign and API changes. A discovered defect is fixed only
with a reproducing test; larger defects return to the responsible owner through
the handoff.

### Deliverables

- Configure repeatable Detox builds/runs for Android and iOS, with test-only
  environment injection and no committed credentials.
- Automate the happy path: election → authentication → ballot audit → fresh
  cast → real receipt → verification → Watchdog/Results.
- Automate duplicate-vote, revoked-session, election-close-window, and offline
  interruption at every mutating step.
- Assert that offline or failed requests never reach a recorded-vote screen.
- Verify on device/emulator that sign-out clears the secure session and clearing
  app data creates a new device ID that requires authentication.
- Capture exact platform/build versions, commands, pass/fail counts, and
  blockers. An unavailable iOS host is recorded as pending, not passed.

### Acceptance

- Detox scenarios are deterministic and runnable from documented commands.
- Android and iOS results are recorded separately.
- `testing/offline_matrix_output.json` reflects the executed matrix.
- Mobile typecheck, core-api/core-crypto tests, Android export, and
  `git diff --check` remain green.
- Every skip has a named external blocker; integrity-critical failures are not
  converted into skips.

Done means Nabiha receives runnable E2E commands, test identities/configuration,
the observed matrix, and a precise list of remaining staging-only checks.

---

## 4. Nabiha — staging rehearsal and release evidence

### Start gate

Urmi's PR is merged into `dev`. The project owner supplies a dedicated test DB,
HTTPS staging API, test-chain configuration, and the permitted emulator/device
access. Production credentials are never used for this rehearsal.

### Read before editing

- `MOBILE_AGENT_HANDOFF.md`
- Urmi's handoff comment
- `VERIFICATION_AND_TESTING.md` §4–§5
- `testing/P7_REHEARSAL_RUNBOOK.md`
- `ROADMAP_RISKS_DOD.md` P5–P7

### Owned files

- `testing/**` evidence artifacts
- `docs/evidence/**` mobile verifier/rehearsal artifacts
- `BUILD_NOTES.md`, `ROADMAP_RISKS_DOD.md`, `README.md`, and `context.md`
- Release configuration only when a rehearsal exposes a configuration defect

### Deliverables

- Apply/verify the schema on the dedicated test DB and record the environment
  identity without recording secrets.
- Run the complete staging cycle: register/authenticate → mobile cast → anchor
  → dense and SMT verify → tally → Results.
- Run `testing/hostile_client.mjs`; confirm every forged, omitted, unauthorized,
  or replayed attempt is rejected and the public vote-count delta is zero.
- Execute the isolated tamper scenario and confirm the voter-facing Verify flow
  reports the mismatch.
- Re-run Urmi's mobile matrix against staging on both available platforms.
- Archive commands and raw observed output in the documented evidence paths.
- Produce a release-readiness summary: passed, failed, blocked, and rollback
  conditions. Recommend the web-voter cutover outcome; the project owner makes
  the deletion/retention decision.

### Acceptance

- The P7 runbook is green end-to-end or each unmet step has a concrete blocker.
- Hostile-client output shows only expected rejection statuses and zero DB
  effect as measured by the vote count.
- Receipt verification and tamper detection are voter-visible on the mobile
  client.
- Documentation claims match archived evidence; P5–P7 status is updated only
  to the level actually observed.
- Full local/CI gates and `git diff --check` pass before the PR.

Done means the owner can make a release/cutover decision from reproducible
evidence without relying on verbal claims.

---

## Out of scope for this queue

`FUTURE_IMPLEMENTATION.md` also proposes face liveness, biometric/device
attestation, push notifications, a keyholder companion app, WebAuthn, and wider
portal work. Those require separate product and threat-model decisions. None is
silently added to these four assignments.

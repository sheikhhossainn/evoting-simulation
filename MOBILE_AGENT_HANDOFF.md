# Mobile client handoff

Use this as the single entry point for React Native/Expo work in this
repository. It supersedes the phase status and git state in `HANDOFF.md`, which
is retained as historical P0–P3 context.

## Mission

Continue the voter-facing Expo client from the merged migration base. P0–P4
and the local P5/P6 implementation are already merged. The default objective is
to finish mobile quality and produce truthful device/staging evidence for P5–P7,
not to rebuild completed backend or crypto work.

The integration base is commit `6660c0f` on `dev`. Later commits are expected;
verify ancestry instead of expecting an exact HEAD.

## 1. Prove the starting state

From the repository root, run:

```powershell
git rev-parse --abbrev-ref HEAD
git status --short
git merge-base --is-ancestor 6660c0f HEAD
$LASTEXITCODE
git stash list
```

Completion criterion: the ancestry command exits `0`, the worktree is clean or
all existing changes are understood, and the older unrelated stash is left
untouched. Start new work from current `dev` or a user-specified branch based on
it.

## 2. Load only the relevant specification

Always read:

- `BUILD_NOTES.md` §6–§9 for P4, decision A, and current implementation/evidence.
- `ROADMAP_RISKS_DOD.md` P5–P7 for acceptance criteria and remaining status.

Then follow the branch matching the task:

| Task | Read before editing |
|---|---|
| Screens, navigation, copy, accessibility, offline UX | `MOBILE_UX_ARCHITECTURE.md` §3–§5 |
| API, sessions, errors, election lifecycle | `DATA_AND_API_MIGRATION.md`; `packages/core-api/README.md` |
| Crypto, ballot audit, Expo crypto adapter | `packages/core-crypto/README.md`; `BUILD_NOTES.md` §6 |
| Token storage, TLS, hostile-client work | `THREAT_MODEL_AND_SECURITY.md` §4; `VERIFICATION_AND_TESTING.md` §4 |
| Detox, emulator evidence, full-cycle rehearsal | `VERIFICATION_AND_TESTING.md` §3.4–§5; `testing/P7_REHEARSAL_RUNBOOK.md` |

When documents differ, later decision records in `BUILD_NOTES.md` override
older plans. Code and test behavior override stale descriptive text; update the
text in the same change.

## 3. Know the implementation seams

| Responsibility | Source of truth |
|---|---|
| Typed HTTP client and stable errors | `packages/core-api/src/index.ts` |
| API contract tests | `packages/core-api/src/index.test.ts` |
| Portable ElGamal, OR-proof, Benaloh helpers | `packages/core-crypto/src/` |
| Expo crypto adapter | `packages/mobile-app/src/expoCrypto.ts` |
| Secure session, device, audit storage | `packages/mobile-app/src/secureSessionStore.ts` |
| Voter journey and public screens | `packages/mobile-app/App.tsx` |
| Expo entry and configuration | `packages/mobile-app/index.ts`, `packages/mobile-app/app.json` |
| Hostile-client harness | `testing/hostile_client.mjs` |

The current app implements Election Hub → Authenticate → Voter status → Ballot
→ Cast-or-audit → Confirm → Receipt → Verify, plus Watchdog, Results, and
Settings. `App.tsx` is currently a single state-machine shell; splitting it is
allowed when behavior and protocol boundaries remain intact.

## 4. Preserve the protocol spine

- **Server authority:** render a recorded-vote state only from the real
  successful `/vote` response. Receipts contain only server-provided `vote_id`
  and real anchor data.
- **Offline fail-closed:** create and submit ballots only while connected. Use
  the exact user-facing copy: `You appear to be offline. Your vote is NOT
  recorded. Reconnect to continue.`
- **Session cast:** send `{election_id, encrypted_vote, zkp_proof}` to `/vote`.
  Raw NID is transient at authentication and absent from the cast body.
- **Decision A:** preserve `sessions.nullifier_hash` capture at session issuance.
  It keeps mixed web/mobile voting on the same A1 double-vote identity.
- **Secure persistence:** keep tokens, device IDs, and explicitly opted-in audit
  records in OS secure storage. Keep NIDs and tokens out of logs, analytics,
  ordinary files, and error text.
- **Transport:** require HTTPS in release configuration. The existing opt-in
  allows HTTP only for explicit local-development hosts.
- **Crypto boundary:** keep `core-crypto` platform-neutral. Expo primitives stay
  in the mobile adapter; server secrets stay server-side.
- **Public data:** keep Watchdog and Results read-only and election-scoped.

These are regression guardrails. Any requested design that conflicts with one
requires an explicit user decision and corresponding threat-model update.

## 5. Establish the baseline before editing

On a fresh clone, install the root workspaces and backend dependencies first:

```powershell
npm ci
npm ci --prefix backend
```

Then run:

```powershell
Push-Location backend
npx tsc --noEmit
npm run test:ci
Pop-Location

npm test --workspace=@evoting/core-crypto
npm run typecheck --workspace=@evoting/core-crypto
npm test --workspace=@evoting/core-api
npm run typecheck --workspace=@evoting/core-api
npm run typecheck --workspace=@evoting/mobile-app

Push-Location packages/mobile-app
npx expo export --platform android
Pop-Location
```

Handoff baseline: backend `9 files / 113 tests`, core-crypto `13 tests`,
core-api `7 tests`, all typechecks green, and Android export successful. On
Windows, Vitest or Metro may need approved worker-process permissions when the
sandbox reports `spawn EPERM`.

Completion criterion: the baseline matches, or work pauses with the mismatch
reported before source edits. If a legitimate change alters a count, update
this file and `BUILD_NOTES.md` with the new observed output.

## 6. Work the task

1. State the exact mobile behavior and acceptance criterion being changed.
2. Add the smallest contract/unit/E2E coverage that can fail on a regression.
3. Implement through the seams above; widen backend scope only for a demonstrated
   contract gap.
4. Exercise offline, error, retry, session-revocation, and accessibility states
   affected by the change.
5. Update the applicable evidence/status document in the same commit.

Completion criterion: every changed behavior maps to a test or a named manual
device check, and every unrun check is listed as pending rather than inferred.

## 7. Remaining evidence backlog

- Detox happy path, double-vote, offline-at-every-step, revocation, and
  close-window cases on iOS and Android emulators.
- Device proof that sign-out wipes SecureStore and clearing app data creates a
  new device ID requiring re-authentication.
- Live `testing/hostile_client.mjs` execution producing
  `testing/hostile_client_output.json` with zero vote-count delta.
- Dedicated `backend/.env.test` execution and the P7 staging cycle: register →
  mobile vote → anchor → tally → verify → results → tamper detection.
- Automated and manual accessibility checks, including screen-reader flow,
  touch targets, contrast, and focus/state announcements.

Credentials, emulators, or staging may be unavailable. In that case, preserve
the blocker explicitly and complete the runnable contract, typecheck, bundle,
and unit-test work. Evidence files contain observed results only.

## 8. Finish and hand off

Run the affected baseline gates plus:

```powershell
git diff --check
git status --short
```

Record commands and observed results in `BUILD_NOTES.md`; update the P5–P7
status only to the level actually evidenced. Keep code, tests, and changed doc
claims in one commit. Push or merge only after an explicit user request.

The migration is fully complete only when local gates, both emulator matrices,
hostile-client evidence, secure-storage evidence, and the P7 staging rehearsal
are green.

# Mobile app agent handoff

This is the current entry point for work on the React Native/Expo client. Read
this file first. It supersedes the phase-status and git-state portions of
`HANDOFF.md`, which is a historical P3 kickoff document.

## Current repository state

- Repository: `D:\Coding\evoting-simulation`
- Current integration branch: `dev`
- Current merged commit: `6660c0f` (`merge mobile migration phases P3-P7`)
- Mobile feature commit: `8c824ba`
- The feature branch remains available as `origin/feature/mobile-migration-p0`.
- Do not store, print, or commit credentials, API tokens, NIDs, or private keys.
- Do not claim live evidence that was not actually run.

P0–P4 backend/crypto migration work and the P5/P6 implementation are already
merged. The remaining work is device/staging validation, mobile quality work,
and the P7 full-cycle rehearsal described below.

## Read in this order

1. `MOBILE_UX_ARCHITECTURE.md` — authoritative screen set, lifecycle, offline
   decision, accessibility bar, and mobile-specific rationale.
2. `ROADMAP_RISKS_DOD.md` — P5, P6, and P7 objectives, tests, and completion
   criteria.
3. `VERIFICATION_AND_TESTING.md` — required contract, E2E, hostile-client,
   secure-storage, and full-cycle evidence.
4. `DATA_AND_API_MIGRATION.md` — endpoint contracts and web/mobile migration
   decisions.
5. `THREAT_MODEL_AND_SECURITY.md` — token, identity, TLS, tamper, and privacy
   boundaries.
6. `BUILD_NOTES.md` §7–§9 — decision A (`sessions.nullifier_hash`), P3
   evidence, and current P5–P7 implementation log.
7. `packages/core-api/README.md` and `packages/core-crypto/README.md` — package
   contracts and platform-boundary rules.
8. `testing/P7_REHEARSAL_RUNBOOK.md` — operator sequence for staging evidence.

`HANDOFF.md` remains useful only for historical P0–P3 reasoning and the
decision-A context. Its old “remaining phases” and “git state” sections are not
current.

## Mobile code map

| Area | Source of truth |
|---|---|
| Typed HTTP client and stable errors | `packages/core-api/src/index.ts` |
| API contract tests | `packages/core-api/src/index.test.ts` |
| Portable ElGamal, OR-proof, Benaloh helpers | `packages/core-crypto/src/` |
| Expo crypto adapter | `packages/mobile-app/src/expoCrypto.ts` |
| Secure session/device/audit storage | `packages/mobile-app/src/secureSessionStore.ts` |
| Current voter journey shell | `packages/mobile-app/App.tsx` |
| Expo entry/config | `packages/mobile-app/index.ts`, `app.json` |
| HTTP hostile-client harness | `testing/hostile_client.mjs` |
| P7 operator runbook | `testing/P7_REHEARSAL_RUNBOOK.md` |

The current app implements Election Hub → Authenticate → Voter status → Ballot
→ Cast-or-audit → Confirm → Receipt → Verify, plus Watchdog, Results, and
Settings. It uses the real typed API client and never fabricates a `vote_id` or
transaction hash.

## Non-negotiable protocol rules

1. The server and database remain authoritative. A mobile success state requires
   the real successful HTTP response; never add mock success, fake receipt IDs,
   fake transaction hashes, or local “recorded” state.
2. Offline is fail-closed. Show exactly:
   `You appear to be offline. Your vote is NOT recorded. Reconnect to continue.`
   Do not create or queue ballots offline.
3. `/vote` uses the server-issued session and sends `{election_id,
   encrypted_vote, zkp_proof}`. Do not reintroduce raw NID on the cast path.
4. Preserve P2 decision A: `sessions.nullifier_hash` is captured at session
   issuance so mixed web/mobile voting preserves A1 double-vote prevention.
5. Tokens, device IDs, and opt-in audit records use OS secure storage. Raw NIDs
   and tokens must not enter logs, error strings, analytics, or ordinary files.
6. Release API configuration is HTTPS-only. Local HTTP is permitted only for
   explicit development hosts through the existing opt-in flag.
7. Use the injected crypto/platform boundary. Do not import Expo modules into
   `core-crypto` or add server secrets to the mobile bundle.
8. Keep public Watchdog/Results data read-only and election-scoped.

## Start-of-task checks

Run these from the repository root before editing:

```powershell
git rev-parse --abbrev-ref HEAD
git status --short
npm ci

cd backend
npx tsc --noEmit
npm run test:ci
cd ..

npm test --workspace=@evoting/core-crypto
npm run typecheck --workspace=@evoting/core-crypto
npm test --workspace=@evoting/core-api
npm run typecheck --workspace=@evoting/core-api
npm run typecheck --workspace=@evoting/mobile-app
cd packages/mobile-app
npx expo export --platform android
cd ../..
```

On Windows, Vitest and Metro may need the normal approved process permissions
because worker creation can otherwise fail with `spawn EPERM`.

## What is still genuinely unfinished

- Detox happy-path, double-vote, offline-at-every-step, and revocation tests on
  both iOS and Android emulators.
- Device verification that sign-out wipes SecureStore and app-data clearing
  creates a new device ID requiring re-authentication.
- A live hostile-client run producing `testing/hostile_client_output.json`.
- A dedicated `backend/.env.test` database run and staging full-cycle rehearsal:
  register → mobile vote → anchor → tally → verify → results → tamper detection.
- Accessibility walkthrough and production-level mobile UX polish.

Never create placeholder evidence for these items. If credentials, emulators,
or staging are unavailable, record the blocker and continue with pure contract,
typecheck, bundle, and unit-test work.

## Change and completion discipline

- Keep code and documentation claims in the same commit.
- Prefer pure, injected modules so tests do not import `supabaseClient`.
- Update `BUILD_NOTES.md` and the relevant roadmap status when a claim changes.
- Run `git diff --check` and the applicable tests before committing.
- Do not push or merge unless the user explicitly requests it.

The mobile work is complete only when the local gates, emulator matrix, hostile
client evidence, and P7 staging runbook all have truthful results.

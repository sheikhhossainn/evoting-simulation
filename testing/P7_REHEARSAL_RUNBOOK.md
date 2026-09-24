# P7 full-cycle rehearsal

This is the operator runbook for the first staging rehearsal. It is not an
evidence artifact: no staging credentials or `backend/.env.test` are checked
into the repository.

## Preconditions

1. Provision a dedicated Supabase test project and populate `backend/.env.test`
   from `backend/.env.test.example`. Never point it at production.
2. Start the backend over HTTPS (or behind a TLS-terminating proxy) and set
   `EXPO_PUBLIC_API_BASE` to that origin.
3. Seed constituencies, candidates, voters, four keyholders, and a test
   election. Complete DKG and confirm the election reaches `voting`.
4. Install the Expo app on one iOS and one Android emulator.

## Rehearsal

1. Register/authenticate a test voter in the mobile app.
2. Complete Ballot → Cast-or-audit → Confirm → Receipt.
3. Confirm the receipt contains the real server `vote_id`; run dense and SMT
   verification after anchoring.
4. Run `node testing/hostile_client.mjs` against the same election and verify
   the public vote count is unchanged by rejected requests.
5. Anchor the batch, run the tally, and verify Watchdog and Results from mobile.
6. In the isolated test environment, tamper the root and confirm mobile
   verification reports the mismatch.
7. Revoke the session, confirm API calls fail, clear app data, and confirm the
   next launch requires authentication with a new device id.
8. Repeat the happy path, double-vote, offline-at-every-step, and revocation
   matrix on both emulators. Offline must never display a recorded-vote state.

## Cutover decision

Until this runbook is green, keep the web voter flow available as a legacy
compatibility surface. After it is green, decide separately whether to retain
only its admin/public pages or remove voter-facing routes.

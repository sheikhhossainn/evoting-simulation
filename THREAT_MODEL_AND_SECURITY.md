# THREAT_MODEL_AND_SECURITY.md — Phase 3: Threat Model & Mobile Security Architecture

**Status:** Phase 3 deliverable. **Source:** verified findings from `AUDIT.md` (Phase 1) and `METHODOLOGY_CLASSIFICATION.md` (Phase 2), plus the repository's *own* adversary model (`METHODOLOGY.md`, `docs/threat_model.md`). Anything proposed here is explicit about where it lives (client / server / DB — server & DB authoritative per Rule 7) and what it does and does not cover. Every threat uses the format: threat → concrete scenario against this system → existing control → mitigation status → needed control (if any) → test → evidence.

---

## 1. Scope & grounding (what this threat model is allowed to use)

- The system is a **research simulation** of E2E-verifiable voting; its core claim is *tamper-evidence* (detection), parameterized by anchoring cadence, with a stated adversary model (AUDIT.md §13; `METHODOLOGY.md`):
  - Attacker capabilities: full read/write on the Supabase DB (INSERT/UPDATE/DELETE/drop triggers), arbitrary requests to the public API, knowledge of all public parameters.
  - Attacker limits: cannot write to the chain contracts (`anchorRoot`/`anchorSmtRoot`/`ElectionSetupCommitment.anchor` are `onlyOwner`/write-once; `ANCHOR_PRIVATE_KEY` not attacker-controlled), cannot recompute nullifiers (`NULLIFIER_SECRET` server-side), cannot corrupt the honest independent verifier.
  - Implication (stated by the repo itself): DB-layer defenses are **defense-in-depth**; the guarantee is detection via honest verification against on-chain commitments.
- Verified inventory used: A-items A1–A16, B-items B1–B9, C1–C4, D1–D6 (METHODOLOGY_CLASSIFICATION.md Part 6), anti-tamper table (Part 5), linkability (Part 4).
- `UNKNOWN — REQUIRES VERIFICATION` items (AUDIT.md §16) are carried but never treated as facts (e.g., any out-of-tree `elections.status` updater).

## 2. Threat register (Appendix categories, filtered to what applies to *this* system)

Legend — **Existing control**: A-item(s) from Phase 2 touching this threat. **Status**: `MITIGATED` / `PARTIAL` / `NOT ADDRESSED`. **Needed control**: filled only where Status ≠ MITIGATED.

| # | Threat | Concrete scenario against THIS system | Existing control | Status | Needed control (location) |
|---|---|---|---|---|---|
| T1 | Direct DB modification of a stored ballot | DB admin / SQL injection runs `UPDATE votes SET encrypted_vote=…` or changes `nullifier_hash`/`constituency_code`/`created_at` (service-role key in `backend/.env`, supabaseClient.ts) | A5 (`trg_votes_immutable` blocks), A6/A7 (post-anchor detection → 409) | **MITIGATED at DB; detection-only if admin drops triggers** (repo's own stated model) | — (keep A5+A6/A7) |
| T2 | Stored-root manipulation (`merkle_batches.root`) | Attacker edits `votes` AND `merkle_batches.vote_ids`+`root` consistently; the *local* verify passes, but on-chain `contract.verify(electionId, batchId, leaf, proof)` compares against the immutable on-chain root | A6/A7 (on-chain root = anchor of trust; `included_on_chain=false`), honest verifier | **PARTIAL — detection by design** (local check spoofable; chain check not). Matches the repo's honest-verifier requirement | — (documented trust boundary) |
| T3 | Client-side manipulation of the ballot | Modified client encrypts a different value, sends a forged "valid set", or submits a plaintext candidate | A3/A4 (mandatory ZKP vs **server-derived** set; no plaintext candidate field) | **MITIGATED** | — |
| T4 | Malicious/compromised admin action | Anyone with the shared `ADMIN_SECRET` can `POST /anchor/batch`, `/keyshares/tally`, and the **demo tamper routes** (`/anchor/tamper/*`, incl. `fn_admin_delete_vote`, which genuinely deletes a vote row) — no per-admin identity, no audit log | A5 blocks casual deletes; A6/A7/A8 detection (SMT non-membership, batch count, independent recount) | **PARTIAL — detection exists, attribution does not** | (a) production-flag off the demo tamper routes; (b) B5: per-admin identity + sessions + `admin_actions` audit log; (c) keep SMT + bundle checks |
| T5 | Sequential double-vote (one voter) | Same NID casts twice (two taps/tabs/devices) | A1 (`has_voted` flip + atomicity + P0004) + unique constraints | **MITIGATED** | — |
| T6 | Replayed vote request | Re-send a captured `POST /vote` body | A1: same NID → 409. **Cross-NID replay is a new valid ballot** — that is the coercion/ballot-buying vector explicitly declared out-of-scope (explicit-assumptions-and-nongoals §2) | **MITIGATED (same NID); out-of-scope (cross-NID)** | — (scope statement) |
| T7 | Concurrent duplicate cast (same voter, simultaneous) | N parallel `POST /vote` for one NID | A1: `SELECT … FOR UPDATE` serializes; exactly one INSERT | **MITIGATED in code; NOT YET EXECUTED** — the N=50 test was unskipped in P0 (`BUILD_NOTES.md` §4) but cannot run until `backend/.env.test` exists | Test-DB credentials + two-session mobile variant (Phase 6) |
| T8 | One voter, multiple devices/sessions | Voter uses two phones with the same NID; attacker uses a stolen phone | A1 is identity-scoped (`nid_hash`) → exactly one vote | **MITIGATED** (D1 sessions authenticate, never authorize a 2nd ballot) | D1 design constraint |
| T9 | Altered/out-of-context candidate ID | Client encrypts a candidate of another constituency, a made-up UUID, or passes its own candidate set | A3/A4 (server derives the constituency set; ZKP fails) | **MITIGATED** | — |
| T10 | NID guessing / enrollment inflation | Script registers many 11-digit NIDs (`is_eligible=true`, B1) and casts N ballots; nothing throttles (B4) or proves identity | None of A1–A16 bounds *who may enroll*; A3/A4 only bound each ballot's validity | **NOT ADDRESSED** (B1+B4) | Server: rate limiting + CAPTCHA on `/voter/register` (+ `/vote`); authoritative eligibility/roll or explicit scope note; mobile: D1 session + device binding (§3.T10) |
| T11 | Altered timestamps | Client tries to supply `created_at`/`updated_at` | `created_at` = DB `now()`; in immutable guard (A5); post-trigger-drop edits change the leaf → on-chain detect | **MITIGATED** | — |
| T12 | Bypassed client validation / fake client success | A modified/offline client "records" a vote locally (exactly the C1 mock path) | Server re-validates everything; client cannot create a server vote | **MITIGATED against the server; the USER is defrauded by C1's fake-success UI** | C1 replacement + D3 fail-closed (mobile) |
| T13 | Voting after official close / close mid-submission | Lead marks "closed" but nothing enforces it: `elections.status` never transitions; `/vote` never checks it (B2) | A1 gates (existence/key/commitment) are the only windows | **NOT ADDRESSED** (B2) | Server: status transitions + enforce open status in `/vote` + 403 "election closed"; audit; mobile reflects closed state (§3.T13) |
| T14 | Token-less identity replay (today's web) | Anyone who knows/logs a NID re-uses it from anywhere; nothing to revoke | None (NID is the credential; no sessions) | **NOT ADDRESSED for the mobile design** | D1 (mobile); B5 (admin) |
| T15 | Session-token theft/replay (mobile, after D1) | Captured `Authorization: Bearer` replayed from another device/process | D1 must make tokens opaque, random, short-lived, server-hash-stored, device-bound, revocable | **NEW (D1)** (§3.T15) | Server + secure storage |
| T16 | Unauthorized admin API access / privilege escalation | `x-admin-secret` leaked/brute-forced; no per-admin identity; no audit | `timingSafeEqual` compare (A16) only | **PARTIAL** (B5) | Per-admin identity/sessions + `admin_actions` audit; production-exclude demo routes |
| T17 | Keyholder credential compromise | 3 of 4 passphrases compromised (demo defaults `share001..004` unless overridden; seed-keyholders.ts:28,56) | Threshold trust model; DLEQ makes wrong partials detectable (A8) | **PARTIAL by design** (3-of-4 collusion is a documented non-goal, threat_model §10) | Ops: seed real passphrases; no new crypto |
| T18 | Direct DB deletion / duplicate ballot rows | `DELETE FROM votes` / second INSERT for one nullifier | A5 (no-delete), A1 unique constraints; chain/SMT detection after anchor | **MITIGATED at DB; detection-backed after admin bypass** | — (keep; unskip integrity tests) |
| T19 | Unauthorized result manipulation (results store) | DB write to the results store to publish false counts | A8/A7: verification-bundle + independent recount flag `published_results.valid_votes` mismatch | **PARTIAL — detection via honest verifier** | **BUILD-BRIEF C3:** `tally_runs` is the sole store (append-only) and `GET /public/results` reads it directly; legacy `tally_results` is no longer read or written; keep verifier |
| T20 | Inconsistent anchor transaction (partial failure) | `runAnchorBatch` commits on-chain, then `merkle_batches` INSERT or `votes` UPDATE fails → votes stay `queued`/`tx_hash=NULL` while already on-chain (AUDIT §15.10) | A6 logs loudly; re-anchor re-commits same leaves later | **PARTIAL — recoverable but DB/chain reconciliation ambiguous** | Server: reconciliation job comparing on-chain `batchCount` vs `merkle_batches` rows (Phase 5) |
| T21 | High simultaneous load / DoS-ish | Peak voting day hammers `/vote`, `/voter/register`, anonymous GETs; no rate limit, no body limit (B4); HTTP-level concurrency untested | None | **NOT ADDRESSED** (B4) | Rate limiting, body limits, load test (k6/Artillery per FUTURE_WORK §6); Supabase pool sizing |
| T22 | Same-voter simultaneous across devices | Two phones, two sessions, same NID, one request each at once | A1 row lock (identity-scoped) | **MITIGATED** | (verify with two-session test, Phase 6) |

---

## 3. Threats requiring new/changed controls — full 6-point analysis

### §3.T10 — Enrollment inflation / NID guessing (Status: NOT ADDRESSED)
1. **Threat:** an attacker casts many more ballots than there are real voters, or votes as someone else.
2. **Scenario:** `POST /voter/register` (voter.ts:108-120) marks any well-formed 11-digit NID `is_eligible=true`; there is no rate limit (index.ts; B4) and no identity proof. A script registers N NIDs and casts N ballots, each individually valid (201s). A3/A4 bound only *what* is encrypted, not *who* may cast.
3. **Existing control:** A1 (per-NID duplicate prevention), A3/A4 (ballot validity) — neither bounds the *number* of registered voters. Status: **NOT ADDRESSED**.
4. **New control (server — authority per Rule 7):** (a) tiered fixed-window limits on `/voter/register` (tight) and `/vote`, plus a CAPTCHA gate on register (hCaptcha/Turnstile — already on the repo's own roadmap, FUTURE_WORK §6.1) — **implemented in P1** as `backend/src/middleware/{rateLimit,captcha}.ts`, deliberately *without* adopting `express-rate-limit` as a dependency. Keying is per client IP + path, so the per-NID tier is **deferred**: the nullifier is derived *inside* the route, so a middleware key would either hold raw NIDs in process memory (a privacy smell) or duplicate identity derivation (see ROADMAP risk R11); (b) for non-demo use: authoritative eligibility (official roll / verified identity) instead of unauthenticated self-registration (B1 raised to a control); (c) mobile: D1 sessions + device binding reduce casual reuse. **Mitigates:** bulk automation and casual reuse. **Does not:** a determined human using a captured NID (identity theft / coercion — kept out-of-scope by the repo; see §6.2). **Cost:** middleware low; CAPTCHA adds an integration; authoritative eligibility is a product-scope decision (high).
5. **Test:** burst of 100 registers → 429 after quota (the middleware-level equivalent is covered in `test:ci`; the end-to-end burst still requires `.env.test`); CAPTCHA missing/invalid → 400/403; one NID twice → 409; two NIDs → both 201.
6. **Evidence:** HTTP 429/400/409 responses, rate-limit counters, `voters.has_voted` flags.

### §3.T13 — No enforced election open/close (Status: NOT ADDRESSED)
1. **Threat:** ballots are accepted outside the official voting window; "closing" does not stop new votes.
2. **Scenario:** `elections.status` is never transitioned and `POST /vote` never reads it (elections.ts:36-57; vote.ts gates only existence/key/commitment; AUDIT §15.4) — a late ballot is indistinguishable from an on-time one.
3. **Existing control:** none (B2). Status: **NOT ADDRESSED**.
4. **New control (server + DB):** (a) admin `PATCH /elections/:id/status` (admin secret now; B5 identity later) with the CHECK constraint preserved; (b) enforce in route/stored-proc: reject when status ≠ `'voting'` (403 "election closed"); (c) audit every transition. **Covers:** window integrity. **Doesn't:** a DB admin directly rewriting status — pair the status with the setup-commitment era in Phase 5 so window tampering is verifiable against something anchored.
5. **Test:** status `'setup'`/`'closed'` → `/vote` 403; after transition to `'voting'` → 201; vote racing the close → exactly one of 201/403; audit rows recorded.
6. **Evidence:** HTTP 403/201, `elections.status` in DB, `admin_actions` rows, race-run transcript.

### §3.T4 / §3.T16 — Admin: shared secret, no identity, no audit, demo deletion route (Status: PARTIAL)
1. **Threat:** anyone holding the single shared `ADMIN_SECRET` can anchor/tally and — worst — genuinely delete a vote via the demo-only `POST /anchor/tamper/delete-vote` → `fn_admin_delete_vote` (schema.sql:331-347), with no attribution.
2. **Scenario:** the secret lives in `backend/.env`; a leaked env or logged header grants full administrative power (A16's `timingSafeEqual` guards comparison, not possession).
3. **Existing control:** A5 blocks casual deletes; A6/A7/A8 detect afterwards (SMT non-membership for the deleted key; verification-bundle rebuild fails; batch-count mismatch; independent recount flags). Status: **PARTIAL** (detection, no attribution).
4. **New control (server):** (i) expose the three demo tamper routes only when an explicit env flag is set (`ENABLE_TAMPER_DEMO=1`), so production doesn't ship them; (ii) replace the shared secret with per-admin credentials + server sessions (B5; WebAuthn is the repo's own roadmap — FUTURE_WORK §11.4) and an `admin_actions` audit table (who/what/when/result) on anchor/tally/status-transition; (iii) keep SMT + bundle verification as the detection backstop. **Doesn't cover:** a DB admin running SQL directly — the repo's explicit boundary.
5. **Test:** tamper routes 404 in production config; admin action with missing/expired identity → 401; each anchor/tally produces exactly one `admin_actions` row with the acting admin id.
6. **Evidence:** 404s; 401s; audit rows; a tamper-and-verify run showing SMT non-membership + verifier failure.

### §3.T15 — Mobile session-token theft/replay (Status: NEW — D1)
1. **Threat:** a captured mobile session token is replayed from another device/process to act as the voter (ballot fetch, cast, status checks).
2. **Scenario:** the current web sends the raw NID per request; a phone app storing the NID or a long-lived bearer would let anyone with the phone's data act as the voter indefinitely.
3. **Existing control:** none in the web design (NID is the credential; no sessions). Status: **NEW**.
4. **New control (server + client):** (i) server issues an **opaque random token** (256-bit CSPRNG) after verifying NID (+ §3.T10 rate-limit/captcha); (ii) server stores only `sha256(token)` + `voter_nid_hash` + `device_id` + `issued_at` + `expires_at` + `revoked_at` in a `sessions` table; (iii) short TTL (15–30 min, sliding), sent as `Authorization: Bearer` over **HTTPS only**; (iv) voter-scoped routes (`/voter/check-nullifier`, `/candidates`, `/vote`) switch from NID-in-body/header to the session; the raw NID is retained transiently at login/register only; (v) per-NID single-active-device during an election window is a product decision flagged for Phase 4 (A1 already prevents double-voting). **Mitigates:** token replay (opaque/short-lived/revocable/device-bound), NID-at-rest on device, long-lived credential theft. **Does not:** defeat a rooted device (§5) nor phishing of the NID itself.
5. **Test:** replay captured `Authorization` after logout/revocation → 401; replay from a different `device_id` → 401; expired token → 401 + refresh flow; correct token → 200/201; DB stores only the hash.
6. **Evidence:** HTTP 401/201s, `sessions` rows (`expires_at`, `revoked_at`), DB dump shows no raw token string.

### §3.T19 — Unauthorized `tally_results` manipulation (Status: PARTIAL)
1. **Threat:** a DB write to `tally_results` publishes false aggregate counts to the public.
2. **Scenario:** the served results come straight from a table read by the public route (`GET /public/results`, public.ts:126) — a DB write there publishes false counts to everyone.
3. **Existing control:** A8/A7 — the verification-bundle recomputes the tally independently and the verifier flags `published_results.valid_votes` ≠ independent recount (independent-verify-tally.test.ts). Status: **PARTIAL** (requires the honest verifier to run).
4. **New control (server/DB):** append-only history — each run appends to `tally_runs`, which is the **sole** results store (BUILD-BRIEF C3); `GET /public/results` reads `tally_runs ORDER BY tallied_at DESC LIMIT 1`; the legacy `tally_results` table is left in place but no longer read or written; `tally_runs` carries no-update/no-delete triggers. **Covers:** silent overwrite and out-of-band edits become visible. **Doesn't:** stop an admin from appending a fake run — caught by the independent recount, as today.
5. **Test:** overwrite `tally_results` without a new tally run → blocked or visible in history; bundle's `published_results` vs independent recount → verifier FAIL.
6. **Evidence:** trigger error or history rows; verifier rejection output.

### §3.T20 — Anchor transaction partial failure (Status: PARTIAL)
1. **Threat:** after the on-chain commit, the DB record of the batch is missing (votes stay `queued`, `tx_hash=NULL`), leaving DB and chain out of sync.
2. **Scenario:** `runAnchorBatch` commits on-chain, then the `merkle_batches` INSERT or `votes` UPDATE fails (anchorBatch.ts:107-125); a later run re-anchors the same leaves into a new batch — the old on-chain batch has no DB row.
3. **Existing control:** A6 logs loudly; re-anchor is safe (same leaves, new batch). Status: **PARTIAL**.
4. **New control (server):** a reconciliation job that reads on-chain `batchCount(election)` vs `merkle_batches` rows and backfills the missing row or flags a discrepancy ticket. **Covers:** silent divergence. **Doesn't:** change the documented "chain is source of truth" policy (AUDIT §15.10).
5. **Test:** stub the `merkle_batches` INSERT to throw during a live anchor → reconciliation run repairs the row to match the on-chain `BatchAnchored` event.
---

## 4. Mobile security architecture (for the React Native / Expo app)

Design rule repeated throughout: **the server and database remain the only authorities for anything that affects a vote's validity (Rule 7)**. Everything below is client convenience/defense that the server re-validates and, where it matters, re-derives.

### 4.1 Token handling & session/device binding (D1 + D6)
- **Issuance:** `POST /voter/session` (new) — body `{nid, device_id, captcha_token?}`; server enforces registration/eligibility (calls the *existing* `/voter/register` semantics), §3.T10 rate limits, CAPTCHA; on success returns `{token, voter_descriptor}` where token is 32 random bytes (base64url) and `voter_descriptor` is the **non-sensitive** profile the app may display (e.g. `constituency_code`, display name prefix) — never the nullifier, never the raw NID back.
- **Server state:** `sessions(token_hash, voter_nid_hash, device_id, issued_at, expires_at, revoked_at)` — only the hash is stored; lookups are `WHERE token_hash = sha256(header)` and `expires_at > now() AND revoked_at IS NULL`. TTL: 20 minutes sliding (voting step spans a few minutes); refresh via `POST /voter/session/refresh` which rotates the token (old one revoked). NID is **never sent again** after login for the remainder of the voting flow — the vote request carries the session only.
- **Device binding:** `device_id` = random UUID generated once and stored in secure storage (§4.2); the server records it and rejects session use from an unregistered `device_id` (a token + different device_id → 401). App reinstall ⇒ new device_id ⇒ old sessions orphaned/revoked ⇒ voter re-authenticates (D6).
- **Vote request shape post-migration:** `POST /vote` — `{election_id, encrypted_vote, zkp_proof}` + `Authorization`; the server derives `nid_hash`/`nullifier_hash`/`constituency_code` from the **session**, not from the body (A2 preserved; the raw NID no longer transits the wire on cast). **Implemented in P2 (decision A):** `nid_hash` comes from `sessions.voter_nid_hash`, `constituency_code` from the `voters` row the session is bound to, and `nullifier_hash` — which cannot be recomputed from a hash — is **captured in `sessions.nullifier_hash` at issuance**, while the server still transiently holds the NID. That capture is what keeps A1 exact: the session path casts the same pseudonym the legacy raw-NID path computes, so mixed web/mobile voting cannot double-count. The legacy `nid` body field remains accepted for the web client only. **Accepted trade-off:** a pseudonym now sits beside `voter_nid_hash`, so a database-only reader can link a hashed voter to a vote row (see DATA_AND_API_MIGRATION, Unlinkability row).
- **What this does NOT cover:** a rooted/jailbroken device can extract the token from process memory and replay it (its own device_id though — the server's device binding resists *cross-device* replay, not on-device theft). A compromised device can also just vote normally as the user; the duplicate-vote lock (A1) still permits only one ballot per NID. Consequence: token security improves casual theft, not local compromise.

### 4.2 Secure on-device storage (D2)
- Store only: (a) session token + `device_id`; (b) the current `election_id` selection; (c) — **only if the voter explicitly opts in during the Benaloh audit step** — the audit payload `{candidate_id, ciphertext, randomness}`.
- Mechanism: OS-backed store — iOS `Keychain` / Android hardware-backed `Keystore` (e.g. via `expo-secure-store` or the platform-appropriate Expo wrapper); the app must not write these to localStorage/plain files, and must not log them. `NID` is held in memory only during the session and cleared on logout; nothing NID-derived (besides the token) persists.

### 4.3 Client-side ballot crypto (D4)
- Port `frontend/src/utils/elgamal.ts` (encrypt + OR-proof prover + Benaloh helpers) to the Expo runtime with a verified CSPRNG (`crypto.getRandomValues` from JS/secure-backed source) and BigInt modpow, keeping **byte-for-byte** the same hex serialization, Fiat–Shamir input ordering, and challenge domain (A3/A13 preserved). The server's `verifyBallotValidity` (zkp.ts) is the arbiter — if the ported prover ever diverges, the vote is rejected (evidence = 400) — which is a testable property (Phase 6 cross-validation: run the JS prover's output through the backend verifier).

### 4.4 Transport & API reachability (D5)
- Release builds: HTTPS-only (reject plaintext), API base URL from secure config (build-time/ops-injected), `HSTS` set by the server/reverse proxy. **Certificate pinning is NOT added** — justification in §6.3 (Rule 8).
- CORS becomes moot for native HTTP clients but matters for any web-admin fallback; the CI/dev setup moves to `http://localhost` only.

### 4.5 Offline / degraded behavior (D3)
- **No offline ballot creation, period** (rationale: ZKP is verified server-side (A3), duplicate-vote/eligibility is a DB transaction (A1), and the nullifier is server-derived (A2) — anything queued locally could not be validated later without weakening Rule 7).
- App behavior: connectivity banner; step-level retry with idempotency (re-fired `POST /vote` after a timeout is safe — A1 guarantees 409 if it actually landed); explicit copy "Your vote is NOT recorded until the server confirms" on any ambiguous state (replaces C1's fake-success).
- Read-only public screens (`/watchdog`, `/results`, verification) may cache **only** data that is public by construction (counts, roots, proofs) and nothing voter-specific.

### 4.6 Admin & keyholder flows on mobile (scope decision)
- Per FUTURE_WORK §1: keyholders and admins keep **web portals**; the mobile app is voter-facing. The admin/keyholder mechanisms (B5 fix, DKG ceremony) are therefore out of the mobile app's client scope, but the *server-side* fixes (audit log, production-flag-off of demo routes, per-admin identity) still ship (Phase 5). The voter app must not contain admin routes at all (reduces the mobile attack surface).

---

## 5. What this architecture does NOT cover (stated honestly)

- **Rooted/jailbroken devices:** an attacker with OS root can read the token/audit storage and act as the device's user. Mitigation is legal/commercial policy (software escrow, certified devices), not app code. The duplicate-vote lock (A1) still bounds the *number* of ballots per NID; the architecture cannot stop a rooted device from casting the user's single ballot for them.
- **Identity theft with a genuinely known NID** (someone who knows the victim's NID and uses the victim's device, or coerces the victim): this is the coercion/identity-provider problem the repo scopes out (explicit-assumptions-and-nongoals §2). D1 raises the bar (device binding, revocation) but does not claim to solve it.
- **A compromised server:** if the Express backend or its `NULLIFIER_SECRET`/`ANCHOR_PRIVATE_KEY` are compromised, the server can link ballots (Part 4.3) or anchor arbitrary roots. The repo's model requires an *honest server* and an *honest independent verifier*; nothing in the mobile design changes that boundary.
- **Enrollment integrity:** rate limits + CAPTCHA (T10) slow but do not eliminate self-registration of fictional voters while B1 (unauthenticated `is_eligible=true`) stands. Authoritative eligibility is a product decision, not a mobile-app fix.
- **Coercion-resistance and receipt-freeness:** out of scope by the repo's own docs; the Benaloh audit data (if the voter opts to keep it) is voter-side verifiability, which *reduces* receipt-freeness by design.
- **E2E-encryption of the transport beyond TLS, and certificate pinning:** not added (see §6.3).

---

## 6. Deferred decisions — and why (Rule 8: nothing added without a concrete attack)

### 6.1 Biometric / face-liveness second factor (FUTURE_WORK §2)
- Candidate attack it would mitigate: "someone who has your NID *and* casual access to your phone can vote as you." 
- **Today's actual controls already cover the *integrity* consequences:** a foreign ballot is still one-per-NID (A1), valid (A3), and vote-choice anonymous (A2). What MFA would add is *identity confidence*, which matters only when the system's claim includes "only the true registered person voted as them" — **the current system explicitly does not claim this** (B1: enrollment is unauthenticated; threat_model's adversarial matrix does not include enrollment subversion).
- **Decision:** do **not** add biometric/liveness for the simulation's guarantees. It is a product/governance decision to adopt a real identity gate (then MFA accompanies it), and FUTURE_WORK's roadmap can adopt it then. Adding it now would be a heavyweight mechanism not justified by this system's stated claims (Rule 8).
- Test every future decision against: threat → control → location → test → evidence (same discipline as §3).

### 6.2 Certificate pinning / custom TLS trust
- Candidate attack: a network MITM on mobile TLS showing a forged certificate to capture the session/Audit data.
- Existing: OS TLS verification + HTTPS-only + HSTS (4.4) mitigate the standard MITM; the threat_model assumes "TLS holds" (threat_model §2, "no certificate pinning yet").
- **Decision:** do not pin. Pinning imposes real operational cost (cert rotation pushes) and its threat-model benefit (defense against a state-level CA compromise on a mobile network) is not part of this system's stated trust assumptions. Revisit **only** if the deployment's threat model changes (e.g., high-value adversarial-network requirement) — with the same test/evidence discipline.

### 6.3 Push-based tamper alerts (FUTURE_WORK §5)
- The guarantees are pull-based (verify endpoints + independent verifier). Push alerts would close a *notification-timeliness* gap, not an integrity gap. **Decision:** optional product feature for Phase 7, not a security control here.

---

## 7. What Phase 6 will test (linkage)

Phase 6 (`VERIFICATION_AND_TESTING.md`) will instantiate, for every threat above, the concrete attack test with expected DB state, audit evidence, UI feedback, and pass/fail criteria. The threats with **new** controls to prove: T7/T8/T22 (concurrency over the test DB + two sessions), T10 (inflation/rate-limit), T13 (window enforcement), T4/T16 (admin audit + demo-route exclusion), T15 (token lifecycle), T19 (tally history), T20 (reconciliation), D4 (ported prover output accepted by the backend verifier), D3 (offline fail-closed UI states).

## 8. Summary of Phase 3 security posture (one paragraph)

The mobile migration does **not** change the voting method: A1–A16 stay server/DB/chain-side and authoritative. The genuinely new mobile surface is (i) a session layer (opaque, hashed, short-lived, device-bound, revocable) replacing repeated raw-NID transmission, (ii) OS-backed secure storage for the token and any opt-in Benaloh audit data, (iii) a fail-closed offline policy, (iv) the ported client prover (validated by the unchanged backend verifier), and (v) transport/deploy config. The systemic weak points this phase calls out for the server side are enrollment inflation (T10), the missing election-window gate (T13), admin attribution/audit (T4/T16), and DB/chain reconciliation (T20) — each with its threat→control→test→evidence chain above.
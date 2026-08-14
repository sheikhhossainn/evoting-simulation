# Future Work — Mobile-First E-Voting Platform

> Planning doc for the next major phase: retire the voter-facing website, ship a React Native (Expo)
> mobile app with biometric + face-liveness MFA, build an Election-Commission-verified key holder
> portal, add blockchain batch visualization with tamper alerts, and harden the backend against
> DDoS/abuse. Written against the codebase as of commit `72370ab5` (see `graphify-out/GRAPH_REPORT.md`).

## 0. Current State (baseline, from codebase review)

| Area | Today |
|---|---|
| Voter auth | NID only — salted SHA-256 hash (`backend/src/crypto/identity.ts`), no second factor |
| Vote submission | React web app (`frontend/`), ElGamal-encrypted ballot + ZKP of validity (`backend/src/crypto/zkp.ts`) |
| Key holders | 4 fixed holders, passphrase-only (`backend/src/config/keyholders.ts`), 3-of-4 Shamir threshold (`backend/src/crypto/shamir.ts`), submit share via web form |
| Tally/decrypt | Admin-triggered `POST /keyshares/tally` behind `x-admin-secret` header (`backend/src/middleware/adminAuth.ts`) — single shared secret, no per-admin identity |
| Anchoring | Batches of votes Merkle-anchored to Ethereum Sepolia (`backend/src/services/anchorBatch.ts`, `MerkleRootStorage.sol`); tamper *detection* exists (`GET /anchor/verify/:voteId`, `TamperVisualizer.tsx`) but is pull-based (a user has to open the page and check) — no push notification, no batch-graph view, no red/green chain rendering |
| Rate limiting / DDoS | **None found** — no rate-limit middleware, no CAPTCHA, no WAF config in repo |
| Admin identity | Single shared `ADMIN_SECRET`, not per-person, not EC-verified |

This doc addresses every gap above.

---

## 1. Scope & Ground Rules

- **Voters vote from the mobile app only.** The voter-facing web pages (`VotingPage.tsx`, `VoterLogin.tsx`, `VoteConfirmation.tsx`, `HowToVote.tsx`, `LandingPage.tsx`) are deprecated and removed from the production voter flow. They may be kept read-only as public information pages, or deleted — decide during Phase 5 cutover.
- **Key holders operate through a web portal**, gated by Election-Commission-verified accounts, with device-based biometric + location checks performed via a **companion step on their phone** (mobile app or mobile web + native browser APIs — see §4).
- **Admin / Election Commission** keeps a **web portal** (existing `AdminDashboard.tsx` lineage) for vote hashing, tally triggering, batch anchoring, and the new blockchain visualizer.
- Mobile app: **React Native + Expo** (managed workflow initially, may need `expo prebuild` / dev client once native biometric + liveness SDKs are wired in — see §2.4 for why).
- No production credential material (NID salts, ElGamal private key, Shamir shares) ever touches client code — same principle as today, extended to mobile.

---

## 2. Mobile App (React Native / Expo) — Voter Flow

### 2.1 High-level flow

```
1. Open app → enter NID
2. MFA step 1: device fingerprint (biometric unlock of the phone itself)
3. Server issues short-lived "session" token bound to device + NID hash
4. Ballot screen opens → MFA step 2: face liveness check (camera)
5. On pass → decrypt candidate list, voter selects candidate
6. Client builds ElGamal ciphertext + ZKP locally (same crypto as today, ported to RN)
7. Submit vote → server validates ZKP, nullifier, casts vote (fn_cast_vote, unchanged)
8. Confirmation screen + optional push-notification receipt
```

### 2.2 NID entry + fingerprint (factor 1 + factor 2)

- NID entry: same validation/hashing contract as `backend/src/crypto/identity.ts` (`hashNidWithSalt`, `constituencyFromNid`) — reuse server-side, no change needed to the hashing scheme itself.
- Fingerprint: use `expo-local-authentication` (`LocalAuthentication.authenticateAsync`) to require the phone's enrolled biometric (Touch ID / Android fingerprint) **before** the app will submit the NID to the server. This proves "the physical owner of this phone is present" — it does **not** by itself prove *which* voter, since local biometrics never leave the device and the app doesn't know whose fingerprint is enrolled.
  - **Design decision needed**: local device biometric only proves device possession, not voter identity, unless the phone was pre-registered to that specific NID. Recommend a **device-binding step during voter registration**: `POST /voter/register-device` stores a hash of the device's secure-hardware attestation key (Android `StrongBox`/`Keystore` attestation, iOS `DeviceCheck`/App Attest) against the voter's NID hash. At vote time, the server verifies the attestation matches the registered device *and* the local biometric succeeded, giving real two-factor binding (something the voter registered + something on their body).
  - Without device pre-registration, fingerprint is a UX gate only, not a real second factor — flag this to the team before committing to the simpler version.

### 2.3 Face liveness before ballot access (factor 3, or "step-up" MFA)

- Triggered right before the ballot screen renders, not at login — matches the requirement ("when ballot option opens").
- Needs real liveness detection (blink/head-turn/depth or ML-based passive liveness), not just a selfie match, to resist photo/video spoofing. Two viable paths:
  - **Vendor SDK** (recommended for a production system): AWS Rekognition Face Liveness, Azure Face Liveness, iProov, FaceTec, or Onfido. These embed an Expo/RN SDK, run the liveness challenge client-side, and return a signed session result the backend verifies server-side against the vendor API (never trust a client-reported "pass" boolean).
  - **Self-built** (in-house ML model + challenge-response, e.g. random head-turn prompts + on-device face landmark tracking via `expo-camera` + `vision-camera-face-detector` / TensorFlow Lite): more control, more work, weaker anti-spoofing guarantees unless heavily tested. Reasonable for the academic/simulation nature of this project if a vendor contract isn't feasible.
- Store **only a liveness pass/fail + timestamp + confidence score** server-side, never raw face images/video, to avoid turning this into a biometric database (privacy + regulatory exposure). This mirrors the project's existing philosophy of not storing NID plaintext (`voters` table stores salted hash only).
- New backend endpoint: `POST /voter/liveness-check` — accepts the vendor session token (or in-house challenge result), calls out to verify, returns a short-lived `ballot_access_token` (JWT, few-minutes TTL, scoped to one constituency + one NID hash) that `POST /vote` now requires in addition to today's ZKP.

### 2.4 Why Expo managed workflow may not be enough

`expo-local-authentication` and `expo-camera` are fine in Expo Go for basic biometric prompts and camera capture. Vendor liveness SDKs (AWS/Azure/iProov/FaceTec) and device attestation (Play Integrity API, iOS App Attest) typically ship as **native modules** that require a custom dev client (`expo-dev-client`) or full prebuild — plan for **Expo's bare/custom-dev-client workflow**, not Expo Go, once a liveness vendor is chosen. Flag this early since it changes the CI/build pipeline (EAS Build instead of just `expo start`).

### 2.5 Vote crypto on-device

- Port `backend/src/crypto/elgamal.ts` (`encrypt`, `encryptCandidateId`, ZKP proof generation from `backend/src/crypto/zkp.ts`) to a shared TS module usable in React Native (pure BigInt math, no Node-only APIs — should port cleanly; verify `crypto.randomBytes` usage is swapped for `expo-crypto`'s `getRandomBytesAsync` for CSPRNG on-device).
- Reuse `shared-interfaces/types.ts` as the contract between mobile app and backend — same types already used by `frontend/`.

---

## 3. DID YOU MEAN offline handling & connectivity

- Mobile networks drop; design the vote submission as **idempotent + retryable**: client keeps the encrypted ballot + ZKP in memory (never persisted to disk unencrypted) and retries `POST /vote` with the same nullifier on network failure — server-side nullifier uniqueness (existing `nullifiers` table) already makes double-submit safe.
- Add a clear "vote not yet confirmed, do not close app" state distinct from "vote confirmed" to avoid silent failures on flaky connections — mirrors `VoteConfirmation.tsx`'s existing confirmation contract but needs offline-aware states added.

---

## 4. Key Holder Portal (EC-verified, web + phone step-up)

### 4.1 Identity model change — EC approval gate, not self-service

Today: 4 hardcoded keyholders, single shared passphrase check (`verifyKeyholderPassphrase`). Replace with a **two-step provisioning flow**, not just "EC creates the account":

1. **Request** — a candidate keyholder (or their organization: Judiciary, Academic body, Civil Society) submits a registration request through the EC portal: name, role, contact, identity document reference.
2. **Approve** — an EC admin reviews the request in a dedicated **pending-approvals queue** and explicitly approves or rejects it. Only on approval does the account become usable for anything (login, notifications, ceremony participation). This is the actual "verified by Election Commission" requirement — approval is a distinct, audited action, not implied by account creation.

Schema: new `keyholder_accounts` table — `id, name, role, contact, status (pending|approved|rejected|revoked), requested_at, approved_by (admin_id), approved_at`. `key_shares.keyholder_id` now references an approved account instead of a hardcoded `KH-001..004` string. EC can also **revoke** an account mid-cycle (e.g. a keyholder is compromised or replaced) — revoked accounts fail step-up immediately even with valid credentials.

Login itself: standard username/password or EC-issued credential + **TOTP or WebAuthn** as portal-level MFA — recommend WebAuthn (platform authenticator or security key) over SMS OTP for phishing resistance. Login only works for `status = approved`.

### 4.2 "Generate key" step-up flow

When it's time for a keyholder to submit their share (key ceremony) or participate in decryption:

```
1. EC portal marks ceremony "open" → backend creates a pending action per keyholder
2. Keyholder gets notified (push notification to their registered mobile number/app,
   or email — new notification service, see §4.3)
3. Keyholder opens the portal, clicks "Generate/Submit Share" (or "Participate in Decrypt")
4. Step-up check, performed via their phone (companion app or portal-triggered mobile
   deep link that opens a lightweight React Native module bundled in the voter app,
   OR a separate small "Keyholder Companion" Expo app — recommend the latter to keep
   the voter app's attack surface small and its permissions minimal):
     a. Location check — expo-location, compare against an EC-approved location
        allowlist/geofence for that keyholder (e.g. "must be within Dhaka" or a
        specific building) — reject/flag out-of-bounds attempts
     b. Fingerprint — expo-local-authentication, same as voter flow
     c. Face liveness — same vendor/in-house approach as §2.3
5. On all three passing, companion app calls a backend endpoint that mints a
   short-lived "ceremony participation token" scoped to that keyholder + ceremony id
6. Portal (web) then performs the actual cryptographic action (share submission /
   partial decryption) using that token as proof of step-up — the raw Shamir share
   itself should still never leave the keyholder's control unencrypted over a
   network hop the token alone doesn't protect; see §4.4
```

### 4.3 Notification service (new)

- New backend service + table: `notifications` (recipient, type, payload, delivered_at, read_at).
- Channels: push (Expo push notification service — works for both the voter app and keyholder companion app, since both are Expo-built) + email fallback (e.g. via Supabase's built-in email or a transactional provider) for keyholders, since they're a small trusted set and email is fine as backup.
- Used for: (a) keyholder "your action is needed" pings, (b) tamper alerts to voters (§5.3), (c) optional voter "your vote was confirmed on-chain" receipt.

### 4.4 Shamir share handling — don't regress security for UX

Today the raw `share_value` is POSTed in plaintext over HTTPS to `/keyshares/submit` (TLS is the only protection). Adding a step-up token is good but doesn't change that exposure. Recommend, as part of this work (not strictly required by the prompt but a natural place to fix it):
- Encrypt the share client-side to the server's ephemeral public key (or use a WebAuthn-derived key) before transmission, OR
- At minimum, ensure `/keyshares/submit` and `/keyshares/tally` are only reachable over an authenticated, step-up-token-gated channel and never logged (check current logging doesn't print `share_value` — verify in code review pass).

### 4.5 Decryption / tally flow

Same step-up pattern (location + fingerprint + face liveness) required before a keyholder's participation counts toward the 3-of-4 threshold for `POST /keyshares/tally`. Replace the single `x-admin-secret` gate with: EC admin identity (not a shared secret) + confirmation that enough keyholders have completed step-up for this specific tally run.

---

## 5. Admin / Election Commission Web Portal

Stays a **web app** per requirements ("access it from web portal"). Two core capabilities live here:

**(A) Keyholder account approval** — the pending-approvals queue from §4.1 (approve/reject/revoke) lives on this portal, gated behind EC admin login.

**(B) Vote hashing** — §5.1 below.

### 5.1 Vote hashing / batch anchoring (exists, extend)

- Current `POST /anchor/batch` (admin-secret gated) already builds Merkle batches and anchors to Sepolia. Replace shared secret with per-admin EC-verified login (same WebAuthn/MFA approach as keyholders, §4.1) + role-based access control (who can trigger anchoring vs. who can only view).
- Add audit log table (`admin_actions`: admin_id, action, target, timestamp) — currently no record of *who* triggered a tally or anchor, only that it happened.
- Clarify cadence: hashing/anchoring runs **during** the election, on a schedule (e.g. every N minutes or every batch of M votes) — there are no votes to hash before polls open. If the intent is instead a **pre-election integrity checkpoint**, that would be the EC portal hashing the finalized candidate/ballot configuration (`candidates` table snapshot) before polls open and anchoring *that* hash on-chain, so any later tampering with candidate data (adding/removing a candidate, changing a name) is independently detectable. Worth doing either way — cheap, and closes a gap the current design doesn't cover (only votes are anchored today, not the ballot definition itself). Confirm with the team which one was meant, may want both.

### 5.2 Blockchain / batch visualizer (new)

Requirement: "visualize each blockchain from blockchain so we know how each batch is connected, mark tampered ones red."

- New page, e.g. `BlockchainVisualizer.tsx` (successor to today's `TamperVisualizer.tsx`, which currently only checks one vote at a time — extend rather than duplicate).
- Data model: each `merkle_batches` row already has `batch_id`, `root`, `tx_hash`, `vote_ids` — render as a **chain graph**: nodes = batches in anchoring order, edges = "next batch" sequence (and optionally link to the previous batch's on-chain tx for a hash-chain feel, even though today's contract stores independent roots rather than a linked hash chain — consider adding `previous_batch_hash` to `MerkleRootStorage.sol` in a future contract version so batches are cryptographically chained, not just sequentially numbered).
- For each batch node: server recomputes the Merkle root from current DB state and compares to the on-chain-anchored root (extends existing `GET /anchor/verify/:voteId` logic from single-vote to whole-batch). Match → green. Mismatch → **red**, plus which specific vote(s) diverge highlighted.
- Suggest a graph library that fits the existing React/Tailwind stack — e.g. `react-flow` (a.k.a. `@xyflow/react`) for the node/edge chain rendering; keep it in `frontend/` (admin portal stays web) not the mobile app.
- Poll or (better) push-update this view — add a lightweight polling job (or Supabase realtime subscription, since the project already uses Supabase) that periodically re-verifies all anchored batches, not just on manual page load, so tampering is caught even if no admin is looking.

### 5.3 Tamper → notify every voter

Requirement: "if vote gets tampered every voter will be notified."

- When the periodic re-verification job (§5.2) detects a batch root mismatch, publish a tamper event.
- **Scale problem to flag explicitly**: "notify every voter" for a real election is a broadcast to potentially millions of push tokens — needs a queue (not a synchronous loop), e.g. Supabase Edge Function or a background worker draining a `notification_queue` table in batches through the Expo push API's bulk-send endpoint (Expo batches up to 100 messages/request).
- Notification payload should be careful not to leak which specific vote was affected (privacy — votes aren't linkable to voters by design, per the existing `votes` table having no `voter_nid_hash` column) — message should be general ("integrity alert for batch #N, election commission investigating") not voter-specific.
- Also surface the alert publicly on `PublicWatchdog.tsx` (already exists, extend it) so it's not only a push notification.

---

## 6. DDoS & Security Hardening

Nothing exists today (no rate limiter found in `backend/src/index.ts` or anywhere in the repo) — this needs to be built from scratch, not "fixed."

### 6.1 Application-layer

- Add `express-rate-limit` (or equivalent) per-route, tuned differently for public GETs (`/candidates`, `/public/stats`) vs. sensitive POSTs (`/vote`, `/voter/register`, `/keyshares/submit`) — sensitive routes get tight limits + progressive backoff.
- Add request size limits (Express body parser limits) to block oversized payload attacks.
- Add CAPTCHA (e.g. hCaptcha/Turnstile) on `/voter/register` and login-type endpoints to blunt scripted registration/credential-stuffing floods — mobile app equivalent: Apple/Google device attestation (App Attest / Play Integrity) doubles as bot-resistance since it proves a real, non-emulated device, which is a nice side benefit of the attestation work in §2.2.
- Idempotency keys on `/vote` (nullifier already provides this at the DB layer — good) and on share submission.

### 6.2 Network / infra layer

- Put the API behind a CDN/WAF (Cloudflare, AWS CloudFront + WAF, or similar) for SYN flood / volumetric DDoS absorption — this is infrastructure the app-layer code can't provide alone.
- TLS everywhere (already implied), HSTS, and pin the mobile app's expected backend TLS certificate (certificate pinning via `expo-secure-store` + a pinning library) to prevent MITM on the ballot submission path.
- Separate rate-limit tiers by source: authenticated mobile app traffic (has a session token) vs. anonymous public traffic (`/public/stats`, `/anchor/verify`) — don't let public dashboard scraping degrade voting availability.

### 6.3 Abuse-specific to voting

- Nullifier-check endpoint (`/voter/check-nullifier`) is a natural enumeration target — rate-limit hard and consider requiring the step-up session token from §2.2 rather than leaving it fully anonymous.
- Election-period traffic is bursty and predictable (opens at a fixed time) — pre-scale / warm infrastructure and load-test (k6/Artillery) against expected peak concurrent voters before go-live, not after.

---

## 7. Recommended Addition: Voter-Verifiable Cast Confirmation

Not asked for directly, but a natural, high-value fit given everything else in this doc:

- Right now a voter who submits a ballot gets a confirmation screen but has no way to later confirm, on their own, that the specific vote anchored on-chain matches what they actually cast — trust is placed entirely in the system.
- Add a **cast-as-intended receipt**: when `POST /vote` succeeds, return a short receipt code (derived from the nullifier + ciphertext, not from the plaintext choice — must never leak *who they voted for*). The voter can later punch this code into `PublicWatchdog.tsx` (or a mobile "verify my vote" screen) and see: "yes, a vote with this receipt is included in anchored batch #N, Merkle-proof verified on-chain" — reusing the existing `GET /anchor/verify/:voteId` machinery, just keyed by receipt instead of internal vote id.
- This directly strengthens the tamper-detection story from §5.2/§5.3: instead of only the EC's background job catching tampering, **every voter becomes a potential independent auditor** of their own ballot's integrity, without the system ever learning or storing their candidate choice outside the encrypted vote itself.
- Groundwork for this already exists in `testing_guidance.md` (§11b, Benaloh challenge / cast-or-audit — listed there as future work) — this receipt flow is a lightweight subset of that idea, shippable well before a full Benaloh challenge implementation.
- Low cost to add relative to the rest of this roadmap (no new crypto primitives, reuses existing Merkle proof verification) — recommend folding into Phase 4 alongside the blockchain visualizer, since both read from the same anchoring data.

---

## 8. Rough Phasing

1. **Phase 1 — Mobile app skeleton + parity.** Expo app that replicates today's web voting flow (NID → candidate list → encrypt → submit) with no new biometrics yet, proves the crypto ports cleanly to RN.
2. **Phase 2 — MFA.** Device fingerprint gate, device attestation + registration endpoint, face liveness vendor integration, `ballot_access_token` flow.
3. **Phase 3 — Key holder portal rebuild.** EC approval queue for keyholder accounts, WebAuthn login, keyholder companion app (location + fingerprint + liveness step-up), notification service.
4. **Phase 4 — Admin portal upgrades.** Per-admin auth replacing shared secret, audit log, blockchain visualizer with red/green batch health, periodic re-verification job, voter tamper broadcast, cast-as-intended receipt (§7).
5. **Phase 5 — Hardening + cutover.** Rate limiting, WAF, CAPTCHA, cert pinning, load testing, then decommission/redirect the voter-facing website.

## 9. Open Questions for the Team

- Face liveness: vendor SDK (cost, but stronger anti-spoof) vs. in-house model (free, weaker guarantees, more engineering)?
- Device attestation is the only thing that makes "fingerprint" a real second factor rather than a UX gate — confirm the team wants that complexity, or accept fingerprint as a soft gate for this academic/simulation context.
- Keyholder companion: separate small app vs. a role-gated screen inside the same Expo app? Separate app keeps the voter app's permission footprint minimal (no location access needed for ordinary voters) — recommended.
- Contract change for a true hash-chain between batches (`previous_batch_hash` in `MerkleRootStorage.sol`) is a nice-to-have for the visualizer's "how each batch is connected" requirement but is a breaking on-chain change — decide if worth a new contract deployment or if sequential batch IDs are good enough.
- "Notify every voter" scale — confirm expected voter count to size the push-notification queue/worker properly.

---

## 10. Team Execution Plan (4 people)

Split by **portal**, not generic "frontend vs backend" — each pair owns their client end-to-end (UI + the backend routes it calls), so nobody's blocked waiting on the other pair to finish an endpoint.

- **Mobile pair (A, B)** — voter app (Expo), Phases 1–2, then joins hardening in Phase 5.
- **Web pair (C, D)** — keyholder portal + EC/admin portal, Phases 3–4, then joins hardening in Phase 5.

### Week 0 — Shared kickoff (all 4, before splitting)

Do these together first — splitting before these are settled causes rework on both sides:

1. **Face-liveness vendor decision** (§9) — one choice, both portals consume it (voter app + keyholder companion). Assign one person to spike both a vendor SDK and the in-house option for a day, decide as a group.
2. **Extend `shared-interfaces/types.ts`** together — add `KeyholderAccount`, `Notification`, `BallotAccessToken`, `LivenessResult` types now, so both pairs code against the same contract from day one instead of guessing each other's shapes.
3. **Agree the new backend route list up front** (who owns which route in `backend/src/routes/`, even though both pairs will touch backend): mobile pair owns `/voter/register-device`, `/voter/liveness-check`; web pair owns `/keyholder/*` (accounts, approval, step-up) and the `admin_actions` audit log. Avoids two people editing `index.ts` route mounting at once.
4. Branch convention: `feature/mobile-<phase>-<slug>` and `feature/portal-<phase>-<slug>` off `dev`, per `CONTRIBUTING.md`. One PR per numbered subsection of this doc (e.g. "§2.2 device fingerprint + attestation") — keeps review scoped and traceable back to the plan.

### Weeks 1–3 — Phase 1 & Phase 2 (mobile) / Phase 3 (web) in parallel

| | Mobile pair (A, B) | Web pair (C, D) |
|---|---|---|
| Who does what | A: Expo skeleton + NID/candidate flow + crypto port (§2.1, §2.5). B: device fingerprint + attestation + registration endpoint (§2.2) | C: `keyholder_accounts` schema + EC approval queue UI (§4.1). D: WebAuthn login + notification service backbone (§4.3) |
| Then | Both: face-liveness integration (§2.3) once vendor is picked, `ballot_access_token` flow (§2.4) | Both: keyholder companion step-up — location/fingerprint/liveness (§4.2), reusing B's fingerprint work and the shared vendor SDK |

**Dependency to flag**: the keyholder companion step-up (web pair, §4.2) reuses the *same* fingerprint/liveness code the mobile pair builds in §2.2/§2.3. Don't let both pairs build separate implementations — factor the liveness/fingerprint client logic into a small shared RN package once mobile pair has it working, web pair imports it into the companion app rather than re-implementing.

### Weeks 4–5 — Phase 4 (web pair) / mobile pair free to help or start Phase 5 early

- Web pair: admin auth (§5.1), audit log, blockchain visualizer (§5.2, `react-flow`), tamper broadcast (§5.3), voter receipt backend half (§7).
- Mobile pair: voter receipt UI half (§7, "verify my vote" screen), then start Phase 5 items that touch mobile first (cert pinning, offline/retry hardening §3) since those don't depend on web pair's work.

### Week 6 — Phase 5, all 4 together

Rate limiting, WAF, CAPTCHA, load testing, cutover — this phase touches shared backend infra (`backend/src/index.ts` middleware), so do it as one group rather than split, to avoid merge conflicts on the same files.

### Sync cadence

- Short daily check-in between the two pairs (async is fine) — mainly to catch contract drift (someone changed a type in `shared-interfaces/types.ts` without telling the other pair).
- One weekly sync, all 4: review anything crossing the mobile/web boundary (fingerprint/liveness shared code, notification service, `admin_actions` audit log used by both portals' actions).
- Definition of done per phase: matches this doc's phase description + existing project convention — tests pass (`vote.test.ts`-style coverage for new routes), `testing_guidance.md` updated if a new adversarial case applies, PR merged into `dev` per `CONTRIBUTING.md`.

---

## 11. Full Task Checklist

Every task needed to build this out, grouped by subsystem. Use this as the literal issue-tracker seed list — one GitHub issue per checkbox (or per tight cluster of checkboxes), tagged with the phase number from §8 and assigned per §10.

### 11.1 New backend routes & schema (shared foundation — do first)

- [ ] `voters` / device binding: add `voter_devices` table (`voter_nid_hash`, `device_attestation_hash`, `registered_at`, `platform`)
- [ ] `POST /voter/register-device` — accepts attestation payload (Play Integrity / App Attest), verifies with platform API, stores hash
- [ ] `POST /voter/liveness-check` — accepts vendor session token, verifies server-side against vendor API, issues `ballot_access_token` (JWT, short TTL, scoped to constituency + NID hash)
- [ ] Middleware: `requireBallotAccessToken` — gate `POST /vote` on a valid, unexpired token in addition to existing ZKP check
- [ ] `keyholder_accounts` table (`id, name, role, contact, status, requested_at, approved_by, approved_at`)
- [ ] `POST /keyholder/request` — submit registration request (public, rate-limited)
- [ ] `GET /keyholder/pending` — EC admin: list pending requests (auth-gated)
- [ ] `POST /keyholder/:id/approve`, `POST /keyholder/:id/reject`, `POST /keyholder/:id/revoke` — EC admin actions, write to `admin_actions` audit log
- [ ] Migrate `key_shares.keyholder_id` to reference `keyholder_accounts.id` instead of hardcoded `KH-00N` strings; update `backend/src/config/keyholders.ts` accordingly (or retire it in favor of DB-backed lookup)
- [ ] WebAuthn registration/login endpoints for keyholder + admin accounts (`POST /auth/webauthn/register`, `POST /auth/webauthn/login`) — replaces passphrase-only and shared `x-admin-secret`
- [ ] `ceremony_participation_tokens` — short-lived token minted after a keyholder's step-up (location + fingerprint + liveness) passes, scoped to keyholder + ceremony id
- [ ] `POST /keyholder/step-up` — companion app calls this after local checks pass, mints the ceremony participation token
- [ ] Update `/keyshares/submit` and `/keyshares/tally` to require a valid ceremony participation token instead of (or in addition to) the passphrase/admin-secret checks
- [ ] `admin_actions` audit log table + write on every sensitive action (anchor batch, trigger tally, approve/reject keyholder, revoke account)
- [ ] `notifications` table (`recipient, type, payload, delivered_at, read_at`) + `notification_queue` table for batched sends
- [ ] Notification dispatch service (worker or Supabase Edge Function) — drains `notification_queue`, sends via Expo push batch API + email fallback
- [ ] Vote receipt: extend `POST /vote` response with a receipt code (derived from nullifier + ciphertext hash, never plaintext choice); extend `GET /anchor/verify/:voteId` (or add `GET /anchor/verify-receipt/:receipt`) to look up by receipt
- [ ] Periodic batch re-verification job — recomputes each `merkle_batches` root from current DB state, compares to on-chain root, flags mismatches, enqueues tamper notifications on mismatch
- [ ] (Optional, confirm per §5.1) Pre-election candidate-set hash + anchor endpoint, e.g. `POST /anchor/candidates-snapshot`

### 11.2 Mobile App — Voter (React Native / Expo)

**Project setup**
- [ ] Init Expo project (`expo-dev-client` from the start, not Expo Go, per §2.4)
- [ ] Set up EAS Build (iOS + Android profiles), CI hook for builds
- [ ] Wire `shared-interfaces/types.ts` as a shared package/symlink so mobile and backend never drift on types
- [ ] Port `backend/src/crypto/elgamal.ts` + `backend/src/crypto/zkp.ts` to RN-safe module (swap `crypto.randomBytes` → `expo-crypto`), add unit tests mirroring `elgamal.test.ts` / `zkp.test.ts`

**Screens**
- [ ] Landing / NID entry screen
- [ ] Device fingerprint prompt (`expo-local-authentication`)
- [ ] Device registration flow (first-time only) — attestation capture + `POST /voter/register-device`
- [ ] Constituency confirmation (mirrors `App.tsx`'s constituency banner logic)
- [ ] Face liveness screen (vendor SDK or in-house camera challenge) — gates entry to ballot screen
- [ ] Ballot screen — candidate list (`GET /candidates`), selection UI (party theming, mirrors `VotingPage.tsx` / `PARTY_THEMES`)
- [ ] Review/confirm-before-submit screen
- [ ] Submission in-flight state — distinct "submitting, don't close app" vs. "confirmed" states (§3)
- [ ] Confirmation screen with receipt code (§7) + optional push receipt
- [ ] "Verify my vote" screen — enter/paste receipt code, calls verify-by-receipt endpoint, shows Merkle-proof result
- [ ] Error states: already voted, nullifier conflict, network failure with retry, liveness failure with retry limit, device-attestation mismatch
- [ ] "How to vote" / help screens (port content from `HowToVote.tsx`)

**Cross-cutting**
- [ ] Nullifier check + double-vote prevention UX (port `checkNullifier` flow from `VotingPage.tsx`)
- [ ] Offline/retry handling for `POST /vote` (§3) — idempotent retry keyed by nullifier
- [ ] Certificate pinning for API calls (§6.2)
- [ ] Push notification registration (Expo push token → backend) on first launch
- [ ] Accessibility pass (screen reader labels, font scaling, color-contrast check for party theming)
- [ ] Localization scaffold if multiple languages needed (confirm requirement)
- [ ] App store metadata, privacy policy screen (required given biometric/liveness data use), permissions rationale strings (camera, biometric, notifications)

**Testing**
- [ ] Unit tests: crypto port, nullifier logic
- [ ] Integration tests: full vote flow against a local/staging backend
- [ ] Manual device-lab pass: real biometric hardware, real camera liveness, low-end Android + iOS
- [ ] Adversarial cases mirrored from `testing_guidance.md` §4 (malformed payload, ineligible voter, concurrent double-cast) re-run through the mobile client

### 11.3 Website — Keyholder Portal

- [ ] Registration request form (public) — name, role, contact, ID reference → `POST /keyholder/request`
- [ ] EC admin: pending-approvals queue UI (list, approve/reject/revoke actions)
- [ ] Keyholder login (WebAuthn) — replaces current passphrase-only `KeyHolderLogin.tsx`
- [ ] Keyholder dashboard: ceremony status, "action needed" banner when notified
- [ ] "Generate/Submit Share" action — triggers companion step-up, then calls `/keyshares/submit` with ceremony token (extend `KeyShareSubmit.tsx`)
- [ ] "Participate in Decrypt" action — same step-up pattern feeding into `/keyshares/tally` (extend `KeyShareStatus.tsx` / tally trigger UI)
- [ ] Keyholder Companion app (separate small Expo app, per §9 recommendation): location check (`expo-location` + geofence), fingerprint, face liveness, calls `/keyholder/step-up`
- [ ] Notification display in portal (in addition to push/email) — "why was I notified" history

**Testing**
- [ ] Shamir threshold matrix re-run against new account model (mirrors `shamir.test.ts` / `Shamir Threshold Matrix` test doc)
- [ ] Step-up bypass attempts (submit share without valid ceremony token → expect 401/403)
- [ ] Revoked-account rejection test (revoked keyholder cannot complete step-up or submit)

### 11.4 Website — Admin / Election Commission Portal

- [ ] Admin login via WebAuthn, replacing `x-admin-secret` header + `AdminLogin.tsx` mock
- [ ] Role-based access control (who can trigger anchor/tally vs. read-only observer)
- [ ] Audit log viewer (`admin_actions` table) — filter by action type, admin, date
- [ ] Blockchain Visualizer page (`BlockchainVisualizer.tsx`, successor to `TamperVisualizer.tsx`) — `react-flow` chain graph, green/red batch health, click-through to a batch's votes/proof detail
- [ ] Wire visualizer to periodic re-verification job's output (live or near-live, via Supabase realtime subscription or polling)
- [ ] Tamper alert banner + trigger for the voter broadcast (§5.3), with confirmation step before a real broadcast fires (this is a big, hard-to-reverse action — require explicit admin confirmation)
- [ ] `PublicWatchdog.tsx` extension — surface tamper alerts and batch health publicly, not just in the gated admin view
- [ ] Vote-hashing / anchor-batch trigger UI, updated to use new admin auth (extend existing `AdminDashboard.tsx` anchor controls)
- [ ] (If pursued) Pre-election candidate-snapshot hashing UI + status display

**Testing**
- [ ] Tamper-detection re-run: reuse existing `tamper-test.ts` / `TamperConsole` patterns against the new batch-level (not just single-vote) verification
- [ ] Access-control tests: non-approved/revoked admin cannot trigger anchor or tally
- [ ] Audit log completeness check — every sensitive action produces exactly one log row

### 11.5 DDoS / Security Hardening (both portals + backend)

- [ ] `express-rate-limit` on all routes, tiered per §6.1 (tight on `/vote`, `/voter/register`, `/keyshares/submit`, `/keyholder/request`; looser on public GETs)
- [ ] Request body size limits
- [ ] CAPTCHA (hCaptcha/Turnstile) on `/voter/register` and `/keyholder/request`
- [ ] CDN/WAF in front of the API (Cloudflare or equivalent)
- [ ] TLS/HSTS confirmation, mobile cert pinning (cross-ref §11.2)
- [ ] Rate-limit tiering: authenticated (has session/ballot token) vs. anonymous public traffic
- [ ] Nullifier-check endpoint hardening (§6.3)
- [ ] Load test (k6/Artillery) against expected peak concurrent voters
- [ ] Secrets review: confirm `share_value`, WebAuthn private keys, liveness vendor keys never appear in logs (§4.4)

### 11.6 Cutover

- [ ] Confirm final decision on old voter-facing web pages (kept as static info pages vs. deleted) — implement per §1
- [ ] Update `README.md`, `context.md`, `CLAUDE.md` to reflect mobile-first architecture once shipped
- [ ] `graphify update .` after the new code lands, so the knowledge graph reflects the new structure
- [ ] Final end-to-end rehearsal: full election cycle (register → vote via mobile → keyholder ceremony via portal+companion → tally → anchor → visualizer shows green → simulated tamper shows red + voter notification fires) on staging before real go-live

# MOBILE_UX_ARCHITECTURE.md — Phase 4: Mobile Architecture & UX Plan

**Status:** Phase 4 deliverable. Grounded in `AUDIT.md` (frontend/backend/crypto facts), `METHODOLOGY_CLASSIFICATION.md` (lifecycle state machines, A/B/C/D), and `THREAT_MODEL_AND_SECURITY.md` (mobile security architecture, threats T1–T22, D1–D6). The user has confirmed the target **React Native / Expo**; this document does not smuggle that choice in — it derives it from the audit, then specifies the screens from the actual vote lifecycle.

---

## 1. Recommended approach — React Native with Expo (driven by the audit, not chosen first)

**Evidence that points at React/TypeScript rather than anything else:**

1. **The existing frontend is React + TypeScript end-to-end** (`frontend/package.json`: React 19, TypeScript ~6, react-router-dom; AUDIT §2). The entire client voting logic — ElGamal encryption, the Chaum–Pedersen OR-proof prover, and the Benaloh cast-or-audit helpers — is **already written in TypeScript** in `frontend/src/utils/elgamal.ts` (AUDIT §2, §7 Step 2). A React Native/Expo app can port that file with near-zero algorithm churn (D4). Flutter would require re-deriving the crypto in Dart with no shared code; native iOS *and* Android would mean two ports.
2. **Backend compatibility is trivial for any HTTP/JSON client, but type-sharing matters:** the repo's cross-package contract is `shared-interfaces/types.ts` (TS) and the migration (B7, Phase 5) will correct it. Expo lets the mobile app and the backend literally share the TypeScript types and a single crypto module — matching the repo's established "one implementation" convention (e.g. `merkleTree.ts` is imported by both the backend *and* the Solidity tests so the two sides can never drift, ci.yml comment, AUDIT §12).
3. **The repo's own roadmap already decided this.** `FUTURE_WORK.md` (08782df) and its byte-identical duplicate `FUTURE_IMPLEMENTATION.md` state: *"Mobile app: React Native + Expo … [voters] vote from the mobile app only"* (AUDIT §13, §15.1). Per Rule 5 these existing planning docs are authoritative context; nothing in the audit contradicts the choice — it *corroborates* it.
4. **Phase 3 security requirements map onto the Expo ecosystem without custom device code:** OS-backed secure storage (D2: iOS Keychain / Android Keystore via an Expo-compatible secure-store wrapper), a CSPRNG for the ported prover (D4: `crypto.getRandomValues`-equivalent under Expo), and HTTPS enforcement (D5). Building these from scratch on a custom native stack would cost far more for zero methodological gain.
5. **Maintainability:** one TS codebase matches team conventions (vitest, oxlint, npm `--prefix` monorepo — README/CI); the core crypto should live in a **pure-TS shared package with no Expo imports** so it stays unit-testable under vitest exactly like the backend (this lets Phase 6 cross-validate the ported prover against the backend verifier using the same test harness).

**Approach decision:** **React Native via Expo (managed workflow)**, with the voter-facing SPA (`VotingPage`/`VoterLogin`/`VoteConfirmation`, etc.) deprecated for the production voter flow per FUTURE_WORK §1; admin and keyholder flows remain web portals (Phase 3 §4.6). The web SPA continues as the research/demo surface and public-information pages where the repo's evidence pipeline needs it.

**Implementation shape (details in Phase 7):**
```
packages/
  core-crypto/     ← port of frontend/src/utils/elgamal.ts (+SHA-256/Fiat–Shamir pieces), pure TS, vitest
  core-api/        ← typed client for the Phase-5 API (sessions, /vote, /candidates, /public/*), pure TS
  mobile-app/      ← Expo app; imports core-crypto + core-api; expo-secure-store for tokens/audit data
```
---

## 2. Current web screens/flows and usability & accessibility problems (verified in code)

### 2.1 Current screen inventory and flows (from `frontend/src/App.tsx`, pages, and `frontend/src/utils/api.ts`)

| Route | Screen | Role in lifecycle (METHODOLOGY_CLASSIFICATION Part 2) |
|---|---|---|
| `/` · `/how-to-vote` · `/about` | LandingPage / HowToVote / About | Public info |
| `/watchdog` | PublicWatchdog | Public stats (counts only — public.ts) |
| `/visualizer` | TamperVisualizer | Batch health / tamper demo |
| `/voter/login` | VoterLogin → `registerVoter` | Step 1 (auth/register) |
| `/voter/vote` | VotingPage (encrypt + ZKP + Benaloh audit modal) | Steps 2–3 (ballot + cast) |
| `/voter/confirmation` | VoteConfirmation (receipt) | Steps 3(b)–4 (receipt) |
| `/keyholder/*`, `/tally` | KeyHolderLogin, KeyCeremony, KeyShareSubmit/Status, TallyingPage | keyholders/admin (web-only in the mobile plan) |
| `/admin/*` | AdminLogin (mock), AdminDashboard (mock candidate form + real election creation) | admin (web-only in the mobile plan) |

### 2.2 Usability / accessibility problems found in the actual code (citations)

- **U1 — The ballot screen is reachable *unauthenticated* with a fabricated identity.** `VotingPage.tsx:71-76`: `const voterNid = state?.nid ?? "00000000000";` — a voter who lands directly on `/voter/vote` (bookmark, share, back-button) sees a real ballot for the all-zero NID (`x-voter-nid: 00000000000` passes the server's format check; candidates are returned for the derived constituency). The cast would fail server-side (not registered), but the UI shows a full voting screen first — confusing in the worst case, and it normalizes "voting without being authenticated."
- **U2 — The UI can report success the server never produced.** The offline mocks (`api.ts` C1 — `submitVote` returns `vote_id:"mock-vote-…"` and records `localStorage.mock_voted_nids`) and the receipt screen's fabricated `tx_hash` plus random `vote_id` fallback (`VoteConfirmation.tsx:15-24`, C2) are the *opposite* of what a voter needs to trust a voting app (Phase 3 §5; mobile must be fail-closed, D3).
- **U3 — No session means re-authentication every visit, and refresh destroys the flow.** The NID is re-entered on every visit (no sessions — AUDIT §5), and the confirmation screen depends on router state that a refresh wipes, which is exactly when U2's fabricated `vote_id` appears. D1/D6 fix this for mobile.
- **U4 — NID input is not mobile/keyboard- or AT-friendly.** `VoterLogin.tsx:138-148`: `type="text"` (no `type="tel"`, `inputMode="numeric"`, or `pattern` attribute to trigger a numeric keypad or announce format), `autoComplete="off"`, and the validation hint is a separate `<p>` not associated via `aria-describedby`.
- **U5 — Screen-reader support is essentially absent.** Repo-wide pattern count over every `frontend/src/**/*.tsx`: **`role=` appears 0 times and `aria-*` 3 times** (vs 24 `<label>`/16 `htmlFor`, which are used correctly where present). Custom interactive widgets with no roles/state: the candidate "cards" in VotingPage, the cast-or-audit modal (`showModal`), the navbar menu, and all trust/badge visuals. Errors are rendered as plain `<p>`/`<div>` with no `role="alert"`/`aria-live`. No skip-links encountered. (Modal focus-trap behavior in `showModal`: not implemented anywhere visible — `UNKNOWN — REQUIRES VERIFICATION`, AUDIT §16.5.)
- **U6 — Key material in `sessionStorage`.** The DKG ceremony page holds a private polynomial + ECDH key in `sessionStorage` (documented in the CSP comment, `index.html:8-17`). Fine for a short-lived browser flow; **must not be replicated** on mobile where the app process and OS both persist state — D2 (secure store) governs instead.
---

## 3. Mobile screen & navigation set — derived from the actual vote lifecycle

Derivation rule: every screen below exists because a *specific step* of the vote lifecycle (METHODOLOGY_CLASSIFICATION Part 2, which was itself derived from code) requires it — plus one election-context screen and one settings screen that the lifecycle facts force (multi-election A10; session revocation D6). No generic "voting app" screens.

Lifecycle steps referenced: **S0** election+key+commitment preconditions → **S1** register/auth → **S2** build ballot (pubkey + candidates) → **S3** encrypt+prove (cast path) or **S3a** audit path → **S3b** submit (POST /vote) → **S4** stored 'queued' → **S5** anchored 'confirmed' + verify → **S6** tally → **S7** results.

| Mobile screen | Purpose (what step it serves) | Backend endpoint(s) after Phase 5 | Phase-3 element it exercises |
|---|---|---|---|
| **Election Hub** (`S0` elect) | List elections from the registry and their *server-reported* availability; sets the active `election_id` (fixes U7). No election → nothing else exists. | `GET /elections`; (after T13) server status shown as open/closed | A10; T13 |
| **Authenticate** (`S1`) | NID entry on a numeric keypad (fixes U4), CAPTCHA + rate-limit messaging (T10), issues the **session token** (D1). Explicit "your NID is used only to establish eligibility; nothing identity-linked is stored with the ballot" (Part 4 of Phase 2's plain language). | `POST /voter/session` (new), `POST /voter/register` under the hood | D1, D5, T10 |
| **Voter status** (`S1` outcome) | Server truth: registered? eligible? already voted? If `has_voted` → terminal "You have already voted in this election" (matches web behavior, VoterLogin.tsx:37-41, but from the session). | session-scoped status (`GET /voter/me`) | A1 (server authority), D1 |
| **Ballot** (`S2`+`S3`) | Fetch public key + this voter's constituency candidates via the session; select candidate; **encrypt + build ZKP entirely on device** (ported `core-crypto`); show selection in plain language before confirm. | `GET /election/public-key`, `GET /candidates` (session auth) | A3, A4, D4 |
| **Cast-or-audit (Benaloh)** (`S3a` branch) | Before committing: "Audit this ballot" → reveals randomness `r`, re-computes and shows the ciphertext, voter confirms match (the web modal's behavior, elgamal.ts:284-315). Saving audit data is **opt-in only** and lands in secure storage (D2). "Cast" always re-encrypts with a fresh `k` — the audited ciphertext is never submitted (web semantics preserved). | (all local) | A13, D2 |
| **Confirm & submit** (`S3b`) | One decisive "Cast vote" action with the real server's response: `201 {status:"queued", vote_id}` on success; 409/403/404 surfaced in plain words. **Nothing is shown as recorded unless the server said so** (fixes U2). | `POST /vote` (session auth; body no longer carries NID) | A1, A3, D1; C1/C2 excluded |
| **Receipt / anchoring status** (`S4`→`S5`) | Shows the real `vote_id`, state `queued` → `confirmed`, and — only once the batch is anchored — the `tx_hash`/batch from the **real** anchor data. Until then it says "pending anchoring" (the web's fabricated tx_hash (C2) is gone). | `GET /anchor/verify/:voteId` + `GET /anchor/latest` (public) | A6, A7 |
| **Verify** (`S5` for anyone) | Enter a `vote_id` (or pick a saved one from the Receipt screen) and show **local + on-chain** membership result (`included_locally` / `included_on_chain`, and the SMT membership check) with an honest "verification pending" state when the chain is unreachable. | `GET /anchor/verify/:id`, `GET /anchor/verify-smt/:id` | A7 |
| **Watchdog** (public, read-only) | Turnout, key-ceremony, anchoring progress — the public.ts counts, nothing ballot-specific. | `GET /public/stats` | A15 |
| **Results** (public, read-only) | Aggregate published results or "not tallied yet". | `GET /public/results` | A15, T19 |
| **Settings / Security** | Sign out (revoke this session server-side), "sign out everywhere", device info, link to the issuer's privacy & coercion notice, manage saved Benaloh audit data (view/delete from secure store). | `POST /voter/session/revoke` (new) | D1, D6, Part 4 (privacy) |
| **Global (not a screen):** connectivity banner + **offline fail-closed overlay** (D3) — see §4. | | | D3 |

---

## 4. Offline behavior — is offline vote creation acceptable here? **No, and here is the code-based reason.**

Whether offline *vote creation* can ever be acceptable is determined by where this system's validity guarantees actually live:

1. **Ballot validity is established only by the server.** The ZKP that the ciphertext encrypts one of the constituency's real candidates is *verified server-side* (A3; vote.ts:186-197), and only against a *server-derived* candidate set (A4). A ballot sitting in an offline queue has never been validated; letting the client decide "this ballot is valid" would move the trust decision into unverifiable client territory — a direct violation of Rule 7 ("server and DB are always the authority").
2. **Duplicate-vote prevention is a DB transaction, not a client flag.** `fn_cast_vote` serializes the cast on the voter's row and flips `has_voted` atomically (A1); the concurrency threats T7/T8/T22 (same voter, N parallel requests, two devices) are resolved by that **row lock and the unique constraints — none of which exist on a phone**. An app that queued a ballot offline and uploaded it "later" could race an already-cast ballot and have no way to know, by itself, that it lost — the server rejects it (409), but the voter already saw "recorded" on a screen that a fully-offline queue would have shown. That is precisely the C1 error class the mobile app must not reintroduce.
3. **The nullifier is server-derived with a server secret (A2)** — no offline client can compute or verify it, so an offline "vote" has no way to demonstrate eligibility/anonymity correspondence until the server does all of it.
4. **Anchoring is server-side** (A6): tamper-evidence begins when the batch root is committed on-chain; a ballot that never reaches the server can never be anchored or verified (A7). An offline queue would quietly create a "forever unverifiable" ballot category.
5. **Read-only public content** (Watchdog counts, Results, published Verify data) may be cached/displayed offline because it is public by construction (Phase 3 §4.5), but nothing that affects the voter's own cast may be.

**Decision (fail-closed):** the mobile app **does not create ballots offline**. Any drop in connectivity during the journey shows the global banner/overlay: *"You appear to be offline. Your vote is NOT recorded. Reconnect to continue."* Step-level retries are safe only because the protocol is idempotent by construction — re-firing `POST /vote` after a timeout yields either the same 201 or a 409 if it already landed (A1), so the retry can never double-cast and never lies. This is the D3 element, and it is the *reason* U2/C1 (fake success) is structurally impossible on mobile: **a success screen can only be rendered from a 2xx response of an actual server round-trip.**

The web SPA's C1 mocks are demonstrating the *exact opposite* behavior — that is why they are C-classified (replacement, not port).

---

## 5. Interaction & accessibility guidance for the derived screens (addresses U1–U7)

- **Keyboard/AT parity:** the Ballot candidate list uses native radio semantics (`accessibilityState`/`aria` equivalents in RN); the Cast-or-audit modal traps focus, returns focus on close, and announces state changes via accessibility screens (`accessibilityLiveRegion`); all errors use `role="alert"`-style announcement (U5). NID entry uses a numeric keypad, `inputMode="numeric"`, and format guidance announced on arrival (U4).
- **Plain-language trust copy:** every state a voter might misinterpret gets an explicit sentence: "not recorded yet", "recorded, awaiting anchoring", "anchored", "already voted", "election closed" (U2, T13).
- **No fabricated values:** the receipt shows only `vote_id` from the 201 and real anchor data; where anchoring hasn't happened the field says "pending" (C2 gone).
- **One-tap audit-cast:** audit reveal and "go back" return to a *fresh* encryption (fresh `k`), keeping the audit ciphertext out of the submission path (A13 semantics preserved).
- **Session transparency:** Settings shows the active device/session and a one-tap "sign out everywhere" (D6); after reinstall the voter re-authenticates (device_id change) with copy explaining why (D1).
- **Accessibility acceptance bar for Phase 7 DoD:** screens must pass automated checks (screen-reader tree completeness, touch-target ≥44px per platform guidance, 4.5:1 text contrast), plus a manual screen-reader walkthrough of the full journey. **Corrected at build time (BUILD_NOTES §2.3):** the earlier claim that `VoterLogin.tsx:116`'s inline hex is a contrast risk was wrong — line 116 is `#0A2540` on a light card (≈13:1). The real measurable failures in the web UI are `#627d98` at 14px (≈3.9:1) and the `#C8920A` validation hint at 12px (≈2.5–2.8:1); the mobile screens must not reproduce those pairs.

## 6. What Phase 5/7 will take from here

- Phase 5 turns the endpoint column of the §3 table into the migration spec (`/voter/session`, session auth on `/vote`, `/candidates`, `/voter/me`, revocation), and the §4 decision into the API contract ("no offline vote path exists").
- Phase 7 sequences: `core-crypto` port → `core-api` → `mobile-app` screens (in lifecycle order) → a11y/UX hardening → E2E rehearsal — each with the tests Phase 6 specifies.
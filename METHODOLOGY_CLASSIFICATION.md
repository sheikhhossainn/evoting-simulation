# METHODOLOGY_CLASSIFICATION.md — Phase 2: Methodology Extraction & Classification

**Status:** Phase 2 deliverable. **Source:** derived exclusively from `AUDIT.md` (Phase 1; all citations there map to audited files), not from memory of typical voting systems. Unverifiable items stay tagged `UNKNOWN — REQUIRES VERIFICATION` (AUDIT.md §16).
**Filename note:** the repository already owns a research `METHODOLOGY.md` (Rule 5 doc — AUDIT.md §13). This file does **not** overwrite it; it is a distinct analysis deliverable.

Classification legend (per Phase 2 spec):
- **A — Must be preserved** (works; removing/changing it would weaken or contradict a currently guaranteed property)
- **B — Should be improved** (works, but has a concrete, cited weakness)
- **C — Should be replaced** (doesn't work / actively wrong; evidence cited)
- **D — New mechanism required for mobile** (a gap that exists only because of the mobile context)

Every B and C carries a cited weakness from AUDIT.md. A-items name the property they preserve.

---

## Part 1 — Election lifecycle as it actually exists in code (derived state machine)

Facts from AUDIT.md §4 (`elections`), §6 (endpoints), §7, §15.4, §16.4.

```
   elections rows exist only via:
     • POST /elections (admin secret) → status = 'setup'   (elections.ts:36-57)
     • schema seed INSERT             → status = 'tallying' (schema.sql:939-943)
                          │
                          ▼
   status: TEXT CHECK ('setup','voting','tallying','closed')  (schema.sql:924-926)
   ─────────────────────────────────────────────────────────────────────────
   NO CODE TRANSITIONS THIS FIELD. Verified: POST /elections inserts 'setup'
   only; the seed row is hard-set to 'tallying'; a codebase search found no
   `UPDATE elections SET status=…` in any route/service/script
   (AUDIT.md §15.4, §16.4).
                        ─────────────────────────────────────────────
   ⇒ DERIVED STATE MACHINE: the only real gate on vote acceptance is the
     conjunction of three server-side gates inside POST /vote (vote.ts):
       G1  elections row exists                        (else 404)
       G2  election_key_ceremony.status='qualified'    (else 503; vote.ts:178-184)
       G3  election_setup_commitments row exists       (else 412;
           vote.setupCommitment.test.ts)
```

**Stated honestly:** `elections.status` is **descriptive, not enforced** — there is no "voting open/closed" check at the API layer today (AUDIT.md §16.4 marks any out-of-tree updater `UNKNOWN — REQUIRES VERIFICATION`). This is the actual behavior, not a textbook lifecycle.

---

## Part 2 — Vote lifecycle as it actually exists in code (derived state machine)

Facts from AUDIT.md §7 (Steps 1–8). The vote row has `status vote_status` (`'queued' | 'confirmed' | 'rejected'`, schema.sql:22) but only one transition is ever written:

```
  Voter UI                    Backend/DB                    Background / chain
  ─────────                   ─────────────                 ─────────────────────
  /voter/login                POST /voter/register          setInterval 5 min
  (NID entry)                 (voter.ts:54 upsert;          (index.ts:99-101)
       │                      is_eligible=true)             -> maybeAutoAnchor()
       ▼                              │                    (anchorBatch.ts:171)
  /voter/vote                  POST /vote (vote.ts:71):     trigger: unanchored ≥ 50
  fetch public-key +          G1/G2/G3 gates; derive        OR oldest unanchored
  candidates; build ElGamal   nid_hash/nullifier/const;    ≥ AUTO_ANCHOR_MAX_AGE_MS
  ciphertext + ZKP client-    ZKP verify against SERVER-   -> runAnchorBatch(election):
  side (encryptCandidateId-   derived candidate set;       leaves -> buildMerkleTree
  WithProof); optional        fn_cast_vote atomic:          -> contract.anchorRoot
  Benaloh audit modal          row-lock, elig/has_voted     -> INSERT merkle_batches
                               checks, INSERT votes,        -> votes.status='confirmed'
       │                        has_voted=true)              + tx_hash (anchorBatch.ts:129)
       │                        + best-effort nullifiers     -> runAnchorSmtBatch
       ▼                        insert (vote.ts:246-263)     (cumulative SMT)
  POST /vote → 201 {status:"queued", vote_id}
       │
       ▼
  votes row: status='queued', tx_hash=NULL; encrypted_vote+zkp_proof immutable
       │
       ▼  (only writer of a status transition found: anchorBatch.ts:129)
  status='confirmed'
       │
       ▼
  GET /anchor/verify/:id — anyone verifies leaf↔root locally + on-chain
       │
       ▼  (tally time)
  3 keyholders submit d_i + DLEQ (POST /keyshares/submit-partial, INSERT-only)
  → POST /keyshares/tally (admin, explicit batch_id) combines ≥3 per ballot,
    never reconstructs x; writes tally_results; GET /public/results serves them
```

**Stated honestly:**
- `'queued'` is the as-cast state; `'confirmed'` is set only by the batch anchor. `'rejected'` is **never written by any code path** (AUDIT.md §15.4, §16.3); the enum member and the tally's `invalid_votes`/`rejected_votes` are not the same thing — a ballot that fails at tally increments `tally_results.invalid_votes` without changing its `votes.status` row.
- Replay of a *successful* cast body → 409 (`has_voted` / unique nullifier, AUDIT.md §9). Replay *before* any cast is simply another fresh attempt — the protocol carries no nonce/timestamp/ballot signature (AUDIT.md §9 "Replay note").
- The frontend mock path can fabricate a success-shaped result with no server round-trip (AUDIT.md §15.7) — **not part of the real lifecycle** (finding C1 below).

---

## Part 3 — Candidate/option creation and administrative controls (as they exist)

Facts from AUDIT.md §4 (`candidates`, `elections`), §6 (coverage note), §8, §10, §15.6.

- **Candidate rows** (`candidates`, schema.sql:209) are required before any vote: the ZKP is checked against `SELECT id FROM candidates WHERE election_id=? AND constituency_code=?` (vote.ts:157-176). **There is no HTTP route that creates/updates candidates** (AUDIT.md §6 coverage note) and **no candidate seed script exists in the repo** (AUDIT.md §15.6 — `vote.test.ts:63-65` itself references a missing "seed-candidates" script). *To verify:* live DB provenance (AUDIT.md §16.1).
- **The only creation controls that exist in code, per election:** (1) `POST /elections` (elections.ts:36, admin secret; status `'setup'`, contract addresses optional); (2) the DKG ceremony (`POST /dkg/init` admin → keyholder rounds 1-3) which yields the per-election ElGamal public key — `/vote` returns 503 until `qualified` (electionContext.ts:79-89); (3) the election setup commitment (off-chain `election_setup_commitments` row + write-once on-chain `ElectionSetupCommitment.anchor`, candidateCommitment.ts) — precondition for `/vote` (412); (4) seed scripts `seed-constituencies.ts`, `seed-keyholders.ts`, `seed-voters.ts`.
- **`AdminDashboard.tsx`'s candidate form is a UI mock over sample data** (AUDIT.md §10) and does not touch the DB; `AdminLogin.tsx` is also a UI mock (adminAuth.ts:4-8).
- **Net:** candidate admission has neither a self-service path nor an admin HTTP path today — it is SQL/script domain; the freeze triggers (`trg_candidates_immutable_after_commitment`, per-election schema.sql:1132) are the only programmatic "controls" after commitment.

---

## Part 4 — Anonymity / ballot-secrecy properties (as they actually exist)

Facts from AUDIT.md §4 (`votes`, `voters`, `nullifiers`), §5, §7 Step 3, §9, §11, §15.

### 4.1 "Voter authenticated" — YES
The raw 11-digit NID is the credential. `POST /voter/register` (voter.ts:54) establishes a `voters` row (`nid_hash`, `is_eligible`, `has_voted`); `fn_cast_vote` (schema.sql:1077-1124) authenticates by `(election_id, nid_hash)` before inserting a vote. The server therefore **does know which voter is voting at cast time** — it checks eligibility and flips `has_voted` for that specific `nid_hash`.

### 4.2 "Vote is anonymous" — YES, with a precisely-bounded caveat
- The stored `votes` row contains **no voter-identity column** (`voter_nid_hash` was removed; AUDIT.md §4.1, schema.sql:5-17, verified by vote.test.ts "schema does not store raw nid_hash in votes table").
- The vote row's only voter-derived field is `nullifier_hash = SHA-256(nid ‖ election_id ‖ NULLIFIER_SECRET)` (identity.ts:33-38), computed **server-side only**; `NULLIFIER_SECRET` never reaches any client (identity.ts comment; nullifier.ts "removed").
- Consequence: **without `NULLIFIER_SECRET`, voter identity and vote choice are NOT linkable** — neither from the DB (votes↔voters have no join column, and `constituency_code` is shared by thousands) nor from any public output.

### 4.3 Where voter identity and vote choice ARE linkable (stated plainly)
1. **Server-side at cast time:** the Express process receives the raw `nid`, derives both `nid_hash` and `nullifier_hash` from it in the same request (vote.ts:205-215), and holds `NULLIFIER_SECRET`. The pairing exists transiently in that process's memory; **it is not persisted as a pairing** (the nullifier→vote rows and nid_hash→voter row live in different tables with no FK). So the datum "the server *can* link" is true; "the server *does* store the link" is false.
2. **DB administration with the secret:** anyone with `NULLIFIER_SECRET` + DB read can recompute any voter's nullifier and join `votes.nullifier_hash` (audit-level linkage). `supabaseClient.ts` currently uses the service-role key, so today's backend has full DB access anyway.
3. **Participation oracle (leak of "did X vote?", not the choice):** `POST /voter/check-nullifier` (voter.ts:148-182) is **unauthenticated** and returns `{exists: bool}` for any submitted NID. Anyone who knows a NID can learn whether that person voted. It never reveals the choice.
4. **The tally is only ever aggregate:** `tally_results` stores per-constituency candidate counts and rejection reasons (keyshares.ts:387-400); `GET /public/results` never exposes plaintext ballots. But note `rejected_votes[]` rows reference `vote_id`s — separate from identity, this reveals *which ballot rows* were invalid.

### 4.4 What secrecy does NOT cover (AUDIT.md §15.13, docs)
- **Coercion-resistance is explicitly out of scope** (docs/explicit-assumptions-and-nongoals.md §2): there is no receipt-freeness; a voter who keeps their Benaloh audit data could prove their choice to a third party.
- The Benaloh cast-or-audit path (frontend elgamal.ts:284-315) intentionally reveals randomness — for the audited ballot, secrecy is exchanged for verifiability (that is the point of cast-or-audit).
- Blinding/hiding of *who is connected to the server* (network-level metadata) is not addressed.

### 4.5 Conclusion for the mobile build
---

## Part 5 — Anti-tampering / integrity mechanisms: what each actually protects (verified)

Each row verifies the mechanism's own name/comment claim against what the code actually does (AUDIT.md §10, §11, §12; thesis METHODOLOGY.md rows).

| Mechanism (code location) | What it actually protects against | What it does NOT cover (verified) |
|---|---|---|
| `trg_votes_immutable` / `fn_votes_immutable_guard` (schema.sql:282-306, 1003-1021) | Silent substitution of `encrypted_vote`, `nullifier_hash`, `constituency_code`, `election_id`, `created_at` on a stored ballot (DB-layer defense-in-depth) | A DB admin dropping the trigger (threat_model.md §2); a future writer modifying the *permitted* fields `status`/`tx_hash`/`zkp_proof` |
| `trg_votes_no_delete` (schema.sql:310-318) | Deletion of cast ballot rows at the DB layer | `fn_admin_delete_vote` (schema.sql:331-347, demo-only), DB admin disabling triggers |
| Dense Merkle batch root anchored on-chain (merkleTree.ts, MerkleRootStorage.sol, anchorBatch.ts) | **Detection** of any post-anchor modification of an included vote or of `merkle_batches.vote_ids` — `GET /anchor/verify/:id` returns 409 on recomputed-root mismatch (anchor.ts:132-139) | Pre-anchor edits (window bounded by 50-vote / 30-min cadence, AUDIT §15.13); same-sibling-pair reordering (commutative `hashPair`, threat_model §9); ballot omission before first anchor (completeness, docs/explicit-assumptions §1) |
| Sparse Merkle Tree root + chain continuity (`previous_smt_root`) (sparseMerkleTree.ts, anchorSmtBatch.ts, MerkleRootStorage.sol) | **Detection** of deletion of an already-anchored nullifier (membership proof converts to non-membership; old membership proof still verifies against the old root) and of unauthorized "new key" additions | A silently-redone anchor with an attacker-controlled root going on-chain (requires `ANCHOR_PRIVATE_KEY`, out of the threat model); in-process cache rebuild correctness across restarts (rebuilds from DB, anchorSmtBatch.ts:46-73) |
| `election_setup_commitments` + write-once `ElectionSetupCommitment.anchor` + freeze triggers (candidateCommitment.ts, contract, schema.sql:847-1180) | Substitution of the candidate/constituency set *after* the pre-vote commitment (412 gate + TLV hash + read-onchain comparison), and live-DB drift below a published commitment | A re-deploy of a *new* contract for a materially-changed slate (documented as the intended way to change the slate: visibly distinct deployment) |
| `fn_cast_vote` row-lock + P0002/3/4 (schema.sql:1077-1124) | Concurrent double-cast, unregistered cast, ineligible cast — atomically | — (relies on NID-based eligibility itself, see B1) |
| Unique `(election_id, nullifier_hash)` / `(election_id, nid_hash)` / `(election_id, nullifier_hash)` on `nullifiers` (schema.sql:552, 994, 408-410) | Duplicate vote rows even if the app/stored-proc layer is bypassed | — |
| Mandatory ZKP + server-derived candidate set (zkp.ts:201-265; vote.ts:157-197) | Ballots encrypting a value outside the constituency's candidate set; attacker-forged "valid set"; plaintext-choice leakage in the request (no plaintext candidate field exists, vote.ts:51 comment) | Ballot validity only — not who casts, not encryption strength (256-bit simulation-grade key, elgamal.ts:7) |
| DLEQ partial-decryption proofs with domain binding (dleq.ts:74-189) + INSERT-only `partial_decryptions` + no-update trigger (schema.sql:1316-1324) + ≥3 threshold combine (dleq.ts:202-223) | Malicious or mistaken keyholder partials, proof relocation across ballot/keyholder/election, silent overwrite of a bad submission, and private-key reconstruction at any point | Collusion of ≥3 of 4 keyholders (threshold trust model, threat_model §10) |
| `NULLIFIER_SECRET`-salted nullifier (identity.ts:33-38) | External linkage of stored ballot to voter (Part 4) | Server-side linkage by the process that holds the secret and saw the raw NID (Part 4.3) |
| Fresh random `k` per ElGamal encryption + Benaloh audit path (frontend elgamal.ts) | Ciphertext correlation across ballots of the same choice; cast-or-audit verifiability | Coercion-resistance (part 4.4) |
| Merkle leaf double-hash + SMT position-aware hashing (merkleTree.ts:30-48; sparseMerkleTree.ts) | Second-preimage leaf/node confusion; SMT key-relabeling (anti-K1/K2 regression tests, REFACTOR.md §3) | Same-pair reorder (dense tree, see above) |
| `timingSafeEqual` compares (adminAuth.ts:34; keyholders.ts:76-79) | Timing side-channels on admin/keyholder credentials | Credential strength / rate limiting (B4) |
---

## Part 6 — Classification of existing behavior (A / B / C / D)

Every item cites the weakness (for B/C) or the preserved property (for A). Sources are AUDIT.md section/file refs.

### A — MUST BE PRESERVED

| # | Mechanism (verified location) | Property it preserves (why replacing it would break a guarantee) |
|---|---|---|
| A1 | Atomic server-side cast: `fn_cast_vote` (schema.sql:1077-1124) with row-lock, eligibility/`has_voted` checks, INSERT, `has_voted` flip — plus unique `(election_id, nullifier_hash)`, `(election_id, nid_hash)`, `(election_id, nullifier_hash)` on `nullifiers` (schema.sql:994, 408-410, 552) | One-person-one-vote under concurrency, with the DB as final authority (Phase-1 §9; §4.2) |
| A2 | Server-side identity/nullifier/constituency derivation; `NULLIFIER_SECRET`/`NID_HASH_SALT` never leave the server (identity.ts:20-38; vote.ts:187; nullifier.ts "removed") | Ballot-unlinkability for everyone except the secret holder (Part 4) |
| A3 | Client-side ElGamal of the choice + mandatory Chaum–Pedersen ZKP, verified against the **server-derived** candidate set; **no plaintext candidate field in the request** (vote.ts:51 comment, 157-197; zkp.ts) | Ballot validity without revealing the choice; no plaintext in transit/storage |
| A4 | Server-derived candidate authority (vote.ts:157-176; candidates.ts) | Trust boundary: attacker can't smuggle a forged "valid set" |
| A5 | `trg_votes_immutable` + `trg_votes_no_delete` (schema.sql:282-321) | Stored ballots cannot be edited/deleted through any normal path |
| A6 | Dense Merkle + SMT anchoring pipeline (anchorBatch.ts, anchorSmtBatch.ts, contracts; auto-anchor 50/30-min; chain as source of truth) | Post-anchor tamper/deletion **detection** (the project's core methodology claim, thesis METHODOLOGY.md rows 5-6) |
| A7 | Public verification surface: `GET /anchor/verify/:id`, `verify-smt`, `keyshares/verification-bundle`, standalone `independent-verify-tally.ts` | Anyone-trustable tamper evidence without admin access |
| A8 | Verifiable threshold tally: DLEQ partials (dleq.ts), INSERT-only `partial_decryptions` + no-update trigger (schema.sql:1316-1324), ≥3 combine, **never reconstruct x**, explicit `batch_id` (keyshares.ts:31-51) | Tally integrity + accountability of each keyholder; no single party ever holds x |
| A9 | Election setup commitment (412 gate), TLV commitment construction, write-once on-chain anchor, freeze triggers (candidateCommitment.ts; contract; schema.sql:847-1180) | Candidate/constituency set integrity (no silent slate substitution) |
| A10 | Multi-election isolation pattern: `election_id` required everywhere, `resolveElectionId` no default (electionContext.ts:51-68), election-scoped SMT cache (anchorSmtBatch.ts:35) | Elections never leak into each other (relevant on mobile where one app serves many elections) |
| A11 | Election-scoped keyholder passphrase verification + server-derived `share_index` (keyholders.ts:50-80) | Keyholder identity binding per election |
| A12 | Per-election public key sourced from the DKG ceremony, 503 until qualified (electionContext.ts:79-89; vote.ts:178-184) | Encrypt/decrypt sides can never drift apart (the two sides read the same ceremony row) |
| A13 | Benaloh cast-or-audit path (frontend elgamal.ts:284-315) | Voter-side verifiability of ballot encryption (the project's own roadmap direction, FUTURE_WORK §7 line) |
| A14 | DKG relay design — server stores/forwards AES-GCM sub-shares it cannot read; only public Feldman vectors are combined (dkg.ts; dkg_shares table) | "x exists nowhere" at generation time (formal-security-definitions §5 residual, closed by dkg-security-analysis) |
| A15 | Tally publication is aggregate-only (`tally_results`, public.ts:126-161); public stats are counts (public.ts:31) | No plaintext ballot ever leaves the DB |
### B — SHOULD BE IMPROVED (works today; each with a cited weakness)

| # | Mechanism | Cited weakness (AUDIT.md) | Improvement direction (details in Phases 3/5/7) |
|---|---|---|---|
| B1 | Voter registration sets `is_eligible=true` for any well-formed NID (voter.ts:108-120) | Enrollment is unauthenticated self-service; nothing binds an NID to a real person or an official roll (AUDIT §8, §15; FUTURE_WORK §0 "NID only … no second factor") | Authoritative eligibility input (official roll or verified-identity service) OR explicit scope note + rate-limits; at minimum gate on mobile |
| B2 | `elections.status` enum is never transitioned; `POST /vote` does not check it (elections.ts:36-57; vote.ts gates only existence/key/commitment) | No "voting open/closed" enforcement; votes can be cast whenever the three gates pass (AUDIT §15.4, §16.4) | Add status-transition admin endpoint(s) + enforce in `/vote`; add audit trail |
| B3 | `votes.status='rejected'` is dead; only `queued→confirmed` exists (anchorBatch.ts:129) | The state model implies states/transitions that don't exist; a tally-failed ballot is invisible in `votes.status` (AUDIT §15.4, §16.3) | Either implement the rejection transition or remove the enum member + UI copy |
| B4 | No rate limiting / CAPTCHA / body-size limits on any route (index.ts; both package.json) | `/voter/register` and `/vote` are trivially scriptable; NID probing/enumeration is unthrottled (AUDIT §5.4, §15; FUTURE_WORK §6.1 planned) | Tiered fixed-window rate limits + CAPTCHA on register — **implemented in P1** (`middleware/rateLimit.ts`, `middleware/captcha.ts`) without adding a dependency; load-test (Phase 5/7) |
| B5 | Admin auth = single shared `x-admin-secret`, no session, no per-admin identity, no audit log (adminAuth.ts; threat_model §2 "over-trusted") | Any secret holder has full anchor/tally/demo-delete power; actions unattributable; rotation = global revoke (AUDIT §5.2, §15) | Per-admin identity + session (FUTURE_WORK §11.4: WebAuthn) + `admin_actions` audit log — D-scoped new mechanism |
| B6 | `zkp_proof` column is not in the immutability guard (schema.sql:1004-1019) and has no writer | A future/typo'd writer could silently change a stored proof | Add to the guard (or add a trigger) when touching schema in Phase 5 |
| B7 | `shared-interfaces/types.ts` is stale (Vote.voter_nid_hash, missing `election_id`, phantom `/admin/login`) (AUDIT §15.2) | Any package (incl. the new mobile app) building on these types gets wrong contracts | Correct the shared types as part of Phase 5 (mobile shares the contract) |
| B8 | `POST /voter/check-nullifier` is unauthenticated and reveals `{exists:bool}` for any NID (voter.ts:148-182) | Participation oracle: a third party who knows a NID learns whether that person voted (Part 4.3.3) | Gate behind an authenticated session on mobile (or drop) — decision in Phase 3 |
| B9 | Connectivity config is dev-local: CORS `localhost:5173` only (index.ts:33-37), CSP `connect-src http://localhost:3000` (index.html:18), `VITE_API_BASE` default localhost (api.ts:17) | The mobile client cannot talk to a real deployment without code/env changes; static CSP forbids other origins (AUDIT §15.11) | Deployment-driven config + TLS/HSTS (Phase 5/7) |

### C — SHOULD BE REPLACED (actively wrong / dead; evidence cited)

| # | Mechanism | Why it is wrong / dead (evidence) | Replacement |
|---|---|---|---|
| C1 | Client **offline mock fallbacks** in `api.ts` (registerVoter/checkNullifier/submitVote/getElectionPublicKey/getCandidates/getPublicStats) | On transport `TypeError` they return fabricated success: `submitVote` returns `vote_id:"mock-vote-…"` and records the NID in `localStorage.mock_voted_nids`; the mock public key `{p:"ffff…ff", g:"2", y:"3"}` is not a valid subgroup key; candidate ids are synthesized UUIDs (api.ts:48-60, 72-83, 100-120, 160-198; AUDIT §15.7). A voter gets a success screen for a ballot the server never accepted — actively misleading in a voting context | **Never port to mobile.** Mobile API client must be fail-closed (D3) |
| C2 | `VoteConfirmation.tsx` hard-coded mock `tx_hash` + random `vote_id` fallback (VoteConfirmation.tsx:15-24) | Displays values no server ever produced, contradicting the real anchoring implementation (AUDIT §15.3) | Receipt screen driven only by the server's `201 {status, vote_id}` + real anchor-verify data or an explicit "verification pending" state |
| C3 | Legacy GF(2^8) Shamir path: `crypto/shamir.ts`, `secrets.js-grempe`, `key_shares.share_value`, old `POST /keyshares/submit` (removed from code but still referenced by `testing/*` evidence + `shared-interfaces/types.ts`) | `routes/keyshares.ts:12-16` removed the flow "not kept as a fallback"; nothing reads/writes `share_value`; keeping it risks silent reuse and misinforms newcomers (AUDIT §15.8, §12) | Delete/quarantine in the migration; do not port; keep only `shamirZq.ts` (A8 path) |
### D — NEW MECHANISMS REQUIRED FOR MOBILE (gaps that exist only because of the mobile context)

| # | Gap (why mobile-only) | What is needed | Where it lives (server-authoritative per Rule 7) |
|---|---|---|---|
| D1 | **Mobile session/token handling.** The web has no sessions — the raw NID is sent on every request as the credential (`x-voter-nid` header, candidates.ts:38; `nid` body field, vote.ts:46; also Part 4 privacy). Storing/re-sending the raw NID repeatedly on a phone is worse than in a browser session | Server-issued, short-lived session token (bound to device instance + NID hash), with issue/refresh/revoke endpoints; server validates on every `/voter/*`, `/vote`, `/candidates` call; token is **not** a bearer with permanent powers | Server: new auth middleware + `sessions` table (or equivalent) + token lifecycle; client: secure storage (D2). The vote/eligibility/duplicate logic stays server-side and unchanged (A1) |
| D2 | **Secure on-device storage.** Web uses `localStorage` for mock data (api.ts) — on mobile, OS app data is not a vault | Store only: unexpired session token, and Benaloh audit material **if the voter explicitly opts to keep it**. Use OS-backed secure storage (iOS Keychain / Android Keystore via an Expo-compatible wrapper) with the app's EncryptionKey; never plaintext files | Client (device security boundary); server never stores the token plaintext |
| D3 | **Offline behavior.** The web fake-success path (C1) doesn't exist server-side; a mobile app that queued ballots offline would break server-authoritative ZKP verification and the DB duplicate-vote race (A1) | **No offline vote creation.** The mobile client must fail closed: explicit "you are offline / election not reachable — your vote is NOT recorded" UI; no ballot bytes persisted; retry guidance. Read-only public pages may cache (careful: never cache per-election ballot-dependent state) | Client UX contract + client API layer; decision rationale in Phase 4 §4 and Phase 3 |
| D4 | **Mobile client-crypto runtime.** The ElGamal + OR-proof prover + Benaloh helpers run on Web Crypto API (frontend/src/utils/elgamal.ts). Expo needs the same algorithms on a runtime with a hardware/OS-backed CSPRNG and BigInt modular arithmetic | Port `frontend/src/utils/elgamal.ts` (and the Fiat–Shamir/SHA-256 pieces) to an Expo-compatible crypto stack with verified RNG; keep byte-for-byte the same serialization (hex), challenge ordering, and domain binding (A3, A13 — algorithms preserved; runtime is new) | Client (encryption/proving), server unchanged (still verifies) |
| D5 | **API reachability/TLS for mobile.** Everything is dev-local: CORS localhost (index.ts:33-37), static CSP (index.html:18), `VITE_API_BASE` default (api.ts:17) — a phone cannot reach a deployed API; no staging/prod TLS posture exists | Configurable API base (env/secure config), backend listens behind a real origin; HTTPS/HSTS required for the mobile client; **certificate-pinning only if Phase 3's threat model finds a concrete attack requiring it** (Rule 8 — standard OS trust otherwise) | Deployment + client config (Phase 5/7) |
| D6 | **Device-bound session lifecycle UX.** Reinstall, app-data-clear, or device transfer can orphan a session token; a second device with the same NID is possible and must not enable double-votes | Session revocation endpoint (kill sessions on re-install), re-auth required when session invalid, "device signed-in elsewhere" hygiene; duplicate-vote control remains the DB's job (A1) — the session only authenticates, never authorizes a second ballot | Client UX + server session API (D1) |

**Explicitly deferred (Phase 3 will decide, per Rule 8):** biometric/face-liveness second factor and push-based tamper alerts (FUTURE_WORK §2/§5) are *candidate* D items only if the threat model finds concrete attacks they mitigate that nothing else covers. They are not added on general principle.

### Cross-cutting enablers (required regardless of classification; not A/B/C/D behavior)

1. **Dedicated Supabase test project/DB** — the N=50 concurrency test and the DB immutability/uniqueness tests *were* `it.skip` precisely because there was no test DB (AUDIT §12); **P0 unskipped them and switched `integrity.test.ts` to the fail-closed loader (`BUILD_NOTES.md` §4)**, so they now require `backend/.env.test` to execute. The mobile migration adds more API surface; every preserved guarantee (A1/A5/A8) must be re-proven there.
2. **Candidate seeding path** — **CORRECTED (`BUILD_NOTES.md` §2.6): candidate seeding already exists.** `backend/src/scripts/seed-constituencies.ts:91-137` seeds 48 candidates (6 per constituency, full CON-01..08) from `frontend/public/candidates.json` with `onConflict: "election_id,name,constituency_code"`. AUDIT §15.6 was wrong; no new script is needed.
3. **Correct `shared-interfaces/types.ts`** (B7) so the mobile app and backend compile against the real schema.

---

## Closing — what this means for the React/Expo build (trace to Phases 3–7)

The "same methodology" on mobile = **preserve A1–A16 unchanged on the server/DB/chain** (they are the voting method), **replace C1–C4** (never carry the fake paths), **fix B1–B9** (they are weaknesses the mobile context amplifies), and **add D1–D6** (the genuinely new mobile mechanisms). The remaining plan phases are already scoped by these letters:

- **Phase 3** threat model: which Appendix threats are real for *this* system, which A-items already mitigate them, and where D1/D5/D6 (and possibly D7 biometry) are the only gaps — leading to the mobile security architecture.
- **Phase 4** mobile UX: screens derived from Parts 1–3 (election selection → authenticate → fetch ballot → encrypt+prove → audit-or-cast → receipt → verify; watchdog/results as read-only).
- **Phase 5** data & API migration: schema changes for B2/B3/B6 + D1 session table; per-endpoint migration of AUDIT §6; API redesign justified by concrete problems (e.g., NID-as-credential, no election-open gate, death of `rejected`).
- **Phase 6** verification: re-enable the skipped tests on the test DB, plus mobile-specific tests (token storage, replay, double-cast over two devices, rooted-device behavior only if Phase 3 justifies it).
- **Phase 7** roadmap/risks/DoD.
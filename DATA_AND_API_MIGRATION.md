# DATA_AND_API_MIGRATION.md — Phase 5: Data & API Migration Plan

**Status:** Phase 5 deliverable. Source: `AUDIT.md` §4 (schema) & §6 (endpoints), `METHODOLOGY_CLASSIFICATION.md` (B2/B3/B5/B6/B7/B8, D1–D6), `THREAT_MODEL_AND_SECURITY.md` (T4/T10/T13/T15/T16/T19/T20, §4 mobile architecture), `MOBILE_UX_ARCHITECTURE.md` (screen→endpoint mapping, §4 offline). Follows the repo's migration convention: **append idempotently to `backend/src/schema.sql` and apply via the Supabase SQL editor** (AUDIT §4 header; no automated runner). Every change that touches a voting-integrity constraint names what enforces it *today* and what enforces it *after*.

> **BUILD-BRIEF OVERRIDES APPLIED (see `BUILD_NOTES.md`):** C1 `sessions` CHECK fixed to reference `voter_nid_hash`; C2 per-admin identity is **out of scope** (all admin routes keep `x-admin-secret`; `admin_actions.actor_admin_id` = static `"shared-admin"`); C3 **`tally_results` is dropped from the migration** — `tally_runs` is the sole results store and `GET /public/results` reads it directly (no cache sync); C4 the election-window trio (`PATCH /elections/:id/status` + `/vote` gate + `election_status_events`) ships atomically in P3.

---

## 1. Schema migration (current → required)

### 1.1 New tables

**`sessions`** — the mobile session layer (D1, T15). Server-authoritative; the raw NID stops transiting the wire after login.

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id   TEXT        NOT NULL REFERENCES elections (election_id),
    voter_nid_hash CHAR(64)   NOT NULL
                     CONSTRAINT ck_sessions_voter_nid_hash_hex CHECK (voter_nid_hash ~ '^[a-f0-9]{64}$'),
    nullifier_hash CHAR(64)   -- captured at issuance while the raw NID is transiently in hand
                     CONSTRAINT ck_sessions_nullifier_hash_hex CHECK (nullifier_hash ~ '^[a-f0-9]{64}$'),
                              -- ^ P2 decision A: /vote casts THIS, so the session path and the
                              --   legacy raw-NID path share one pseudonym per voter+election (A1)
    token_hash    CHAR(64)    NOT NULL UNIQUE,          -- sha256(server-issued opaque token)
    device_id     UUID        NOT NULL,                 -- generated once per app install
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,                          -- NULL = active
    created_ip    INET,                                 -- rate-limit/hygiene only; masked in logs
    CONSTRAINT ck_sessions_valid_window CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS idx_sessions_election_voter ON sessions (election_id, voter_nid_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_device       ON sessions (device_id);
```
- **Integrity-relevant properties:** token stored only as hash (T15 evidence: a DB dump reveals no usable token); `(token_hash)` UNIQUE; one opaque token = one row; revocation is the *only* UPDATE (see trigger below); no DELETE (or delete = full revocation).
- **Guard triggers (append-only):** `fn_sessions_no_delete` (BEFORE DELETE raises) and `fn_sessions_guard` (BEFORE UPDATE blocks changes to `token_hash`, `voter_nid_hash`, `election_id`, `issued_at`; permits `expires_at`/`last_seen_at`/`revoked_at` only).

**`admin_actions`** — attribution/audit for admin operations (T4/T16/B5).
```sql
CREATE TABLE IF NOT EXISTS admin_actions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_admin_id TEXT        NOT NULL,               -- BUILD-BRIEF C2: static "shared-admin" this pass (per-admin identity is out of scope)
    election_id    TEXT        NOT NULL REFERENCES elections (election_id),
    action         TEXT        NOT NULL,               -- 'election.create'|'election.status_change'|'anchor.batch'|'tally.run'|...
    request_summary JSONB,
    http_status     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- triggers: fn_admin_actions_no_update / fn_admin_actions_no_delete (append-only)
```

**`tally_runs`** — append-only tally history (T19). **BUILD-BRIEF C3: `tally_runs` is the SOLE results store**; the legacy `tally_results` table is left in place but is no longer read or written (same treatment as `key_shares.share_value`), and **no cache-sync step is built**.
```sql
CREATE TABLE IF NOT EXISTS tally_runs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id    TEXT        NOT NULL REFERENCES elections (election_id),
    batch_id       BIGINT      NOT NULL,               -- the explicit batch tallied (A8)
    tallied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    shares_used    INTEGER     NOT NULL,
    total_votes    INTEGER     NOT NULL,
    valid_votes    INTEGER     NOT NULL,
    invalid_votes  INTEGER     NOT NULL,
    results        JSONB       NOT NULL,
    run_by         TEXT,
    UNIQUE (election_id, batch_id, tallied_at)         -- one row per run
);
-- triggers: no_update / no_delete
```
`GET /public/results` reads `tally_runs ORDER BY tallied_at DESC LIMIT 1` directly (BUILD-BRIEF C3) — an out-of-band write to the legacy `tally_results` table is now irrelevant because nothing reads it (T19).

**`election_status_events`** — window-integrity audit trail (T13/B2).
```sql
CREATE TABLE IF NOT EXISTS election_status_events (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id    TEXT        NOT NULL REFERENCES elections (election_id),
    from_status    TEXT        NOT NULL,   -- CHECK enum-compatible
    to_status      TEXT        NOT NULL,
    changed_by     TEXT        NOT NULL,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- triggers: no_update / no_delete
```

### 1.2 Alterations to existing tables

| Table | Change | Reason (trace) |
|---|---|---|
| `votes.zkp_proof` | **Add `zkp_proof` to `fn_votes_immutable_guard`'s blocked set** (schema.sql:1004-1019 clone with one more `RAISE` clause) | B6 — closes the "updatable proof, no writer" gap |
| `votes.status` | Leave the `vote_status` enum as-is; **do not add a 'rejected' writer yet** — first resolve B3 in Phase 7 (either implement the transition or remove the member). No data migration | B3 — avoid schema churn on an unresolved state model |
| `elections` | Status transitions become real: `election_status_events` table records each `setup → voting → tallying → closed` transition (audit trail); the existing CHECK constraint (schema.sql:924-926) stays the guard; transitions validated app-side | T13/B2 |
| `voters` | (Optional, product decision) `eligibility_source TEXT`, `external_id TEXT UNIQUE` for an authoritative roll | B1 — only if authoritative eligibility adopted |
| `merkle_batches` / `smt_batches` | (Optional) `reconciled_at TIMESTAMPTZ` + reconciliation job (T20); no constraint changes | T20 |
| `nullifiers` / `key_shares` / `partial_decryptions` / `dkg_*` / `election_key_ceremony` / `election_setup_commitments` / `candidates` / `constituencies` | **No change** | preserved mechanisms (A5/A8/A9/A10/A11/A14) |

### 1.3 Voting-integrity constraints — what enforces what (today → after migration)

| Integrity property | Enforced today by | Enforced after by (unchanged unless noted) |
|---|---|---|
| One-person-one-vote (sequential) | `fn_cast_vote` `has_voted` flip inside the transaction (schema.sql:1077-1124) | **unchanged (A1)** |
| One-person-one-vote (concurrent, same & cross-device) | `SELECT … FOR UPDATE` row lock + `uq_voters_election_nid_hash` | **unchanged (A1)** — sessions (D1) must never become a second eligibility axis: a session is a *capability*, not a person |
| Duplicate ballot rows | `uq_votes_election_nullifier_hash UNIQUE (election_id, nullifier_hash)` (schema.sql:994) + `uq_nullifier_per_election` (L552) | **unchanged** |
| Vote immutability (content) | `trg_votes_immutable` (blocks nullifier/constituency/election/encrypted_vote/created_at) | **extended** to also block `zkp_proof` (B6) |
| Vote undeletability | `trg_votes_no_delete`; single `SECURITY DEFINER fn_admin_delete_vote` demo path | **unchanged**; demo routes production-flag-off (T4) |
| Ballot validity / no plaintext choice | Mandatory ZKP vs **server-derived** candidate set (A3/A4) | **unchanged**; the mobile prover must produce byte-identical request bodies (D4) |
| Unlinkability (vote ↔ voter) | No identity column on `votes`; nullifier = SHA-256(nid‖election‖secret), server-only (A2) | **narrowed by P2 decision A**: `sessions` holds `voter_nid_hash` + the captured `nullifier_hash`, so an attacker with *database access only* can now join voter→session→vote without `NULLIFIER_SECRET`. That was the price of letting `/vote` derive the nullifier from the session (there is no way to recompute SHA-256(nid‖eid‖secret) from a hash). The server-side boundary is unchanged (a compromised server + secrets could already link ballots), and nothing new about the NID is exposed — the stored value is the same pseudonym already in `nullifiers`/`votes` |
| Candidate/constituency set freeze | `trg_candidates/constituencies_immutable_after_commitment` (per-election) | **unchanged** |
| Partial-decryption immutability | `trg_partial_decryptions_no_update` | **unchanged** |
| Tally integrity | INSERT-only `partial_decryptions` + DLEQ + ≥3 combine + explicit batch (A8); independent verifier | **strengthened**: `tally_runs` append-only and the **sole** results store (C3) (T19) |
| Election window (new) | *(nothing — status not enforced)* | **new**: `elections.status` gate in `/vote` + `election_status_events` audit (T13/B2) |
| Session authenticity (new) | *(no sessions)* | **new**: `sessions` table (hash-only token, device binding, revocation) (D1/T15) |
| Admin attribution (new) | *(shared secret, no audit)* | **new**: `admin_actions` append-only (T4/T16/B5) |

### 1.4 Execution order (append-only, idempotent — repo convention, AUDIT §4)

1. `sessions`, `admin_actions`, `tally_runs`, `election_status_events` (+ triggers) → 2. `votes` immutable-guard extension (B6) → 3. `/vote` route reads `elections.status` (app change, shipped with the P3 trio — C4) → 4. optional items gated on product decisions (B1 authoritative roll, T20 `reconciled_at`). **Per-admin identity (B5) is OUT OF SCOPE this pass (BUILD-BRIEF C2)** — every admin route keeps `x-admin-secret`. Fresh-DB path: `run-schema.ts` picks up the appended DDL; existing DBs: Supabase SQL editor, exactly as every prior change (schema.sql:903-907). **No destructive step, no backfill** — consistent with the project's established migration history.

---

## 2. Per-endpoint migration table (every real endpoint from AUDIT §6; no placeholders)

Legend: **Authz** = current → after; **Validation** = current → after; **DB op** = tables touched; **Security** = controls after migration; **Mobile** = what changes for the Expo client; **New** = newly introduced endpoint.

| Endpoint (current) | Authz today → after | Validation today → after | DB op | Security controls (after) | Mobile-required change | New endpoint? |
|---|---|---|---|---|---|---|
| `POST /voter/register` | none → **rate-limited + CAPTCHA** (T10); unchanged for web | zod `{nid:^\d{11}$, election_id}` (voter.ts:33-36) → same | upsert `voters` (voter.ts:108-120) | rate limit, CAPTCHA, `admin_actions` not involved | **Mobile does not call it**; the session endpoint absorbed registration | `POST /voter/session` (new, §2.1) |
| `POST /voter/check-nullifier` | none → **drop on mobile**; keep for web with same caveat (B8) | zod same (voter.ts:38-41) | read `nullifiers` only | **participation oracle** (B8) — mobile uses session-scoped `GET /voter/me` instead | Excluded from the mobile client | — |
| `POST /vote` | none (NID in body) → **session bearer** + `elections.status='voting'` gate (T13) + rate limit (T10) | zod `{nid?, encrypted_vote, zkp_proof, election_id}` — `nid` is **optional** and only for the web client (Open Question #9); identity comes from the session via `services/castIdentity.ts`, which returns the same `(nid_hash, nullifier_hash, constituency_code)` for both credentials (asserted in `castIdentity.test.ts`) | `fn_cast_vote` + `nullifiers` (vote.ts:205-263) | A1/A3/A4 unchanged; new: session check, window gate, stable error codes (§3) | Same shape of `encrypted_vote`/`zkp_proof` (byte-identical prover, D4); no NID in request | — |
| `GET /candidates` | `x-voter-nid` header (or deprecated `?constituency=`) → **session bearer**; **delete the deprecated query-param path** (candidates.ts:48-73) | NID format check (candidates.ts:43-46) → derived from session | read `candidates` by `(election_id, constituency_code)` | A4 (server derives constituency) | Session auth; sends nothing identity-shaped in the URL | — |
| `GET /election/public-key` | public → **public (unchanged)** | `election_id` resolution | read `election_key_ceremony` (electionContext.ts:79-89) | 503 until qualified (A12) | Ballot step (S2) uses it through `core-api` | — |
| `POST /elections` | `x-admin-secret` (**unchanged** — BUILD-BRIEF C2) + `admin_actions` audit row (T4/T16) | zod (elections.ts:28-34) → same + status-transition validation | insert `elections` | audit row per call (actor = `"shared-admin"`); prod excludes nothing here | Admin portal only (web) | — |
| `GET /elections` · `/elections/:id` | public | `election_id` resolution | read `elections` | — | **Election Hub (S0)** consumes here; response gains a computed `availability` (from status + gates) for the mobile list | — |
| `GET /public/stats` | public | `election_id` | read `voters`/`votes`/`key_shares`/`merkle_batches` counts | A15 (counts only) | **Watchdog** tab (read-only) | — |
| `GET /public/results` | public | `election_id` | **`tally_runs` ORDER BY tallied_at DESC LIMIT 1** (C3; legacy `tally_results` no longer read) | A15 + T19 history | **Results** tab (read-only) | — |
|---|---|---|---|---|---|---|
| `POST /anchor/batch` | `x-admin-secret` (**unchanged**, C2) + `admin_actions` audit row (T4/T16) | `{election_id}` (anchor.ts:54) | `runAnchorBatch`: contract call + `merkle_batches` insert + votes `status`/`tx_hash` update (anchorBatch.ts:107-125) | A6; audit row; T20 reconciliation runs after | Admin portal only | — |
| `GET /anchor/verify/:voteId` | public | `election_id` + `:voteId` (anchor.ts:89) | read `merkle_batches` + `votes`; rebuild root; on-chain `contract.verify` | A7 (409 on tamper) | **Verify screen (S5)**; 404/500 states get explicit mobile copy ("not anchored yet" vs "tamper suspected" vs "chain unreachable") | — |
| `GET /anchor/verify-smt/:voteId` | public | `election_id` + `:voteId` (anchor.ts:204) | SMT proof + on-chain `verifySmt*` | A7 (deletion detection) | Same mobile copy treatment | — |
| `GET /anchor/latest` | public | `election_id` | read latest `merkle_batches` | — | **Receipt → anchoring status** (real tx_hash only after anchor; never fabricated) | — |
| `POST /anchor/tamper/root` · `/anchor/tamper/ballot` · `/anchor/tamper/delete-vote` · `/anchor/restore/root` | `x-admin-secret` → **disabled unless `ENABLE_TAMPER_DEMO=1`** (T4) | demo payloads | demo mutations (`fn_admin_delete_vote` for delete-vote) | production exclusion; `admin_actions` if enabled | **Not in the mobile app** | — |
| `POST /keyshares/submit-partial` | keyholder passphrase (web portal) | zod `{election_id,keyholder_id,passphrase,partials}` (keyshares.ts:60-65) | INSERT-only `partial_decryptions` rows | A8 (DLEQ verify, INSERT-not-UPSERT) | Keyholder web portal (unchanged) | — |
| `POST /keyshares/tally` | `x-admin-secret` (**unchanged**, C2) + `admin_actions` audit row (T4/T16) | explicit `{election_id, batch_id}` (keyshares.ts:31-51) | DLEQ re-verify + combine + **append `tally_runs`** (sole store — C3) | A8 + T19 | Admin portal | — |
| `GET /keyshares/commitments` · `/keyshares/status` · `/keyshares/verification-bundle` | public (status: explicit batch) | `election_id` (+ `batch_id` where applicable) | read ceremony/`key_shares`/`partial_decryptions`/`smt_batches`/`tally_runs` | A7/A8 — independent-verifier interface | Public/auditor; not in the voter app | — |
| `POST /dkg/init` · `/dkg/round1` · `/dkg/round2` · `/dkg/round2/inbox` · `/dkg/round3` · `GET /dkg/round1` · `GET /dkg/status` | admin secret / keyholder passphrase | ceremony schemas (dkg.ts) | `election_key_ceremony`, `dkg_*`, `key_shares` | A14 (server cannot read sub-shares) | Keyholder web portal (unchanged); no mobile change | — |
| `GET /health` | public | — | — | — | kept | — |

### 2.1 New endpoints (mobile session layer — D1/T15/T4/T13; each with its Phase 6 test hook)

| Endpoint | Authz | Request → Response | DB op | Security controls | Which Phase-4 screen |
|---|---|---|---|---|---|
| `POST /voter/session` | rate-limited + CAPTCHA (T10); registers voter under current semantics (B1 note: authoritative roll later) | `{nid, election_id, device_id, captcha_token?}` → `201 {token, expires_at, voter:{has_voted, is_eligible, constituency_code}}` | ensure `voters` row; insert `sessions` (hash-stored) | T15 (opaque token, hash-only, device-bound); A1 untouched | Authenticate (S1) |
| `GET /voter/me` | session bearer | → `{registered, is_eligible, has_voted, constituency_code}` | read `voters` via session's `voter_nid_hash` | replaces `check-nullifier` for mobile (B8) | Voter status |
| `POST /voter/session/refresh` | session bearer | `{token}` rotated; old revoked | update `sessions` (revoke+insert) | T15 sliding TTL | behind the scenes |
| `POST /voter/session/revoke` | session bearer | `204` | `sessions.revoked_at = now()` | T15/D6 | Settings — sign out |
| `POST /voter/session/revoke-all` | session bearer | `204` | revoke all rows for `(election_id, voter_nid_hash)` | D6 | Settings — sign out everywhere |
| `PATCH /elections/:id/status` | `x-admin-secret` (**unchanged**, C2 — per-admin identity out of scope) | `{status}` validated `setup→voting→tallying→closed` + **`closed→closed` idempotent** → `200` | update `elections.status`; insert `election_status_events`; `admin_actions` | T13 — **ships atomically with the `/vote` gate (C4)** | Admin portal (web) |

---

## 3. Is the current API poorly structured for mobile? — Yes in four concrete ways, and here is the fix for each

1. **The raw identity is the credential on every request** — `POST /vote` carries `nid` in the body (vote.ts:46) and `GET /candidates` requires the `x-voter-nid` header (candidates.ts:38). For a phone, that means storing/re-sending the NID repeatedly and having zero revocation. **Fix:** the session layer (§1.1 `sessions`, §2.1) — one `POST /voter/session` after which no voter-scoped call needs the NID; revocation is a server action. This is D1/T15 and the *first* thing the mobile client was designed around (Phase 4 §3 Authenticate screen).
2. **The election-window gap is closed in P3.** `PATCH /elections/:id/status` validates the forward-only lifecycle and writes `election_status_events`; `POST /vote` now returns 403 `ELECTION_NOT_OPEN` whenever the fresh election row is not `voting`, before commitment/key/nullifier checks. `GET /elections` and `GET /elections/:id` expose computed `availability` so the Election Hub reflects server truth. Live HTTP/DB evidence remains pending Open Question #11.
3. **Errors are shaped for a browser, not a retry decision.** Errors today are `{error: string|object[]}` (zod issues) or status-code-only; the PG→HTTP mapping in vote.ts:220-243 works by *string-matching error messages* ("not registered", "not eligible", "already cast") — brittle and invisible to a client that needs to render the *correct* plain-language copy. **Fix:** a stable machine-readable envelope for 4xx/5xx: `{ code, message, retryable }` with codes like `VOTER_NOT_REGISTERED`, `VOTER_NOT_ELIGIBLE`, `VOTE_ALREADY_CAST`, `ELECTION_NOT_OPEN`, `ELECTION_UNKNOWN`, `KEY_NOT_READY`, `COMMITMENT_MISSING`, `RATE_LIMITED`, `INVALID_BALLOT`, `SERVER_ANCHOR_UNAVAILABLE`. The mobile client's copy + retry behavior (Phase 4 §5, §4) keys off `code`/`retryable`, never off message text.
4. **The offline/derived-vs-real distinction is not expressible.** The web SPA's response of "success" can be entirely fabricated client-side (C1 mocks); the API cannot express "this transaction is not yet anchored" (a `queued` vote has no representation beyond the 201 body). **Fix:** the mobile client treats a 2xx as the *only* success signal (Phase 4 §4) and the Receipt screen renders `queued`/`confirmed` from the real anchor status (`GET /anchor/verify/:id` + `GET /anchor/latest`), with an honest "verification pending" state — no fabricated fields (C2 gone).

### 3.1 What is NOT being redesigned (deliberately)

- The vote protocol itself: `POST /vote` body semantics (`encrypted_vote`, `zkp_proof`, server-derived candidate set) are preserved byte-for-byte (A3/A4, D4) — the migration changes *who is authenticated*, not *what a ballot is*.
- The public verification surface (`/anchor/verify*`, `/keyshares/verification-bundle`) — the tamper-evidence interface, unchanged.
- The chain path (`MerkleRootStorage`, `ElectionSetupCommitment`, `anchorBatch`/`anchorSmtBatch`) — untouched; `sessions`/status live entirely outside it.
- Admin/keyholder web portals — authentication hardening (B5) applies server-side; mobile scope excludes them (Phase 3 §4.6).

### 3.2 Migration delivery (summary for Phase 7)

Backend: append schema (§1) → add session middleware + endpoint handlers (§2.1) → switch `/vote`, `/candidates` to session + window gate + error envelope (§2, §3) → wire `tally_runs`/`admin_actions` → flag off demo routes. Frontend: add `core-api` client + migrate the web SPA's voter flow to sessions (or keep web on NID for demo with a compat flag, flagged in Phase 7 cutover). Mobile: consume the §2/§2.1 endpoints only. Tests: Phase 6 covers every `New endpoint` row and every changed authz cell.

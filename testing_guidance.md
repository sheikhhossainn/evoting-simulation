# Testing Guidance

> For Urmi (and anyone else testing). Read the "How to use this" section first.
> Test after **every** PR merges into `dev` — don't wait until the end of the week.

## How to use this document

Each section below covers one component of the system and follows the same shape:

- **Status** — built / partially built / not built yet (test plan still included so testing can start the moment it lands)
- **What to test** — functional correctness, the happy path
- **Adversarial / tamper tests** — actively try to break it; this is where real bugs hide
- **What NOT to test** — known, intentional limitations. Don't file these as bugs — they're already tracked in `context.md`
- **Pass criteria** — what "this works" concretely means
- **How to test** — concrete endpoint/steps, so you don't have to reverse-engineer the API each time

Anything you find that fails an adversarial test is a real finding for the Evaluation section — write down exactly what you did and what happened, not just "it worked" / "it didn't."

**Two hard rules that apply everywhere:**
1. Never run an irreversible action (tallying, anchoring) against real/live data without the team's sign-off first. Always test against seeded/mock data.
2. If you ever see actual private key material (even a partial preview) in any API response, logs, or the UI — stop, that's a critical regression, report it immediately rather than continuing testing.

---

## Where to look for issues, and how to look

Bugs in this system hide in four places. For every component you test, check all four — a passing API response alone proves nothing if the DB row underneath is wrong.

### 1. The API surface (curl / Postman)
Every endpoint is listed in `context.md` → "Backend API". Backend runs on `http://localhost:3000` (`npm run dev:backend`).
- **How**: send both valid and malformed payloads with `curl`. Always check the HTTP status code, not just the body — a `500` where a `400` belongs is a bug even if "nothing broke."
- **Where the handlers live**: `backend/src/routes/` — one file per area (`voter.ts`, `vote.ts`, `keyshares.ts`, `anchor.ts`, `public.ts`, `candidates.ts`). When a response looks wrong, open the matching route file and read the validation (Zod schemas at the top) before filing — the bug is usually a missing check there, and citing the file/line makes the report actionable.
- **Auth checks**: anything sensitive goes through `backend/src/middleware/adminAuth.ts` (`x-admin-secret`) or `backend/src/config/keyholders.ts` (passphrases). Test every protected route once *without* credentials.

### 2. The database (Supabase dashboard → Table Editor / SQL Editor)
The API can lie; the tables can't. After every write operation, verify the row directly.
- **Schema of record**: `backend/src/schema.sql` — table shapes, constraints, triggers, and `fn_cast_vote` all live here. If observed DB behavior contradicts this file, one of them is the bug.
- **Key checks**:
  - `votes` must contain `nullifier_hash` + `constituency_code` and **no** voter-identifying column — if you can join `votes` to `voters` with any SQL, that's a critical ballot-secrecy finding.
  - Immutability: `UPDATE votes SET encrypted_vote = '{}' WHERE id = '...'` in the SQL Editor (test env) must raise an exception from the trigger, not succeed.
  - Counts: after any flow, `SELECT count(*)` the affected table and compare with what the API/UI claims.
- **How to look**: use the SQL Editor for adversarial writes (they bypass the API on purpose — that's the test), the Table Editor for eyeballing rows.

### 3. The browser (devtools Network + Console tabs)
The frontend can display something different from what it actually sent.
- **How**: open devtools *before* starting a flow. On `/voter/vote`, confirm the request body of `POST /vote` contains an ElGamal `{c1,c2}` ciphertext — never a readable candidate UUID or base64 of one. Confirm the page fetched `/election/public-key` and `/candidates` (real UUIDs).
- **Console attacks**: the crypto helpers are importable — try calling `encryptCandidateId("not-a-uuid", pubkey)` from the console; invalid input must throw client-side (`frontend/src/utils/elgamal.ts`).
- **Watchdog leak check**: on `/watchdog`, search the Network responses for any candidate name/count — per-candidate results appearing there is a high-priority privacy finding (§9).
- **Where the client code lives**: `frontend/src/utils/api.ts` (all API calls), `frontend/src/utils/elgamal.ts` (encryption), `frontend/src/pages/` (per-page logic).

### 4. The chain (Sepolia Etherscan)
On-chain state is the independent witness — never trust only the backend's word about it.
- **How**: every anchored batch has a `tx_hash` in the `merkle_batches` table. Look it up at https://sepolia.etherscan.io and confirm the transaction exists, targets `0x312621075076Eb379fbE81760A76B5a8E56b95a7`, and succeeded.
- **The core tamper test**: change data in Supabase (a vote's `encrypted_vote`, or a `merkle_batches.vote_ids` entry), then `GET /anchor/verify/:voteId` → must flag tampering (`409`), because the recomputed root no longer matches the on-chain one. If verification still passes after a DB edit, that's the worst possible finding in this entire project — report immediately.
- **Where the code lives**: `backend/src/merkle/merkleTree.ts` (tree/proof logic — single source of truth, also used by the Hardhat tests), `backend/src/blockchain/merkleContract.ts` (chain reads/writes), `backend/src/routes/anchor.ts` (endpoints), `blockchain/contracts/MerkleRootStorage.sol` (the contract itself).

### Cross-cutting habits
- **Reproduce twice before filing.** Flaky ≠ fine, but "did X, got Y, twice, here's the payload" is a report someone can fix.
- **Check `context.md` "Known Limitations" and "Not Yet Implemented" first** — if it's listed there, it's tracked, not a new bug.
- **Grep is your friend for leak-hunting**: search backend responses/logs for fragments of `ELGAMAL_PRIVATE_KEY`, `NULLIFIER_SECRET`, or a raw NID. None of these strings may ever appear in any HTTP response or the frontend bundle.
- **Env drift**: `NULLIFIER_SECRET` is required by `backend/src/crypto/identity.ts` but missing from `backend/.env.example`; `AMOY_RPC_URL` actually holds the Sepolia URL. If a fresh setup fails mysteriously, look at env vars first.

---

## 1. Voter Registration — `POST /voter/register`
**Status: built**

**What to test**
- Register with a valid 11-digit NID → returns `voter_id`, `nid_hash`, `constituency_code`, `is_eligible: true`, `has_voted: false`
- Register the same NID again → returns the *same* existing record (upsert), not a duplicate row
- Same NID always produces the same `nid_hash` (determinism)
- Different NIDs never produce the same `nid_hash` (spot-check a few)

**Adversarial**
- NID with wrong digit count (10 or 12 digits), non-numeric characters, empty string
- Extremely long string, SQL-injection-style payload (`' OR 1=1--`) as the NID
- All of the above must return `400`, never a 500 or a successful registration

**What NOT to test**
- Whether the raw NID is stored anywhere — by design it never is; you can't "test for absence" meaningfully beyond confirming the `voters` table schema only has `nid_hash`, not `nid`

**Pass criteria**: malformed input always 400; valid input is idempotent; hash is deterministic and collision-free across your test set

**How to test**: `curl -X POST http://localhost:3000/voter/register -H "Content-Type: application/json" -d '{"nid":"10001234567"}'`

---

## 2. Candidates — `GET /candidates?constituency=CON-XX`
**Status: built**

**What to test**
- Valid constituency code (`CON-01`..`CON-08`) → returns candidates with real UUID `id`s, `name`, `party`, `symbol`
- Cross-check: the `id` returned here must match what actually gets encrypted when a vote is cast (open browser devtools on `/voter/vote` and confirm)

**Adversarial**
- Invalid format (`con-1`, `CON-99`, `DROP TABLE candidates;`) → `400`, not a crash
- Missing `constituency` param → `400`

**What NOT to test**
- Adding/editing/removing candidates via `AdminDashboard` — it's mock UI only, not wired to the DB. Don't file "my new candidate doesn't show up" as a bug.

**Pass criteria**: only real, valid constituency codes return data; everything else is a clean 400

---

## 3. Client-Side ElGamal Encryption — `frontend/src/utils/elgamal.ts`
**Status: built**

**What to test**
- Encrypt the same candidate ID twice → two **different** ciphertexts each time (randomized encryption — this is required, not a bug, if they matched every time that would be a real vulnerability)
- Fetch `/election/public-key`, confirm the frontend actually uses those exact `p`/`g`/`y` values (check network tab)

**Adversarial**
- Try to force-encrypt something that isn't a valid UUID (e.g., open devtools console and call `encryptCandidateId("not-a-uuid", pubkey)`) → must throw client-side, must never produce a ciphertext that reaches the server

**What NOT to test**
- 256-bit prime size — documented as "simulation-grade," not production-grade. Don't flag this as a weakness; it's a known, intentional tradeoff.
- Timing/side-channel resistance, quantum resistance — out of scope for this project

**Pass criteria**: same input never produces identical ciphertext twice; invalid input never reaches the server as a "valid" ciphertext

---

## 4. Vote Casting — `POST /vote`, `fn_cast_vote`
**Status: built**

**What to test**
- Cast a vote for a registered, eligible, not-yet-voted voter → `201`, a `votes` row appears, `has_voted` flips to `true`

**Adversarial (this is the important section — double-voting is the #1 thing a voting system must prevent)**
- Cast a **second** vote for the same voter (same `nid_hash`) → must be rejected (`409`/`403`); confirm exactly **one** vote row exists for that voter afterward, not two
- **Concurrent double-cast**: fire two simultaneous requests for the same voter at the same time (e.g., two terminal tabs, or a small script firing both at once) → exactly one must succeed, never both, never neither. This tests the row-lock in `fn_cast_vote`, not just the earlier duplicate check.
- Cast a vote for an NID hash that was never registered → `404`
- Cast a vote for an ineligible voter (`is_eligible: false` — you'll need to set this directly in Supabase for a test row) → `403`
- Submit malformed `encrypted_vote` (missing `c1`/`c2`, wrong types, extra fields) → `400`
- Directly try to `UPDATE` a vote's `encrypted_vote` or `voter_nid_hash` via SQL in Supabase (test env only) → must be rejected by the immutability trigger
  - **Framing note (important for the paper)**: this trigger is **defense-in-depth**, not the real tamper-evidence guarantee. Our adversary model assumes an attacker with full DB access who *can drop the trigger*. So "trigger blocked the UPDATE" = pass for defense-in-depth, but the *actual* immutability claim is proven on-chain (section 8), not here. If you can drop the trigger and then edit a vote, that is **expected** under our model — the point is that section 8's on-chain verify still catches it. Don't file "I dropped the trigger and edited a vote" as a system-breaking bug; file it only if section 8 then *fails* to detect that edit.

**What NOT to test**
- Whether the server can validate the vote's *content* is a valid candidate choice at submission time — it can't, there's no ZKP yet. This is a documented, known gap, not a new bug.

**Pass criteria**: no scenario produces two successful votes for one voter, including the concurrent race; immutability trigger actually blocks direct edits

---

## 5. Nullifier — redesigned implementation (secret-salted, vote storage key)

> **Update 2026-07-16**: Nabiha's redesign is **merged** (PR #17). The old §5a (unsalted nullifier, `voter_nid_hash` as storage key) no longer exists in the code — test the redesign below, now, against `dev`.

**Status: built — test now.** Nullifier is `SHA-256(nid + election_id + NULLIFIER_SECRET)` computed server-side only (`backend/src/crypto/identity.ts`); vote rows store `nullifier_hash` + `constituency_code`, never `voter_nid_hash`.

**What to test (basics still apply)**
- Same NID + same election ID → same nullifier hash, every time (determinism survives the redesign)
- `POST /voter/check-nullifier` correctly reports `exists: false` before voting, `exists: true` after

**What to test (redesign-specific)**
- The nullifier can no longer be reproduced by anyone without the server-side secret salt — try computing it yourself client-side-only (old formula, `SHA-256(nid + election_id)`) and confirm it no longer matches what the server actually uses/stores
- Votes can no longer be joined straight back to `voters` via a raw `nid_hash` column — check the schema/query path actually goes through the new nullifier-based indirection
- Double-voting is **still** blocked after the redesign (this must not regress — retest all of section 4's adversarial cases against the new code)
- Tallying (`POST /keyshares/tally`) still correctly groups results by constituency (confirm the new indirection layer still resolves constituency correctly — this is the trickiest part of the redesign to get right)

**Adversarial**
- Attempt to deanonymize a decrypted vote by joining on the old-style `nid_hash` path — should no longer be possible
- Attempt to reconstruct someone's nullifier from public information alone (no salt) — should be infeasible

**Pass criteria**: (a) double-vote prevention unchanged, (b) a decrypted vote can no longer be trivially traced back to a specific voter, (c) tally aggregate results are unchanged in total count vs. before the redesign (only the linkability changes, not the counting)

---

## 6. Shamir's Secret Sharing / Key Ceremony
**Status: built**

**What to test**
- `POST /keyshares/submit` with correct `keyholder_id` + correct passphrase → success, `submitted_count` increments
- `GET /keyshares/status` accurately shows submitted count out of 4

**Adversarial (security-critical — this was a real bug we already fixed once, retest it explicitly)**
- Wrong passphrase for a valid `keyholder_id` → must be `401`
- Correct `keyholder_id`, but try to submit again after already submitting → must be `409`, must not overwrite the existing share
- With only 2 of 4 shares submitted, `GET /keyshares/reconstruct` → `400` "threshold not met," and the response must contain **zero** key material
- With 3+ shares submitted, `/keyshares/reconstruct` → success, but check the response body contains **only** a boolean/message, never any part of the actual key (not even a truncated preview)

**What NOT to test**
- The literal reconstructed private key value — it should never be visible anywhere. (See the hard rule at the top: if you ever see it, stop and report immediately, don't keep poking.)

**Pass criteria**: wrong passphrase always rejected; no key material ever leaks at any threshold state

---

## 7. Tallying & Decryption — `POST /keyshares/tally`
**Status: built, untested against a real 3-of-4 ceremony**

**Precondition**: use **real** submitted shares (3 of 4 actual keyholders), not simulated ones, at least once before signing off on this section.

**What to test**
- Correct `x-admin-secret` + 3 real shares → returns results grouped by constituency → candidate, plus `valid_votes`/`invalid_votes` counts
- `total_votes = valid_votes + invalid_votes`, always — no vote should be unaccounted for
- Candidate vote counts within each constituency sum correctly

**Adversarial**
- Wrong or missing `x-admin-secret` → `401`, no data returned
- Fewer than 3 shares submitted → `400`, no partial/attempted reconstruction
- (Test env only) manually insert a vote row with a corrupted `encrypted_vote` blob directly in Supabase, run the tally, confirm it's counted under `invalid_votes` — not silently dropped, not a crash

**What NOT to test / be careful with**
- This is a **one-time, irreversible ceremony action**. Never trigger it against real production data casually — always test against seeded/mock data first, and only run it for real with the whole team's sign-off.

**Pass criteria**: correct results with valid auth+threshold; clean rejection otherwise; malformed votes degrade to "invalid," never a crash or silent miscounting

---

## 8. Merkle Anchoring — `POST /anchor/batch`, `GET /anchor/verify/:voteId`
**Status: built; contract DEPLOYED to Ethereum Sepolia on 2026-07-15 (chain switched from Amoy — see context.md "Deployed Contract"). Live tests unblocked — this section can be tested end-to-end now.**

Contract: `0x312621075076Eb379fbE81760A76B5a8E56b95a7` — https://sepolia.etherscan.io/address/0x312621075076Eb379fbE81760A76B5a8E56b95a7

**What to test (local baseline)**
- `npm test` inside `blockchain/` → must stay 4/4 passing on every PR. This is the baseline regression check — run it locally if CI doesn't cover a change you're reviewing.

**What to test (live, on Sepolia — Sheikh runs first per LEFTWORK.md Task 1; anchoring is irreversible, seeded data only)**
- Anchor a real batch, then call `/anchor/verify/:voteId` for a vote in that batch → both `included_locally` and `included_on_chain` must be `true`
- Cross-check the returned `tx_hash` on Sepolia Etherscan — the anchored root visible on a public chain is the whole point
- Verify a `vote_id` that was never anchored → `404`

**Adversarial — edit tampering (the core claim)**
- (Test env only) tamper with a `merkle_batches` row's stored vote list in Supabase, then re-verify a vote from that batch → must return `409` "possible data tampering," never a false-positive valid proof
- Also edit a vote's `encrypted_vote` directly, then `GET /anchor/verify/:voteId` for that vote → `409`, recomputed root ≠ on-chain root
- Call `POST /anchor/batch` without `x-admin-secret` → `401`
- Call `POST /anchor/batch` when there are zero unanchored votes → `400`, no empty batch gets anchored

**Adversarial — deletion / completeness (methodology row 6 — expect a partial/honest result, not a clean pass)**
- (Test env only) after a batch is anchored, **delete** one anchored vote row *and* remove its id from that batch's `merkle_batches.vote_ids`, then re-verify a *different, surviving* vote from the same batch.
- Record honestly which of these happens:
  - Surviving votes still verify `true` (likely) — because a Merkle root proves **inclusion**, not **completeness**. The deleted vote simply "never existed" as far as the surviving proofs know.
  - Whether anything at all flags that the batch shrank. Today the contract anchors only the root, **not a leaf/vote count**, so a consistent deletion is probably **not detected**.
- This is a **known boundary**, not a bug to panic over. Write down exactly what you observed. Mitigation (commit a leaf-count on-chain and have the auditor check it) is tracked — the honest "not detected, mitigated by X" result is itself a paper finding.

**Adversarial — pre-anchor window (methodology row 7 — expect not-detectable, that's the point)**
- Cast a vote but do **not** anchor its batch yet. Edit that vote's `encrypted_vote` in Supabase, then `GET /anchor/verify/:voteId`.
- Expected: verification cannot flag on-chain tampering because there is **no on-chain root for this vote yet**. This demonstrates the guarantee only holds *after* anchoring — record the result to bound the claim by anchoring cadence.
- Do **not** file this as a bug. It quantifies the protection window, which the paper states openly.

**What NOT to test**
- Gas costs or real financial risk — Sepolia is a testnet, the ETH has no real value
- Performance/scale of anchoring — this is a simulation, not a production chain with real throughput requirements

**Pass criteria**: for anchored votes, on-chain and off-chain verification always agree and edit-tampering is caught (`409`); for deletion and pre-anchor cases, the observed result is **recorded honestly** (detected / not detected / mitigated) — these bound the guarantee rather than pass or fail it

---

## 9. Public Watchdog — `GET /public/stats`, `/watchdog` page
**Status: built**

**What to test**
- Numbers shown on the page match a direct count in Supabase (don't just trust the endpoint — cross-check independently)
- Turnout percentage math is correct (`votes_cast / registered_voters` per constituency)
- Page auto-refreshes every 15 seconds
- The "verify your vote" tool on the page correctly reflects real anchor status (ties back to section 8)

**What NOT to test / watch for as a serious regression**
- **Per-candidate results must never appear on this page.** That's tallying's job, and showing it here before/without the key ceremony would be a real privacy violation, not just a bug. If you ever see candidate-level vote counts here, report it immediately as high priority.

**Pass criteria**: all displayed numbers are independently verifiable against the DB; no decrypted candidate data ever appears here

---

## 10. Admin Dashboard / Admin Auth
**Status: UI mock only, not wired to real logic**

**What NOT to test (known, intentional — don't file as bugs)**
- Candidate add/edit/remove actually persisting — it doesn't, it's mock data in the component
- Admin login actually authenticating — it's a UI mock, any input navigates through

**What to still check**
- That the mock admin pages don't accidentally call any protected backend endpoint without the real `x-admin-secret` (open devtools network tab while clicking around) — if they do, that's a real issue even though the login itself is fake

---

## 11. Future Work — test plans ready for when these get built

Nothing in this section exists yet. These are written now so testing can start immediately once code lands, instead of being designed from scratch under time pressure later.

### 11a. Digital Signature (integrity)
- Tamper with a signed ciphertext in transit (flip one byte) → signature verification must fail server-side
- Replay a previously-signed vote → must be rejected (needs a nonce/timestamp check)
- **Critical check**: confirm the signing key is ephemeral/session-based, not the voter's persistent identity. If it's a persistent identity key, that undoes the nullifier/ballot-secrecy work — flag immediately, don't treat it as a minor note.

### 11b. Benaloh Challenge (cast-or-audit, voter verifiability)
- Choosing "audit" reveals the randomness used to encrypt; independently recomputing the ciphertext from `(candidate_id, randomness, public_key)` must match exactly
- After auditing, the **same** ciphertext must never actually be cast — casting requires fresh randomness (re-encryption). If the audited ciphertext can be directly submitted as the final vote, that's a protocol violation.
- Choosing "cast" directly (no audit) must never reveal the randomness

### 11c. Full ZKP (zk-SNARK proof of eligibility/validity)
- A valid proof from a genuinely eligible voter verifies successfully
- A forged or invalid proof is rejected
- Note: the zero-knowledge property itself (that a proof reveals nothing about voter identity) is usually validated by the underlying security proof of the scheme, not by empirical testing alone — don't expect to "test your way" to confidence here, that's a design/review question for whoever implements it

### 11d. MACI
- Out of scope entirely (documented future-work-only). No test plan needed unless the project's scope changes.

---

## Project-wide "do not test"

- Production-grade crypto parameters — this is explicitly a simulation (256-bit ElGamal, etc.); don't file "should be 2048-bit" as a bug
- Load/stress testing — this system has ~20-50 seeded voters, it's an academic simulation, not a production system sized for real election volume
- Anything explicitly listed under "Not Yet Implemented" in `context.md` — check there first before assuming something is a bug
- Never run tallying or anchoring against real/live data without explicit team sign-off — both are irreversible

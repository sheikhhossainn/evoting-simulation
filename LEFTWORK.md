# Left Work — Remaining Tasks & Assignments

> Goal: prove a tamper-proof online voting system using blockchain. Not website polish.
> Ordered by priority. Each task lists owner, why it matters, and exact steps.
> Last updated: 2026-07-16.

## Status snapshot (what's already done, docs lag behind)

- Nullifier redesign (server-side secret salt, `nullifier_hash` + `constituency_code` as ballot key) — **merged** (PR #17). `testing_guidance.md` section 5b says "not built yet" — stale.
- `MerkleRootStorage` contract — **deployed to Ethereum Sepolia on 2026-07-15** (not Polygon Amoy; the team switched chains). `backend/.env` already has `MERKLE_CONTRACT_ADDRESS` and the Sepolia RPC URL (still under the `AMOY_RPC_URL` variable name). `context.md` still says "not deployed, target Amoy" — stale.
- Everything in `context.md` "Backend API" table marked ✅ is built and functional against Supabase.

---

## Task 1 — Live anchoring + tamper-detection demo on Sepolia
**Owner: Sheikh** (deployed the contract, owns `blockchain/` + `backend/src/blockchain/`)
**Priority: HIGHEST — this single task IS the tamper-proof proof. Nothing new to build, only run + document.**

The contract is deployed but has never anchored a real vote batch. Until this runs end-to-end, the project's core claim is unproven.

Steps:
1. Confirm seeded/mock votes exist (`backend/src/scripts/seed-voters.ts`, cast a handful via the UI or curl). **Anchoring is irreversible — seeded data only, per testing rules.**
2. `POST /anchor/batch` with the `x-admin-secret` header. Record the returned `batch_id`, `root`, `tx_hash`.
3. Open the `tx_hash` on https://sepolia.etherscan.io — screenshot it. This is evidence the root is on a public chain.
4. `GET /anchor/verify/:voteId` for a vote in that batch → both `included_locally` and `included_on_chain` must be `true`.
5. **The tamper test (the money shot):** in Supabase (test env), edit that batch's row in `merkle_batches` — swap one `vote_id` in the stored list, or edit the vote's `encrypted_vote` JSONB. Re-run `GET /anchor/verify/:voteId` → must return `409` "possible data tampering". Screenshot before/after.
6. Also verify a never-anchored `vote_id` → `404`, and `POST /anchor/batch` with zero unanchored votes → `400`.
7. Write the whole run up (commands, responses, Etherscan links, screenshots) — this becomes the centerpiece of the evaluation/demo section.

Deliverable: a `docs/tamper-proof-demo.md` (or report section) showing: honest data verifies on-chain; tampered data is caught.

## Task 2 — Update stale docs (context.md, testing_guidance.md)
**Owner: Sheikh** (knows current deploy state)
**Priority: HIGH, quick — teammates are working from wrong info.**

1. `context.md`: "Not Yet Implemented" still lists Amoy deployment as pending — replace with Sepolia deployment facts (address, date, chain). Update "Target chain" row in the tech-stack table.
2. `context.md`: nullifier limitation under "Known Limitations" is fixed by PR #17 — move it to a "Fixed" note, describe the new design (server-side salted nullifier as ballot key).
3. `testing_guidance.md`: flip section 5b status from "not built yet" to "built — test now"; flip section 8 from "not yet deployed" to "deployed to Sepolia — live tests unblocked".
4. Optional cleanup: rename `AMOY_RPC_URL` → `CHAIN_RPC_URL` in `backend/.env(.example)` + `backend/src/blockchain/merkleContract.ts` to stop the naming confusion. Low effort, prevents future mistakes.

## Task 3 — Nullifier redesign regression suite
**Owner: Urmi** (test plans already written for her in `testing_guidance.md` §5b + §4)
**Priority: HIGH — the redesign touched the double-vote path; a regression here breaks the #1 security property.**

Run against the current `dev` build:
1. All of §4 adversarial cases again, especially the **concurrent double-cast** (two simultaneous `POST /vote` for the same voter → exactly one succeeds). The redesign changed the storage key; the row-lock in `fn_cast_vote` must still hold.
2. §5b checks: old-formula client-side nullifier (`SHA-256(nid + election_id)`) must no longer match what the server stores; votes must no longer be joinable to `voters` via a raw `nid_hash` column — inspect the `votes` schema and query path in Supabase.
3. Immutability trigger: direct SQL `UPDATE` on a vote row in Supabase (test env) → must be rejected.
4. Write findings as concrete evidence ("did X, got Y"), pass or fail — these go straight into the evaluation section.

## Task 4 — Real 3-of-4 key ceremony + tally
**Owner: Humaira** (coordinates; needs 3 humans anyway), **Urmi verifies** per §7
**Priority: HIGH — tally code is built but has never run against a real 3-of-4 ceremony. §7 explicitly requires this once before sign-off.**

1. Pick 3 of the 4 keyholders (any 3 teammates). Each submits their real share via `POST /keyshares/submit` (UI at `/keyholder/submit`) with their own passphrase.
2. Adversarial along the way (§6): wrong passphrase → `401`; duplicate submission → `409`; `GET /keyshares/reconstruct` at 2 shares → `400` with zero key material.
3. With 3 shares in: `POST /keyshares/tally` with `x-admin-secret` on **seeded data only** (irreversible — whole-team sign-off first, per testing rules).
4. Verify: `total_votes = valid_votes + invalid_votes`; per-constituency candidate sums correct; results still group correctly by constituency through the new nullifier indirection (the trickiest part of the redesign — §5b calls this out).
5. Corrupt-ciphertext test (§7): manually break one `encrypted_vote` blob in Supabase, re-tally → counted as `invalid_votes`, no crash.
6. Cross-check `/watchdog` page: per-candidate results must **never** appear there (§9 — privacy violation if they do).

## Task 5 — Benaloh challenge (cast-or-audit voter verifiability)
**Owner: Nabiha** (did the nullifier crypto redesign — closest to the encryption code)
**Priority: MEDIUM — first *new* feature worth building. Gives individual voter verifiability, a strong thesis point, moderate effort. Test plan already exists (§11b).**

Design constraints (from §11b — violating these makes it worse than not building it):
- "Audit" reveals the encryption randomness `r`; anyone can recompute the ciphertext from `(candidate_id, r, public_key)` and check it matches. Implement the recompute check client-side in `frontend/src/utils/elgamal.ts` (encryption already lives there).
- An audited ciphertext must **never** be castable — after audit, force re-encryption with fresh randomness before casting. Enforce in the voting flow (`VotingPage.tsx`), and ideally server-side too (reject a ciphertext previously revealed for audit — simplest: audit happens purely client-side before submission, and submission always triggers fresh encryption).
- "Cast" without audit must never expose `r`.

Suggested shape: add an "Audit this ballot" button on the review step in `VotingPage.tsx`; on audit, show `(candidate_id, r, ciphertext)` + a "verified ✓ / mismatch ✗" recomputation result, then discard and re-encrypt. No backend changes strictly required for a minimal version.

## Task 6 — ZKP of vote validity: decide scope, then document or build
**Owner: Nabiha decides + writes justification; team ratifies**
**Priority: MEDIUM — biggest known gap, but a real zk-SNARK is weeks of work and may not be needed to make the academic argument.**

Current state: a malformed/malicious ciphertext is accepted at submission and only caught at decrypt time (tally counts it as `invalid_votes` — already defends against crashes and miscounting).

Decision:
- **Option A (recommended for the timeline): document as a scoped limitation.** Write a section explaining: what a submission-time validity proof would add, why decrypt-time rejection already prevents miscounting, and what scheme would be used in production (e.g., Groth16 over a circuit proving "ciphertext encrypts one of the valid candidate UUIDs"). §11c itself notes the ZK property is validated by the scheme's security proof, not empirical testing — a design writeup is academically legitimate here.
- **Option B: build a minimal disjunctive Chaum-Pedersen proof** ("ciphertext encrypts one of N known candidate ids") — much cheaper than a full zk-SNARK, fits the existing ElGamal setup, real cryptographic content for the thesis. Only if time remains after Tasks 1–5.

## Task 7 — Evaluation write-up (runs alongside everything)
**Owner: Humaira** (compiles), **all** contribute evidence
**Priority: MEDIUM — this is what actually "proves" the system to readers.**

Collect from Tasks 1, 3, 4: exact commands run, responses, Etherscan links, screenshots, pass/fail per adversarial case. Structure: property claimed → attack attempted → observed result. Properties to cover: double-vote prevention, ballot secrecy (nullifier unlinkability), vote immutability (DB trigger + Merkle/chain), tamper detection (Task 1 step 5), threshold decryption (no single party can decrypt), no key-material leakage.

---

## Explicitly NOT doing (agreed scope — don't spend time here)

- Admin dashboard wiring / real admin auth / RLS policies — `x-admin-secret` suffices for the simulation; documented intentional mocks.
- Production-grade crypto parameters (2048-bit keys etc.) — documented simulation-grade tradeoff.
- Load/performance testing — ~20–50 seeded voters, academic simulation.
- MACI — documented future-work-only (§11d).
- Digital signature layer (§11a) — only if Tasks 1–6 finish early; if built, the signing key MUST be ephemeral/session-based, or it undoes the nullifier work.

## Hard rules (unchanged, from testing_guidance.md)

1. Never run tallying or anchoring against real/live data without whole-team sign-off — both irreversible. Seeded/mock data only.
2. Any sight of private key material in any response/log/UI = critical regression, stop and report immediately.

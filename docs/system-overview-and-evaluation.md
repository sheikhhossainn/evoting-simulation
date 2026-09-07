# System Overview, Implementation, and Evaluation

**What this document is.** One self-contained account of how this e-voting simulation works, what
cryptographic and infrastructural building blocks it uses and why, how it is tested, and the actual
current results of that testing — measured, not estimated, as of this writing. Companion documents
go deeper on individual pieces (linked throughout); this file is the entry point that ties them
together for anyone reading the project end-to-end for the first time — reviewer, examiner, or
future contributor.

**Honesty policy, matching every other doc in this project:** every claim below is either backed by
a code reference, a test file, or a real captured run. Where something is designed but not built, or
tested against a mock rather than live infrastructure, that distinction is stated, not blurred.

---

## 1. What the system is

A working simulation of the cryptographic mechanisms behind end-to-end-verifiable (E2E-V) electronic
voting — not a production election platform. A voter registers, casts an encrypted ballot with a
proof that it's valid, the ballot is permanently locked and periodically anchored to a public
blockchain, and — at tally time — a 3-of-4 threshold of independent keyholders cooperatively decrypt
and publish results, with every step independently checkable by an outside observer holding no
secret material.

**Stack:** React 19 + Vite + Tailwind (frontend) · Express 5 + TypeScript (backend) ·
Supabase/Postgres (storage) · Hardhat + Solidity (on-chain anchoring, Sepolia testnet) · native
`BigInt` + Web Crypto API (all client-side cryptography — no external crypto library, by design,
since the point of the simulation is showing the primitives working, not hiding them behind one).

---

## 2. Cryptographic building blocks — what's used, and why

| Primitive | Used for | Implementation |
|---|---|---|
| **ElGamal encryption** (256-bit safe prime, order-`q` subgroup) | Encrypting each ballot; homomorphic-friendly for threshold decryption | [elgamal.ts](../backend/src/crypto/elgamal.ts) |
| **Chaum-Pedersen OR-proof** (Cramer-Damgård-Schoenmakers 1994, Fiat-Shamir non-interactive) | Proving a ballot encrypts *one of* the real candidates in the voter's constituency, without revealing which — mandatory on every vote | [zkp.ts](../backend/src/crypto/zkp.ts) |
| **Shamir Secret Sharing over `Z_q` + Feldman VSS** | Splitting the decryption key into 4 shares, threshold 3; commitments let each share be checked against a public value | [shamirZq.ts](../backend/src/crypto/shamirZq.ts) |
| **Chaum-Pedersen DLEQ proof** | Proving a keyholder's published partial decryption was honestly computed from their real share, for *this specific ballot* — without reconstructing the private key anywhere | [dleq.ts](../backend/src/crypto/dleq.ts) |
| **Pedersen-style Distributed Key Generation (DKG)** | Generating the decryption key itself with no single party (dealer, server, or any one keyholder) ever holding it in full | [routes/dkg.ts](../backend/src/routes/dkg.ts), [dkgCrypto.ts](../frontend/src/utils/dkgCrypto.ts) — full protocol/proof detail: [dkg-security-analysis.md](dkg-security-analysis.md) |
| **Dense Merkle tree** (per-batch, sorted-pair hashing) | Anchoring a batch of ballots to one on-chain root; proof of inclusion for any ballot | [merkleTree.ts](../backend/src/merkle/merkleTree.ts) |
| **Sparse Merkle Tree** (256-level, cumulative, over `nullifier_hash` keys) | Proving *non-membership* too — the mechanism that makes ballot **deletion** (not just modification) detectable | [sparseMerkleTree.ts](../backend/src/merkle/sparseMerkleTree.ts), design: [smt-design.md](smt-design.md) |
| **On-chain anchoring** (`MerkleRootStorage.sol`, Sepolia) | Public, immutable, third-party-checkable root of truth for both trees, per election | [MerkleRootStorage.sol](../blockchain/contracts/MerkleRootStorage.sol) |

Nothing above is a novel cryptographic construction — every primitive is a textbook instance of a
named, cited result. What this project builds is the **composition**: how these pieces are wired
together into a working system, where the trust boundaries actually are, and where they are not.
Formal statements of exactly what each piece proves (and does not) are in
[formal-security-definitions.md](formal-security-definitions.md) and
[dkg-security-analysis.md](dkg-security-analysis.md) — game-based definitions, proof sketches,
citations, explicit residual-scope sections.

---

## 3. The full lifecycle, end to end

### 3.1 Election setup (admin, one-time per election)

1. `POST /elections` registers the election (`election_id`, name, constituency count) —
   [elections.ts](../backend/src/routes/elections.ts). Every other table now requires this row to
   exist first (FK-enforced) — this is the actual mechanism that makes the system replicable for a
   *different* election rather than hardcoded to one (§10 of the old threat model named this as an
   open gap; closed this session — see §6.3 below).
2. Candidates and constituencies are seeded
   ([seed-constituencies.ts](../backend/src/scripts/seed-constituencies.ts)) and, before voting
   opens, their Merkle root is committed on-chain
   (`ElectionSetupCommitment.sol`) so a later drift between the live DB and what was originally
   published is detectable.
3. **Key generation (DKG ceremony)** — `POST /dkg/init` publishes public group parameters
   `(p, g)`; the 4 keyholders each run the ceremony in their own browser tab
   ([KeyCeremony.tsx](../frontend/src/pages/KeyCeremony.tsx)): generate their own polynomial and
   Feldman commitments locally, exchange encrypted sub-shares, combine into their own final share —
   the private key never exists in one place, not even momentarily on the server. Full protocol,
   proof, and a real captured live run: [dkg-security-analysis.md](dkg-security-analysis.md).
4. Keyholders are seeded per-election ([seed-keyholders.ts](../backend/src/scripts/seed-keyholders.ts))
   with individually-hashed passphrases — two elections can have entirely disjoint keyholder sets.

### 3.2 Voting

1. Voter registers by NID (`POST /voter/register`) — the raw NID is never stored, only
   `SHA-256(nid + salt)`.
2. Client fetches the election's public key `(p, g, y)` and its constituency's candidate list, then
   **client-side**: ElGamal-encrypts the chosen candidate's UUID with fresh randomness, and builds
   the Chaum-Pedersen OR-proof that the ciphertext encrypts one of the real candidates — without the
   ciphertext or the proof ever revealing which one.
3. `POST /vote` — backend re-derives the valid candidate set itself (never trusts the client for
   this), verifies the proof is mandatory and valid, then calls `fn_cast_vote` — one atomic
   Postgres transaction: eligibility check, row-lock, insert (keyed by a server-computed
   `nullifier_hash = SHA-256(nid + election_id + server_secret)`, never `nid` itself), flip
   `has_voted`. A DB trigger makes the row immutable from that point on (no UPDATE, no DELETE,
   except one narrow audited exception used only by the tamper-detection demo).

### 3.3 Anchoring

A batching service periodically folds newly-queued votes into a dense Merkle tree and a cumulative
Sparse Merkle Tree, and anchors both roots on-chain in one transaction each
([anchorBatch.ts](../backend/src/services/anchorBatch.ts),
[anchorSmtBatch.ts](../backend/src/services/anchorSmtBatch.ts)). `GET /anchor/verify/:voteId`
returns a Merkle proof linking one ballot to the on-chain root; `GET /anchor/verify-smt/:voteId`
does the same against the SMT, and can also produce a **non-membership** proof — the mechanism that
catches deletion, not just modification (design: [smt-design.md](smt-design.md)).

### 3.4 Tally

`POST /keyshares/submit-partial` — each keyholder computes their partial decryption
`d_i = c1^(x_i) mod p` **locally in their browser**
([KeyShareSubmit.tsx](../frontend/src/pages/KeyShareSubmit.tsx)) and a DLEQ proof that `d_i` is
consistent with their public commitment, for that specific ballot. Only `(d_i, proof)` — never the
raw share — is ever sent. `POST /keyshares/tally` (admin) re-verifies every DLEQ proof
independently (never trusts the stored `verified` flag), combines any ≥3 valid partials per ballot
via Lagrange interpolation *in the exponent* (`combinePartialDecryptions`, `dleq.ts`) — the private
key is never assembled anywhere, at generation time or at tally time.

### 3.5 Verification

`GET /keyshares/verification-bundle` assembles everything an independent, no-special-access observer
needs — group params, keyholder commitments, ballots, partial decryptions, SMT membership proofs,
setup commitment, published totals — and
[independent-verify-tally.ts](../backend/src/scripts/independent-verify-tally.ts) is a standalone
script that recomputes the entire tally from that bundle alone, without touching the database or any
authenticated route, and confirms it matches the published result.

---

## 4. Testing methodology

Four layers, deliberately not collapsed into one:

1. **Unit tests** (no DB, no network) — the cryptographic core in isolation: ElGamal correctness/
   semantic-security property tests (`fast-check`, thousands of randomized inputs), ZKP soundness,
   DLEQ soundness, Shamir/Feldman algebra, Merkle/SMT proof generation and forgery rejection, and —
   new this session — DKG commitment-combination algebra
   ([dkg.test.ts](../backend/src/crypto/dkg.test.ts)).
2. **Route/integration tests against a mock Supabase** — full HTTP request/response cycles through
   Express, with an in-memory mock standing in for the database, so route logic (auth, validation,
   scoping, error paths) is tested without touching live data. This is where the DKG's full 3-round,
   4-keyholder ceremony is exercised end-to-end
   ([dkg.test.ts (routes)](../backend/src/routes/dkg.test.ts)), including feeding its output into
   the **unmodified** partial-decryption route to prove real interoperability, not just that the new
   routes work in isolation.
3. **Live-database integration tests** (`backend/src/db/integrity.test.ts`,
   `backend/src/routes/vote.test.ts`, `backend/src/routes/anchorSmt.integration.test.ts`) — talk to
   real Supabase directly, isolating raw schema constraints (foreign keys, uniqueness, immutability
   triggers) independent of application logic. Two of these three additionally require a *separate*
   test Supabase project before they'll run at all — `testSupabaseEnv.ts` refuses to fall back to
   the production database, a deliberate safety choice — so they're gated, not broken, when that
   isn't configured (see §5.2).
4. **Live end-to-end runs against real infrastructure** — not a test file at all, but an actual
   execution: a real 4-browser-tab DKG ceremony run against the deployed backend and a real Supabase
   project, and (earlier in this project's history) a real tamper-detection demo against a deployed
   Sepolia contract. This is the layer that catches "the code is correct but the live migration
   was never applied" class of problem that unit/mock tests structurally cannot catch — which is
   exactly what happened this session (§5.3).

Adversarial testing specifically (attack attempted → observed result) is verified across the
test suites and live test reports ([tamper-proof-demo.md](tamper-proof-demo.md),
[tally-verifiability-implementation-report.md](tally-verifiability-implementation-report.md)) — forged ZKP,
modified ciphertext, replayed ballot, wrong passphrase, duplicate submission, under-threshold
reconstruction, corrupted-ciphertext tallying, concurrent double-vote, direct SQL UPDATE — all **PASS**,
each with exact commands and observed responses documented.

---

## 5. Current results

### 5.1 Backend unit + integration suite

```
Test Files  2 failed | 16 passed (18)
Tests       173 passed, 2 skipped (175)
```

Run: `cd backend && npx vitest run`, this session, after applying the multi-election + DKG
migration to the live database. Includes: full cryptographic core, all route logic (voter, vote,
candidates, keyshares, anchor, public, elections, **dkg**), all services, and the live-database
integrity suite (`db/integrity.test.ts`) — which required a small fix this session: three of its
tests inserted rows without an `election_id`, which the multi-election migration now requires;
fixed by supplying the project's real backfilled election id, restoring their original intent
(reject a bad `constituency_code` via foreign-key violation) rather than failing on an unrelated
not-null violation first.

**The 2 gated tests** (`vote.test.ts`, `anchorSmt.integration.test.ts`) require a separate,
dedicated test Supabase project (`backend/.env.test`) before they run at all — this project
deliberately refuses to run write-heavy integration tests against the production database. Not
configured for this session; these are the project's pre-existing, documented gate, not a new gap.
They fail-closed (0 tests each) rather than silently passing.

### 5.2 Blockchain contract suite

```
35 passing (9s)
```

Run: `cd blockchain && npx hardhat test`. Covers `MerkleRootStorage.sol`'s dense-tree anchoring,
SMT anchoring, on-chain proof verification (membership, non-membership, forgery rejection across
multiple attack shapes), concurrent-anchor race handling, and — new this session — a
**multi-election isolation** suite proving two elections' on-chain batch counters, roots, and SMT
chains are fully independent within one shared contract deployment.

### 5.3 DKG ceremony — live run, not just tests

Beyond the automated suites above, the DKG ceremony was run for real: 4 separate browser tabs,
election `DKG-TEST-01`, against the actual deployed Express backend and a real Supabase project —
not a mock. Real captured server state after the run: ceremony `status: "qualified"`, all 4
keyholders showing `round1_submitted / round2_submitted / round3_confirmed: true`, a published
combined Feldman commitment vector, and 4 distinct public commitments — full JSON responses quoted
in [dkg-security-analysis.md §6](dkg-security-analysis.md#6-empirical-evidence--live-ceremony-run).
This is the layer of evidence a code-inspection-only writeup cannot provide, and the layer that
caught a real bug in this session: the multi-election migration itself had never been applied to
the live project (§6.1 below), something no unit or mock test could have caught, because they don't
touch live infrastructure by design.

### 5.4 Scalability (off-chain timing + on-chain gas, up to 50,000 synthetic ballots)

Measured, not estimated, from [scalability-benchmark.ts](../blockchain/scripts/scalability-benchmark.ts)
against Hardhat's in-memory EVM. Full tables: [scalability-benchmark-results.md](scalability-benchmark-results.md).
Headline numbers:

| Metric | @ 1,000 | @ 10,000 | @ 50,000 |
|---|---:|---:|---:|
| Dense tree build time | 362 ms | 3,836 ms | 23,695 ms |
| Dense `verify()` gas | ~34.8k | ~41.3k | ~43.9k |
| SMT insert (ms/key) | 12.19 | 11.95 | 12.78 (flat) |
| SMT membership-proof gas | ~338.7k | ~342.4k | (flat, ~340k regardless of scale) |
| DLEQ prove+verify per ballot | 0.75 + 1.12 ms | (constant, independent of N) | |
| ZKP OR-proof, 5-candidate constituency | ~10.3 ms prove+verify | (constant, independent of N — scales with candidate count, not N) | |

Key findings: on-chain cost is flat or logarithmic in ballot count; per-ballot cryptography is cheap
and embarrassingly parallel; the one genuine scalability limitation found is the current
single-key-at-a-time SMT `insert()` path (~5.3 minutes to build a 50k-key tree from scratch,
documented as a known optimization target — batched insertion — not implemented).

### 5.5 Adversarial test matrix

Compiled across the test suites and live reports ([tamper-proof-demo.md](tamper-proof-demo.md),
[tally-verifiability-implementation-report.md](tally-verifiability-implementation-report.md)) with exact
attack commands and observed responses. Summary: forged ZKP, tampered ciphertext post-anchor, replayed/duplicated ballot, wrong
keyholder passphrase, duplicate share submission, under-threshold reconstruction attempt, corrupted-
ciphertext tallying, concurrent double-vote race, direct SQL UPDATE bypass attempt — all **PASS**.
Two items remain explicitly open, stated as such rather than silently passed over: deletion of a
ballot *before* it was ever anchored (the pre-commitment-window gap — mitigated but not eliminated by
the SMT, [threat_model.md §5-6](threat_model.md#5-deletion-completeness-gap-detail)), and voter-
verifiable cast confirmation (Benaloh-style audit — explicit design boundary, not implemented,
[threat_model.md §8](threat_model.md#8-explicit-boundary-voter-verifiable-cast-confirmation)).

---

## 6. What changed this session, and what it closes

1. **Multi-election isolation** — every table (`voters`, `votes`, `candidates`, `constituencies`,
   anchored batches) is now scoped by `election_id`, contract-level state is keyed by election in a
   single shared `MerkleRootStorage` deployment, and every route resolves `election_id` explicitly
   (no silent default). This is the mechanism that makes the system genuinely replicable for a
   different election with the same codebase, rather than hardcoded to one — closing what the old
   threat model listed as an explicit non-goal (see the erratum in
   [dkg-security-analysis.md §8](dkg-security-analysis.md#8-erratum--stale-claims-elsewhere-in-the-docs-found-while-writing-this-document)
   — that non-goal listing is now stale and should be removed in a documentation follow-up).
2. **Distributed key generation** — replaces the trusted-dealer key ceremony with a real 4-party
   protocol where no party ever holds the full private key. Full treatment:
   [dkg-security-analysis.md](dkg-security-analysis.md).
3. **A genuinely new bug found and fixed while migrating**, not present in the pre-migration system:
   the candidates/constituencies immutability trigger checked `election_setup_commitments`
   *globally*, so anchoring one election's setup commitment silently froze every other election's
   still-in-setup data. Fixed to check the row's own `election_id`.
4. **The migration itself had never been applied to the live database** until this session — found
   by attempting the live DKG walkthrough and getting `PGRST205: table 'public.elections' not
   found`, not by any test (mock and unit tests structurally cannot catch "migration wasn't run,"
   since they don't touch live infrastructure). Applying it surfaced a further real bug: the
   backfill `UPDATE` on `constituencies`/`candidates` tripped the (correctly working)
   immutability trigger on a project that already had an anchored setup commitment — fixed by
   disabling the trigger for just that one backfill statement, documented inline in
   [schema.sql](../backend/src/schema.sql).

---

## 7. Known, stated limitations (not hidden)

- **Pre-anchor / pre-first-commitment window**: a ballot deleted before it was ever anchored in
  either tree leaves no trace. Substantially narrowed by the SMT, not eliminated —
  [threat_model.md §5-6](threat_model.md#5-deletion-completeness-gap-detail).
- **DKG is Pedersen91-style, not GJKR99-hardened**: no commit-then-reveal round, so a rushing
  keyholder can bias the *distribution* of the resulting public key. Does not break this system's
  actual secrecy requirement (argued formally in
  [dkg-security-analysis.md §4](dkg-security-analysis.md#4-known-limitation-rushingbias-on-the-public-key-pedersen91-vs-gjkr99)),
  but is a real, named gap relative to the state of the art.
- **DKG ceremony has no dropout recovery**: if a keyholder's browser tab closes mid-ceremony, their
  session material is gone and the whole ceremony must restart. A scoped, deliberate simplification
  for a scheduled one-time event, not a live service.
- **Voter-verifiable cast confirmation** (Benaloh-style audit) is an explicit design boundary, not
  implemented — the honest reasoning for why is in
  [threat_model.md §8](threat_model.md#8-explicit-boundary-voter-verifiable-cast-confirmation).
- **`threat_model.md` itself is currently stale** in three specific, named places (predates both the
  DLEQ tally redesign and this session's work) — enumerated precisely in
  [dkg-security-analysis.md §8](dkg-security-analysis.md#8-erratum--stale-claims-elsewhere-in-the-docs-found-while-writing-this-document),
  not yet corrected as of this document.

---

## 8. Document map

| Question | Read |
|---|---|
| What does each cryptographic piece formally prove? | [formal-security-definitions.md](formal-security-definitions.md) |
| How does the DKG ceremony work, and what does it prove? | [dkg-security-analysis.md](dkg-security-analysis.md) |
| What's the full protocol spec for partial decryption / DLEQ / verifiability? | [tally-verifiability-design.md](tally-verifiability-design.md) |
| How does the Sparse Merkle Tree / deletion-detection mechanism work? | [smt-design.md](smt-design.md) |
| What attacks were actually attempted, and what happened? | [tamper-proof-demo.md](tamper-proof-demo.md), [tally-verifiability-implementation-report.md](tally-verifiability-implementation-report.md) |
| What are the actor/trust assumptions and open gaps? | [threat_model.md](threat_model.md) (see §7 above for known staleness) |
| What does this system explicitly not attempt, and why? | [explicit-assumptions-and-nongoals.md](explicit-assumptions-and-nongoals.md) |
| How does this compare to published academic/real-world systems? | [related-work-positioning.md](related-work-positioning.md) |
| What does it cost, at scale? | [scalability-benchmark-results.md](scalability-benchmark-results.md), [anchoring-cost-analysis.md](anchoring-cost-analysis.md) |
| How do I run it myself? | [README.md](../README.md) |

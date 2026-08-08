# Secure E-Voting Simulation

A full-stack **blockchain-secured e-voting simulation** that lets you cast, verify, and tally encrypted ballots, with end-to-end integrity anchored to a real blockchain (Polygon Amoy / Sepolia).

It is a working simulation of the cryptographic mechanisms behind real end-to-end verifiable (E2E-V) voting systems — not a production election platform.

**Stack:** React 19 + Vite + Tailwind (frontend) · Express 5 + TypeScript (backend) · Supabase/Postgres (storage) · Hardhat + Solidity (anchoring) · Web Crypto API (client crypto)

---

## Table of Contents

- [How it works](#how-it-works)
- [Cryptographic design](#cryptographic-design)
- [The voting flow](#the-voting-flow)
- [End-to-end integrity (Merkle anchoring)](#end-to-end-integrity-merkle-anchoring)
- [Repository layout](#repository-layout)
- [API endpoints](#api-endpoints)
- [Setup](#setup)
- [Running](#running)
- [Testing](#testing)
- [Docs](#docs)

---

## How it works

A voter submits their National ID (NID). The client encrypts their candidate choice with **ElGamal encryption**, proves the encrypted ballot is valid without revealing the choice (**zero-knowledge proof**), and submits both. The backend stores only the ciphertext, checks the voter is registered and eligible exactly once, and the vote is permanently locked in the database.

Later, votes are hashed into a **Merkle tree** whose root is anchored to a **public blockchain** (a single on-chain transaction per batch). Anyone can verify that no stored ballot has been changed, deleted, or added — because the blockchain root is public and immutable, and the Merkle proofs connect each ballot to that root.

The system's two strongest guarantees:

1. **Ballot secrecy** — the backend never sees the plaintext vote. It receives an ElGamal ciphertext plus a ZKP that the ciphertext encrypts *one of* the legitimate candidates — without revealing which.
2. **Tamper-evidence** — a Merkle root of all votes is written on-chain. If any vote row in the database is altered, the recomputed tree root no longer matches the on-chain root, and the tamper is detectable by anyone.

## Cryptographic design

### ElGamal encryption (256-bit safe prime)

Each ballot is an ElGamal encryption of the candidate's UUID over a 256-bit safe prime `p = 2q + 1` (order-`q` subgroup):

```
c1 = g^k mod p
c2 = m · y^k mod p      (m = encoded candidate UUID, k = fresh random ephemeral key)
```

- The **public key** `(p, g, y)` is served to the client at `GET /election/public-key`.
- The **private key** `x` never touches the browser — it exists only server-side, split into shares (below).
- Encryption happens client-side with the Web Crypto API (fresh `k` per ballot, so identical choices produce different ciphertexts).

### Zero-knowledge proof of ballot validity (Chaum–Pedersen OR-proof)

A vote must prove that its ciphertext encrypts **one of the real candidates** without revealing which. This is a disjunctive Chaum–Pedersen Σ-protocol (Cramer–Damgård–Schoenmakers 1994), made non-interactive via **Fiat–Shamir** with SHA-256:

- The prover (browser) knows which candidate it encrypted; it produces a valid response for that branch and simulates the others.
- The verifier (backend) checks `Σ challenges ≡ Fiat-Shamir hash` — proving exactly one branch is honest, and that branch corresponds to a real candidate.
- **Trust boundary:** the backend derives the valid-candidate set *itself* (server-side query), never from the client. A forged ciphertext plus a self-serving "valid set" is rejected. The proof is mandatory — a ballot without one is rejected at the schema layer.

### Shamir's Secret Sharing (3-of-4)

The ElGamal private key is split into **4 shares, threshold 3** ([setup-shamir.ts](backend/src/scripts/setup-shamir.ts)). No single keyholder can decrypt anything; any 3 of the 4 must cooperate to reconstruct the key for a tally. Reconstruction is verified against every 3-of-4 combination.

### Vote sealing (server-side only)

- `nid_hash = SHA-256(nid + NID_HASH_SALT)` — used transiently to look up and flip `has_voted`; never written to the vote row.
- `nullifier_hash = SHA-256(nid + election_id + NULLIFIER_SECRET)` — the only identifier stored on a vote row. Because the secret never leaves the server, knowing a NID is not enough to find anyone's ballot.
- A DB trigger makes vote rows **immutable** (no UPDATE/DELETE) — tampering must go through the anchoring system to be detected.

## The voting flow

```
┌──────────┐   NID, candidate id    ┌──────────┐   ciphertext + ZKP proof    ┌───────────────┐
│  Browser │ ────────────────────▶ │  Express │ ──────────────────────────▶ │    Supabase    │
│ (React)  │  GET /election/public-key             │ validates NID,          │  (Postgres)   │
│  + Web   │ ◀──────────────────── │  Backend │    eligibility, proof,       │               │
│  Crypto  │   public key (p,g,y)  │          │    then casts vote           │  fn_cast_vote │
└──────────┘                        └──────────┘                              │  (atomic)     │
                                                                             └───────┬───────┘
                                                                                     │
                                                                                     ▼
                                                                             ┌───────────────┐
                                                                             │   Merkle tree  │  hashVoteLeaf
                                                                             └───────┬───────┘
                                                                                     │
                                                                                     ▼
                                                                             ┌───────────────────────────────┐
                                                                             │ Polygon Amoy / Sepolia chain  │
                                                                             │  MerkleRootStorage.anchorRoot │
                                                                             └───────────────────────────────┘
```

1. **Register** — `POST /voter/register` with an 11-digit NID. The backend hashes it and marks the voter registered.
2. **Vote** — the client fetches the public key and the candidate list, encrypts its choice with fresh randomness, builds the ZKP, and calls `POST /vote` with `{ nid, candidate_id, encrypted_vote, election_id, zkp_proof }`.
3. **Server-side gates (in order)** — zod schema validation → nullifier check (already voted?) → server-derived candidate set + constituency guard → mandatory ZKP verification against that set → `fn_cast_vote` atomic transaction (eligibility, insert, `has_voted` flip). Returns `201 { status: "queued", vote_id }`.
4. **Anchoring** — a batching service folds votes into a Merkle tree and calls `anchorRoot` on the deployed `MerkleRootStorage` contract once per batch.
5. **Tally** — 3-of-4 keyholders submit shares (`POST /keyshares/submit`); with 3 shares the key is reconstructed and ballots are decrypted for the tally page.
6. **Verification** — `GET /anchor/verify/:voteId` returns the Merkle proof linking a specific ballot to the on-chain root; `GET /public/stats` powers the Public Watchdog page.

## End-to-end integrity (Merkle anchoring)

- Votes are hashed into a Merkle tree (`buildMerkleTree`, per vote `hashVoteLeaf`).
- The root is anchored on-chain via the [MerkleRootStorage.sol](blockchain/contracts/MerkleRootStorage.sol) contract: `anchorRoot(bytes32 root, uint256 voteCount)` emits a `BatchAnchored` event. The contract stores the root permanently; `verify` checks a root + proof against the batch.
- Anchoring is **batched, not per-vote** — one transaction per batch of votes, chosen for cost (see [docs/batching-vs-per-vote.md](docs/batching-vs-per-vote.md)).
- The [Tamper Visualizer](frontend/src/pages/TamperVisualizer.tsx) page demonstrates the guarantee: flip one vote in the database (dev-only endpoints `POST /anchor/tamper/root` and `/anchor/tamper/ballot`) and the recomputed root diverges from the on-chain root — the tamper is visible immediately.

## Repository layout

```
├── backend/              Express + TypeScript API
│   ├── src/
│   │   ├── routes/       voter, vote, candidates, keyshares, anchor, public
│   │   ├── crypto/       elgamal, zkp (Chaum–Pedersen), identity, shamir
│   │   ├── merkle/       merkleTree (build, proof, verify)
│   │   ├── services/     anchorBatch (fold → root → anchor)
│   │   ├── blockchain/   merkleContract (ethers wrapper)
│   │   ├── scripts/      setup-keys, setup-shamir, seed-*, run-schema
│   │   ├── schema.sql    Postgres schema (tables, fn_cast_vote, triggers)
│   │   └── index.ts      app + route mounts
├── frontend/             React 19 + Vite + Tailwind SPA
│   └── src/pages/        Landing, VoterLogin, VotingPage, TallyingPage,
│                         TamperVisualizer, PublicWatchdog, KeyShare*…
├── blockchain/           Hardhat project: MerkleRootStorage.sol, deploy scripts
├── shared-interfaces/    shared TS types between frontend/backend
├── docs/                 design rationale, cost analysis, write-ups
└── testing/              concurrency evidence, integration notes
```

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/election/public-key` | ElGamal public key `{p, g, y}` |
| POST | `/voter/register` | register a voter by NID |
| POST | `/voter/check-nullifier` | has this voter already voted? |
| GET | `/candidates` | candidates for a constituency (`x-voter-nid` header) |
| POST | `/vote` | cast an encrypted ballot + ZKP proof |
| POST | `/keyshares/submit` | keyholder submits a share |
| GET | `/keyshares/status` | how many shares collected |
| GET | `/keyshares/reconstruct` | reconstruct key at threshold |
| POST | `/anchor/batch` | anchor a batch root on-chain |
| GET | `/anchor/verify/:voteId` | Merkle proof for a ballot vs on-chain root |
| GET | `/anchor/latest` | most recent anchored batch |
| POST | `/anchor/tamper/root` · `/anchor/tamper/ballot` | dev-only tamper demo |
| GET | `/public/stats` | public watchdog stats |
| GET | `/public/results` | public results (tally) |

## Setup

**Prerequisites:** Node 20+, npm, a Supabase project (free tier fine), optional: Polygon Amoy/Sepolia RPC + private key for anchoring.

1. **Clone + install**
   ```bash
   git clone <repo-url>
   cd evoting-simulation
   npm run install:all        # frontend + backend + blockchain
   ```

2. **Backend environment** — copy `backend/.env.example` → `backend/.env` and fill in:
   | Key | Description |
   |---|---|
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase project (service role) |
   | `NID_HASH_SALT` | salt for `nid_hash` |
   | `NULLIFIER_SECRET` | secret for vote nullifier — never expose to clients |
   | `ELGAMAL_P` / `ELGAMAL_G` / `ELGAMAL_PUBLIC_KEY` / `ELGAMAL_PRIVATE_KEY` | ElGamal keypair |
   | `KEYHOLDER_PASSPHRASE_SALT`, `ADMIN_SECRET` | keyholder / admin auth |
   | `AMOY_RPC_URL` / `MERKLE_CONTRACT_ADDRESS` / `ANCHOR_PRIVATE_KEY` | optional anchoring |

3. **Generate the ElGamal keypair + split the private key**
   ```bash
   cd backend
   npx ts-node src/scripts/setup-keys.ts          # writes ELGAMAL_* to .env
   npx ts-node src/scripts/setup-shamir.ts        # 3-of-4 shares for keyholders
   ```

4. **Database schema + seed**
   ```bash
   npx ts-node src/scripts/run-schema.ts          # applies schema.sql
   npx ts-node src/scripts/seed-constituencies.ts
   npx ts-node src/scripts/seed-voters.ts
   ```

5. **Deploy the anchoring contract (optional)**
   ```bash
   cd blockchain
   npm run compile
   npm run deploy:amoy    # or deploy:sepolia — prints address → put in .env
   ```

## Running

```bash
# backend on :3000
cd backend && npm run dev

# frontend dev server
cd frontend && npm run dev        # or from root: npm run dev
```

Open the frontend URL, register a voter, and cast a vote — the tamper visualizer and watchdog pages show the anchoring/verification side.

## Testing

```bash
npm run test:ci          # backend crypto + merkle unit suite (no DB needed)
npm run contracts:test   # Hardhat contract tests
```

- **Unit** (no DB): ElGamal, identity, ZKP, Shamir, Merkle tree — `vitest run`.
- **Integration** (`backend/src/routes/vote.test.ts`): needs a live backend on `:3000` + seeded Supabase. Covers registration/eligibility gates, mandatory-ZKP rejection, and the forged-`candidate_ids` trust-boundary regression. The N=50 concurrency stress test is deliberately `it.skip` — it would write permanent vote rows, and there is no separate test DB yet.

## Docs

- [docs/evaluation_writeup.md](docs/evaluation_writeup.md) — full system evaluation
- [docs/anchoring-flow-diagram.md](docs/anchoring-flow-diagram.md) — votes → tree → root → tx
- [docs/anchoring-cost-analysis.md](docs/anchoring-cost-analysis.md) — gas/scale analysis
- [docs/batching-vs-per-vote.md](docs/batching-vs-per-vote.md) — why batches, not per-vote anchors
- [docs/tamper-proof-demo.md](docs/tamper-proof-demo.md) — tamper demo walkthrough
- [METHODOLOGY.md](METHODOLOGY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

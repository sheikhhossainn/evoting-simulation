# E-Voting Simulation — Agent Context

> Handoff doc for AI agents. Read before making changes.

## What This Is

Blockchain-based secure e-voting simulation using ZKP (not yet implemented), ElGamal encryption, Shamir's Secret Sharing, and Polygon anchoring. Academic/research project. Monorepo with 4 packages.

## Repo & Git

- **GitHub**: `sheikhhossainn/evoting-simulation`
- **Branching**: `main` ← `dev` ← `feature/*`. All changes via PR into `dev`.
- **Rules**: See `CONTRIBUTING.md`.

## Architecture

```
evoting-simulation/
├── package.json              ← Root orchestrator (scripts only)
├── frontend/                 ← React 19 + Vite 8 + TS + Tailwind 3
├── backend/                  ← Express 5 + TS + Zod 4 + Supabase + ethers
├── blockchain/                ← Hardhat + Solidity — MerkleRootStorage contract
└── shared-interfaces/        ← Shared TS types (types.ts)
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | React 19, Vite 8, TypeScript 6, Tailwind CSS 3, react-router-dom 7 |
| **Backend** | Express 5, TypeScript 6, Zod 4, Supabase JS, ethers 6, dotenv, Node crypto |
| **Blockchain** | Hardhat 2, Solidity 0.8.24, OpenZeppelin Contracts 5 (Ownable, MerkleProof) |
| **Shared** | Plain TypeScript (`shared-interfaces/types.ts`) |
| **DB** | Supabase (PostgreSQL 15+) |
| **Target chain** | Ethereum Sepolia testnet (chainId 11155111) — switched from Polygon Amoy because Amoy faucets now require a mainnet ETH balance |

## How to Run

```bash
npm run dev                    # Frontend (Vite :5173)
npm run dev:backend            # Backend (Express :3000)
npm run install:all            # Install deps in frontend, backend, blockchain
npm run contracts:compile      # Compile MerkleRootStorage.sol
npm run contracts:test         # Run Hardhat tests (local network, no funds needed)
npm run contracts:deploy:amoy  # Deploy to Polygon Amoy (needs blockchain/.env)
```

Backend requires `backend/.env` — see `backend/.env.example` for all keys.
Blockchain package requires `blockchain/.env` for Amoy deployment — see `blockchain/.env.example`.

## Backend `.env` Keys

`PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NID_HASH_SALT`, `NULLIFIER_SECRET`, `ELGAMAL_P`, `ELGAMAL_G`, `ELGAMAL_PUBLIC_KEY`, `ELGAMAL_PRIVATE_KEY`, `KEYHOLDER_PASSPHRASE_SALT`, `ADMIN_SECRET`, `AMOY_RPC_URL` (legacy name — now holds the **Sepolia** RPC URL), `MERKLE_CONTRACT_ADDRESS`, `ANCHOR_PRIVATE_KEY`

> ⚠️ `NULLIFIER_SECRET` (used by `backend/src/crypto/identity.ts` for the salted nullifier) is **missing from `backend/.env.example`** — add it there when touching env files.

Generate crypto keys: `npx ts-node src/scripts/setup-keys.ts`
Generate Shamir shares: `npx ts-node src/scripts/setup-shamir.ts`

## Blockchain `.env` Keys (blockchain/.env)

`SEPOLIA_RPC_URL` (default: public `https://ethereum-sepolia-rpc.publicnode.com`), `DEPLOYER_PRIVATE_KEY` (a **testnet-only** wallet — free Sepolia ETH from https://learnweb3.io/faucets/ethereum_sepolia or Google Cloud's faucet).

## Deployed Contract (live)

- **Contract**: `MerkleRootStorage.sol`
- **Network**: Ethereum Sepolia (testnet, no real money)
- **Address**: `0x312621075076Eb379fbE81760A76B5a8E56b95a7`
- **Explorer**: https://sepolia.etherscan.io/address/0x312621075076Eb379fbE81760A76B5a8E56b95a7
- **Deployed**: 2026-07-15 by wallet `0x03A56C16Ce34976a35b22E55b39fE3D1744A04E0`
- Deploy command: `npm run contracts:deploy:sepolia` (root) / `deploy:sepolia` (blockchain/)
- Backend anchoring config lives in `backend/.env`: `MERKLE_CONTRACT_ADDRESS`, `AMOY_RPC_URL` (legacy var name, holds the Sepolia RPC URL), `ANCHOR_PRIVATE_KEY`

## Database (Supabase)

Schema: `backend/src/schema.sql`. Tables:

| Table | Purpose |
|-------|---------|
| `voters` | Registered voters (NID stored as salted SHA-256 hash) |
| `votes` | Encrypted vote records (ElGamal `{c1,c2}` as JSONB). Keyed by `nullifier_hash` + `constituency_code` — **no** `voter_nid_hash` column, so a decrypted vote cannot be joined back to a voter |
| `candidates` | Candidates per constituency |
| `nullifiers` | Double-vote prevention hashes |
| `key_shares` | Shamir's Secret Sharing shares for tallying |
| `merkle_batches` | Anchored vote batches: on-chain `batch_id`, `root`, `tx_hash`, ordered `vote_ids` (for regenerating proofs) |

Stored proc: `fn_cast_vote(p_voter_nid_hash, p_nullifier_hash, p_constituency_code, p_encrypted_vote, p_zkp_proof)` — atomic vote casting. `p_voter_nid_hash` is used only to check eligibility and flip `has_voted`; the vote row itself stores only the nullifier + constituency.

## Backend API

| Method | Path | Auth | Status |
|--------|------|------|--------|
| `POST` | `/voter/register` | none | ✅ Salted SHA-256 hash NID, upsert into Supabase |
| `POST` | `/voter/check-nullifier` | none | ✅ Check nullifier existence |
| `POST` | `/vote` | none | ✅ ElGamal ciphertext `{c1,c2}` → `fn_cast_vote` RPC |
| `GET` | `/candidates?constituency=CON-XX` | none | ✅ Filtered candidate list (real UUIDs — frontend fetches this, no longer reads a static JSON) |
| `GET` | `/election/public-key` | none | ✅ Returns ElGamal `{p,g,y}` — frontend encrypts ballots with this |
| `POST` | `/keyshares/submit` | passphrase | ✅ Key holder submits Shamir share (passphrase now verified server-side) |
| `GET` | `/keyshares/status` | none | ✅ Public: submission counts per keyholder |
| `GET` | `/keyshares/reconstruct` | none | ✅ Public diagnostic: confirms shares are consistent (never returns key material) |
| `POST` | `/keyshares/tally` | `x-admin-secret` | ✅ Reconstructs private key **in memory only**, decrypts all votes, returns results grouped by constituency/candidate |
| `POST` | `/anchor/batch` | `x-admin-secret` | ✅ Builds a Merkle tree from unanchored votes, anchors root on Polygon, flips votes to `confirmed` |
| `GET` | `/anchor/verify/:voteId` | none | ✅ Public: regenerates + verifies a vote's Merkle inclusion proof, locally and on-chain |
| `GET` | `/public/stats` | none | ✅ Public Watchdog data: turnout per constituency, key-ceremony progress, anchoring progress |
| `GET` | `/health` | none | ✅ Health check |

## Backend Source Structure

```
backend/src/
├── index.ts                  ← Express entry, mounts all routes
├── supabaseClient.ts         ← Supabase client (service role)
├── schema.sql                ← Full DB schema incl. merkle_batches
├── crypto/
│   ├── elgamal.ts             ← ElGamal keygen, encrypt/decrypt, + encryptCandidateId/decryptCandidateId (UUID-safe encoding)
│   └── shamir.ts             ← Shamir split/reconstruct (3-of-4)
├── merkle/
│   └── merkleTree.ts          ← Canonical Merkle tree (keccak256, OZ-compatible) — imported directly by blockchain/ tests, single source of truth
├── blockchain/
│   └── merkleContract.ts      ← ethers.js bindings for MerkleRootStorage (read/write)
├── config/
│   └── keyholders.ts          ← Keyholder passphrase verification (salted hash)
├── middleware/
│   └── adminAuth.ts           ← x-admin-secret guard for sensitive routes
├── routes/
│   ├── voter.ts               ← /voter/register, /voter/check-nullifier
│   ├── vote.ts                ← POST /vote
│   ├── candidates.ts          ← GET /candidates
│   ├── keyshares.ts           ← submit/status/reconstruct/tally
│   ├── anchor.ts              ← POST /anchor/batch, GET /anchor/verify/:voteId
│   └── public.ts              ← GET /public/stats
└── scripts/
    ├── setup-keys.ts          ← Generate ElGamal keypair + NID salt → .env
    ├── setup-shamir.ts        ← Split ElGamal key into 4 Shamir shares
    ├── seed-voters.ts         ← 20 mock voters across 8 constituencies
    ├── seed-candidates.ts     ← 48 candidates from candidates.json
    ├── run-schema.ts          ← Apply schema.sql to Supabase
    ├── test-merkle-batch.ts   ← Standalone Merkle sanity check (no chain/DB needed)
    └── (backend/src/db.ts and root db.json removed — dead pre-Supabase leftovers)
```

## Blockchain Package (blockchain/)

```
blockchain/
├── contracts/MerkleRootStorage.sol   ← Ownable; anchorRoot(), verify() via OZ MerkleProof, getBatch()
├── test/MerkleRootStorage.test.ts     ← Anchors mock vote batches on local Hardhat network, verifies proofs
├── scripts/deploy.ts                 ← Deploy to Amoy or local network
├── hardhat.config.ts
└── .env.example
```

`npm run contracts:test` passes today (4/4) — anchoring, multi-batch, non-owner rejection, zero-root rejection, all using the exact same `merkleTree.ts` module the backend uses for real batches.

## Frontend Routes

| Route | Component | Auth | Status |
|-------|-----------|------|--------|
| `/` | `LandingPage` | none | Built |
| `/watchdog` | `PublicWatchdog` | none | **New** — live turnout, key-ceremony & anchoring status, vote-anchor verification tool |
| `/voter/login` | `VoterLogin` | none | Built |
| `/voter/vote` | `VotingPage` | none | Now does **real** client-side ElGamal encryption + fetches real candidates from the backend |
| `/voter/confirmation` | `VoteConfirmation` | none | Built |
| `/keyholder/login` | `KeyHolderLogin` | passphrase (UI only) | Built |
| `/keyholder/submit` | `KeyShareSubmit` | passphrase | Built — passphrase now actually verified server-side |
| `/keyholder/status` | `KeyShareStatus` | none | Built — links to `/tally` once threshold is met |
| `/tally` | `TallyingPage` | admin secret | **New** — triggers `POST /keyshares/tally`, shows results grouped by constituency/candidate |
| `/admin` | `AdminDashboard` | none (UI mock) | Built |

Frontend API helpers: `frontend/src/utils/api.ts`
Frontend ElGamal encryption: `frontend/src/utils/elgamal.ts` (mirrors backend's encrypt-side logic)

## Seeded Data

- **20 voters**: NIDs `10001234567`–`10231234567`, spread across CON-01 to CON-08
- **48 candidates**: 6 per constituency, from `frontend/public/candidates.json` (seeded into Supabase with real UUIDs — the frontend now fetches these from the backend rather than reading the JSON file directly)
- **Constituency format**: `CON-01` through `CON-08`

## Key Decisions

- **Module systems**: Frontend = ESM, Backend = CommonJS, Blockchain = CommonJS (ts-node/Hardhat)
- **NID hashing**: `SHA-256(nid + NID_HASH_SALT)` — salt in `.env`
- **Nullifier (PR #17 redesign)**: `SHA-256(nid + election_id + NULLIFIER_SECRET)` computed **server-side only** (`backend/src/crypto/identity.ts`) — the secret never reaches the client, so nullifiers can't be recomputed from public info. The nullifier (not the voter's NID hash) is the vote row's identity key.
- **ElGamal**: 256-bit safe prime (simulation-grade), Node.js `crypto` BigInt. Candidate ids (UUIDs, 128 bits) are encoded by parsing hex digits directly rather than UTF-8 byte encoding, so they always fit under the 256-bit modulus — see `encryptCandidateId`/`decryptCandidateId`.
- **Vote storage**: ElGamal ciphertext `{c1, c2}` as JSONB in `votes` table
- **Atomic voting**: `fn_cast_vote` PostgreSQL function (locks row, checks eligibility, inserts vote, flips `has_voted`)
- **Election id**: single hardcoded `NATIONAL-2026-001` used consistently across voter/nullifier flow and keyholder/tally flow (previously mismatched — see Fixes below)
- **Merkle hashing scheme**: leaf = double-`keccak256` of `abi.encode(voteId, c1, c2, createdAt)`; internal nodes = `keccak256(sorted(left, right))` (commutative, OpenZeppelin-`MerkleProof`-compatible); odd nodes self-duplicate. One canonical implementation in `backend/src/merkle/merkleTree.ts`, imported directly by the Hardhat test suite — there is no second implementation to drift out of sync.
- **Admin auth interim**: sensitive routes (`/anchor/batch`, `/keyshares/tally`) require an `x-admin-secret` header until real session-based admin auth exists.
- **Dev tools**: Backend uses `nodemon` + `ts-node`, Frontend uses `oxlint`, Blockchain uses Hardhat + ts-node
- **No root node_modules**: Each sub-project independent (frontend/backend/blockchain each have their own)

## Historical Fixes (kept for context — all merged)

1. **Votes were not actually encrypted** — `VotingPage.tsx` built a base64-encoded mock ciphertext (`btoa(...)`) instead of using the ElGamal module that already existed in the backend. Anyone with DB read access could trivially decode exactly who voted for whom. Fixed: frontend now fetches `/election/public-key` and does real client-side ElGamal encryption (`frontend/src/utils/elgamal.ts`).
2. **Candidate id mismatch** — the ballot used a static `frontend/public/candidates.json` with ids like `"c1-3"`, disconnected from the real `candidates` table (UUIDs). Decrypted votes could never be joined back to real candidate rows for tallying. Fixed: `VotingPage` now calls the real `GET /candidates` endpoint and encrypts the DB's UUID.
3. **Keyholder passphrase was never checked** — `POST /keyshares/submit` accepted any non-empty string as the passphrase for any `keyholder_id`, so anyone could squat on a keyholder slot before the real holder submitted, corrupting the 3-of-4 ceremony. Fixed: added `backend/src/config/keyholders.ts` (salted-hash verification, demo defaults match the UI's documented demo credentials, overridable via `KEYHOLDER_PASSPHRASE_HASH_1..4`).
4. **`/keyshares/reconstruct` leaked key material** — it returned a 16-char preview of the reconstructed private key over an unauthenticated GET. Fixed: now only confirms reconstruction succeeds (boolean), never serializes any part of the key. Real decryption now lives behind admin-gated `POST /keyshares/tally`.
5. **Mismatched election ids** — the voter/nullifier flow used `ELECTION_ID = "election-2026"` while the keyholder flow used `"NATIONAL-2026-001"`. Votes and key shares would have silently belonged to two unrelated "elections," and tallying would never find matching votes. Fixed: unified on `NATIONAL-2026-001`.
6. **Dead code removed**: `backend/src/db.ts` (an unused local-JSON-file DB from before the Supabase migration) and the stale `db.json` data file it operated on (now git-ignored too).

## Known Limitations

- ~~**Ballot secrecy**: `votes.voter_nid_hash` directly linked votes to voters~~ — **FIXED** (PR #17, nullifier redesign): votes now store only `nullifier_hash = SHA-256(nid + election_id + NULLIFIER_SECRET)` + `constituency_code`. The server-side `NULLIFIER_SECRET` means nobody can recompute a voter's nullifier from public info, and the `votes` table has no voter FK. See `backend/src/crypto/identity.ts` and `backend/src/schema.sql`.
- **No ZKP of vote validity yet**: a malformed or maliciously-crafted ciphertext can still be submitted. `POST /keyshares/tally` defends against this at decrypt time (rejects any ballot that doesn't decode to a real candidate in the voter's own constituency, counting it as "invalid" rather than crashing or silently miscounting), but there's still no proof at submission time that a ciphertext encodes a valid choice.
- **Admin/EC login is still a UI mock** (`AdminLogin.tsx` navigates with no real auth). Sensitive admin routes are protected by `ADMIN_SECRET` instead — good enough for a simulation, not for production.
- **RLS policies**: tables have RLS enabled but no policies yet (all access goes through the backend's service-role key).

## Not Yet Implemented

- Zero-Knowledge Proofs for vote validity at submission time (see LEFTWORK.md Task 6 — decision pending: document as limitation vs. build disjunctive Chaum-Pedersen proof)
- Benaloh challenge (cast-or-audit voter verifiability) — LEFTWORK.md Task 5
- Session-based EC Admin authentication (currently `x-admin-secret` header + UI-mock login) — intentional, out of scope
- RLS policies — intentional, out of scope (all access via backend service-role key)
- ~~Live testnet deployment~~ — **DONE**: contract live on Ethereum Sepolia since 2026-07-15 (see "Deployed Contract" above). What remains is exercising it end-to-end: anchor a real batch, verify on-chain, run the tamper-detection test — LEFTWORK.md Task 1.

See `LEFTWORK.md` for the full remaining-work plan with owners.

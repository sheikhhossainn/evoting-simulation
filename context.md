# E-Voting Simulation — Agent Context

> Handoff doc for AI agents. Read before making changes.

## What This Is

Blockchain-based secure e-voting simulation using ZKP of ballot validity, ElGamal encryption, Shamir's Secret Sharing, and Ethereum Sepolia anchoring. Academic/research project. Monorepo with 4 packages.

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
npm run contracts:deploy:sepolia  # Deploy to Ethereum Sepolia (needs blockchain/.env)
```

Backend requires `backend/.env` — see `backend/.env.example` for all keys.
Blockchain package requires `blockchain/.env` for Sepolia deployment — see `blockchain/.env.example`.

## Backend `.env` Keys

`PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NID_HASH_SALT`, `NULLIFIER_SECRET`, `ELGAMAL_P`, `ELGAMAL_G`, `ELGAMAL_PUBLIC_KEY`, `ELGAMAL_PRIVATE_KEY`, `KEYHOLDER_PASSPHRASE_SALT`, `ADMIN_SECRET`, `AMOY_RPC_URL` (legacy name — now holds the **Sepolia** RPC URL), `MERKLE_CONTRACT_ADDRESS`, `ANCHOR_PRIVATE_KEY`

> `NULLIFIER_SECRET` (used by `backend/src/crypto/identity.ts` for the salted nullifier) is now documented in `backend/.env.example` (was previously missing).

Generate crypto keys: `npx ts-node src/scripts/setup-keys.ts`
Generate Shamir shares: `npx ts-node src/scripts/setup-shamir.ts`

## Blockchain `.env` Keys (blockchain/.env)

`SEPOLIA_RPC_URL` (default: public `https://ethereum-sepolia-rpc.publicnode.com`), `DEPLOYER_PRIVATE_KEY` (a **testnet-only** wallet — free Sepolia ETH from https://learnweb3.io/faucets/ethereum_sepolia or Google Cloud's faucet).

## Deployed Contracts (Live Sepolia Testnet)

- **`MerkleRootStorage.sol`**:
  - **Address**: `0x4b5C381c62876d34bBDDefDe02e872E5a93401b6`
  - **Explorer**: https://sepolia.etherscan.io/address/0x4b5C381c62876d34bBDDefDe02e872E5a93401b6
  - **Functions**: `anchorRoot()`, `anchorSmtRoot()`, `verify()`, `verifySmtMembership()`, `verifySmtNonMembership()`, `getBatch()`, `smtBatches()`
- **`ElectionSetupCommitment.sol`**:
  - **Address**: `0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C`
  - **Explorer**: https://sepolia.etherscan.io/address/0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C`
  - **Function**: Write-once `anchor(bytes32 setupCommitment)` pinning candidate & constituency configuration on-chain.

## Database (Supabase)

Schema: `backend/src/schema.sql`. Tables:

| Table | Purpose |
|-------|---------|
| `voters` | Registered voters (NID stored as salted SHA-256 hash) |
| `votes` | Encrypted vote records (ElGamal `{c1,c2}` as JSONB). Keyed by `nullifier_hash` + `constituency_code` — **no** `voter_nid_hash` column, so a decrypted vote cannot be joined back to a voter |
| `candidates` | Candidates per constituency |
| `nullifiers` | Double-vote prevention hashes |
| `key_shares` | Shamir's Secret Sharing shares for tallying |
| `partial_decryptions` | Keyholder partial decryptions `d_i` with Chaum-Pedersen DLEQ proofs |
| `merkle_batches` | Anchored dense batches: on-chain `batch_id`, `root`, `tx_hash`, ordered `vote_ids` |
| `smt_batches` | Anchored Sparse Merkle Tree batches: `smt_root`, `total_keys_anchored`, `tx_hash` |
| `election_key_ceremony`| Distributed key generation & Feldman VSS state machine |

Stored proc: `fn_cast_vote(p_voter_nid_hash, p_nullifier_hash, p_constituency_code, p_encrypted_vote, p_zkp_proof)` — atomic vote casting. `p_voter_nid_hash` is used only to check eligibility and flip `has_voted`; the vote row itself stores only the nullifier + constituency.

## Backend API

| Method | Path | Auth | Status |
|--------|------|------|--------|
| `POST` | `/voter/register` | none | ✅ Salted SHA-256 hash NID, upsert into Supabase |
| `POST` | `/voter/check-nullifier` | none | ✅ Check nullifier existence |
| `POST` | `/vote` | none | ✅ ElGamal ciphertext `{c1,c2}` + ZKP → `fn_cast_vote` RPC |
| `GET` | `/candidates?constituency=CON-XX` | none | ✅ Filtered candidate list (real UUIDs) |
| `GET` | `/election/public-key` | none | ✅ Returns ElGamal `{p,g,y}` from qualified ceremony |
| `GET` | `/keyshares/commitments` | none | ✅ Public Feldman & keyholder commitments |
| `GET` | `/keyshares/status` | none | ✅ Public submission counts per keyholder |
| `POST` | `/keyshares/submit-partial` | passphrase | ✅ Keyholder submits `(d_i, proof)`; verified against ballot ciphertext |
| `POST` | `/keyshares/tally` | `x-admin-secret` | ✅ Verifies all DLEQ proofs, combines partials; private key never reconstructed |
| `GET` | `/keyshares/verification-bundle` | none | ✅ Complete export bundle for standalone verifier |
| `POST` | `/dkg/init`, `/round1`, `/round2` | admin/keyholder | ✅ Pedersen-style DKG ceremony |
| `POST` | `/anchor/batch` | `x-admin-secret` | ✅ Builds dense tree + SMT, anchors roots on Sepolia |
| `GET` | `/anchor/verify/:voteId` | none | ✅ Verifies Merkle inclusion locally and on-chain |
| `GET` | `/public/stats` | none | ✅ Public Watchdog data: turnout, ceremony, anchoring |
| `GET` | `/health` | none | ✅ Health check |

## Backend Source Structure

```
backend/src/
├── index.ts                  ← Express entry, mounts all routes
├── supabaseClient.ts         ← Supabase client (service role)
├── schema.sql                ← Full DB schema incl. triggers, SMT, DKG tables
├── crypto/
│   ├── elgamal.ts             ← ElGamal group arithmetic, safe prime generation
│   ├── zkp.ts                 ← Chaum-Pedersen OR-proof of ballot validity (CDS94)
│   ├── shamirZq.ts            ← Shamir over Z_q + Feldman VSS
│   ├── dleq.ts                ← Chaum-Pedersen DLEQ proof of partial decryption
│   ├── candidateCommitment.ts ← TLV canonical serialization & hash commitment
│   ├── identity.ts            ← Salted NID hashing and server-side nullifier derivation
│   └── dkg.ts                 ← Distributed Key Generation crypto primitives
├── merkle/
│   ├── merkleTree.ts          ← Canonical dense Merkle tree (keccak256, OZ-compatible)
│   └── sparseMerkleTree.ts    ← 256-bit Sparse Merkle Tree with non-membership proofs
├── blockchain/
│   └── merkleContract.ts      ← ethers.js bindings for MerkleRootStorage & SetupCommitment
├── config/
│   └── keyholders.ts          ← Keyholder passphrase verification (salted hash)
├── middleware/
│   └── adminAuth.ts           ← x-admin-secret guard for sensitive routes
├── routes/
│   ├── voter.ts               ← /voter/register, /voter/check-nullifier
│   ├── vote.ts                ← POST /vote
│   ├── candidates.ts          ← GET /candidates
│   ├── keyshares.ts           ← commitments/status/submit-partial/tally/bundle
│   ├── dkg.ts                 ← /dkg ceremony state machine
│   ├── elections.ts           ← Multi-election isolation
│   ├── anchor.ts              ← POST /anchor/batch, GET /anchor/verify/:voteId
│   └── public.ts              ← GET /public/stats
└── scripts/
    ├── independent-verify-tally.ts ← Standalone auditor verifier (zero backend/DB trust)
    ├── run-schema.ts               ← Apply schema.sql to Supabase
    ├── seed-voters.ts              ← Seed test voters
    ├── seed-candidates.ts          ← Seed candidates
    └── setup-keys.ts               ← Setup helper
```

## Blockchain Package (blockchain/)

```
blockchain/
├── contracts/
│   ├── MerkleRootStorage.sol       ← Ownable; anchorRoot, anchorSmtRoot, verify, verifySmtNonMembership
│   └── ElectionSetupCommitment.sol ← Write-once candidate/constituency commitment
├── test/
│   ├── MerkleRootStorage.test.ts   ← Anchoring, multi-batch, SMT verification, access control (35 passing)
│   └── ElectionSetupCommitment.test.ts
├── scripts/
│   ├── deploy.ts                   ← Deploy contracts to Sepolia or local network
│   ├── measure-anchoring-cost.ts   ← Gas and build time measurement harness
│   └── scalability-benchmark.ts    ← 50k ballot benchmark
├── hardhat.config.ts
└── .env.example
```

## Frontend Routes

| Route | Component | Auth | Status |
|-------|-----------|------|--------|
| `/` | `LandingPage` | none | Built |
| `/watchdog` | `PublicWatchdog` | none | Live turnout, ceremony & anchoring status, proof verifier |
| `/voter/login` | `VoterLogin` | none | Built |
| `/voter/vote` | `VotingPage` | none | Real client-side ElGamal encryption + ZKP generation |
| `/voter/confirmation` | `VoteConfirmation` | none | Built |
| `/keyholder/login` | `KeyHolderLogin` | passphrase (UI only) | Built |
| `/keyholder/submit` | `KeyShareSubmit` | passphrase | Client-side partial decryption with DLEQ proof |
| `/keyholder/status` | `KeyShareStatus` | none | Live submission tracking |
| `/tally` | `TallyingPage` | admin secret | Triggers `POST /keyshares/tally`, displays verifiable results |
| `/admin` | `AdminDashboard` | none (UI mock) | Built |

## Key Decisions

- **Dual Merkle Structure**: Dense Merkle tree for batch inclusion proofs + 256-bit Sparse Merkle Tree (SMT) with position-aware hashing for ballot non-membership proofs (closing the deletion-after-anchor gap).
- **Verifiable Decryption**: Keyholders never reveal raw shares to the server. Each computes $d_i = c_1^{s_i}$ on-device and generates a non-interactive Chaum-Pedersen DLEQ proof. Tallying reconstructs the plaintext homomorphically without ever assembling the private key.
- **On-Chain Candidate Pinned Setup**: Candidate lists and constituencies are canonically serialized via TLV and hashed into an on-chain `ElectionSetupCommitment`.
- **Ballot Validity**: Client generates a non-interactive Chaum-Pedersen OR-proof (CDS94) proving the encrypted value is one of the valid candidates in the constituency, preventing malformed ballots before database entry.
- **Nullifier Privacy**: `SHA-256(nid + election_id + NULLIFIER_SECRET)` computed server-side only; votes are decoupled from voter identity.

## Historical Fixes (kept for context — all merged)

1. **Votes were not actually encrypted** — fixed via real client-side ElGamal.
2. **Candidate id mismatch** — fixed by binding real UUIDs from backend.
3. **Keyholder passphrase checking** — fixed with salted hash verification.
4. **Key reconstruction leakage** — fixed; raw keys are never returned or reconstructed.
5. **Election id mismatch** — unified across voter, DKG, and tallying flows.
6. **Deletion completeness gap** — resolved via Sparse Merkle Tree non-membership proofs and on-chain batch counts.

## Known Limitations & Boundaries

- **Pre-anchor window**: A vote is tamper-evident on-chain once its batch is anchored. Bounded by anchoring cadence.
- **Admin/EC UI**: Admin portal uses `ADMIN_SECRET` rather than full multi-admin RBAC session auth (intentional simulation scope).
- **RLS policies**: Supabase tables rely on DB triggers and service-role access (intentional simulation scope).


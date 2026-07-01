# E-Voting Simulation — Agent Context

> Handoff doc for AI agents. Read before making changes.

## What This Is

Blockchain-based secure e-voting simulation using ZKP, ElGamal encryption, Shamir's Secret Sharing, and Polygon anchoring. Academic/research project. Monorepo with 3 packages.

## Repo & Git

- **GitHub**: `sheikhhossainn/evoting-simulation`
- **Branching**: `main` ← `dev` ← `feature/*`. All changes via PR into `dev`.
- **Rules**: See `CONTRIBUTING.md`.

## Architecture

```
evoting-simulation/
├── package.json              ← Root orchestrator (scripts only)
├── frontend/                 ← React 19 + Vite 8 + TS + Tailwind 3
├── backend/                  ← Express 5 + TS + Zod 4 + Supabase
└── shared-interfaces/        ← Shared TS types (types.ts)
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | React 19, Vite 8, TypeScript 6, Tailwind CSS 3, react-router-dom 7 |
| **Backend** | Express 5, TypeScript 6, Zod 4, Supabase JS, dotenv, Node crypto |
| **Shared** | Plain TypeScript (`shared-interfaces/types.ts`) |
| **DB** | Supabase (PostgreSQL 15+) |

## How to Run

```bash
npm run dev            # Frontend (Vite :5173)
npm run dev:backend    # Backend (Express :3000)
npm run install:all    # Install deps in both packages
```

Backend requires `backend/.env` — see `backend/.env.example` for all keys.

## Backend `.env` Keys

`PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NID_HASH_SALT`, `ELGAMAL_P`, `ELGAMAL_G`, `ELGAMAL_PUBLIC_KEY`, `ELGAMAL_PRIVATE_KEY`

Generate crypto keys: `npx ts-node src/scripts/setup-keys.ts`

## Database (Supabase)

Schema: `backend/src/schema.sql`. Tables:

| Table | Purpose |
|-------|---------|
| `voters` | Registered voters (NID stored as salted SHA-256 hash) |
| `votes` | Encrypted vote records (ElGamal `{c1,c2}` as JSONB) |
| `candidates` | Candidates per constituency |
| `nullifiers` | Double-vote prevention hashes |
| `key_shares` | Shamir's Secret Sharing shares for tallying |

Stored proc: `fn_cast_vote(p_voter_nid_hash, p_encrypted_vote, p_zkp_proof)` — atomic vote casting.

## Backend API

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/voter/register` | ✅ Salted SHA-256 hash NID, upsert into Supabase |
| `POST` | `/voter/check-nullifier` | ✅ Check nullifier existence |
| `POST` | `/vote` | ✅ ElGamal ciphertext `{c1,c2}` → `fn_cast_vote` RPC |
| `GET` | `/candidates?constituency=CON-XX` | ✅ Filtered candidate list |
| `GET` | `/election/public-key` | ✅ Returns ElGamal `{p,g,y}` |
| `GET` | `/health` | ✅ Health check |

## Backend Source Structure

```
backend/src/
├── index.ts                  ← Express entry, mounts all routes
├── supabaseClient.ts         ← Supabase client (service role)
├── crypto/
│   └── elgamal.ts            ← ElGamal keygen, encrypt, decrypt (BigInt)
├── routes/
│   ├── voter.ts              ← /voter/register, /voter/check-nullifier
│   ├── vote.ts               ← POST /vote
│   └── candidates.ts         ← GET /candidates
└── scripts/
    ├── setup-keys.ts         ← Generate ElGamal keypair + NID salt → .env
    ├── seed-voters.ts        ← 20 mock voters across 8 constituencies
    └── seed-candidates.ts    ← 48 candidates from candidates.json
```

## Frontend Routes

| Route | Component | Status |
|-------|-----------|--------|
| `/` | `LandingPage` | Built |
| `/voter/login` | `VoterLogin` | Built |
| `/voter/vote` | `VotingPage` | Built |
| `/voter/confirmation` | `VoteConfirmation` | Built |
| `/keyholder/login` | `KeyHolderLogin` | Built |
| `/keyholder/submit` | `KeyShareSubmit` | Built |
| `/keyholder/status` | `KeyShareStatus` | Built |
| `/admin` | `AdminDashboard` | Built |

Frontend API helpers: `frontend/src/utils/api.ts`

## Seeded Data

- **20 voters**: NIDs `10001234567`–`10231234567`, spread across CON-01 to CON-08
- **48 candidates**: 6 per constituency, from `frontend/public/candidates.json`
- **Constituency format**: `CON-01` through `CON-08`

## Key Decisions

- **Module systems**: Frontend = ESM, Backend = CommonJS
- **NID hashing**: `SHA-256(nid + NID_HASH_SALT)` — salt in `.env`
- **ElGamal**: 256-bit safe prime (simulation-grade), Node.js `crypto` BigInt
- **Vote storage**: ElGamal ciphertext `{c1, c2}` as JSONB in `votes` table
- **Atomic voting**: `fn_cast_vote` PostgreSQL function (locks row, checks eligibility, inserts vote, flips `has_voted`)
- **Dev tools**: Backend uses `nodemon` + `ts-node`, Frontend uses `oxlint`
- **No root node_modules**: Each sub-project independent

## Not Yet Implemented

- Frontend ↔ Backend ElGamal integration (client-side encryption)
- Shamir's Secret Sharing key ceremony + reconstruction
- ZKP vote validity proofs
- Blockchain/Polygon anchoring
- Admin authentication
- RLS policies (tables have RLS enabled but no policies yet)

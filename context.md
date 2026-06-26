# E-Voting Simulation — Agent Context

> Handoff doc for AI agents. Read this before making changes.

## What This Project Is

A **blockchain-based secure e-voting simulation** using ZKP, ElGamal encryption, Shamir's Secret Sharing, and Polygon anchoring. Academic/research project. Monorepo with 3 packages.

## Repo & Git

- **GitHub**: `sheikhhossainn/evoting-simulation`
- **Branching**: `main` ← `dev` ← `feature/*`. Never push to `main` or `dev` directly. All changes via PR into `dev`.
- **Full rules**: See `CONTRIBUTING.md` in repo root.

## Architecture

```
evoting-simulation/
├── package.json          ← Root orchestrator (no deps, just npm scripts)
├── frontend/             ← React 19 + Vite 8 + TypeScript + Tailwind CSS 3
├── backend/              ← Express 5 + TypeScript + Zod 4 + Supabase
└── shared-interfaces/    ← Shared TS types (currently just a placeholder)
```

## Tech Stack

| Layer | Stack | Key Config |
|-------|-------|------------|
| **Frontend** | React 19, Vite 8, TypeScript 6, Tailwind CSS 3, react-router-dom 7 | `frontend/vite.config.ts`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js` |
| **Backend** | Express 5, TypeScript 6, Zod 4, Supabase JS, dotenv | `backend/tsconfig.json` (CommonJS), `backend/nodemon.json` (ts-node) |
| **Shared** | Plain TypeScript | `shared-interfaces/types.ts` |

## How to Run

```bash
# From repo root:
npm run dev            # Starts frontend (Vite on :5173)
npm run dev:backend    # Starts backend (Express on :3000)
npm run install:all    # Installs deps in both frontend/ and backend/
```

Backend requires `backend/.env` with: `PORT`, `SUPABASE_URL`, `SUPABASE_KEY`.

## Current State (as of 2026-06-26)

### ✅ Done
- Monorepo scaffolded with root `package.json` orchestrator
- Frontend: Vite + React + Tailwind initialized, routing configured with 7 routes
- Backend: Express + Zod initialized, single `POST /vote` endpoint (validates `{ nid: string }`, returns `{ status: "queued" }`)
- All configs working: TypeScript, Tailwind, PostCSS, Nodemon, Vite

### 📂 Frontend Routes & Pages
| Route | Component | Status |
|-------|-----------|--------|
| `/` | `LandingPage` | Built — shows project intro & contributing instructions |
| `/voter/login` | `VoterLogin` | Stub (title only) |
| `/voter/vote` | `VotingPage` | Stub (title only) |
| `/voter/confirmation` | `VoteConfirmation` | Stub (title only) |
| `/keyholder/login` | `KeyHolderLogin` | Stub (title only) |
| `/keyholder/submit` | `KeyShareSubmit` | Stub (title only) |
| `/keyholder/status` | `KeyShareStatus` | Stub (title only) |

### 📂 Backend Endpoints
| Method | Path | Status |
|--------|------|--------|
| `POST` | `/vote` | Working — Zod validates `{ nid: string }`, returns `{ status: "queued" }` |

### 🔲 Not Yet Started
- Supabase integration (schema, queries)
- ElGamal encryption / ZKP / Shamir's Secret Sharing logic
- Actual voter authentication flow
- Key holder share management
- Blockchain/Polygon anchoring
- Frontend ↔ Backend API integration
- `shared-interfaces/types.ts` is empty (placeholder comment only)

## Key Decisions Made
- **Module systems**: Frontend = ESM (`"type": "module"`), Backend = CommonJS (`"type": "commonjs"`)
- **Linting**: Frontend uses `oxlint` (not ESLint)
- **Dev tools**: Backend uses `nodemon` + `ts-node` for hot reload
- **No root node_modules**: Each sub-project manages its own dependencies independently

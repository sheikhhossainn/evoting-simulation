# Graph Report - evoting-simulation  (2026-07-16)

## Corpus Check
- 73 files · ~43,548 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 529 nodes · 643 edges · 55 communities (26 shown, 29 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7aef75b9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Public Watchdog & Tallying UI
- React App & Layout Components
- Keyholder Auth & Passphrase Verification
- Blockchain Package Config
- Backend Package Config
- Project Docs & Core Concepts
- Merkle Contract Bindings
- ElGamal Crypto (Backend)
- Frontend TypeScript Config
- Frontend Dependencies
- Backend TypeScript Config
- Frontend Node TS Config
- Shared TypeScript Interfaces
- Backend Runtime Dependencies
- Frontend React Dependencies
- Root Package & Orchestration
- Blockchain TypeScript Config
- Shamir Secret Sharing
- Voter Seeding Scripts
- Schema Migration Scripts
- Frontend Lint Config
- Candidate Seeding Scripts
- Design System & UI Assets
- Frontend TS Project References
- Hardhat Config
- Frontend HTML & Favicon
- Tailwind CSS Config
- Graphify Knowledge Graph Rules
- Frontend Vite README
- E-Voting Simulation — Agent Context
- React + TypeScript + Vite
- CLAUDE.md
- x-admin-secret Header Auth
- Ballot Secrecy Architectural Gap
- ElGamal Encryption Scheme
- E-Voting System Architecture
- fn_cast_vote Stored Procedure
- Key Ceremony (3-of-4 Threshold)
- Monorepo Architecture (4 packages)
- NID SHA-256 Hashing
- Polygon Amoy Blockchain Anchoring
- Public Watchdog Dashboard
- Shamir's Secret Sharing (3-of-4)
- Supabase PostgreSQL Database
- Vote Encryption Fix (Session)
- Zero-Knowledge Proof (Planned)
- Pull Request Workflow (into dev)
- Double-Vote Prevention Tests
- Merkle Anchoring Test Plan
- Testing Guidance Document
- Tallying & Decryption Test Plan
- Voter Registration Test Plan

## God Nodes (most connected - your core abstractions)
1. `E-Voting Simulation — Agent Context` - 19 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 15 edges
4. `Testing Guidance` - 15 edges
5. `compilerOptions` - 14 edges
6. `Contributing Guide` - 13 edges
7. `Left Work — Remaining Tasks & Assignments` - 11 edges
8. `scripts` - 10 edges
9. `compilerOptions` - 9 edges
10. `buildMerkleTree()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `GitHub Actions CI Workflow` --conceptually_related_to--> `Three-Tier Branching Strategy`  [INFERRED]
  .github/workflows/ci.yml → CONTRIBUTING.md
- `SecureVote BD Favicon` --references--> `Frontend HTML Entry Point`  [INFERRED]
  frontend/public/favicon.svg → frontend/index.html
- `CI Contracts Job (Hardhat tests)` --references--> `Merkle Tree Vote Anchoring`  [EXTRACTED]
  .github/workflows/ci.yml → context.md
- `runAnchorBatch()` --calls--> `getWritableMerkleContract()`  [EXTRACTED]
  backend/src/services/anchorBatch.ts → backend/src/blockchain/merkleContract.ts
- `main()` --calls--> `generateKeypair()`  [EXTRACTED]
  backend/src/scripts/setup-keys.ts → backend/src/crypto/elgamal.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI Pipeline (3 Parallel Jobs)** — github_workflows_ci_frontend_job, github_workflows_ci_backend_job, github_workflows_ci_contracts_job [EXTRACTED 1.00]

## Communities (55 total, 29 thin omitted)

### Community 0 - "Public Watchdog & Tallying UI"
Cohesion: 0.05
Nodes (47): defaultPartyColor, PARTY_COLORS, PublicWatchdog(), PARTY_ACCENTS, REJECTION_DESCRIPTIONS, REJECTION_LABELS, SummaryTile(), TallyingPage() (+39 more)

### Community 1 - "React App & Layout Components"
Cohesion: 0.06
Nodes (18): App(), Layout(), navLinks, techStack, AdminDashboard(), Candidate, CONSTITUENCIES, PARTIES (+10 more)

### Community 2 - "Keyholder Auth & Passphrase Verification"
Cohesion: 0.14
Nodes (17): DEMO_PASSPHRASES, envHashKeyFor(), hashPassphrase(), verifyKeyholderPassphrase(), ElGamalPrivateKey, reconstructKey(), secrets, ShamirShares (+9 more)

### Community 3 - "Blockchain Package Config"
Cohesion: 0.09
Nodes (22): author, description, devDependencies, dotenv, hardhat, @nomicfoundation/hardhat-toolbox, @openzeppelin/contracts, ts-node (+14 more)

### Community 4 - "Backend Package Config"
Cohesion: 0.07
Nodes (28): author, dependencies, cors, dotenv, ethers, express, secrets.js-grempe, @supabase/supabase-js (+20 more)

### Community 5 - "Project Docs & Core Concepts"
Cohesion: 0.33
Nodes (6): Merkle Tree Vote Anchoring, Three-Tier Branching Strategy, CI Backend Job (tsc + merkle test), CI Contracts Job (Hardhat tests), CI Frontend Job (lint + build), GitHub Actions CI Workflow

### Community 6 - "Merkle Contract Bindings"
Cohesion: 0.09
Nodes (34): getReadOnlyMerkleContract(), getWritableMerkleContract(), loadConfig(), MERKLE_ROOT_STORAGE_ABI, MerkleContractConfig, loadPublicKeyFromEnv(), computeNullifier(), constituencyFromNid() (+26 more)

### Community 7 - "ElGamal Crypto (Backend)"
Cohesion: 0.18
Nodes (21): bigIntToHex(), decodeCandidateId(), decodeMessage(), decrypt(), decryptCandidateId(), ElGamalCiphertext, ElGamalKeypair, ElGamalPublicKey (+13 more)

### Community 8 - "Frontend TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 9 - "Frontend Dependencies"
Cohesion: 0.07
Nodes (25): 1. Clone the Repository, 1. Stage Your Changes, 1. Switch Away from Your Feature Branch, 2. Commit Your Changes, 2. Create a Local Feature Branch (Always from `dev`, NOT from `main`), 2. Delete Local Branch, 3. Delete Remote Branch, 3. Push to Remote (+17 more)

### Community 10 - "Backend TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir (+8 more)

### Community 11 - "Frontend Node TS Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 12 - "Shared TypeScript Interfaces"
Cohesion: 0.11
Nodes (17): AdminEC, AdminLoginRequest, AdminLoginResponse, ApiErrorResponse, Candidate, CandidateListResponse, Constituency, ElGamalCiphertext (+9 more)

### Community 13 - "Backend Runtime Dependencies"
Cohesion: 0.08
Nodes (24): 10. Admin Dashboard / Admin Auth, 11. Future Work — test plans ready for when these get built, 11a. Digital Signature (integrity), 11b. Benaloh Challenge (cast-or-audit, voter verifiability), 11c. Full ZKP (zk-SNARK proof of eligibility/validity), 11d. MACI, 1. The API surface (curl / Postman), 1. Voter Registration — `POST /voter/register` (+16 more)

### Community 14 - "Frontend React Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, react, react-dom, react-router-dom, devDependencies, autoprefixer, oxlint, postcss (+16 more)

### Community 15 - "Root Package & Orchestration"
Cohesion: 0.11
Nodes (17): author, description, keywords, license, name, private, scripts, build (+9 more)

### Community 16 - "Blockchain TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck, strict (+2 more)

### Community 17 - "Shamir Secret Sharing"
Cohesion: 0.17
Nodes (11): Explicitly NOT doing (agreed scope — don't spend time here), Hard rules (unchanged, from testing_guidance.md), Left Work — Remaining Tasks & Assignments, Status snapshot (what's already done, docs lag behind), Task 1 — Live anchoring + tamper-detection demo on Sepolia, Task 2 — Update stale docs (context.md, testing_guidance.md), Task 3 — Nullifier redesign regression suite, Task 4 — Real 3-of-4 key ceremony + tally (+3 more)

### Community 19 - "Voter Seeding Scripts"
Cohesion: 0.38
Nodes (6): constituencyFromNid(), main(), MOCK_NIDS, MockVoter, sha256WithSalt(), supabase

### Community 20 - "Schema Migration Scripts"
Cohesion: 0.60
Nodes (5): executeSqlStatements(), main(), printManualInstructions(), splitSqlStatements(), supabase

### Community 21 - "Frontend Lint Config"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 33 - "E-Voting Simulation — Agent Context"
Cohesion: 0.10
Nodes (19): Architecture, Backend API, Backend `.env` Keys, Backend Source Structure, Blockchain `.env` Keys (blockchain/.env), Blockchain Package (blockchain/), Database (Supabase), Deployed Contract (live) (+11 more)

### Community 35 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

## Knowledge Gaps
- **317 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+312 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `supabase` connect `Merkle Contract Bindings` to `Keyholder Auth & Passphrase Verification`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `ApiError` connect `Public Watchdog & Tallying UI` to `React App & Layout Components`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _322 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public Watchdog & Tallying UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05222734254992319 - nodes in this community are weakly interconnected._
- **Should `React App & Layout Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06072874493927125 - nodes in this community are weakly interconnected._
- **Should `Keyholder Auth & Passphrase Verification` be split into smaller, more focused modules?**
  _Cohesion score 0.13852813852813853 - nodes in this community are weakly interconnected._
- **Should `Blockchain Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
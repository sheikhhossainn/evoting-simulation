# Graph Report - evoting-simulation  (2026-07-14)

## Corpus Check
- 72 files · ~39,691 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 510 nodes · 618 edges · 58 communities (28 shown, 30 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f11c65f2`
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
- ElGamal Crypto (Frontend)
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
- Design Guide — SecureVote BD
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
- SecureVote BD Color Palette
- Double-Vote Prevention Tests
- Merkle Anchoring Test Plan
- Testing Guidance Document
- Tallying & Decryption Test Plan
- Voter Registration Test Plan

## God Nodes (most connected - your core abstractions)
1. `E-Voting Simulation — Agent Context` - 18 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 15 edges
4. `compilerOptions` - 14 edges
5. `Testing Guidance` - 14 edges
6. `Contributing Guide` - 13 edges
7. `compilerOptions` - 9 edges
8. `scripts` - 9 edges
9. `buildMerkleTree()` - 8 edges
10. `supabase` - 8 edges

## Surprising Connections (you probably didn't know these)
- `SecureVote BD UI Icon Set` --conceptually_related_to--> `UI CSS Component Classes`  [INFERRED]
  frontend/public/icons.svg → design_guide.md
- `GitHub Actions CI Workflow` --conceptually_related_to--> `Three-Tier Branching Strategy`  [INFERRED]
  .github/workflows/ci.yml → CONTRIBUTING.md
- `SecureVote BD Favicon` --references--> `Frontend HTML Entry Point`  [INFERRED]
  frontend/public/favicon.svg → frontend/index.html
- `CI Contracts Job (Hardhat tests)` --references--> `Merkle Tree Vote Anchoring`  [EXTRACTED]
  .github/workflows/ci.yml → context.md
- `VotingPage()` --calls--> `encryptCandidateId()`  [EXTRACTED]
  frontend/src/pages/VotingPage.tsx → frontend/src/utils/elgamal.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CI Pipeline (3 Parallel Jobs)** — github_workflows_ci_frontend_job, github_workflows_ci_backend_job, github_workflows_ci_contracts_job [EXTRACTED 1.00]

## Communities (58 total, 30 thin omitted)

### Community 0 - "Public Watchdog & Tallying UI"
Cohesion: 0.07
Nodes (34): defaultPartyColor, PARTY_COLORS, PublicWatchdog(), PARTY_ACCENTS, TallyingPage(), VoterLogin(), LocationState, PARTY_THEMES (+26 more)

### Community 1 - "React App & Layout Components"
Cohesion: 0.06
Nodes (18): App(), Layout(), navLinks, techStack, AdminDashboard(), Candidate, CONSTITUENCIES, PARTIES (+10 more)

### Community 2 - "Keyholder Auth & Passphrase Verification"
Cohesion: 0.10
Nodes (20): DEMO_PASSPHRASES, envHashKeyFor(), hashPassphrase(), verifyKeyholderPassphrase(), ElGamalPrivateKey, loadPublicKeyFromEnv(), app, requireAdminSecret() (+12 more)

### Community 3 - "Blockchain Package Config"
Cohesion: 0.09
Nodes (21): author, description, devDependencies, dotenv, hardhat, @nomicfoundation/hardhat-toolbox, @openzeppelin/contracts, ts-node (+13 more)

### Community 4 - "Backend Package Config"
Cohesion: 0.07
Nodes (28): author, dependencies, cors, dotenv, ethers, express, secrets.js-grempe, @supabase/supabase-js (+20 more)

### Community 5 - "Project Docs & Core Concepts"
Cohesion: 0.33
Nodes (6): Merkle Tree Vote Anchoring, Three-Tier Branching Strategy, CI Backend Job (tsc + merkle test), CI Contracts Job (Hardhat tests), CI Frontend Job (lint + build), GitHub Actions CI Workflow

### Community 6 - "Merkle Contract Bindings"
Cohesion: 0.18
Nodes (19): getReadOnlyMerkleContract(), getWritableMerkleContract(), loadConfig(), MERKLE_ROOT_STORAGE_ABI, MerkleContractConfig, buildMerkleTree(), getProof(), hashPair() (+11 more)

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
Cohesion: 0.10
Nodes (20): 10. Admin Dashboard / Admin Auth, 11. Future Work — test plans ready for when these get built, 11a. Digital Signature (integrity), 11b. Benaloh Challenge (cast-or-audit, voter verifiability), 11c. Full ZKP (zk-SNARK proof of eligibility/validity), 11d. MACI, 1. Voter Registration — `POST /voter/register`, 2. Candidates — `GET /candidates?constituency=CON-XX` (+12 more)

### Community 14 - "Frontend React Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, react, react-dom, react-router-dom, devDependencies, autoprefixer, oxlint, postcss (+16 more)

### Community 15 - "Root Package & Orchestration"
Cohesion: 0.12
Nodes (16): author, description, keywords, license, name, private, scripts, build (+8 more)

### Community 16 - "Blockchain TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck, strict (+2 more)

### Community 17 - "Shamir Secret Sharing"
Cohesion: 0.39
Nodes (7): reconstructKey(), secrets, ShamirShares, splitPrivateKey(), verifyReconstruction(), ENV_PATH, main()

### Community 18 - "ElGamal Crypto (Frontend)"
Cohesion: 0.36
Nodes (8): bigIntToHex(), ElGamalCiphertext, ElGamalPublicKey, encodeCandidateId(), encryptCandidateId(), hexToBigInt(), modPow(), randomBigIntInRange()

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
Cohesion: 0.11
Nodes (18): Architecture, Backend API, Backend `.env` Keys, Backend Source Structure, Blockchain `.env` Keys (blockchain/.env), Blockchain Package (blockchain/), Database (Supabase), E-Voting Simulation — Agent Context (+10 more)

### Community 34 - "Design Guide — SecureVote BD"
Cohesion: 0.22
Nodes (8): Card Header Pattern, Colors, CSS Classes, Demo Credentials Box, Design Guide — SecureVote BD, Do / Don't, Page Layout Rules, Typography

### Community 35 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

## Knowledge Gaps
- **306 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+301 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `supabase` connect `Keyholder Auth & Passphrase Verification` to `Merkle Contract Bindings`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `encryptCandidateId()` connect `ElGamal Crypto (Frontend)` to `Public Watchdog & Tallying UI`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _309 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public Watchdog & Tallying UI` be split into smaller, more focused modules?**
  _Cohesion score 0.0730804810360777 - nodes in this community are weakly interconnected._
- **Should `React App & Layout Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06072874493927125 - nodes in this community are weakly interconnected._
- **Should `Keyholder Auth & Passphrase Verification` be split into smaller, more focused modules?**
  _Cohesion score 0.09879032258064516 - nodes in this community are weakly interconnected._
- **Should `Blockchain Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
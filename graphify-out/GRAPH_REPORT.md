# Graph Report - evoting-simulation  (2026-07-20)

## Corpus Check
- 78 files · ~53,870 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 592 nodes · 738 edges · 35 communities (30 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a1e46b76`
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
- Tamper-Proof Demo — Live Sepolia Anchoring & Verification
- Voter Seeding Scripts
- Schema Migration Scripts
- plugins
- Candidate Seeding Scripts
- Design System & UI Assets
- Frontend TS Project References
- Hardhat Config
- Smart Contract Deploy Script
- Frontend HTML & Favicon
- Tailwind CSS Config
- Graphify Knowledge Graph Rules
- Frontend Vite README
- Vite Build Config

## God Nodes (most connected - your core abstractions)
1. `E-Voting Simulation — Agent Context` - 19 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 15 edges
4. `Testing Guidance` - 15 edges
5. `compilerOptions` - 14 edges
6. `Contributing Guide` - 13 edges
7. `react` - 12 edges
8. `Tamper-Proof Demo — Live Sepolia Anchoring & Verification` - 12 edges
9. `Left Work — Remaining Tasks & Assignments` - 11 edges
10. `scripts` - 10 edges

## Surprising Connections (you probably didn't know these)
- `runAnchorBatch()` --calls--> `getWritableMerkleContract()`  [EXTRACTED]
  backend/src/services/anchorBatch.ts → backend/src/blockchain/merkleContract.ts
- `main()` --calls--> `generateKeypair()`  [EXTRACTED]
  backend/src/scripts/setup-keys.ts → backend/src/crypto/elgamal.ts
- `main()` --calls--> `splitPrivateKey()`  [EXTRACTED]
  backend/src/scripts/setup-shamir.ts → backend/src/crypto/shamir.ts
- `main()` --calls--> `reconstructKey()`  [EXTRACTED]
  backend/src/scripts/setup-shamir.ts → backend/src/crypto/shamir.ts
- `main()` --calls--> `hashVoteLeaf()`  [EXTRACTED]
  backend/src/scripts/test-merkle-batch.ts → backend/src/merkle/merkleTree.ts

## Import Cycles
- None detected.

## Communities (35 total, 5 thin omitted)

### Community 0 - "Public Watchdog & Tallying UI"
Cohesion: 0.06
Nodes (43): defaultPartyColor, PARTY_COLORS, PublicWatchdog(), PARTY_ACCENTS, REJECTION_DESCRIPTIONS, REJECTION_LABELS, SummaryTile(), TallyingPage() (+35 more)

### Community 1 - "React App & Layout Components"
Cohesion: 0.06
Nodes (22): App(), Layout(), navLinks, techStack, AdminDashboard(), Candidate, CONSTITUENCIES, PARTIES (+14 more)

### Community 2 - "Keyholder Auth & Passphrase Verification"
Cohesion: 0.08
Nodes (32): DEMO_PASSPHRASES, envHashKeyFor(), hashPassphrase(), verifyKeyholderPassphrase(), ElGamalPrivateKey, loadPublicKeyFromEnv(), computeNullifier(), constituencyFromNid() (+24 more)

### Community 3 - "Blockchain Package Config"
Cohesion: 0.05
Nodes (37): autoprefixer, dependencies, react, react-dom, react-router-dom, devDependencies, autoprefixer, oxlint (+29 more)

### Community 4 - "Backend Package Config"
Cohesion: 0.07
Nodes (29): author, description, devDependencies, dotenv, hardhat, @nomicfoundation/hardhat-toolbox, @openzeppelin/contracts, ts-node (+21 more)

### Community 5 - "Project Docs & Core Concepts"
Cohesion: 0.07
Nodes (26): author, description, devDependencies, nodemon, ts-node, @types/cors, @types/express, @types/node (+18 more)

### Community 6 - "Merkle Contract Bindings"
Cohesion: 0.07
Nodes (25): 1. Clone the Repository, 1. Stage Your Changes, 1. Switch Away from Your Feature Branch, 2. Commit Your Changes, 2. Create a Local Feature Branch (Always from `dev`, NOT from `main`), 2. Delete Local Branch, 3. Delete Remote Branch, 3. Push to Remote (+17 more)

### Community 7 - "ElGamal Crypto (Backend)"
Cohesion: 0.18
Nodes (19): getReadOnlyMerkleContract(), getWritableMerkleContract(), loadConfig(), MERKLE_ROOT_STORAGE_ABI, MerkleContractConfig, buildMerkleTree(), getProof(), hashPair() (+11 more)

### Community 8 - "Frontend TypeScript Config"
Cohesion: 0.08
Nodes (24): 10. Admin Dashboard / Admin Auth, 11. Future Work — test plans ready for when these get built, 11a. Digital Signature (integrity), 11b. Benaloh Challenge (cast-or-audit, voter verifiability), 11c. Full ZKP (zk-SNARK proof of eligibility/validity), 11d. MACI, 1. The API surface (curl / Postman), 1. Voter Registration — `POST /voter/register` (+16 more)

### Community 9 - "Frontend Dependencies"
Cohesion: 0.18
Nodes (21): bigIntToHex(), decodeCandidateId(), decodeMessage(), decrypt(), decryptCandidateId(), ElGamalCiphertext, ElGamalKeypair, ElGamalPublicKey (+13 more)

### Community 10 - "Backend TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+14 more)

### Community 11 - "Frontend Node TS Config"
Cohesion: 0.10
Nodes (20): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir (+12 more)

### Community 12 - "Shared TypeScript Interfaces"
Cohesion: 0.10
Nodes (19): Architecture, Backend API, Backend `.env` Keys, Backend Source Structure, Blockchain `.env` Keys (blockchain/.env), Blockchain Package (blockchain/), Database (Supabase), Deployed Contract (live) (+11 more)

### Community 13 - "Backend Runtime Dependencies"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 14 - "Frontend React Dependencies"
Cohesion: 0.11
Nodes (18): Bug found & fixed during this run, Environment, Etherscan evidence, Known boundaries (not failures — see `testing_guidance.md` §8), Missing admin secret → **401**, Never-anchored vote id → **404**, Reproduce, Results summary (+10 more)

### Community 15 - "Root Package & Orchestration"
Cohesion: 0.11
Nodes (17): author, description, keywords, license, name, private, scripts, build (+9 more)

### Community 16 - "Blockchain TypeScript Config"
Cohesion: 0.11
Nodes (17): AdminEC, AdminLoginRequest, AdminLoginResponse, ApiErrorResponse, Candidate, CandidateListResponse, Constituency, ElGamalCiphertext (+9 more)

### Community 17 - "Shamir Secret Sharing"
Cohesion: 0.12
Nodes (17): dependencies, cors, dotenv, ethers, express, secrets.js-grempe, @supabase/supabase-js, uuid (+9 more)

### Community 18 - "Tamper-Proof Demo — Live Sepolia Anchoring & Verification"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck, strict (+6 more)

### Community 19 - "Voter Seeding Scripts"
Cohesion: 0.17
Nodes (11): Explicitly NOT doing (agreed scope — don't spend time here), Hard rules (unchanged, from testing_guidance.md), Left Work — Remaining Tasks & Assignments, Status snapshot (what's already done, docs lag behind), Task 1 — Live anchoring + tamper-detection demo on Sepolia, Task 2 — Update stale docs (context.md, testing_guidance.md), Task 3 — Nullifier redesign regression suite, Task 4 — Real 3-of-4 key ceremony + tally (+3 more)

### Community 20 - "Schema Migration Scripts"
Cohesion: 0.18
Nodes (10): Adversary model, Goal, How we prove it, Research Methodology & Goal, Scope boundary, Scope of the tamper-evidence guarantee, Target venue, What we are proving (+2 more)

### Community 21 - "plugins"
Cohesion: 0.22
Nodes (8): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, typescript, warn

### Community 22 - "Candidate Seeding Scripts"
Cohesion: 0.38
Nodes (6): constituencyFromNid(), main(), MOCK_NIDS, MockVoter, sha256WithSalt(), supabase

### Community 23 - "Design System & UI Assets"
Cohesion: 0.60
Nodes (5): executeSqlStatements(), main(), printManualInstructions(), splitSqlStatements(), supabase

### Community 24 - "Frontend TS Project References"
Cohesion: 0.60
Nodes (4): flipOneNibble(), main(), supabase, verify()

### Community 25 - "Hardhat Config"
Cohesion: 0.40
Nodes (4): 1. Tamper Detection & On-Chain Anchoring (Task 1), 2. Ballot Secrecy & Nullifier Unlinkability (Task 3), 3. Threshold Decryption & Key Ceremony (Task 4), E-Voting System Evaluation Write-Up

### Community 27 - "Frontend HTML & Favicon"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

## Knowledge Gaps
- **324 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+319 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `React App & Layout Components` to `Public Watchdog & Tallying UI`, `plugins`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `plugins` connect `plugins` to `React App & Layout Components`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Shamir Secret Sharing` to `Project Docs & Core Concepts`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _324 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public Watchdog & Tallying UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05870020964360587 - nodes in this community are weakly interconnected._
- **Should `React App & Layout Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05612244897959184 - nodes in this community are weakly interconnected._
- **Should `Keyholder Auth & Passphrase Verification` be split into smaller, more focused modules?**
  _Cohesion score 0.07676767676767676 - nodes in this community are weakly interconnected._
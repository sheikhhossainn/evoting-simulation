# Graph Report - .  (2026-07-14)

## Corpus Check
- Corpus is ~39,277 words - fits in a single context window. You may not need a graph.

## Summary
- 484 nodes · 647 edges · 33 communities (26 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `compilerOptions` - 15 edges
3. `E-Voting System Architecture` - 15 edges
4. `compilerOptions` - 14 edges
5. `react` - 12 edges
6. `compilerOptions` - 9 edges
7. `scripts` - 9 edges
8. `buildMerkleTree()` - 8 edges
9. `supabase` - 8 edges
10. `VotingPage()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `SecureVote BD UI Icon Set` --conceptually_related_to--> `UI CSS Component Classes`  [INFERRED]
  frontend/public/icons.svg → design_guide.md
- `GitHub Actions CI Workflow` --conceptually_related_to--> `Three-Tier Branching Strategy`  [INFERRED]
  .github/workflows/ci.yml → CONTRIBUTING.md
- `SecureVote BD Favicon` --references--> `Frontend HTML Entry Point`  [INFERRED]
  frontend/public/favicon.svg → frontend/index.html
- `E-Voting Simulation Project` --references--> `ElGamal Encryption Scheme`  [EXTRACTED]
  README.md → context.md
- `E-Voting Simulation Project` --references--> `Polygon Amoy Blockchain Anchoring`  [EXTRACTED]
  README.md → context.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cryptographic Security Core** — context_elgamal_encryption, context_shamir_secret_sharing, context_merkle_tree, context_zkp_placeholder [EXTRACTED 0.95]
- **CI Pipeline (3 Parallel Jobs)** — github_workflows_ci_frontend_job, github_workflows_ci_backend_job, github_workflows_ci_contracts_job [EXTRACTED 1.00]
- **Key Ceremony & Tally Flow** — context_key_ceremony, context_shamir_secret_sharing, context_elgamal_encryption, context_admin_auth [EXTRACTED 0.95]

## Communities (33 total, 7 thin omitted)

### Community 0 - "Public Watchdog & Tallying UI"
Cohesion: 0.07
Nodes (35): defaultPartyColor, PARTY_COLORS, PublicWatchdog(), PARTY_ACCENTS, TallyingPage(), VoterLogin(), LocationState, PARTY_THEMES (+27 more)

### Community 1 - "React App & Layout Components"
Cohesion: 0.06
Nodes (22): plugins, App(), Layout(), navLinks, techStack, AdminDashboard(), Candidate, CONSTITUENCIES (+14 more)

### Community 2 - "Keyholder Auth & Passphrase Verification"
Cohesion: 0.10
Nodes (20): DEMO_PASSPHRASES, envHashKeyFor(), hashPassphrase(), verifyKeyholderPassphrase(), ElGamalPrivateKey, loadPublicKeyFromEnv(), app, requireAdminSecret() (+12 more)

### Community 3 - "Blockchain Package Config"
Cohesion: 0.07
Nodes (28): author, description, devDependencies, dotenv, hardhat, @nomicfoundation/hardhat-toolbox, @openzeppelin/contracts, ts-node (+20 more)

### Community 4 - "Backend Package Config"
Cohesion: 0.07
Nodes (26): author, description, devDependencies, nodemon, ts-node, @types/cors, @types/express, @types/node (+18 more)

### Community 5 - "Project Docs & Core Concepts"
Cohesion: 0.12
Nodes (27): x-admin-secret Header Auth, Ballot Secrecy Architectural Gap, ElGamal Encryption Scheme, E-Voting System Architecture, fn_cast_vote Stored Procedure, Key Ceremony (3-of-4 Threshold), Merkle Tree Vote Anchoring, Monorepo Architecture (4 packages) (+19 more)

### Community 6 - "Merkle Contract Bindings"
Cohesion: 0.18
Nodes (19): getReadOnlyMerkleContract(), getWritableMerkleContract(), loadConfig(), MERKLE_ROOT_STORAGE_ABI, MerkleContractConfig, buildMerkleTree(), getProof(), hashPair() (+11 more)

### Community 7 - "ElGamal Crypto (Backend)"
Cohesion: 0.18
Nodes (21): bigIntToHex(), decodeCandidateId(), decodeMessage(), decrypt(), decryptCandidateId(), ElGamalCiphertext, ElGamalKeypair, ElGamalPublicKey (+13 more)

### Community 8 - "Frontend TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+14 more)

### Community 9 - "Frontend Dependencies"
Cohesion: 0.10
Nodes (21): autoprefixer, devDependencies, autoprefixer, oxlint, postcss, tailwindcss, @types/node, @types/react (+13 more)

### Community 10 - "Backend TypeScript Config"
Cohesion: 0.10
Nodes (20): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir (+12 more)

### Community 11 - "Frontend Node TS Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 12 - "Shared TypeScript Interfaces"
Cohesion: 0.11
Nodes (17): AdminEC, AdminLoginRequest, AdminLoginResponse, ApiErrorResponse, Candidate, CandidateListResponse, Constituency, ElGamalCiphertext (+9 more)

### Community 13 - "Backend Runtime Dependencies"
Cohesion: 0.12
Nodes (17): dependencies, cors, dotenv, ethers, express, secrets.js-grempe, @supabase/supabase-js, uuid (+9 more)

### Community 14 - "Frontend React Dependencies"
Cohesion: 0.12
Nodes (16): dependencies, react, react-dom, react-router-dom, name, private, scripts, build (+8 more)

### Community 15 - "Root Package & Orchestration"
Cohesion: 0.12
Nodes (16): author, description, keywords, license, name, private, scripts, build (+8 more)

### Community 16 - "Blockchain TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, skipLibCheck, strict (+6 more)

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
Nodes (5): rules, react/only-export-components, react/rules-of-hooks, $schema, warn

### Community 23 - "Design System & UI Assets"
Cohesion: 0.50
Nodes (4): SecureVote BD Color Palette, UI CSS Component Classes, Page Layout Rules, SecureVote BD UI Icon Set

## Knowledge Gaps
- **232 isolated node(s):** `name`, `version`, `description`, `main`, `dev` (+227 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `React App & Layout Components` to `Public Watchdog & Tallying UI`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `plugins` connect `React App & Layout Components` to `Frontend Lint Config`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Backend Runtime Dependencies` to `Backend Package Config`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _232 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public Watchdog & Tallying UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07493061979648474 - nodes in this community are weakly interconnected._
- **Should `React App & Layout Components` be split into smaller, more focused modules?**
  _Cohesion score 0.06090808416389812 - nodes in this community are weakly interconnected._
- **Should `Keyholder Auth & Passphrase Verification` be split into smaller, more focused modules?**
  _Cohesion score 0.09879032258064516 - nodes in this community are weakly interconnected._
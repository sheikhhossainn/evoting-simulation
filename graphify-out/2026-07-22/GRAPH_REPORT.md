# Graph Report - .  (2026-07-22)

## Corpus Check
- cluster-only mode - file stats not available

## Summary
- 344 nodes · 1124 edges · 13 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: MODIFIES: 329 · ON_BRANCH: 285 · contains: 214 · PARENT_OF: 94 · imports: 67 · imports_from: 62 · calls: 59 · reads_from: 10 · triggers: 3 · method: 1


## Graph Freshness
- Built from Git commit: `2816473`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `ApiError` - 11 edges
2. `supabase` - 8 edges
3. `modPow()` - 7 edges
4. `fn_cast_vote()` - 7 edges
5. `apiGet()` - 7 edges
6. `encryptCandidateId()` - 7 edges
7. `generateKeypair()` - 6 edges
8. `encrypt()` - 6 edges
9. `encryptCandidateId()` - 6 edges
10. `decryptCandidateId()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `0c4ef8c Merge pull request #11 from sheikhhossainn/feature/merkle-polygon-anchoring` --ON_BRANCH--> `dev`  [EXTRACTED]
  git → git  _Bridges community 4 → community 0_
- `0c4ef8c Merge pull request #11 from sheikhhossainn/feature/merkle-polygon-anchoring` --PARENT_OF--> `1d21ad2 Merge pull request #12 from sheikhhossainn/feature/public-watchdog`  [EXTRACTED]
  git → git  _Bridges community 4 → community 3_
- `14f8663 Merge pull request #17 from sheikhhossainn/feature/nullifier-redesign` --ON_BRANCH--> `dev`  [EXTRACTED]
  git → git  _Bridges community 5 → community 0_
- `18b76fe Merge pull request #20 from sheikhhossainn/dev` --ON_BRANCH--> `feature/adversarial-tally-watchdog`  [EXTRACTED]
  git → git  _Bridges community 2 → community 0_
- `1d21ad2 Merge pull request #12 from sheikhhossainn/feature/public-watchdog` --ON_BRANCH--> `dev`  [EXTRACTED]
  git → git  _Bridges community 3 → community 0_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (52): config, dev, feature/adversarial-tally-watchdog, feature/qa-testing-docs, feature/testing-evidence-final, main, 0080e9b Improve CONTRIBUTING.md with comprehensive onboarding for new contributors, 09b9f6c resolve schema merge conflict, add key_shares and nullifiers tables (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (20): 2503f4e designed Voter UI, 2b5f445 Merge pull request #5 from sheikhhossainn/feature/routing, 698b728 Initial commit, 728ddb2 feat: add homepage with role cards, navbar, routing, candidates schema, and BD theme, d10bdd9 Merge pull request #13 from sheikhhossainn/dev, e319286 Merge pull request #1 from sheikhhossainn/feature/voter-ui, navLinks, config (+12 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (30): 18b76fe Merge pull request #20 from sheikhhossainn/dev, 26ce322 Merge pull request #9 from sheikhhossainn/feature/elgamal, 763f8fa Merge pull request #8 from sheikhhossainn/feature/nullifier-voter-flow, 77d1f38 feat: add ElGamal encryption, migrate routes to Supabase, seed voters & candidates, 9455886 redesign nullifier with server-side secret salt; move ballot lookup key from voter_nid_hash to nullifier_hash + constituency_code, f1f54a0 feat: wire end-to-end voter flow with client-side nullifier generation, computeNullifier(), constituencyFromNid() (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (36): 1d21ad2 Merge pull request #12 from sheikhhossainn/feature/public-watchdog, 210ee45 enable public watchdog and mock offline voting flow, 84985f3 added testing guidance, 930172e polish watchdog dashboard and add post-tally results, d3c5488 Merge pull request #14 from sheikhhossainn/feature/watchdog-result, defaultPartyColor, PARTY_COLORS, PARTY_ACCENTS (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (27): getReadOnlyMerkleContract(), getWritableMerkleContract(), loadConfig(), MERKLE_ROOT_STORAGE_ABI, MerkleContractConfig, 0c4ef8c Merge pull request #11 from sheikhhossainn/feature/merkle-polygon-anchoring, 84b7239 feat: Merkle tree construction and Polygon Amoy anchoring, e4ca553 feat: real watchdog data, tally persistence, and auto-anchor at 50 votes (+19 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (18): 14f8663 Merge pull request #17 from sheikhhossainn/feature/nullifier-redesign, 8d49f9a Merge pull request #16 from sheikhhossainn/feature/tallying-decryption, b16b92d Merge branch 'dev' into feature/nullifier-redesign, DEMO_PASSPHRASES, envHashKeyFor(), hashPassphrase(), verifyKeyholderPassphrase(), ElGamalPrivateKey (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (20): candidates, fn_cast_vote(), fn_votes_immutable_guard(), key, key_shares, merkle_batches, NEW.constituency_code, NEW.created_at (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (19): bigIntToHex(), decodeCandidateId(), decodeMessage(), decrypt(), decryptCandidateId(), ElGamalCiphertext, ElGamalKeypair, ElGamalPublicKey (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): AdminEC, AdminLoginRequest, AdminLoginResponse, ApiErrorResponse, Candidate, CandidateListResponse, Constituency, ElGamalCiphertext (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.36
Nodes (8): bigIntToHex(), ElGamalCiphertext, ElGamalPublicKey, encodeCandidateId(), encryptCandidateId(), hexToBigInt(), modPow(), randomBigIntInRange()

### Community 10 - "Community 10"
Cohesion: 0.60
Nodes (5): executeSqlStatements(), main(), printManualInstructions(), splitSqlStatements(), supabase

### Community 11 - "Community 11"
Cohesion: 0.50
Nodes (4): fetchPost(), REQUIRED_ENV, runTests(), supabase

### Community 12 - "Community 12"
Cohesion: 0.60
Nodes (4): flipOneNibble(), main(), supabase, verify()

## Knowledge Gaps
- **90 isolated node(s):** `MERKLE_ROOT_STORAGE_ABI`, `MerkleContractConfig`, `DEMO_PASSPHRASES`, `ElGamalPublicKey`, `ElGamalKeypair` (+85 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ApiError` connect `Community 3` to `Community 1`, `Community 0`, `Community 2`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `supabase` connect `Community 4` to `Community 2`, `Community 5`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `encryptCandidateId()` connect `Community 9` to `Community 2`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `MERKLE_ROOT_STORAGE_ABI`, `MerkleContractConfig`, `DEMO_PASSPHRASES` to the rest of the system?**
  _90 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08446455505279035 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08282828282828283 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07822410147991543 - nodes in this community are weakly interconnected._
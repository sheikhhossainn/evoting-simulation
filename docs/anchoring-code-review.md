# Final Code Review — Anchoring / Merkle / On-Chain Integration

**Scope:** the anchoring subsystem — Merkle construction, the on-chain contract, the backend anchor service and routes, and the measurement/test harness. This is the "final code review + integration" deliverable.

**Verdict:** the anchoring path is coherent and correct. One implementation is shared everywhere it matters, on-chain and off-chain hashing cannot drift, failure modes are handled honestly, and the one piece of confusing naming is intentional and documented (not a bug). No changes were required.

---

## 1. Files reviewed

| File | Role |
|------|------|
| [backend/src/merkle/merkleTree.ts](../backend/src/merkle/merkleTree.ts) | Canonical Merkle build / proof / verify |
| [blockchain/contracts/MerkleRootStorage.sol](../blockchain/contracts/MerkleRootStorage.sol) | On-chain root storage + `verify` |
| [backend/src/services/anchorBatch.ts](../backend/src/services/anchorBatch.ts) | Batch anchor logic + auto-anchor trigger |
| [backend/src/routes/anchor.ts](../backend/src/routes/anchor.ts) | HTTP: batch / verify / latest / tamper / restore |
| [backend/src/blockchain/merkleContract.ts](../backend/src/blockchain/merkleContract.ts) | ethers.js bindings |
| [blockchain/scripts/measure-anchoring-cost.ts](../blockchain/scripts/measure-anchoring-cost.ts) | Gas + scale measurement harness |
| [blockchain/test/MerkleRootStorage.test.ts](../blockchain/test/MerkleRootStorage.test.ts) | Contract + Merkle round-trip tests |
| [frontend/src/pages/TamperVisualizer.tsx](../frontend/src/pages/TamperVisualizer.tsx) | Live pipeline + tamper demo UI |

---

## 2. What is done well

**Single source of truth for the hashing scheme.** `merkleTree.ts` is imported by the backend service, the Hardhat tests, and the measurement script by relative path. There is exactly one implementation of leaf hashing (`keccak256(keccak256(abiEncode(...)))`) and node hashing (commutative sorted-pair, OpenZeppelin-compatible). Off-chain proof generation and on-chain `verify()` therefore cannot silently diverge — the property the whole tamper-evidence claim rests on. Confirmed the tests and the cost script both import this same module.

**Double-hashed leaves + commutative pairing are deliberate and documented.** The leaf double-hash defends against the second-preimage attack where an internal node is replayed as a leaf; the sorted-pair node hash matches OZ's `_hashPair` so proof ordering is irrelevant. The header comment in `merkleTree.ts` states this contract explicitly.

**batchId is read from the event, not the return value.** `merkleContract.ts` declares `anchorRoot(...) returns (uint256 batchId)`, but `anchorBatch.ts` parses `batchId` from the `BatchAnchored` event log. This is correct: a non-`view` function's Solidity return value is not available in a transaction receipt (only the tx is), so the event is the right channel. Not a bug — a common trap avoided.

**Honest failure handling around the chain/DB boundary.** In `runAnchorBatch`, if the on-chain anchor lands but the subsequent `merkle_batches` insert or `votes` update fails, the code logs loudly and does **not** pretend to roll back — the comment notes chain state is the source of truth. This is the right call; the on-chain tx is irreversible and the DB can be reconciled from it.

**Auto-anchor is safe under concurrency and never blocks the voter.** `maybeAutoAnchor` is fire-and-forget, wrapped so it never throws into the vote response path, and guarded by an in-process `autoAnchorInFlight` flag against overlapping runs. The comment correctly flags that a horizontal scale-out would need a DB advisory lock instead — a known, documented boundary rather than a silent assumption.

**Read/write key separation.** `getReadOnlyMerkleContract` needs no private key; only `getWritableMerkleContract` (anchoring) loads `ANCHOR_PRIVATE_KEY`. Public verification cannot accidentally require or expose the signing key.

---

## 3. Integration notes

**The `AMOY_RPC_URL` name is intentional legacy, not a bug.** The project migrated from Polygon Amoy to Ethereum Sepolia but kept the env var name `AMOY_RPC_URL` in `backend/.env` — it now holds the **Sepolia** RPC URL. This is documented in [docs/tamper-proof-demo.md](tamper-proof-demo.md) and the deploy script. `merkleContract.ts` reads `AMOY_RPC_URL` deliberately. **Do not "fix" this by renaming** without updating `.env`, the deploy script output, and the docs together — a blind rename would break a working deployment for zero functional gain. Recommendation: leave as-is, or rename in one coordinated change across all three if clarity is judged worth the churn.

> Note: `blockchain/hardhat.config.ts` uses `AMOY_RPC_URL` and `SEPOLIA_RPC_URL` as **separate, distinct** variables in its own context — that is a different concern from `backend/.env` and is not affected by the above.

**Measurement path == production path.** `measure-anchoring-cost.ts` and the contract tests import the same `merkleTree.ts` the backend runs and deploy the same contract. The gas/timing numbers in [anchoring-cost-analysis.md](anchoring-cost-analysis.md) therefore describe the real system, not a stand-in.

---

## 4. Known boundaries (already surfaced in-product)

These are correctly disclosed in the tamper visualizer UI and are recorded here for completeness, not as defects:

- **Pre-anchor window** — a vote is only tamper-evident *after* its batch anchors; edits before anchoring leave no on-chain trace. Bounded by anchor cadence (auto-anchor every 50 votes).
- **Deletion vs. edit** — a Merkle root proves *inclusion*, not *completeness*. Editing a leaf is caught; deleting a whole vote could yield a self-consistent smaller tree. The contract does store `voteCount` on-chain, which is the anchor point for detecting count mismatch — worth asserting against the DB count during verification as a future hardening step.
- **Confirmation latency** is not measurable on the in-memory EVM; the ~12 s figure comes from the real Sepolia anchor (see [anchoring-cost-analysis.md §4.2](anchoring-cost-analysis.md)).

---

## 5. Recommendations (optional, non-blocking)

1. **Assert on-chain `voteCount` against the DB row count during verification** to partially close the deletion boundary above. Low effort, meaningful hardening.
2. If the app ever scales beyond a single Express instance, **replace the `autoAnchorInFlight` in-process flag with a DB advisory lock** (already noted in-code).
3. **Consider a coordinated rename of `AMOY_RPC_URL` → `SEPOLIA_RPC_URL`** in `backend/.env` + deploy script + docs, purely for readability — only if done atomically across all three.

None of these block the current deliverable; the subsystem is correct as it stands.

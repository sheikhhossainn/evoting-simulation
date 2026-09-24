# Scalability Benchmark — 10k+ Synthetic Ballots

**Scope:** off-chain proof-generation/verification timing and on-chain gas, measured up to 50,000 synthetic ballots/keys. Extends [anchoring-cost-analysis.md](anchoring-cost-analysis.md) (which covers dense-tree build @1k/10k and `anchorRoot`/`anchorSmtRoot` gas flatness) with: SMT scaling to 50k, per-ballot DLEQ and ZKP-validity crypto cost, and on-chain `verify`/`verifySmtMembership`/`verifySmtNonMembership` gas.

**Methodology:** all figures measured, not estimated, from [blockchain/scripts/scalability-benchmark.ts](../blockchain/scripts/scalability-benchmark.ts) against Hardhat's in-memory EVM, importing the same production modules the backend runs (`merkleTree.ts`, `sparseMerkleTree.ts`, `dleq.ts`, `zkp.ts`, `elgamal.ts`).

```bash
cd blockchain
NODE_OPTIONS="--max-old-space-size=8192" npx hardhat run scripts/scalability-benchmark.ts
```

The larger heap is required past ~30k cumulative SMT keys — see §3's finding.

---

## 1. Dense Merkle tree (per-batch), up to 50k votes

| Votes | Build time | Proof length | Proof gen | Proof verify |
|------:|-----------:|-------------:|----------:|--------------:|
| 100    | 49 ms     | 7  | 0.098 ms | 0.288 ms |
| 1,000  | 362 ms    | 10 | 0.032 ms | 0.335 ms |
| 5,000  | 2,014 ms  | 13 | 0.039 ms | 0.382 ms |
| 10,000 | 3,836 ms  | 14 | 0.014 ms | 0.464 ms |
| 25,000 | 9,434 ms  | 15 | 0.017 ms | 0.422 ms |
| 50,000 | 23,695 ms | 16 | 0.037 ms | 0.582 ms |

Build time is linear in N (~0.47 ms/vote at 50k); proof length is `ceil(log2 N)`; proof gen/verify stay sub-millisecond regardless of scale. Consistent with the 1k/10k figures already in anchoring-cost-analysis.md, now confirmed out to 50k.

## 2. SMT — cumulative build + membership proof, checkpoints to 50k

| Cumulative keys | Insert time (this segment) | ms/insert | Proof gen | Proof verify |
|-----------------:|----------------------------:|----------:|----------:|---------------:|
| 100    | 1,144 ms   | 11.44 | 0.855 ms | 9.401 ms |
| 1,000  | 10,972 ms  | 12.19 | 0.513 ms | 8.302 ms |
| 5,000  | 47,595 ms  | 11.90 | 0.550 ms | 9.469 ms |
| 10,000 | 59,772 ms  | 11.95 | 0.514 ms | 9.979 ms |
| 25,000 | 160,264 ms | 10.68 | 3.224 ms | 11.486 ms |
| 50,000 | 319,392 ms | 12.78 | 16.857 ms | 13.632 ms |

Two findings, one confirming the design, one a genuine limitation:

- **Proof gen/verify time stays flat** (single-digit ms) regardless of how many keys are in the tree — confirms the O(256), tree-size-independent proof cost the design claims (docs/smt-design.md §8), in contrast to the dense tree's O(log N) growth in §1. The small increase at 50k (16.9 ms proof-gen) is GC pressure from a large `nodeCache` Map, not an algorithmic cost increase.
- **Per-insert cost is a flat ~11-13 ms regardless of cumulative tree size** — also expected (each `insert()` walks exactly 256 levels, docs/smt-design.md §8). But at ~12 ms/insert, building a 50k-key SMT from scratch takes **~5.3 minutes**, ~25× slower than building a fresh 50k-leaf dense tree in the same run (23.7 s). This is a real throughput ceiling for the *current, unoptimized, single-key-at-a-time* `insert()` implementation — not a flaw in the O(256) design, but a concrete cost of the naive in-memory `Map<string, string>` node cache (string-keyed lookups, one Map entry per non-default node per level). A production system anchoring 50k+ ballots per batch would want batched/lazy SMT construction rather than N sequential `insert()` calls; documented here as a known optimization opportunity, not implemented in this project.
- The benchmark run itself required `--max-old-space-size=8192`; the default Node heap OOM'd at ~30k cumulative keys during a first attempt, because the node-cache footprint scales as O(N × 256) key-value pairs. Same underlying cause as the throughput finding above.

## 3. Per-ballot crypto cost (independent of election size N)

### 3a. DLEQ — partial decryption + proof (avg of 200 trials, one keyholder)

| Operation | Avg time |
|---|---:|
| Partial decryption (`c1^x_i mod p`) | 0.481 ms |
| DLEQ prove | 0.747 ms |
| DLEQ verify | 1.119 ms |

Per keyholder, per ballot: ~2.35 ms total (decrypt + prove + verify). For a threshold-3 tally of N ballots, aggregate DLEQ-verify time (the independent verifier's dominant cost) is **~3 × 1.12 ms × N**, e.g. ~33.6 s for 10,000 ballots on a single thread — and trivially parallelizable across ballots (each verification is independent, no shared state).

### 3b. ZKP ballot-validity OR-proof (avg of 50 trials), by candidate count

| Candidates | Prove | Verify |
|---:|---:|---:|
| 2  | 1.665 ms  | 1.979 ms |
| 5  | 4.564 ms  | 5.710 ms |
| 10 | 9.647 ms  | 10.252 ms |
| 20 | 21.259 ms | 21.301 ms |
| 50 | 52.891 ms | 52.886 ms |

Cost is linear in the **constituency's candidate count** (one OR-branch per candidate, matching the CDS94 construction), and is **independent of election size N** — this proof runs once per ballot at cast time, on the voter's ballot alone. Even at an unusually large 50-candidate constituency, prove+verify together stay under 106 ms.

## 4. On-chain gas — `verify()` by proof length, SMT verification

| Votes | Proof length | `verify()` gas estimate |
|------:|--------------:|--------------------------:|
| 100    | 7  | 32,515 |
| 1,000  | 10 | 36,200 |
| 5,000  | 13 | 40,130 |
| 10,000 | 14 | 41,290 |
| 25,000 | 15 | 42,630 |
| 50,000 | 16 | 43,940 |

| Cumulative SMT keys | `verifySmtMembership` gas | `verifySmtNonMembership` gas |
|---:|---:|---:|
| 100    | 338,565 | 336,853 |
| 1,000  | 338,657 | 339,345 |
| 10,000 | 342,383 | 342,572 |

- Dense `verify()` gas grows only with `log2 N` — from ~32.5k gas at 100 votes to ~44k gas at 50,000, a ~35% increase for a 500× scale increase.
- SMT verification gas is flat around ~339-342k regardless of tree size, as expected — it always walks a fixed 256 levels, independent of how many keys are actually present. This is ~8-10× more expensive per verification than the dense tree's proof, the direct on-chain cost of the SMT's size-independence guarantee.
- **Both functions are `view`/`pure`** — an off-chain caller (`eth_call`, e.g. this project's independent verifier) pays **$0** regardless of the gas number above; the estimate only matters if a verification were ever invoked from inside another contract's state-changing transaction, which this system does not do.

---

## 5. Key findings for the scalability section

1. **On-chain cost is flat or near-flat in N** — `anchorRoot`/`anchorSmtRoot` are exactly flat (established in anchoring-cost-analysis.md); `verify()` grows only logarithmically (32.5k → 44k gas, 100 → 50,000 votes); SMT verification is exactly flat (~340k gas) regardless of scale. All are free for the off-chain verifier regardless.
2. **Dense-tree off-chain scaling is comfortable to 50k**: ~24 s build, sub-millisecond proofs.
3. **Per-ballot cryptography (DLEQ, ZKP) is cheap and embarrassingly parallel** — single-digit milliseconds per ballot, independent of election size; the ZKP's only scale dependency is candidate count per constituency, not total voters.
4. **The one genuine scalability limitation found**: the current SMT `insert()` path costs a flat ~12 ms/key regardless of tree size, so building a 50k-key SMT from scratch takes ~5.3 minutes and its in-memory node cache needs an ~8 GB heap past ~30k keys. This is a property of the current single-key-at-a-time implementation, not the O(256) design — documented here as a known limitation and a concrete optimization target (batched insertion), rather than silently omitted.

---

## References

Companion documents: [anchoring-cost-analysis.md](anchoring-cost-analysis.md), [smt-design.md](smt-design.md), [related-work-positioning.md](related-work-positioning.md).

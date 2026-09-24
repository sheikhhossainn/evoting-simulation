# Anchoring Cost & Scale Analysis

**Scope:** gas and cost of anchoring confirmed votes on-chain, comparing the naive "one transaction per vote" approach against the batched single-Merkle-root approach this system uses, plus off-chain scaling behaviour at 1k and 10k votes.

**Companion document:** [scalability-benchmark-results.md](scalability-benchmark-results.md) holds extended 50k-ballot benchmarks. This document holds the measured gas, cost, and scaling numbers.

---

## 1. Methodology

All gas and timing figures below are **measured, not estimated**. They come from [blockchain/scripts/measure-anchoring-cost.ts](../blockchain/scripts/measure-anchoring-cost.ts), run against Hardhat's in-memory EVM:

```bash
cd blockchain
npx hardhat run scripts/measure-anchoring-cost.ts
```

Key properties of the measurement harness:

- The script imports the **same** Merkle module the backend uses in production — `buildMerkleTree`, `getProof`, `hashVoteLeaf`, `verifyProof` from [backend/src/merkle/merkleTree.ts](../backend/src/merkle/merkleTree.ts). The measured off-chain build/proof timings are therefore the real production code path, not a re-implementation that could drift.
- Gas is read from the actual transaction receipt (`receipt.gasUsed`) after deploying [MerkleRootStorage.sol](../blockchain/contracts/MerkleRootStorage.sol) and calling `anchorRoot`.
- The deployed contract on Ethereum Sepolia is `0x4b5C381c62876d34bBDDefDe02e872E5a93401b6`; a real anchored batch is referenced in §4.

Gas is a property of the EVM, not of the network, so the gas counts measured on the in-memory EVM are identical to what Sepolia or Ethereum mainnet would charge for the same calldata and state writes. USD figures depend on live gas price and ETH price and are treated as parameters in §3.

---

## 2. Gas measurements

### 2.1 One-time deployment

| Operation | Gas | Frequency |
|-----------|-----|-----------|
| Deploy `MerkleRootStorage` | 1,171,809 | Once, ever |

Deployment is paid a single time at system setup and is not part of per-batch or per-vote cost.

### 2.2 `anchorRoot` gas per batch size

The core result. Each row is **one** `anchorRoot(bytes32 root, uint256 voteCount)` transaction anchoring a batch of the given size:

| Batch size | `anchorRoot` gas | Note |
|-----------:|-----------------:|------|
| 10  | 117,029 | first anchor — pays cold-storage surcharge |
| 30  | 99,929  | steady state |
| 50  | 99,929  | steady state |
| 100 | 99,929  | steady state |

**The critical observation: on-chain gas is independent of batch size N.** Anchoring 100 votes costs exactly the same gas as anchoring 30. This is structural, not coincidental — `anchorRoot` always writes the same three storage words (`root`, `voteCount`, `timestamp`; see [MerkleRootStorage.sol:14-18](../blockchain/contracts/MerkleRootStorage.sol)) and emits one event, regardless of how many votes the root summarises. The batch size N is recorded as a plain `uint256` and never touches per-vote storage.

The 117,029 figure for the first anchor reflects a one-time cold-storage surcharge (writing to never-before-touched slots costs more under EIP-2929). Every subsequent anchor is **99,929 gas** — the representative steady-state figure used everywhere below.

### 2.3 Per-vote (naive) vs batched

If the system anchored every vote in its own transaction, each vote would pay a full `anchorRoot` (99,929 gas steady-state). Comparison:

| Votes | Per-vote anchoring | Batched anchoring | Transactions saved | Gas ratio |
|------:|-------------------:|------------------:|-------------------:|----------:|
| 10  | ~999,290 gas (10 txns)  | 117,029 gas (1 txn) | 9   | ~8.5× (cold) / ~10× steady |
| 30  | ~2,997,870 gas (30 txns) | 99,929 gas (1 txn)  | 29  | ~30× |
| 50  | ~4,996,450 gas (50 txns) | 99,929 gas (1 txn)  | 49  | ~50× |
| 100 | ~9,992,900 gas (100 txns) | 99,929 gas (1 txn)  | 99  | ~100× |

**The gas savings from batching scale linearly with batch size and are unbounded.** A batch of N votes costs N× less gas than anchoring each vote separately, because batching collapses N transactions into 1 while the single transaction's cost stays flat.

---

## 3. USD cost

On-chain cost in fiat is:

```
cost_USD = gasUsed × gasPrice_gwei × 1e-9 × ETH_price_USD
```

**ETH price:** $1,898.33 USD (CoinGecko, https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd).

Gas price is volatile and is treated as a parameter. The table shows the steady-state batch anchor (99,929 gas) and the 30-vote per-vote baseline (2,997,870 gas) across three gas-price scenarios:

| Gas price | 1 batched anchor (99,929 gas) | 30 per-vote anchors (2,997,870 gas) | Savings on a 30-batch |
|----------:|------------------------------:|------------------------------------:|-----------------------:|
| 0.16 gwei (current low) | ~$0.03 | ~$0.91 | ~$0.88 |
| 10 gwei (moderate) | ~$1.90 | ~$56.91 | ~$55.01 |
| 30 gwei (busy network) | ~$5.70 | ~$170.73 | ~$165.03 |

> The production system anchors on **Sepolia (testnet)**, where gas is free. These USD figures are what the identical gas usage would cost **if run on Ethereum mainnet**, included to make the batching argument concrete for cost-sensitive deployment decisions. The savings multiplier (30×, 50×, 100×) holds regardless of gas price.

---

## 4. Scale test (1k / 10k votes)

### 4.1 Off-chain Merkle build + proof (measured)

| Votes | Merkle build time | Proof length | Single-proof verify |
|------:|------------------:|-------------:|--------------------:|
| 1,000  | 198.3 ms   | 10 hashes | 0.494 ms |
| 10,000 | 1,935.2 ms | 14 hashes | 0.263 ms |

Notes:

- **Build time** covers hashing every leaf (`hashVoteLeaf`) and building the full tree. It grows roughly linearly with vote count (~10× votes, ~15× time — hashing dominates). Even 10k votes build in under 3 seconds on commodity hardware, and this is a one-time cost per batch, done off-chain before a single transaction is sent.
- **Proof length** is `ceil(log2 N)`: 1,000 votes → 10 sibling hashes, 10,000 votes → 14. This is what a verifier downloads to prove one vote's inclusion — it grows logarithmically, so proofs stay tiny even at large scale.
- **Verify time** is sub-millisecond regardless of batch size, because verification walks only the proof path, not the whole tree.

### 4.2 Transaction confirmation latency

Confirmation latency **cannot** be measured on the in-memory EVM — it mines blocks instantly. The realistic figure comes from the real Sepolia anchor:

- **Anchored batch:** batch_id 1, 32 votes, root `0x2531a8a03bb2d9255830164884e9981c3f688226926f7acf5885617608678bf5`, tx `0xf4c5577b…316c`, mined in block 11352499.
- Sepolia (like Ethereum mainnet post-Merge) targets **~12 s per block**. One confirmation is therefore ~12 s; waiting a few blocks for practical finality is on the order of tens of seconds.

**Confirmation latency is independent of batch size N.** Whether a batch holds 10 votes or 10,000, it is still exactly one transaction of the same size, so it confirms in the same ~12 s. This is the same structural property as gas (§2.2): batching does not make the on-chain step slower.

---

## 5. Key findings

1. **On-chain gas is flat in N.** One anchor is 99,929 gas (steady state) whether the batch is 30 or 100 votes.
2. **Batching beats per-vote anchoring by exactly N×** in both gas and transaction count. At 100 votes that is a ~100× reduction.
3. **Off-chain scaling is comfortable.** 10k votes build in <3 s; inclusion proofs are 14 hashes and verify in <1 ms.
4. **Latency does not degrade with scale** — one batch is one ~12 s transaction regardless of vote count.
5. **The measurement path is the production path** — the harness imports the backend's own Merkle module and the deployed contract, so these numbers reflect the real system.

---

## References

1. MDPI, "Standard-Compliant Blockchain Anchoring for Timestamp Tokens" — https://www.mdpi.com/2076-3417/15/23/12722
2. R. Vanabharathiraja, "Hash, Print, Anchor: Securing Logs with Merkle Trees and Blockchain" — https://medium.com/@vanabharathiraja/%EF%B8%8F-building-a-tamper-proof-event-logging-system-e71dfbc3c58a
3. Cube Exchange, "What is a Merkle Tree?" — https://www.cube.exchange/what-is/merkle-tree
4. Wikipedia, "Merkle tree" (see RFC 6962, Laurie, Langley, Kasper, June 2013, doi:10.17487/rfc6962) — https://en.wikipedia.org/wiki/Merkle_tree
5. Investopedia, "Merkle Trees in Blockchain" — https://www.investopedia.com/terms/m/merkle-tree.asp
6. CoinGecko Simple Price API (ETH/USD) — https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd

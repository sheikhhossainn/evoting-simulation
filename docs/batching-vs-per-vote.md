# Batching vs Per-Vote Anchoring — Design Rationale

**Audience:** faculty / evaluators asking "why did you anchor a batched Merkle root instead of putting each vote on-chain?"

**Companion document:** [anchoring-cost-analysis.md](anchoring-cost-analysis.md) holds the measured gas, cost, and scale numbers this rationale rests on.

---

## The question

When you want a blockchain to guarantee that recorded votes cannot be silently altered, there are two obvious designs:

1. **Per-vote anchoring** — send one transaction per vote, writing each vote (or its hash) directly on-chain.
2. **Batched root anchoring** — collect a batch of votes off-chain, build a Merkle tree over them, and anchor only the single 32-byte **root** in one transaction.

This system uses design 2. This document explains why, and is honest about what design 1 would have bought.

## Short answer

Batching a Merkle root gives the **same tamper-evidence guarantee** as per-vote anchoring — any change to any vote still breaks verification — but at **N× lower gas, N× fewer transactions, and no loss of the ability to prove one individual vote's inclusion**. For an election with hundreds or thousands of votes, per-vote anchoring is strictly more expensive and slower for zero additional integrity. This is the same architecture Certificate Transparency (RFC 6962) uses to anchor millions of certificates, and that blockchains themselves use to commit all transactions in a block to a single root.

---

## The architecture

```
N votes            Merkle tree              1 root         1 transaction
─────────          ───────────              ──────         ─────────────

vote 1 ─┐
        ├─ h(1,2) ─┐
vote 2 ─┘          │
                   ├─ h(1..4) ─┐
vote 3 ─┐          │           │
        ├─ h(3,4) ─┘           │
vote 4 ─┘                      ├──►  ROOT  ──►  anchorRoot(root, N)
                               │              (one tx, ~98,076 gas,
vote 5 ─┐          ┌───────────┘               independent of N)
        ├─ h(5,6) ─┤
vote 6 ─┘          │
                  ...
```

`anchorRoot` writes exactly three storage words (root, voteCount, timestamp) and emits one event, no matter how large N is — see [MerkleRootStorage.sol](../blockchain/contracts/MerkleRootStorage.sol).

### Inclusion-proof path

To later prove that **one specific vote** was in an anchored batch, you do not need the whole tree — only the sibling hashes along the path from that leaf to the root (a Merkle proof). For a batch of N votes the proof is `ceil(log2 N)` hashes:

```
Prove vote 3 was anchored:

           ROOT  ◄── on-chain, trusted
          /    \
     h(1..4)   h(5..8)   ◄── proof hash #2 (sibling: h(5..8))
     /     \
 h(1,2)   h(3,4)          ◄── proof hash #1 (sibling: h(1,2))
          /    \
     leaf3    leaf4        ◄── proof hash #0 (sibling: leaf4)
       ▲
     the vote being proven

proof = [ leaf4, h(1,2), h(5..8) ]        (3 hashes for N=8)
verify: hash(leaf3, leaf4) → hash(h(1,2), ·) → hash(·, h(5..8)) == ROOT ?
```

The verifier recomputes the path upward and checks it equals the on-chain root. If it matches, the vote was provably in the batch; if the vote (or the stored root) was altered, the recomputed root differs and verification fails. This is exactly what [backend/src/routes/anchor.ts](../backend/src/routes/anchor.ts) `GET /anchor/verify/:voteId` does — both locally and against the on-chain `verify()` — returning 409 when a tamper is detected. Proof length for real batch sizes: 1,000 votes → 10 hashes, 10,000 votes → 14 hashes.

---

## Tradeoff analysis

| Dimension | Per-vote anchoring | Batched root anchoring | Winner |
|-----------|--------------------|------------------------|--------|
| **Gas / N votes** | N × ~98,076 gas | ~98,076 gas (flat) | Batched (N×) |
| **Transactions / N votes** | N | 1 | Batched (N×) |
| **Confirmation latency** | N txns to await | 1 txn (~12 s on Sepolia) | Batched |
| **Tamper evidence** | Yes — each vote committed | Yes — root commits all votes | Tie |
| **Prove one vote's inclusion** | Trivial (it's its own record) | Merkle proof, `ceil(log2 N)` hashes | Tie (both possible) |
| **On-chain privacy** | Risk of leaking per-vote metadata / timing | Only an opaque 32-byte root is public | Batched |
| **Write authority surface** | N signed writes to expose | 1 signed write per batch | Batched |
| **Real-time per-vote finality** | Each vote final on its own tx | Vote final only when its batch anchors | Per-vote |

### Cost and throughput

Per-vote anchoring costs scale linearly and without bound: 100 votes is 100 transactions and ~100× the gas (see [anchoring-cost-analysis.md §2.3](anchoring-cost-analysis.md)). On a busy mainnet at 30 gwei that is the difference between ~$5.59 and ~$167.55 for a single 30-vote batch. Batching collapses this to one flat-cost transaction. For an election, where votes arrive in bursts, batching is the only design that stays affordable at scale.

### Integrity — no guarantee is lost

The common worry is that batching "hides" individual votes and weakens the guarantee. It does not. The Merkle root is a cryptographic commitment to **every** leaf: flip one bit of one vote and the recomputed root no longer matches the anchored root, exactly as if that vote had been anchored alone. The security reduction is to the collision resistance of keccak256, the same primitive per-vote anchoring would rely on. This is precisely why Certificate Transparency logs (RFC 6962) and blockchain block headers both commit large sets to a single root rather than storing each item on-chain.

### Privacy and attack surface

Per-vote anchoring publishes one on-chain event per vote, leaking vote count timing and creating N signed writes an attacker could target or an operator could mis-order. Batching publishes only an opaque 32-byte root; the encrypted ballots never leave the database, and there is exactly one privileged write per batch (`onlyOwner anchorRoot`), shrinking the trusted write surface.

### What per-vote anchoring would have bought (the honest tradeoff)

Per-vote anchoring gives each vote **independent, immediate on-chain finality** the instant it is cast, rather than at batch-anchor time. If the requirement were "every single vote must be irreversibly on-chain within seconds of casting, independently of all others," per-vote would fit better. For this system that is not the requirement: votes are confirmed in the database immediately (with an immutability trigger, demo vector 2), and the on-chain root provides the tamper-evident audit anchor. The batch cadence (auto-anchor every 50 votes) bounds how long a vote waits for its on-chain anchor to a small window, which is an acceptable tradeoff for the N× cost and latency win.

---

## Why batching wins for this system

1. **Same integrity, N× cheaper.** The root commits to every vote; changing any vote breaks verification. Batching sacrifices none of that while cutting gas and transaction count by a factor of N.
2. **Scales without cost blow-up.** On-chain cost and latency are flat in batch size (measured: 98,076 gas and one ~12 s tx whether 30 or 100 votes).
3. **Individual votes remain provable.** A `ceil(log2 N)`-hash Merkle proof proves any one vote's inclusion against the on-chain root — 10 hashes for 1k votes, 14 for 10k.
4. **Smaller trusted surface and better privacy** — one privileged write per batch, and only an opaque root is public.

The only thing given up is per-vote instant on-chain finality, which this system does not require because database confirmation is immediate and the batch cadence bounds the anchoring delay.

---

## References

1. Wikipedia, "Merkle tree" (see RFC 6962 — Laurie, Langley, Kasper, *Certificate Transparency*, June 2013, doi:10.17487/rfc6962) — https://en.wikipedia.org/wiki/Merkle_tree
2. MDPI, "Standard-Compliant Blockchain Anchoring for Timestamp Tokens" — https://www.mdpi.com/2076-3417/15/23/12722
3. R. Vanabharathiraja, "Hash, Print, Anchor: Securing Logs with Merkle Trees and Blockchain" — https://medium.com/@vanabharathiraja/%EF%B8%8F-building-a-tamper-proof-event-logging-system-e71dfbc3c58a
4. Cube Exchange, "What is a Merkle Tree?" — https://www.cube.exchange/what-is/merkle-tree
5. Investopedia, "Merkle Trees in Blockchain" — https://www.investopedia.com/terms/m/merkle-tree.asp

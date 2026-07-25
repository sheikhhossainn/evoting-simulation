# Task 8B — Merkle forgery + on-chain binding: test run output

> Real run output, not illustrative. Both suites import the **same** module
> (`backend/src/merkle/merkleTree.ts`) so the off-chain and on-chain paths cannot
> silently drift.

## Coverage

| Requirement | Where |
|---|---|
| Valid proof verifies for every leaf; sizes 1, 2, 3 (odd), 50, 1000 | both suites |
| Forged: flipped sibling hash | both |
| Forged: wrong leaf index | both |
| Forged: proof from a different tree | both |
| Second-preimage (swap a leaf for an inner node) | unit suite |
| Empty-tree / single-leaf edge cases | both |
| Solidity-stored root == TS-computed root | hardhat binding suite |

---

## 1. Off-chain unit tests — `backend/`

```
npm run test:merkle
```

```
🌳 Merkle tree adversarial unit tests

Run at: 2026-07-25T03:54:25.600Z

[1] Valid inclusion proofs for every leaf
  ✅ size 1: all 1 inclusion proofs verify
  ✅ size 2: all 2 inclusion proofs verify
  ✅ size 3: all 3 inclusion proofs verify
  ✅ size 50: all 50 inclusion proofs verify
  ✅ size 1000: all 1000 inclusion proofs verify

[2] Forged-proof rejection
  ✅ flipped sibling hash rejected
  ✅ proof for one leaf does not verify a different leaf
  ✅ leaf verified against a proof built for the wrong index rejected
  ✅ proof from a different tree rejected against original root
  ✅ valid proof rejected against a foreign root
  ✅ second-preimage: raw inner-node forgery reconstructs the root (mechanical)
  ✅ second-preimage defense: leaf and inner-node value spaces are disjoint
  ✅ second-preimage defense: recomputed leaf for a forged vote != inner node
  ✅ empty proof rejected for a leaf in a multi-leaf tree

[3] Empty-tree / single-leaf edge cases
  ✅ buildMerkleTree([]) throws
  ✅ single-leaf root equals the leaf
  ✅ single-leaf proof is empty
  ✅ single-leaf leaf verifies with empty proof
  ✅ foreign leaf rejected against single-leaf root

19 passed, 0 failed

✅ All Merkle unit tests passed
```

---

## 2. On-chain binding + forgery tests — `blockchain/`

```
npx hardhat test test/MerkleRootStorage.test.ts
```

```
  MerkleRootStorage
    ✔ anchors a mock vote batch and verifies every vote's inclusion proof (1129ms)
    ✔ anchors multiple sequential batches with independent batchIds (59ms)
    ✔ rejects anchoring from a non-owner account (44ms)
    ✔ rejects a zero root
    on-chain / off-chain binding
      ✔ size 1: stored root == TS root and every leaf verifies on-chain
      ✔ size 2: stored root == TS root and every leaf verifies on-chain (39ms)
      ✔ size 3: stored root == TS root and every leaf verifies on-chain (77ms)
      ✔ size 50: stored root == TS root and every leaf verifies on-chain (517ms)
      ✔ size 1000: stored root == TS root and every leaf verifies on-chain (9752ms)
      ✔ single-leaf batch: root == leaf and verifies on-chain with an empty proof
    on-chain forged-proof rejection
      ✔ rejects flipped-sibling, wrong-index, and cross-tree proofs on-chain (127ms)

  11 passing (12s)
```

---

**Result: 19 unit assertions + 11 hardhat cases — all green.**

/**
 * measure-anchoring-cost.ts — real gas + timing evidence for the anchoring
 * cost analysis (docs/anchoring-cost-analysis.md, docs/batching-vs-per-vote.md).
 *
 * Runs on Hardhat's in-memory EVM (no testnet funds). Produces:
 *   1. anchorRoot gas per batch size 10/30/50/100 — proves on-chain gas is
 *      independent of N (one fixed-size root tx regardless of batch size).
 *   2. per-vote gas: what N separate anchorRoot calls would cost (the naive
 *      "anchor every vote" baseline) vs the single batched root.
 *   3. Merkle build time for 1k / 10k votes (off-chain scaling).
 *
 * Run:  npx hardhat run scripts/measure-anchoring-cost.ts
 */

import { ethers } from "hardhat";
import {
  buildMerkleTree,
  getProof,
  hashVoteLeaf,
  verifyProof,
  type VoteLeafInput,
} from "../../backend/src/merkle/merkleTree";
import {
  SparseMerkleTree,
  GENESIS_ROOT,
} from "../../backend/src/merkle/sparseMerkleTree";

function mockVoteBatch(n: number): VoteLeafInput[] {
  const votes: VoteLeafInput[] = [];
  for (let i = 0; i < n; i++) {
    votes.push({
      voteId: ethers.hexlify(ethers.randomBytes(16)),
      c1: ethers.hexlify(ethers.randomBytes(32)),
      c2: ethers.hexlify(ethers.randomBytes(32)),
      createdAt: new Date(Date.now() + i).toISOString(),
    });
  }
  return votes;
}

async function main(): Promise<void> {
  const [owner] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("MerkleRootStorage");
  const contract = await factory.deploy(owner.address);
  await contract.waitForDeployment();

  // Deployment gas (one-time setup cost).
  const deployTx = contract.deploymentTransaction();
  const deployReceipt = await deployTx!.wait();
  console.log(`\n=== Deployment (one-time) ===`);
  console.log(`deploy gas: ${deployReceipt!.gasUsed.toString()}`);

  console.log(`\n=== 1. Batched anchorRoot gas per batch size ===`);
  console.log(`batch_size,anchorRoot_gas`);
  const batchSizes = [10, 30, 50, 100];
  const anchorGasBySize: Record<number, bigint> = {};
  for (const size of batchSizes) {
    const votes = mockVoteBatch(size);
    const tree = buildMerkleTree(votes.map(hashVoteLeaf));
    const tx = await contract.anchorRoot(tree.root, size);
    const receipt = await tx.wait();
    anchorGasBySize[size] = receipt!.gasUsed;
    console.log(`${size},${receipt!.gasUsed.toString()}`);
  }

  // First anchorRoot pays a cold-storage surcharge (fresh batchCount slot etc).
  // Report the steady-state gas (a later anchor) as the representative figure.
  const steadyGas = anchorGasBySize[100];

  console.log(`\n=== 2. Per-vote vs batched (N=30 reference) ===`);
  const perVoteGas = steadyGas; // one anchorRoot per vote = same fixed cost each
  for (const size of batchSizes) {
    const naive = perVoteGas * BigInt(size);
    console.log(
      `size ${size}: per-vote ~${naive.toString()} gas (${size} txns) vs batched ${anchorGasBySize[size].toString()} gas (1 txn)`
    );
  }

  console.log(`\n=== 3. Merkle build time (off-chain scaling) ===`);
  console.log(`vote_count,build_ms,proof_len,proof_verify_ms`);
  for (const n of [1000, 10000]) {
    const votes = mockVoteBatch(n);
    const t0 = performance.now();
    const leaves = votes.map(hashVoteLeaf);
    const tree = buildMerkleTree(leaves);
    const t1 = performance.now();

    // Time a single inclusion-proof generate + verify round-trip.
    const idx = Math.floor(n / 2);
    const p0 = performance.now();
    const proof = getProof(tree, idx);
    const ok = verifyProof(leaves[idx], proof, tree.root);
    const p1 = performance.now();
    if (!ok) throw new Error(`proof failed at n=${n}`);

    console.log(
      `${n},${(t1 - t0).toFixed(1)},${proof.length},${(p1 - p0).toFixed(3)}`
    );
  }

  console.log(`\nsteady-state anchorRoot gas (representative): ${steadyGas.toString()}`);

  // === 4. anchorSmtRoot gas per batch (docs/smt-design.md §13 test 17) ===
  // Chain several SMT batches (like the real anchorBatch flow: rebuild the
  // cumulative tree, insert this batch's new keys, anchor the new root with
  // chain-continuity back to the previous one). Batch size shouldn't matter
  // to gas — anchorSmtRoot's cost is fixed (four bytes32/uint256 args + one
  // storage write), independent of how many keys were inserted off-chain to
  // produce newRoot, same flat-per-batch shape as anchorRoot above.
  console.log(`\n=== 4. anchorSmtRoot gas per batch (chained) ===`);
  console.log(`batch_size,newKeysThisBatch,totalKeysAnchored,anchorSmtRoot_gas`);
  const smtTree = new SparseMerkleTree();
  let previousSmtRoot = GENESIS_ROOT;
  let totalKeys = 0;
  const smtBatchSizes = [10, 30, 50, 100];
  const smtGasBySize: Record<number, bigint> = {};
  for (const size of smtBatchSizes) {
    for (let i = 0; i < size; i++) {
      const key = ethers.hexlify(ethers.randomBytes(32));
      const value = ethers.hexlify(ethers.randomBytes(32));
      smtTree.insert(key, value);
    }
    const newRoot = smtTree.root();
    totalKeys += size;
    const tx = await contract.anchorSmtRoot(newRoot, previousSmtRoot, size, totalKeys);
    const receipt = await tx.wait();
    smtGasBySize[size] = receipt!.gasUsed;
    console.log(`${size},${size},${totalKeys},${receipt!.gasUsed.toString()}`);
    previousSmtRoot = newRoot;
  }

  console.log(
    `\nverifySmtMembership / verifySmtNonMembership: both are \`pure\` functions ` +
      `taking \`root\` as a parameter (not reading contract state), so any ` +
      `off-chain eth_call to them costs $0 in gas for the caller, and can check ` +
      `ANY historically anchored root, not just the latest.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

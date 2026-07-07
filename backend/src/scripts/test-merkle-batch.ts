/**
 * test-merkle-batch.ts — Sanity-check Merkle tree construction with a mock
 * vote batch, no blockchain/DB required.
 *
 * Run: npx ts-node src/scripts/test-merkle-batch.ts
 *
 * For a full test that also anchors on-chain and verifies via the deployed
 * contract, see blockchain/test/MerkleRootStorage.test.ts (npm test in
 * blockchain/).
 */

import { randomUUID, randomBytes } from "crypto";
import {
  buildMerkleTree,
  getProof,
  hashVoteLeaf,
  verifyProof,
  type VoteLeafInput,
} from "../merkle/merkleTree";

function mockVoteBatch(n: number): VoteLeafInput[] {
  const votes: VoteLeafInput[] = [];
  for (let i = 0; i < n; i++) {
    votes.push({
      voteId: randomUUID(),
      c1: "0x" + randomBytes(32).toString("hex"),
      c2: "0x" + randomBytes(32).toString("hex"),
      createdAt: new Date(Date.now() + i).toISOString(),
    });
  }
  return votes;
}

function main() {
  console.log("\n🌳 Merkle batch sanity check\n");

  for (const size of [1, 2, 3, 7, 16, 33]) {
    const votes = mockVoteBatch(size);
    const leaves = votes.map(hashVoteLeaf);
    const tree = buildMerkleTree(leaves);

    let allValid = true;
    for (let i = 0; i < leaves.length; i++) {
      const proof = getProof(tree, i);
      if (!verifyProof(leaves[i], proof, tree.root)) {
        allValid = false;
        console.error(`  ❌ batch size ${size}: proof failed at index ${i}`);
      }
    }

    // A leaf that was never in the batch must not verify against this root
    const foreignLeaf = hashVoteLeaf({
      voteId: "not-in-batch",
      c1: "0x00",
      c2: "0x00",
      createdAt: new Date().toISOString(),
    });
    const foreignRejected = !verifyProof(foreignLeaf, getProof(tree, 0), tree.root);

    console.log(
      `  batch size ${String(size).padStart(2)}: root=${tree.root.slice(0, 18)}... ` +
        `all proofs valid=${allValid} foreign vote rejected=${foreignRejected}`
    );

    if (!allValid || !foreignRejected) {
      process.exitCode = 1;
    }
  }

  if (process.exitCode === 1) {
    console.error("\n❌ Merkle batch sanity check FAILED\n");
  } else {
    console.log("\n✅ Merkle batch sanity check passed for all batch sizes\n");
  }
}

main();

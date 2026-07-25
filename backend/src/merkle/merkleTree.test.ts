/**
 * merkleTree.test.ts — adversarial unit tests for the canonical Merkle module
 *
 * Pure off-chain tests (no blockchain / DB): they exercise the exact
 * tree/proof/verify functions in merkleTree.ts that the backend anchoring
 * route and the Hardhat suite both import. Run:
 *
 *   npx ts-node src/merkle/merkleTree.test.ts     (from backend/)
 *   npm run test:merkle                            (from backend/)
 *
 * The on-chain binding (Solidity-stored root == TS-computed root, and
 * on-chain proof forgery rejection) is asserted in
 * blockchain/test/MerkleRootStorage.test.ts, which imports THIS same module.
 *
 * Task 8B coverage:
 *   - Valid proof verifies for every leaf; tree sizes 1, 2, 3 (odd), 50, 1000
 *   - Forged-proof rejection: flipped sibling hash, wrong leaf index,
 *     proof from a different tree, second-preimage attack (inner node as leaf)
 *   - Empty-tree / single-leaf edge cases
 */

import { randomUUID, randomBytes } from "crypto";
import {
  buildMerkleTree,
  getProof,
  hashVoteLeaf,
  verifyProof,
  type VoteLeafInput,
} from "./merkleTree";

// ── minimal assertion harness (backend has no test framework) ──
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

function checkThrows(name: string, fn: () => unknown): void {
  try {
    fn();
    failed++;
    console.error(`  ❌ ${name} (expected throw, none happened)`);
  } catch {
    passed++;
    console.log(`  ✅ ${name}`);
  }
}

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

/** Flip the last hex nibble of a 0x-prefixed hash to make a distinct value */
function corrupt(hash: string): string {
  const last = hash.slice(-1);
  const flipped = last === "0" ? "1" : "0";
  return hash.slice(0, -1) + flipped;
}

// ── 1. Valid proof verifies for every leaf, across representative sizes ──
// 1 (single leaf), 2 (perfect), 3 (odd → duplicate-node path), 50 (odd
// intermediate layers), 1000 (large, mixed parity through the layers).
function testValidProofs(): void {
  console.log("\n[1] Valid inclusion proofs for every leaf");
  for (const size of [1, 2, 3, 50, 1000]) {
    const leaves = mockVoteBatch(size).map(hashVoteLeaf);
    const tree = buildMerkleTree(leaves);

    let allValid = true;
    for (let i = 0; i < leaves.length; i++) {
      if (!verifyProof(leaves[i], getProof(tree, i), tree.root)) {
        allValid = false;
      }
    }
    check(`size ${size}: all ${size} inclusion proofs verify`, allValid);
  }
}

// ── 2. Forged-proof rejection ──
function testForgedProofs(): void {
  console.log("\n[2] Forged-proof rejection");

  // Use size 50 so proofs are multi-level and there are siblings to tamper.
  const leaves = mockVoteBatch(50).map(hashVoteLeaf);
  const tree = buildMerkleTree(leaves);
  const target = 17; // arbitrary interior leaf
  const validProof = getProof(tree, target);

  // 2a. Flipped sibling hash — a single corrupted sibling breaks the chain.
  const flipped = [...validProof];
  flipped[0] = corrupt(flipped[0]);
  check(
    "flipped sibling hash rejected",
    !verifyProof(leaves[target], flipped, tree.root)
  );

  // 2b. Wrong leaf index — a valid proof for leaf A must not verify leaf B.
  const otherIndex = 4;
  check(
    "proof for one leaf does not verify a different leaf",
    !verifyProof(leaves[otherIndex], validProof, tree.root)
  );
  // ...and the correct leaf paired with a proof generated for a DIFFERENT
  // index (wrong sibling ordering / wrong path) must also be rejected.
  const wrongPathProof = getProof(tree, otherIndex);
  check(
    "leaf verified against a proof built for the wrong index rejected",
    !verifyProof(leaves[target], wrongPathProof, tree.root)
  );

  // 2c. Proof from a different tree — same leaf, but a proof + root taken
  // from an entirely separate batch must not verify.
  const otherLeaves = mockVoteBatch(50).map(hashVoteLeaf);
  const otherTree = buildMerkleTree(otherLeaves);
  check(
    "proof from a different tree rejected against original root",
    !verifyProof(leaves[target], getProof(otherTree, target), tree.root)
  );
  check(
    "valid proof rejected against a foreign root",
    !verifyProof(leaves[target], validProof, otherTree.root)
  );

  // 2d. Second-preimage attack — swap a leaf for an inner node.
  //
  // The classic attack: present an INTERNAL node hash as if it were a leaf,
  // together with a truncated proof, to forge inclusion of a "vote" that was
  // never submitted. Mechanically, `verifyProof(innerNode, truncatedProof,
  // root)` DOES reconstruct the root — a bare proof verifier cannot tell a
  // leaf value from an inner-node value, so that is expected and not the
  // security boundary. Demonstrate the raw attack succeeds structurally:
  const innerNode = tree.layers[1][0]; // level-1 node = hashPair(leaf0, leaf1)
  const shortenedProof = getProof(tree, 0).slice(1); // drop the level-0 sibling
  check(
    "second-preimage: raw inner-node forgery reconstructs the root (mechanical)",
    verifyProof(innerNode, shortenedProof, tree.root)
  );

  // The ACTUAL defense is domain separation: leaves are double-hashed
  // (keccak256(keccak256(encode(...)))) while inner nodes are single-hashed
  // (keccak256(sorted(l,r))), so the two value-spaces are disjoint. The
  // production verifier (anchor route) always DERIVES the leaf from real vote
  // fields via hashVoteLeaf — it never accepts an attacker-supplied hash — so
  // an inner node can never be the leaf hash of any submittable vote.
  // Assert that disjointness holds concretely: no inner node in the tree
  // equals any leaf value.
  const leafSet = new Set(leaves.map((h) => h.toLowerCase()));
  let anyLeafNodeCollision = false;
  for (let level = 1; level < tree.layers.length; level++) {
    for (const node of tree.layers[level]) {
      if (leafSet.has(node.toLowerCase())) anyLeafNodeCollision = true;
    }
  }
  check(
    "second-preimage defense: leaf and inner-node value spaces are disjoint",
    !anyLeafNodeCollision
  );

  // And the operational consequence: an attacker who wants to claim the inner
  // node was a vote must supply vote fields; the verifier recomputes the leaf
  // via hashVoteLeaf, which (being double-hashed) cannot equal that inner node.
  const forgedVoteLeaf = hashVoteLeaf({
    voteId: innerNode, // attacker tries to smuggle the inner-node hash in
    c1: "0x00",
    c2: "0x00",
    createdAt: new Date().toISOString(),
  });
  check(
    "second-preimage defense: recomputed leaf for a forged vote != inner node",
    forgedVoteLeaf.toLowerCase() !== innerNode.toLowerCase()
  );

  // 2e. Empty proof against a multi-leaf root — only a single-leaf tree may
  // verify with an empty proof (root == leaf). A leaf of a larger tree must
  // not verify with no siblings.
  check(
    "empty proof rejected for a leaf in a multi-leaf tree",
    !verifyProof(leaves[target], [], tree.root)
  );
}

// ── 3. Empty-tree / single-leaf edge cases ──
function testEdgeCases(): void {
  console.log("\n[3] Empty-tree / single-leaf edge cases");

  // Empty tree must throw, never silently produce a root.
  checkThrows("buildMerkleTree([]) throws", () => buildMerkleTree([]));

  // Single leaf: root == leaf, proof is empty, verifies with [].
  const single = hashVoteLeaf(mockVoteBatch(1)[0]);
  const tree = buildMerkleTree([single]);
  check("single-leaf root equals the leaf", tree.root === single);
  check("single-leaf proof is empty", getProof(tree, 0).length === 0);
  check(
    "single-leaf leaf verifies with empty proof",
    verifyProof(single, [], tree.root)
  );

  // A different leaf must not verify against a single-leaf root.
  const other = hashVoteLeaf(mockVoteBatch(1)[0]);
  check(
    "foreign leaf rejected against single-leaf root",
    !verifyProof(other, [], tree.root)
  );
}

function main(): void {
  console.log("\n🌳 Merkle tree adversarial unit tests\n");
  console.log(`Run at: ${new Date().toISOString()}`);

  testValidProofs();
  testForgedProofs();
  testEdgeCases();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\n❌ Merkle unit tests FAILED\n");
    process.exitCode = 1;
  } else {
    console.log("\n✅ All Merkle unit tests passed\n");
  }
}

main();

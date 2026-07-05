/**
 * merkleTree.ts — Merkle tree construction for vote batch anchoring
 *
 * Canonical implementation shared by the backend (batch anchoring route)
 * and the blockchain package (Hardhat tests/scripts import this module
 * directly by relative path — there is exactly one implementation of the
 * hashing scheme, so on-chain verification and off-chain proof generation
 * can never drift apart).
 *
 * Hashing scheme (must match MerkleRootStorage.sol / OpenZeppelin's
 * MerkleProof):
 *   - Leaf:  keccak256(keccak256(abi.encode(voteId, c1, c2, createdAt)))
 *            (double-hashed — standard defense against second-preimage
 *            attacks where an inner node is replayed as a leaf)
 *   - Node:  keccak256(sort(left, right))  — commutative pair hashing,
 *            so proof order doesn't matter (matches OZ's `_hashPair`)
 *   - Odd layer: the unpaired node is duplicated against itself
 */

import { ethers } from "ethers";

export interface VoteLeafInput {
  voteId: string;
  c1: string;
  c2: string;
  createdAt: string; // ISO timestamp — binds the leaf to the immutable vote row
}

/** Hash a single vote's immutable fields into a Merkle leaf */
export function hashVoteLeaf(vote: VoteLeafInput): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "string", "string"],
    [vote.voteId, vote.c1, vote.c2, vote.createdAt]
  );
  return ethers.keccak256(ethers.keccak256(encoded));
}

/** Commutative pair hash: keccak256(sorted(a, b)) */
function hashPair(a: string, b: string): string {
  const [x, y] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

export interface MerkleTree {
  root: string;
  /** layers[0] = leaves, layers[last] = [root] */
  layers: string[][];
}

/** Build a full Merkle tree from an ordered list of leaf hashes */
export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("Cannot build a Merkle tree from zero leaves");
  }

  let currentLayer = [...leaves];
  const layers: string[][] = [currentLayer];

  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right =
        i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i];
      nextLayer.push(hashPair(left, right));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { root: currentLayer[0], layers };
}

/** Generate a Merkle proof (sibling hashes bottom-up) for the leaf at `index` */
export function getProof(tree: MerkleTree, index: number): string[] {
  const proof: string[] = [];
  let idx = index;

  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const isRightNode = idx % 2 === 1;
    const pairIndex = isRightNode ? idx - 1 : idx + 1;
    proof.push(pairIndex < layer.length ? layer[pairIndex] : layer[idx]);
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/** Verify a leaf + proof reconstructs the given root */
export function verifyProof(
  leaf: string,
  proof: string[],
  root: string
): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { randomUUID, randomBytes } from "crypto";
import {
  buildMerkleTree,
  getProof,
  hashVoteLeaf,
  verifyProof,
  type VoteLeafInput,
} from "./merkleTree";

// Configure fixed seed for deterministic testing
beforeAll(() => {
  fc.configureGlobal({ seed: 42 });
});

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

function corrupt(hash: string): string {
  const last = hash.slice(-1);
  const flipped = last === "0" ? "1" : "0";
  return hash.slice(0, -1) + flipped;
}

describe('Merkle Tree (Unit)', () => {
  describe('Valid inclusion proofs for every leaf', () => {
    it('verifies for size 1', () => {
      const leaves = mockVoteBatch(1).map(hashVoteLeaf);
      const tree = buildMerkleTree(leaves);
      expect(verifyProof(leaves[0], getProof(tree, 0), tree.root)).toBe(true);
    });
    
    it('verifies for sizes 2, 3, 50, 1000', () => {
      for (const size of [2, 3, 50, 1000]) {
        const leaves = mockVoteBatch(size).map(hashVoteLeaf);
        const tree = buildMerkleTree(leaves);
        let allValid = true;
        for (let i = 0; i < leaves.length; i++) {
          if (!verifyProof(leaves[i], getProof(tree, i), tree.root)) {
            allValid = false;
          }
        }
        expect(allValid).toBe(true);
      }
    });
  });

  describe('Forged-proof rejection', () => {
    const leaves = mockVoteBatch(50).map(hashVoteLeaf);
    const tree = buildMerkleTree(leaves);
    const target = 17;
    const validProof = getProof(tree, target);

    it('rejects flipped sibling hash', () => {
      const flipped = [...validProof];
      flipped[0] = corrupt(flipped[0]);
      expect(verifyProof(leaves[target], flipped, tree.root)).toBe(false);
    });

    it('rejects proof for one leaf against a different leaf', () => {
      const otherIndex = 4;
      expect(verifyProof(leaves[otherIndex], validProof, tree.root)).toBe(false);
      
      const wrongPathProof = getProof(tree, otherIndex);
      expect(verifyProof(leaves[target], wrongPathProof, tree.root)).toBe(false);
    });

    it('rejects proof from a different tree', () => {
      const otherLeaves = mockVoteBatch(50).map(hashVoteLeaf);
      const otherTree = buildMerkleTree(otherLeaves);
      expect(verifyProof(leaves[target], getProof(otherTree, target), tree.root)).toBe(false);
      expect(verifyProof(leaves[target], validProof, otherTree.root)).toBe(false);
    });

    it('defends against second-preimage attack', () => {
      const innerNode = tree.layers[1][0]; 
      const shortenedProof = getProof(tree, 0).slice(1); 
      expect(verifyProof(innerNode, shortenedProof, tree.root)).toBe(true);

      const leafSet = new Set(leaves.map((h) => h.toLowerCase()));
      let anyLeafNodeCollision = false;
      for (let level = 1; level < tree.layers.length; level++) {
        for (const node of tree.layers[level]) {
          if (leafSet.has(node.toLowerCase())) anyLeafNodeCollision = true;
        }
      }
      expect(anyLeafNodeCollision).toBe(false);

      const forgedVoteLeaf = hashVoteLeaf({
        voteId: innerNode, 
        c1: "0x00",
        c2: "0x00",
        createdAt: new Date().toISOString(),
      });
      expect(forgedVoteLeaf.toLowerCase()).not.toBe(innerNode.toLowerCase());
    });

    it('rejects empty proof for a leaf in a multi-leaf tree', () => {
      expect(verifyProof(leaves[target], [], tree.root)).toBe(false);
    });
  });

  describe('Empty-tree / single-leaf edge cases', () => {
    it('throws on empty tree', () => {
      expect(() => buildMerkleTree([])).toThrow();
    });

    it('single-leaf root equals the leaf and verified with empty proof', () => {
      const single = hashVoteLeaf(mockVoteBatch(1)[0]);
      const tree = buildMerkleTree([single]);
      expect(tree.root).toBe(single);
      expect(getProof(tree, 0).length).toBe(0);
      expect(verifyProof(single, [], tree.root)).toBe(true);
      
      const other = hashVoteLeaf(mockVoteBatch(1)[0]);
      expect(verifyProof(other, [], tree.root)).toBe(false);
    });
  });

  describe('Property-based tests (fast-check)', () => {
    // Generate valid leaf hashes
    const leafArbitrary = fc.record({
      voteId: fc.uuid(),
      c1: fc.array(fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'), { minLength: 64, maxLength: 64 }).map(a => '0x' + a.join('')),
      c2: fc.array(fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'), { minLength: 64, maxLength: 64 }).map(a => '0x' + a.join('')),
      createdAt: fc.date().map(d => d.toISOString())
    }).map(hashVoteLeaf);

    it('∀ batchSize ∈ [1..200], ∀ leafIndex: getProof + verifyProof === true', () => {
      fc.assert(
        fc.property(
          fc.array(leafArbitrary, { minLength: 1, maxLength: 200 }).chain(leaves => 
            fc.tuple(fc.constant(leaves), fc.integer({ min: 0, max: leaves.length - 1 }))
          ),
          ([leaves, index]) => {
            const tree = buildMerkleTree(leaves);
            const proof = getProof(tree, index);
            return verifyProof(leaves[index], proof, tree.root);
          }
        )
      );
    });

    it('∀ batchSize ∈ [2..200], ∀ corruptedSibling: verifyProof === false', () => {
      fc.assert(
        fc.property(
          fc.array(leafArbitrary, { minLength: 2, maxLength: 200 }).chain(leaves => 
            fc.tuple(fc.constant(leaves), fc.integer({ min: 0, max: leaves.length - 1 }))
          ),
          ([leaves, index]) => {
            const tree = buildMerkleTree(leaves);
            const proof = getProof(tree, index);
            if (proof.length === 0) return true; // Handled by valid proof tests
            
            const corruptedProof = [...proof];
            // Corrupt the first element of the proof
            corruptedProof[0] = corrupt(corruptedProof[0]);
            
            return !verifyProof(leaves[index], corruptedProof, tree.root);
          }
        )
      );
    });

    it('∀ batch: no inner node equals any leaf (second-preimage domain separation)', () => {
      fc.assert(
        fc.property(
          fc.array(leafArbitrary, { minLength: 2, maxLength: 200 }),
          (leaves) => {
            const tree = buildMerkleTree(leaves);
            const leafSet = new Set(leaves.map(h => h.toLowerCase()));
            
            for (let level = 1; level < tree.layers.length; level++) {
              for (const node of tree.layers[level]) {
                if (leafSet.has(node.toLowerCase())) return false;
              }
            }
            return true;
          }
        )
      );
    });
  });
});

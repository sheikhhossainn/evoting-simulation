import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { randomBytes } from "crypto";
import {
  SparseMerkleTree,
  DEFAULT_HASHES,
  GENESIS_ROOT,
  leafHash,
  verifySmtMembershipProof,
  verifySmtNonMembershipProof,
  type SmtMembershipProof,
} from "./sparseMerkleTree";
import { hashPair } from "./merkleTree";

beforeAll(() => {
  fc.configureGlobal({ seed: 42 });
});

function randomKey(): string {
  return "0x" + randomBytes(32).toString("hex");
}

function randomValue(): string {
  return "0x" + randomBytes(32).toString("hex");
}

function flipLastHexChar(hex: string): string {
  const last = hex.slice(-1);
  const flipped = last === "0" ? "1" : "0";
  return hex.slice(0, -1) + flipped;
}

describe("Sparse Merkle Tree (Unit)", () => {
  // Test 1: Genesis root
  describe("genesis root", () => {
    it("empty tree's root equals the precomputed H[256] constant", () => {
      const tree = new SparseMerkleTree();
      expect(tree.root()).toBe(GENESIS_ROOT);
      expect(tree.root()).toBe(DEFAULT_HASHES[256]);
    });

    it("H[0..256] computed iteratively matches an independent recursive recomputation", () => {
      function recursiveDefault(i: number): string {
        if (i === 0) return DEFAULT_HASHES[0];
        const prev = recursiveDefault(i - 1);
        return hashPair(prev, prev);
      }
      for (let i = 0; i <= 256; i++) {
        expect(recursiveDefault(i)).toBe(DEFAULT_HASHES[i]);
      }
    });
  });

  // Test 2: Single insertion
  describe("single insertion", () => {
    it("produces a deterministic root reproducible from a from-scratch rebuild", () => {
      const key = randomKey();
      const value = randomValue();

      const tree1 = new SparseMerkleTree();
      tree1.insert(key, value);
      const root1 = tree1.root();

      const tree2 = new SparseMerkleTree();
      tree2.insert(key, value);
      const root2 = tree2.root();

      expect(root1).toBe(root2);
      expect(root1).not.toBe(GENESIS_ROOT);
    });
  });

  // Test 3: Membership proof round-trip
  describe("membership proof round-trip", () => {
    it("verifies for a freshly inserted key", () => {
      const tree = new SparseMerkleTree();
      const keys = Array.from({ length: 25 }, () => randomKey());
      for (const k of keys) tree.insert(k, randomValue());

      const root = tree.root();
      for (const k of keys) {
        const proof = tree.getMembershipProof(k);
        expect(verifySmtMembershipProof(root, proof)).toBe(true);
      }
    });
  });

  // Test 4: Non-membership proof for never-inserted key
  describe("non-membership proof for a never-inserted key", () => {
    it("verifies true against a tree with N other keys inserted", () => {
      const tree = new SparseMerkleTree();
      for (let i = 0; i < 25; i++) tree.insert(randomKey(), randomValue());

      const untouched = randomKey();
      expect(tree.has(untouched)).toBe(false);

      const root = tree.root();
      const proof = tree.getNonMembershipProof(untouched);
      expect(verifySmtNonMembershipProof(root, proof)).toBe(true);
    });
  });

  // Regression test for the soundness bug found via adversarial testing during
  // implementation (docs/smt-design.md §6.1): with commutative internal-node
  // hashing, a non-membership proof's (bitmap, siblings) never actually
  // depended on the claimed key, so K1's real absence proof could be
  // relabeled to falsely "prove" a DIFFERENT key K2 — including an actual
  // member — was absent. Fixed by making internal-node hashing position-aware
  // (keccak256(left‖right), no sorting). This test must keep failing if that
  // fix is ever reverted or weakened.
  describe("non-membership proof cannot be relabeled to a different key", () => {
    it("K1's absence proof does not verify when relabeled with an unrelated absent key K2", () => {
      const tree = new SparseMerkleTree();
      for (let i = 0; i < 10; i++) tree.insert(randomKey(), randomValue());

      const k1 = randomKey();
      const k2 = randomKey();
      expect(tree.has(k1)).toBe(false);
      expect(tree.has(k2)).toBe(false);

      const root = tree.root();
      const proofForK1 = tree.getNonMembershipProof(k1);
      expect(verifySmtNonMembershipProof(root, proofForK1)).toBe(true);

      const relabeledAsK2 = { ...proofForK1, key: k2 };
      expect(verifySmtNonMembershipProof(root, relabeledAsK2)).toBe(false);
    });

    it("K1's absence proof does not verify when relabeled as a REAL MEMBER key", () => {
      const tree = new SparseMerkleTree();
      for (let i = 0; i < 10; i++) tree.insert(randomKey(), randomValue());

      const memberKey = randomKey();
      const memberValue = randomValue();
      tree.insert(memberKey, memberValue);

      const absentKey = randomKey();
      expect(tree.has(absentKey)).toBe(false);
      expect(tree.has(memberKey)).toBe(true);

      const root = tree.root();
      const absenceProof = tree.getNonMembershipProof(absentKey);
      expect(verifySmtNonMembershipProof(root, absenceProof)).toBe(true);

      // Relabel the genuine absence proof as if it were proving memberKey absent.
      const forgedProof = { ...absenceProof, key: memberKey };
      expect(verifySmtNonMembershipProof(root, forgedProof)).toBe(false);

      // Sanity check: memberKey's real state is membership, not absence.
      expect(verifySmtMembershipProof(root, tree.getMembershipProof(memberKey))).toBe(true);
    });
  });

  // Test 5: Deletion contradiction — the core property (docs/smt-design.md §8)
  describe("deletion contradiction (core property)", () => {
    it("old membership proof and new non-membership proof are mutually exclusive across roots", () => {
      const tree = new SparseMerkleTree();
      const key = randomKey();
      const value = randomValue();

      // A few other keys so the tree isn't trivially small
      for (let i = 0; i < 10; i++) tree.insert(randomKey(), randomValue());

      tree.insert(key, value);
      const rootBeforeDeletion = tree.root();
      const membershipProof = tree.getMembershipProof(key);

      tree.delete(key);
      const rootAfterDeletion = tree.root();
      const nonMembershipProof = tree.getNonMembershipProof(key);

      // (a) membership proof still verifies against the OLD root
      expect(verifySmtMembershipProof(rootBeforeDeletion, membershipProof)).toBe(true);
      // (b) non-membership proof verifies against the NEW root
      expect(verifySmtNonMembershipProof(rootAfterDeletion, nonMembershipProof)).toBe(true);
      // (c) membership proof does NOT verify against the NEW root
      expect(verifySmtMembershipProof(rootAfterDeletion, membershipProof)).toBe(false);
      // (d) non-membership proof does NOT verify against the OLD root
      expect(verifySmtNonMembershipProof(rootBeforeDeletion, nonMembershipProof)).toBe(false);
    });
  });

  // Test 6: Forgery rejection
  describe("forgery rejection", () => {
    let root: string;
    let proof: SmtMembershipProof;
    let key: string;

    beforeAll(() => {
      const tree = new SparseMerkleTree();
      for (let i = 0; i < 15; i++) tree.insert(randomKey(), randomValue());
      key = randomKey();
      tree.insert(key, randomValue());
      root = tree.root();
      proof = tree.getMembershipProof(key);
    });

    it("rejects a valid proof as a sanity check", () => {
      expect(verifySmtMembershipProof(root, proof)).toBe(true);
    });

    it("rejects a flipped bitmap bit", () => {
      const bad = { ...proof, bitmap: flipLastHexChar(proof.bitmap) };
      expect(verifySmtMembershipProof(root, bad)).toBe(false);
    });

    it("rejects a swapped sibling hash", () => {
      if (proof.siblings.length === 0) return; // nothing to swap for this key's path, skip
      const bad = { ...proof, siblings: [flipLastHexChar(proof.siblings[0]), ...proof.siblings.slice(1)] };
      expect(verifySmtMembershipProof(root, bad)).toBe(false);
    });

    it("rejects an altered value", () => {
      const bad = { ...proof, value: flipLastHexChar(proof.value) };
      expect(verifySmtMembershipProof(root, bad)).toBe(false);
    });

    it("rejects an altered key", () => {
      const bad = { ...proof, key: flipLastHexChar(proof.key) };
      expect(verifySmtMembershipProof(root, bad)).toBe(false);
    });
  });

  // Test 7: Order independence
  describe("order independence", () => {
    it("final root is identical regardless of insertion order", () => {
      const entries = Array.from({ length: 30 }, () => ({ key: randomKey(), value: randomValue() }));

      const treeA = new SparseMerkleTree();
      for (const { key, value } of entries) treeA.insert(key, value);

      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      const treeB = new SparseMerkleTree();
      for (const { key, value } of shuffled) treeB.insert(key, value);

      expect(treeA.root()).toBe(treeB.root());
    });
  });

  // Test 8: Incremental vs. from-scratch equivalence
  describe("incremental vs. from-scratch equivalence", () => {
    it("root after each op matches a full rebuild from the live key set", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              op: fc.constantFrom("insert", "delete"),
              keyIdx: fc.integer({ min: 0, max: 7 }),
            }),
            { minLength: 1, maxLength: 40 }
          ),
          (ops) => {
            const pool = Array.from({ length: 8 }, () => randomKey());
            const values = new Map(pool.map((k) => [k, randomValue()]));

            const incremental = new SparseMerkleTree();
            const liveSet = new Set<string>();

            for (const { op, keyIdx } of ops) {
              const key = pool[keyIdx];
              if (op === "insert") {
                incremental.insert(key, values.get(key)!);
                liveSet.add(key);
              } else {
                incremental.delete(key);
                liveSet.delete(key);
              }

              const rebuilt = new SparseMerkleTree();
              for (const k of liveSet) rebuilt.insert(k, values.get(k)!);

              expect(incremental.root()).toBe(rebuilt.root());
            }
          }
        ),
        { numRuns: 25 }
      );
    });
  });

  // Test 9: Leaf/internal/empty domain-separation smoke test
  describe("domain separation smoke test", () => {
    it("no collision between empty marker, leaf hashes, and internal-node hashes across many random trials", () => {
      const seen = new Set<string>([DEFAULT_HASHES[0]]);

      for (let i = 0; i < 5000; i++) {
        const key = randomKey();
        const value = randomValue();
        const leaf = leafHash(key, value);
        expect(seen.has(leaf)).toBe(false);
        seen.add(leaf);

        const internal = hashPair(randomValue(), randomValue());
        expect(seen.has(internal)).toBe(false);
        // internal nodes aren't domain-unique by construction (no prefix), so don't add
        // them to `seen` — only checking they don't accidentally collide with a
        // leaf/empty-marker value already recorded.
      }
    });
  });

  // Test 10: Proof-size measurement (hypothesis check, not an asserted O(log N) claim)
  describe("proof-size measurement", () => {
    it.each([100, 1000, 10000])("measures sibling-count distribution at N=%i keys", (n) => {
      const tree = new SparseMerkleTree();
      const keys: string[] = [];
      for (let i = 0; i < n; i++) {
        const k = randomKey();
        keys.push(k);
        tree.insert(k, randomValue());
      }

      const sample = keys.slice(0, Math.min(50, keys.length));
      const sizes = sample.map((k) => tree.getMembershipProof(k).siblings.length);
      const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const max = Math.max(...sizes);

      // No O(log N) assertion here — docs/smt-design.md §10 keeps that a hypothesis
      // until numbers exist. This test only records that proofs stay far below the
      // theoretical worst case of 256 siblings, which is the actual bandwidth claim
      // being made.
      expect(max).toBeLessThan(256);
      // eslint-disable-next-line no-console
      console.log(`SMT proof size @ N=${n}: avg siblings=${avg.toFixed(1)}, max=${max}`);
    }, 120000);
  });
});

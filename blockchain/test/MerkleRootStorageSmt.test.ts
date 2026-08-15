/**
 * MerkleRootStorageSmt.test.ts — SMT (Sparse Merkle Tree) contract additions
 *
 * Covers docs/smt-design.md §13 tests 11-16 (contract-level). Imports the
 * SAME sparseMerkleTree.ts module the backend uses, exactly like
 * MerkleRootStorage.test.ts does for the dense tree — this is what proves
 * the on-chain and off-chain implementations cannot silently drift apart.
 *
 * These tests are purely local (Hardhat in-memory EVM) — no testnet, no
 * live Supabase.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Log, LogDescription } from "ethers";
import type { MerkleRootStorage } from "../typechain-types";
import {
  SparseMerkleTree,
  GENESIS_ROOT,
  verifySmtMembershipProof,
  verifySmtNonMembershipProof,
  type SmtMembershipProof,
  type SmtNonMembershipProof,
} from "../../backend/src/merkle/sparseMerkleTree";

const EID = "TEST-ELECTION";

function randomKey(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

function randomValue(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

function flipLastHexChar(hex: string): string {
  const last = hex.slice(-1);
  const flipped = last === "0" ? "1" : "0";
  return hex.slice(0, -1) + flipped;
}

/**
 * Flip the MOST-significant nibble (right after "0x"), i.e. bits 252-255 —
 * the levels nearest the tree root. Used instead of flipLastHexChar() for KEY
 * mutations specifically: for a sparse tree with few real keys, the lowest
 * bits (nearest the leaf) are almost always in an entirely-empty neighborhood
 * shared by many never-inserted keys, so a low-nibble key flip can coincide
 * with another key that's ALSO genuinely absent — a valid (non-forged) proof,
 * not a rejection case. High-order bits are virtually always inside the
 * tree's real branching region, so flipping there reliably changes the
 * verification outcome. (Value/bitmap/sibling mutations don't have this
 * issue — flipLastHexChar is still correct for those.)
 */
function flipHighNibble(hex: string): string {
  const c = hex[2];
  const flipped = c === "0" ? "1" : "0";
  return hex.slice(0, 2) + flipped + hex.slice(3);
}

async function deployContract() {
  const [owner, stranger] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("MerkleRootStorage");
  const contract = await factory.deploy(owner.address);
  await contract.waitForDeployment();
  return { owner, stranger, contract: contract as unknown as MerkleRootStorage };
}

describe("MerkleRootStorage — SMT additions", () => {
  // Test 11: Genesis anchor
  describe("genesis anchor", () => {
    it("EMPTY_TREE_ROOT constant matches the TS GENESIS_ROOT byte-for-byte", async () => {
      const { contract } = await deployContract();
      expect((await contract.EMPTY_TREE_ROOT()).toLowerCase()).to.equal(GENESIS_ROOT.toLowerCase());
    });

    it("first anchorSmtRoot requires previousRoot == EMPTY_TREE_ROOT", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      tree.insert(randomKey(), randomValue());
      const newRoot = tree.root();

      await expect(
        contract.anchorSmtRoot(EID, newRoot, ethers.ZeroHash, 1, 1)
      ).to.be.revertedWith("MerkleRootStorage: SMT chain continuity broken");

      const tx = await contract.anchorSmtRoot(EID, newRoot, GENESIS_ROOT, 1, 1);
      const receipt = await tx.wait();

      const event = receipt!.logs
        .map((log: Log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: LogDescription | null) => parsed?.name === "SmtBatchAnchored");
      expect(event).to.not.be.undefined;
      expect(event!.args.smtBatchId).to.equal(0n);
      expect(event!.args.smtRoot).to.equal(newRoot);

      expect(await contract.smtBatchCount(EID)).to.equal(1n);
    });

    it("rejects a zero SMT root", async () => {
      const { contract } = await deployContract();
      await expect(
        contract.anchorSmtRoot(EID, ethers.ZeroHash, GENESIS_ROOT, 1, 1)
      ).to.be.revertedWith("MerkleRootStorage: SMT root cannot be zero");
    });

    it("rejects anchoring from a non-owner account", async () => {
      const { contract, stranger } = await deployContract();
      const tree = new SparseMerkleTree();
      tree.insert(randomKey(), randomValue());
      await expect(
        (contract.connect(stranger) as MerkleRootStorage).anchorSmtRoot(
          EID,
          tree.root(),
          GENESIS_ROOT,
          1,
          1
        )
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("rejects a totalKeysAnchored that doesn't match previous + newKeysThisBatch", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      tree.insert(randomKey(), randomValue());
      await expect(
        contract.anchorSmtRoot(EID, tree.root(), GENESIS_ROOT, 1, 99)
      ).to.be.revertedWith("MerkleRootStorage: SMT totalKeysAnchored mismatch");
    });

    it("rejects an empty electionId", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      tree.insert(randomKey(), randomValue());
      await expect(
        contract.anchorSmtRoot("", tree.root(), GENESIS_ROOT, 1, 1)
      ).to.be.revertedWith("MerkleRootStorage: electionId cannot be empty");
    });
  });

  // Test 12: Chain continuity enforced
  describe("chain continuity", () => {
    it("a second anchor with any previousRoot other than the first batch's smtRoot reverts", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      tree.insert(randomKey(), randomValue());
      const root1 = tree.root();
      await (await contract.anchorSmtRoot(EID, root1, GENESIS_ROOT, 1, 1)).wait();

      tree.insert(randomKey(), randomValue());
      const root2 = tree.root();

      // Wrong previousRoot (using genesis again instead of root1)
      await expect(
        contract.anchorSmtRoot(EID, root2, GENESIS_ROOT, 1, 2)
      ).to.be.revertedWith("MerkleRootStorage: SMT chain continuity broken");

      // Correct previousRoot succeeds
      await (await contract.anchorSmtRoot(EID, root2, root1, 1, 2)).wait();
      expect(await contract.smtBatchCount(EID)).to.equal(2n);
    });

    it("accepts a re-anchor with newKeysThisBatch = 0 (e.g. after a detected deletion)", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      const key = randomKey();
      tree.insert(key, randomValue());
      const root1 = tree.root();
      await (await contract.anchorSmtRoot(EID, root1, GENESIS_ROOT, 1, 1)).wait();

      tree.delete(key);
      const root2 = tree.root();
      expect(root2).to.equal(GENESIS_ROOT); // only key deleted -> back to empty

      await (await contract.anchorSmtRoot(EID, root2, root1, 0, 1)).wait();
      expect(await contract.smtBatchCount(EID)).to.equal(2n);
      const batch = await contract.smtBatches(EID, 1);
      expect(batch.smtRoot).to.equal(root2);
      expect(batch.newKeysThisBatch).to.equal(0n);
      expect(batch.totalKeysAnchored).to.equal(1n); // unchanged — counts insertions, not current occupancy
    });
  });

  describe("membership / non-membership verification and forgery rejection", () => {
    // Shared fixture: anchor one SMT batch with N keys, keep the tree + root for reuse.
    async function anchoredTree(n: number) {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();
      const keys: string[] = [];
      for (let i = 0; i < n; i++) {
        const k = randomKey();
        keys.push(k);
        tree.insert(k, randomValue());
      }
      const root = tree.root();
      await (await contract.anchorSmtRoot(EID, root, GENESIS_ROOT, n, n)).wait();
      return { contract, tree, root, keys };
    }

    // Test 13: Membership verification on-chain
    it("verifySmtMembership accepts a valid off-chain-generated proof against an anchored root", async () => {
      const { contract, tree, root, keys } = await anchoredTree(20);

      for (const key of keys) {
        const proof = tree.getMembershipProof(key);
        expect(verifySmtMembershipProof(root, proof)).to.equal(true); // off-chain agrees
        expect(
          await contract.verifySmtMembership(root, proof.key, proof.value, proof.bitmap, proof.siblings)
        ).to.equal(true); // on-chain agrees
      }
    });

    // Test 14: Non-membership verification on-chain
    it("verifySmtNonMembership accepts a valid proof for an untouched key", async () => {
      const { contract, tree, root } = await anchoredTree(20);
      const untouched = randomKey();
      expect(tree.has(untouched)).to.equal(false);

      const proof = tree.getNonMembershipProof(untouched);
      expect(verifySmtNonMembershipProof(root, proof)).to.equal(true);
      expect(
        await contract.verifySmtNonMembership(root, proof.key, proof.bitmap, proof.siblings)
      ).to.equal(true);
    });

    // Test 15: On-chain forgery rejection (mirrors the off-chain "forgery rejection" unit test)
    it("rejects forged membership proofs on-chain: flipped bitmap, swapped sibling, altered value, altered key", async () => {
      const { contract, tree, root, keys } = await anchoredTree(15);
      const key = keys[0];
      const proof: SmtMembershipProof = tree.getMembershipProof(key);

      expect(
        await contract.verifySmtMembership(root, proof.key, proof.value, proof.bitmap, proof.siblings)
      ).to.equal(true);

      expect(
        await contract.verifySmtMembership(
          root,
          proof.key,
          proof.value,
          flipLastHexChar(proof.bitmap),
          proof.siblings
        )
      ).to.equal(false);

      if (proof.siblings.length > 0) {
        const badSiblings = [flipLastHexChar(proof.siblings[0]), ...proof.siblings.slice(1)];
        expect(
          await contract.verifySmtMembership(root, proof.key, proof.value, proof.bitmap, badSiblings)
        ).to.equal(false);
      }

      expect(
        await contract.verifySmtMembership(
          root,
          proof.key,
          flipLastHexChar(proof.value),
          proof.bitmap,
          proof.siblings
        )
      ).to.equal(false);

      expect(
        await contract.verifySmtMembership(
          root,
          flipLastHexChar(proof.key),
          proof.value,
          proof.bitmap,
          proof.siblings
        )
      ).to.equal(false);
    });

    it("rejects forged non-membership proofs on-chain", async () => {
      const { contract, tree, root } = await anchoredTree(15);
      const untouched = randomKey();
      const proof: SmtNonMembershipProof = tree.getNonMembershipProof(untouched);

      expect(
        await contract.verifySmtNonMembership(root, proof.key, proof.bitmap, proof.siblings)
      ).to.equal(true);

      expect(
        await contract.verifySmtNonMembership(root, proof.key, flipLastHexChar(proof.bitmap), proof.siblings)
      ).to.equal(false);

      expect(
        await contract.verifySmtNonMembership(root, flipHighNibble(proof.key), proof.bitmap, proof.siblings)
      ).to.equal(false);
    });

    // Regression test matching sparseMerkleTree.test.ts's "non-membership proof
    // cannot be relabeled to a different key" — on-chain side of the fix for
    // the soundness bug found during implementation (docs/smt-design.md §6.1).
    it("rejects an absence proof relabeled on-chain as a different, actually-present key", async () => {
      const { contract, tree, root, keys } = await anchoredTree(15);
      const memberKey = keys[0];
      const absentKey = randomKey();

      const absenceProof = tree.getNonMembershipProof(absentKey);
      expect(
        await contract.verifySmtNonMembership(root, absenceProof.key, absenceProof.bitmap, absenceProof.siblings)
      ).to.equal(true);

      // Relabel the genuine absence proof as if it proved memberKey absent.
      expect(
        await contract.verifySmtNonMembership(root, memberKey, absenceProof.bitmap, absenceProof.siblings)
      ).to.equal(false);

      // memberKey's real state is membership, unaffected.
      const membershipProof = tree.getMembershipProof(memberKey);
      expect(
        await contract.verifySmtMembership(
          root,
          membershipProof.key,
          membershipProof.value,
          membershipProof.bitmap,
          membershipProof.siblings
        )
      ).to.equal(true);
    });

    // Test 16: Historical-root check
    it("verifies a proof against a non-latest anchored root, with later batches already anchored", async () => {
      const { contract } = await deployContract();
      const tree = new SparseMerkleTree();

      const roots: string[] = [];
      const firstBatchKey = randomKey();
      tree.insert(firstBatchKey, randomValue());
      roots.push(tree.root());
      await (await contract.anchorSmtRoot(EID, roots[0], GENESIS_ROOT, 1, 1)).wait();

      // Capture the proof against the FIRST anchored root before more batches land.
      const historicalProof = tree.getMembershipProof(firstBatchKey);
      const historicalRoot = roots[0];

      // Anchor 4 more batches (batches 1..4), each adding a new key.
      let total = 1;
      for (let i = 0; i < 4; i++) {
        tree.insert(randomKey(), randomValue());
        const newRoot = tree.root();
        total += 1;
        await (await contract.anchorSmtRoot(EID, newRoot, roots[roots.length - 1], 1, total)).wait();
        roots.push(newRoot);
      }

      expect(await contract.smtBatchCount(EID)).to.equal(5n);

      // The proof captured against batch 0's root must STILL verify against
      // that historical root, even though 4 newer batches now exist —
      // verifySmtMembership takes root as a parameter, not the latest state.
      expect(
        await contract.verifySmtMembership(
          historicalRoot,
          historicalProof.key,
          historicalProof.value,
          historicalProof.bitmap,
          historicalProof.siblings
        )
      ).to.equal(true);

      // It must NOT verify against a root it doesn't belong to would need
      // re-deriving — sanity check against the wrong (later) root's own key still works:
      expect(
        await contract.verifySmtMembership(
          roots[roots.length - 1],
          historicalProof.key,
          historicalProof.value,
          historicalProof.bitmap,
          historicalProof.siblings
        )
      ).to.equal(false); // stale proof (old siblings) does not verify against a newer root
    });
  });

  // Test 20: Concurrent batch anchoring — two anchorSmtRoot calls racing
  // against the same previousRoot must serialize, not silently overwrite
  // (contract-level analogue of the DB-level concurrency test in
  // evaluation_writeup.md §4).
  describe("concurrent batch anchoring", () => {
    it("two anchorSmtRoot calls racing against the same previousRoot: exactly one succeeds", async () => {
      const { contract } = await deployContract();
      const treeA = new SparseMerkleTree();
      treeA.insert(randomKey(), randomValue());
      const rootA = treeA.root();

      const treeB = new SparseMerkleTree();
      treeB.insert(randomKey(), randomValue());
      const rootB = treeB.root();

      // Both submitted against the SAME previousRoot (GENESIS_ROOT) —
      // simulating two concurrent batch-anchor processes racing.
      const results = await Promise.allSettled([
        contract.anchorSmtRoot(EID, rootA, GENESIS_ROOT, 1, 1),
        contract.anchorSmtRoot(EID, rootB, GENESIS_ROOT, 1, 1),
      ]);

      // Both transactions may be *submitted* successfully (no revert at
      // submission time — reverts happen at mined-tx time), so wait() each
      // and see which one actually lands.
      const waited = await Promise.allSettled(
        results.map((r) => (r.status === "fulfilled" ? r.value.wait() : Promise.reject(r.reason)))
      );

      const succeeded = waited.filter((r) => r.status === "fulfilled");
      const failed = waited.filter((r) => r.status === "rejected");

      // Exactly one of the two racing anchors lands; the other must revert
      // with the continuity error once the first has been mined, because by
      // then its previousRoot no longer matches the (now-updated) chain tip.
      expect(succeeded.length).to.equal(1);
      expect(failed.length).to.equal(1);
      expect(String((failed[0] as PromiseRejectedResult).reason)).to.match(
        /SMT chain continuity broken/
      );

      // Exactly one batch was recorded — no silent overwrite, no double-anchor.
      expect(await contract.smtBatchCount(EID)).to.equal(1n);
      const landedRoot = (await contract.smtBatches(EID, 0)).smtRoot;
      expect([rootA, rootB]).to.include(landedRoot);
    });
  });

  // Multi-election isolation (threat_model.md §10) — the SMT-side regression
  // test paralleling MerkleRootStorage.test.ts's dense-tree version: two
  // elections' SMT chains on the same deployed contract must never share a
  // batch counter or a continuity chain.
  describe("multi-election isolation", () => {
    it("two elections' SMT chains are independent — separate genesis, separate counters", async () => {
      const { contract } = await deployContract();
      const treeA = new SparseMerkleTree();
      treeA.insert(randomKey(), randomValue());
      const rootA = treeA.root();

      const treeB = new SparseMerkleTree();
      treeB.insert(randomKey(), randomValue());
      treeB.insert(randomKey(), randomValue());
      const rootB = treeB.root();

      // Both elections independently start from EMPTY_TREE_ROOT — neither
      // needs to know about the other's chain tip.
      await (await contract.anchorSmtRoot("ELECTION-A", rootA, GENESIS_ROOT, 1, 1)).wait();
      await (await contract.anchorSmtRoot("ELECTION-B", rootB, GENESIS_ROOT, 2, 2)).wait();

      expect(await contract.smtBatchCount("ELECTION-A")).to.equal(1n);
      expect(await contract.smtBatchCount("ELECTION-B")).to.equal(1n);

      const batchA = await contract.smtBatches("ELECTION-A", 0);
      const batchB = await contract.smtBatches("ELECTION-B", 0);
      expect(batchA.smtRoot).to.equal(rootA);
      expect(batchA.totalKeysAnchored).to.equal(1n);
      expect(batchB.smtRoot).to.equal(rootB);
      expect(batchB.totalKeysAnchored).to.equal(2n);

      // Election B cannot extend election A's chain by claiming A's root as
      // its own previousRoot — continuity is checked per electionId.
      treeA.insert(randomKey(), randomValue());
      await expect(
        contract.anchorSmtRoot("ELECTION-B", treeA.root(), rootA, 1, 3)
      ).to.be.revertedWith("MerkleRootStorage: SMT chain continuity broken");
    });
  });
});

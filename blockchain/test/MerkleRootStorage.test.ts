/**
 * MerkleRootStorage.test.ts — anchoring with mock vote batches
 *
 * Runs entirely on Hardhat's in-memory network (no testnet funds needed).
 * Imports the SAME merkle module the backend uses for real batches
 * (backend/src/merkle/merkleTree.ts), so this test exercises the exact
 * off-chain root/proof computation that production anchoring will use —
 * not a re-implementation that could silently drift.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Log, LogDescription } from "ethers";
import type { MerkleRootStorage } from "../typechain-types";
import {
  buildMerkleTree,
  getProof,
  hashVoteLeaf,
  verifyProof,
  type VoteLeafInput,
} from "../../backend/src/merkle/merkleTree";

const EID = "TEST-ELECTION";

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

describe("MerkleRootStorage", () => {
  it("anchors a mock vote batch and verifies every vote's inclusion proof", async () => {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MerkleRootStorage");
    const contract = await factory.deploy(owner.address);
    await contract.waitForDeployment();

    const votes = mockVoteBatch(7); // odd count exercises the duplicate-node path
    const leaves = votes.map(hashVoteLeaf);
    const tree = buildMerkleTree(leaves);

    const tx = await contract.anchorRoot(EID, tree.root, votes.length);
    const receipt = await tx.wait();

    const event = receipt!.logs
      .map((log: Log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: LogDescription | null) => parsed?.name === "BatchAnchored");

    expect(event).to.not.be.undefined;
    expect(event!.args.batchId).to.equal(0n);
    expect(event!.args.root).to.equal(tree.root);
    expect(event!.args.voteCount).to.equal(BigInt(votes.length));

    const [storedRoot, storedCount] = await contract.getBatch(EID, 0);
    expect(storedRoot).to.equal(tree.root);
    expect(storedCount).to.equal(BigInt(votes.length));

    // Every vote in the batch must produce a valid off-chain AND on-chain proof
    for (let i = 0; i < leaves.length; i++) {
      const proof = getProof(tree, i);

      expect(verifyProof(leaves[i], proof, tree.root)).to.equal(true);
      expect(await contract.verify(EID, 0, leaves[i], proof)).to.equal(true);
    }

    // A vote that was never in the batch must fail verification
    const foreignLeaf = hashVoteLeaf({
      voteId: "not-in-batch",
      c1: "0x00",
      c2: "0x00",
      createdAt: new Date().toISOString(),
    });
    expect(await contract.verify(EID, 0, foreignLeaf, getProof(tree, 0))).to.equal(
      false
    );
  });

  it("anchors multiple sequential batches with independent batchIds", async () => {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MerkleRootStorage");
    const contract = await factory.deploy(owner.address);
    await contract.waitForDeployment();

    const batchA = mockVoteBatch(4);
    const treeA = buildMerkleTree(batchA.map(hashVoteLeaf));
    await (await contract.anchorRoot(EID, treeA.root, batchA.length)).wait();

    const batchB = mockVoteBatch(5);
    const treeB = buildMerkleTree(batchB.map(hashVoteLeaf));
    await (await contract.anchorRoot(EID, treeB.root, batchB.length)).wait();

    expect(await contract.batchCount(EID)).to.equal(2n);

    const [rootA] = await contract.getBatch(EID, 0);
    const [rootB] = await contract.getBatch(EID, 1);
    expect(rootA).to.equal(treeA.root);
    expect(rootB).to.equal(treeB.root);
    expect(rootA).to.not.equal(rootB);
  });

  it("rejects anchoring from a non-owner account", async () => {
    const [owner, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MerkleRootStorage");
    const contract = await factory.deploy(owner.address);
    await contract.waitForDeployment();

    const votes = mockVoteBatch(3);
    const tree = buildMerkleTree(votes.map(hashVoteLeaf));

    await expect(
      (contract.connect(stranger) as MerkleRootStorage).anchorRoot(
        EID,
        tree.root,
        votes.length
      )
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });

  it("rejects a zero root", async () => {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MerkleRootStorage");
    const contract = await factory.deploy(owner.address);
    await contract.waitForDeployment();

    await expect(contract.anchorRoot(EID, ethers.ZeroHash, 1)).to.be.revertedWith(
      "MerkleRootStorage: root cannot be zero"
    );
  });

  it("rejects an empty electionId", async () => {
    const [owner] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MerkleRootStorage");
    const contract = await factory.deploy(owner.address);
    await contract.waitForDeployment();

    await expect(contract.anchorRoot("", ethers.keccak256("0x01"), 1)).to.be.revertedWith(
      "MerkleRootStorage: electionId cannot be empty"
    );
  });

  // ── Multi-election isolation: two elections anchoring on the SAME deployed
  // contract must never share batch counters, roots, or proofs.
  // (threat_model.md §10 — this is the direct regression test for the gap
  // that section names as an explicit non-goal, now closed.) ──
  describe("multi-election isolation", () => {
    it("two elections' batchIds are independent counters, starting at 0 each", async () => {
      const [owner] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("MerkleRootStorage");
      const contract = await factory.deploy(owner.address);
      await contract.waitForDeployment();

      const treeA1 = buildMerkleTree(mockVoteBatch(3).map(hashVoteLeaf));
      const treeB1 = buildMerkleTree(mockVoteBatch(4).map(hashVoteLeaf));
      const treeA2 = buildMerkleTree(mockVoteBatch(5).map(hashVoteLeaf));

      await (await contract.anchorRoot("ELECTION-A", treeA1.root, 3)).wait();
      await (await contract.anchorRoot("ELECTION-B", treeB1.root, 4)).wait();
      await (await contract.anchorRoot("ELECTION-A", treeA2.root, 5)).wait();

      expect(await contract.batchCount("ELECTION-A")).to.equal(2n);
      expect(await contract.batchCount("ELECTION-B")).to.equal(1n);

      const [rootA0] = await contract.getBatch("ELECTION-A", 0);
      const [rootA1] = await contract.getBatch("ELECTION-A", 1);
      const [rootB0] = await contract.getBatch("ELECTION-B", 0);
      expect(rootA0).to.equal(treeA1.root);
      expect(rootA1).to.equal(treeA2.root);
      expect(rootB0).to.equal(treeB1.root);
    });

    it("a proof anchored under one electionId does not verify under another", async () => {
      const [owner] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("MerkleRootStorage");
      const contract = await factory.deploy(owner.address);
      await contract.waitForDeployment();

      const leavesA = mockVoteBatch(6).map(hashVoteLeaf);
      const treeA = buildMerkleTree(leavesA);
      await (await contract.anchorRoot("ELECTION-A", treeA.root, 6)).wait();

      // ELECTION-B never anchored anything — batchId 0 doesn't exist for it.
      const proof = getProof(treeA, 2);
      await expect(contract.verify("ELECTION-B", 0, leavesA[2], proof)).to.be.revertedWith(
        "MerkleRootStorage: unknown batchId"
      );

      // Even if ELECTION-B anchors its own batch 0, election A's proof must
      // not verify against it (different root entirely).
      const treeB = buildMerkleTree(mockVoteBatch(6).map(hashVoteLeaf));
      await (await contract.anchorRoot("ELECTION-B", treeB.root, 6)).wait();
      expect(await contract.verify("ELECTION-B", 0, leavesA[2], proof)).to.equal(false);
    });
  });

  // ── On-chain binding: the Solidity-stored root must equal the TS-computed
  // root, and OpenZeppelin's MerkleProof.verify (on-chain) must accept exactly
  // the proofs merkleTree.ts (off-chain) generates. This is what proves the
  // Hardhat contract and the backend module cannot silently drift apart. ──
  describe("on-chain / off-chain binding", () => {
    // 1 (single leaf), 2 (perfect), 3 (odd → duplicate-node path), 50 (odd
    // intermediate layers), 1000 (large, mixed parity through the layers).
    for (const size of [1, 2, 3, 50, 1000]) {
      it(`size ${size}: stored root == TS root and every leaf verifies on-chain`, async () => {
        const [owner] = await ethers.getSigners();
        const factory = await ethers.getContractFactory("MerkleRootStorage");
        const contract = await factory.deploy(owner.address);
        await contract.waitForDeployment();

        const votes = mockVoteBatch(size);
        const leaves = votes.map(hashVoteLeaf);
        const tree = buildMerkleTree(leaves);

        await (await contract.anchorRoot(EID, tree.root, size)).wait();

        // The root Solidity stored is byte-for-byte the TS-computed root.
        const [storedRoot] = await contract.getBatch(EID, 0);
        expect(storedRoot).to.equal(tree.root);

        // Every off-chain proof verifies against the on-chain OZ verifier.
        for (let i = 0; i < leaves.length; i++) {
          const proof = getProof(tree, i);
          expect(verifyProof(leaves[i], proof, tree.root)).to.equal(true);
          expect(await contract.verify(EID, 0, leaves[i], proof)).to.equal(true);
        }
      });
    }

    it("single-leaf batch: root == leaf and verifies on-chain with an empty proof", async () => {
      const [owner] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("MerkleRootStorage");
      const contract = await factory.deploy(owner.address);
      await contract.waitForDeployment();

      const leaf = hashVoteLeaf(mockVoteBatch(1)[0]);
      const tree = buildMerkleTree([leaf]);
      expect(tree.root).to.equal(leaf); // single-leaf root is the leaf itself

      await (await contract.anchorRoot(EID, tree.root, 1)).wait();
      const [storedRoot] = await contract.getBatch(EID, 0);
      expect(storedRoot).to.equal(leaf);
      // OZ MerkleProof.verify with an empty proof reduces to leaf == root.
      expect(await contract.verify(EID, 0, leaf, [])).to.equal(true);
    });
  });

  // ── Forged-proof rejection on-chain: the on-chain verifier must reject the
  // same forgeries the off-chain unit tests reject (flipped sibling, wrong
  // leaf index, proof from a different tree). ──
  describe("on-chain forged-proof rejection", () => {
    function corrupt(hash: string): string {
      const last = hash.slice(-1);
      const flipped = last === "0" ? "1" : "0";
      return hash.slice(0, -1) + flipped;
    }

    it("rejects flipped-sibling, wrong-index, and cross-tree proofs on-chain", async () => {
      const [owner] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("MerkleRootStorage");
      const contract = await factory.deploy(owner.address);
      await contract.waitForDeployment();

      const leaves = mockVoteBatch(50).map(hashVoteLeaf);
      const tree = buildMerkleTree(leaves);
      await (await contract.anchorRoot(EID, tree.root, 50)).wait();

      const target = 17;
      const validProof = getProof(tree, target);
      expect(await contract.verify(EID, 0, leaves[target], validProof)).to.equal(
        true
      );

      // Flipped sibling hash.
      const flipped = [...validProof];
      flipped[0] = corrupt(flipped[0]);
      expect(await contract.verify(EID, 0, leaves[target], flipped)).to.equal(false);

      // Valid proof, wrong leaf.
      expect(await contract.verify(EID, 0, leaves[4], validProof)).to.equal(false);

      // Proof from a different tree.
      const otherTree = buildMerkleTree(mockVoteBatch(50).map(hashVoteLeaf));
      expect(
        await contract.verify(EID, 0, leaves[target], getProof(otherTree, target))
      ).to.equal(false);
    });
  });
});

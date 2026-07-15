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

    const tx = await contract.anchorRoot(tree.root, votes.length);
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

    const [storedRoot, storedCount] = await contract.getBatch(0);
    expect(storedRoot).to.equal(tree.root);
    expect(storedCount).to.equal(BigInt(votes.length));

    // Every vote in the batch must produce a valid off-chain AND on-chain proof
    for (let i = 0; i < leaves.length; i++) {
      const proof = getProof(tree, i);

      expect(verifyProof(leaves[i], proof, tree.root)).to.equal(true);
      expect(await contract.verify(0, leaves[i], proof)).to.equal(true);
    }

    // A vote that was never in the batch must fail verification
    const foreignLeaf = hashVoteLeaf({
      voteId: "not-in-batch",
      c1: "0x00",
      c2: "0x00",
      createdAt: new Date().toISOString(),
    });
    expect(await contract.verify(0, foreignLeaf, getProof(tree, 0))).to.equal(
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
    await (await contract.anchorRoot(treeA.root, batchA.length)).wait();

    const batchB = mockVoteBatch(5);
    const treeB = buildMerkleTree(batchB.map(hashVoteLeaf));
    await (await contract.anchorRoot(treeB.root, batchB.length)).wait();

    expect(await contract.batchCount()).to.equal(2n);

    const [rootA] = await contract.getBatch(0);
    const [rootB] = await contract.getBatch(1);
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

    await expect(contract.anchorRoot(ethers.ZeroHash, 1)).to.be.revertedWith(
      "MerkleRootStorage: root cannot be zero"
    );
  });
});

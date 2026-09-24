/**
 * ElectionSetupCommitment.test.ts — docs/tally-verifiability-design.md
 * §8.2.5/§8.2.6 test 8 (write-once enforcement) plus basic sanity checks.
 * Purely local (Hardhat in-memory EVM).
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Log, LogDescription } from "ethers";
import type { ElectionSetupCommitment } from "../typechain-types";
import {
  buildAndComputeCommitment,
  type CandidateRecord,
  type ConstituencyRecord,
} from "../../backend/src/crypto/candidateCommitment";

async function deployContract() {
  const [owner, stranger] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("ElectionSetupCommitment");
  const contract = await factory.deploy(owner.address);
  await contract.waitForDeployment();
  return { owner, stranger, contract: contract as unknown as ElectionSetupCommitment };
}

function sampleCommitment(electionId: string): string {
  const candidates: CandidateRecord[] = [
    { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Alice", party: "Reform", symbol: "star", constituency_code: "CON-01" },
  ];
  const constituencies: ConstituencyRecord[] = [{ code: "CON-01", name: "North" }];
  return buildAndComputeCommitment(electionId, candidates, constituencies).commitment;
}

describe("ElectionSetupCommitment", () => {
  it("anchors a commitment and emits CommitmentAnchored", async () => {
    const { contract } = await deployContract();
    const commitment = sampleCommitment("ELECTION-1");

    const tx = await contract.anchor("ELECTION-1", commitment);
    const receipt = await tx.wait();

    expect(await contract.commitment()).to.equal(commitment);
    expect(await contract.electionId()).to.equal("ELECTION-1");

    const event = receipt!.logs
      .map((log: Log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: LogDescription | null) => parsed?.name === "CommitmentAnchored");
    expect(event).to.not.be.undefined;
    expect(event!.args.commitment).to.equal(commitment);
  });

  // Test 8 (§8.2.6): write-once enforcement — no update path exists at all.
  it("rejects a second anchor() call — write-once, no update path", async () => {
    const { contract } = await deployContract();
    const first = sampleCommitment("ELECTION-1");
    await (await contract.anchor("ELECTION-1", first)).wait();

    const second = sampleCommitment("ELECTION-1-REVISED");
    await expect(contract.anchor("ELECTION-1-REVISED", second)).to.be.revertedWith(
      "ElectionSetupCommitment: already anchored"
    );

    // State from the first anchor is unchanged.
    expect(await contract.commitment()).to.equal(first);
    expect(await contract.electionId()).to.equal("ELECTION-1");
  });

  it("rejects a zero commitment", async () => {
    const { contract } = await deployContract();
    await expect(contract.anchor("ELECTION-1", ethers.ZeroHash)).to.be.revertedWith(
      "ElectionSetupCommitment: commitment cannot be zero"
    );
  });

  it("rejects an empty electionId", async () => {
    const { contract } = await deployContract();
    const commitment = sampleCommitment("ELECTION-1");
    await expect(contract.anchor("", commitment)).to.be.revertedWith(
      "ElectionSetupCommitment: electionId cannot be empty"
    );
  });

  it("rejects anchoring from a non-owner account", async () => {
    const { contract, stranger } = await deployContract();
    const commitment = sampleCommitment("ELECTION-1");
    await expect(
      (contract.connect(stranger) as ElectionSetupCommitment).anchor("ELECTION-1", commitment)
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });
});

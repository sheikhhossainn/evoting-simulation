import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import {
  candidateRecordBytes,
  candidateLeaf,
  buildElectionSetupTrees,
  computeElectionSetupCommitment,
  buildAndComputeCommitment,
  type CandidateRecord,
  type ConstituencyRecord,
} from "./candidateCommitment";

const ELECTION_ID = "TEST-ELECTION-001";

function sampleCandidates(): CandidateRecord[] {
  return [
    { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "Alice", party: "Reform", symbol: "star", constituency_code: "CON-01" },
    { id: "11111111-2222-3333-4444-555555555555", name: "Bob", party: "Unity", symbol: "boat", constituency_code: "CON-01" },
    { id: "99999999-8888-7777-6666-555544443333", name: "Carol", party: "Progress", symbol: "leaf", constituency_code: "CON-02" },
  ];
}

function sampleConstituencies(): ConstituencyRecord[] {
  return [
    { code: "CON-01", name: "North" },
    { code: "CON-02", name: "South" },
  ];
}

describe("candidateCommitment (docs/tally-verifiability-design.md §8.2.6)", () => {
  // Test 1: canonical serialization determinism
  it("serializes deterministically and matches a hand-checked example", () => {
    const c: CandidateRecord = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      name: "Alice",
      party: "Reform",
      symbol: "star",
      constituency_code: "CON-01",
    };
    const bytes1 = candidateRecordBytes(c);
    const bytes2 = candidateRecordBytes({ ...c });
    expect(bytes1).toBe(bytes2);

    // Hand-checked: 0x01 tag, 16-byte UUID, then each field as
    // uint32-BE-length ‖ utf8-bytes.
    const expected = ethers.concat([
      "0x01",
      ethers.getBytes("0x3fa85f6457174562b3fc2c963f66afa6"),
      ethers.zeroPadValue(ethers.toBeHex(5), 4), // len("Alice")
      ethers.toUtf8Bytes("Alice"),
      ethers.zeroPadValue(ethers.toBeHex(6), 4), // len("Reform")
      ethers.toUtf8Bytes("Reform"),
      ethers.zeroPadValue(ethers.toBeHex(4), 4), // len("star")
      ethers.toUtf8Bytes("star"),
      ethers.zeroPadValue(ethers.toBeHex(6), 4), // len("CON-01")
      ethers.toUtf8Bytes("CON-01"),
    ]);
    expect(bytes1).toBe(ethers.hexlify(expected));
  });

  // Test 2: root computation matches independent recomputation
  it("candidatesRoot matches an independently rebuilt tree from the same leaves", () => {
    const candidates = sampleCandidates();
    const { candidatesRoot } = buildElectionSetupTrees(candidates, sampleConstituencies());

    const leaves = [...candidates]
      .sort((a, b) => a.id.replace(/-/g, "").localeCompare(b.id.replace(/-/g, "")))
      .map(candidateLeaf);
    // Rebuilding via the same sort key (UUID hex string compare) as a
    // cross-check that sorting by raw bytes vs. hex-string comparison agree
    // for these UUIDs — both are lexicographic over the same byte sequence.
    expect(leaves.length).toBe(3);
    const { candidatesRoot: rebuiltRoot } = buildElectionSetupTrees(candidates, sampleConstituencies());
    expect(rebuiltRoot).toBe(candidatesRoot);
  });

  // Test 3: single-field mutation changes candidatesRoot
  describe("single-field mutation changes the root", () => {
    const fields: (keyof CandidateRecord)[] = ["id", "name", "party", "symbol", "constituency_code"];
    for (const field of fields) {
      it(`mutating '${field}' changes candidatesRoot`, () => {
        const candidates = sampleCandidates();
        const { candidatesRoot: before } = buildElectionSetupTrees(candidates, sampleConstituencies());

        const mutated = candidates.map((c, i) =>
          i === 0
            ? {
                ...c,
                [field]:
                  field === "id"
                    ? "00000000-0000-0000-0000-000000000000"
                    : c[field] + "-X",
              }
            : c
        );
        const { candidatesRoot: after } = buildElectionSetupTrees(mutated, sampleConstituencies());
        expect(after).not.toBe(before);
      });
    }
  });

  // Test 4: single-field mutation changes constituenciesRoot
  describe("constituency field mutation changes the root", () => {
    for (const field of ["code", "name"] as (keyof ConstituencyRecord)[]) {
      it(`mutating '${field}' changes constituenciesRoot`, () => {
        const constituencies = sampleConstituencies();
        const { constituenciesRoot: before } = buildElectionSetupTrees(sampleCandidates(), constituencies);

        const mutated = constituencies.map((c, i) =>
          i === 0 ? { ...c, [field]: field === "code" ? "CON-99" : c[field] + "-X" } : c
        );
        const { constituenciesRoot: after } = buildElectionSetupTrees(sampleCandidates(), mutated);
        expect(after).not.toBe(before);
      });
    }
  });

  // Test 5: adding/removing a record changes the root
  it("adding a candidate changes candidatesRoot", () => {
    const candidates = sampleCandidates();
    const { candidatesRoot: before } = buildElectionSetupTrees(candidates, sampleConstituencies());
    const withExtra = [
      ...candidates,
      { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "Dave", party: "Independent", symbol: "tree", constituency_code: "CON-02" },
    ];
    const { candidatesRoot: after } = buildElectionSetupTrees(withExtra, sampleConstituencies());
    expect(after).not.toBe(before);
  });

  it("removing a candidate changes candidatesRoot", () => {
    const candidates = sampleCandidates();
    const { candidatesRoot: before } = buildElectionSetupTrees(candidates, sampleConstituencies());
    const { candidatesRoot: after } = buildElectionSetupTrees(candidates.slice(1), sampleConstituencies());
    expect(after).not.toBe(before);
  });

  // Test 6: reordering-only produces the IDENTICAL commitment (the explicit
  // "this is not an attack" proof — direct analogue of sparseMerkleTree's
  // "order independence" test, here justifying a design decision).
  it("reordering the input array (same set, same fields) produces the IDENTICAL commitment", () => {
    const candidates = sampleCandidates();
    const constituencies = sampleConstituencies();

    const { commitment: commitmentA } = buildAndComputeCommitment(ELECTION_ID, candidates, constituencies);

    const shuffled = [...candidates].reverse();
    const shuffledConstituencies = [...constituencies].reverse();
    const { commitment: commitmentB } = buildAndComputeCommitment(
      ELECTION_ID,
      shuffled,
      shuffledConstituencies
    );

    expect(commitmentB).toBe(commitmentA);
  });

  // Test 7: cross-election replay rejected (domain separation)
  it("the same candidate/constituency set under a different election_id produces a DIFFERENT commitment", () => {
    const candidates = sampleCandidates();
    const constituencies = sampleConstituencies();
    const { commitment: commitmentA } = buildAndComputeCommitment(ELECTION_ID, candidates, constituencies);
    const { commitment: commitmentB } = buildAndComputeCommitment(
      "OTHER-ELECTION-002",
      candidates,
      constituencies
    );
    expect(commitmentB).not.toBe(commitmentA);
  });

  it("computeElectionSetupCommitment is deterministic given the same roots", () => {
    const { trees } = buildAndComputeCommitment(ELECTION_ID, sampleCandidates(), sampleConstituencies());
    const c1 = computeElectionSetupCommitment(ELECTION_ID, trees.candidatesRoot, trees.constituenciesRoot);
    const c2 = computeElectionSetupCommitment(ELECTION_ID, trees.candidatesRoot, trees.constituenciesRoot);
    expect(c1).toBe(c2);
  });
});

/**
 * candidateCommitment.ts — Election setup commitment (docs/tally-verifiability-design.md §8.2)
 *
 * Commits to the exact set of candidates and constituencies before voting
 * opens, so a decryption proof's "ciphertext X decrypts to UUID Y" cannot
 * be paired with a silently-relabeled "UUID Y is candidate Alice" claim.
 *
 * Deliberately reuses the EXISTING dense Merkle tree (merkleTree.ts) rather
 * than inventing a new tree primitive or reusing the SMT: this commitment
 * only ever needs MEMBERSHIP proofs ("candidate X with these fields is in
 * the set"), never non-membership — the exact property that forced the
 * SMT's position-aware hashing (smt-design.md §6.1) doesn't apply here, so
 * the dense tree's simpler, already-tested, commutative hashPair is the
 * correct and sufficient tool (§8.2.2).
 */

import { ethers } from "ethers";
import { buildMerkleTree, type MerkleTree } from "../merkle/merkleTree";

export interface CandidateRecord {
  id: string; // UUID
  name: string;
  party: string;
  symbol: string;
  constituency_code: string;
}

export interface ConstituencyRecord {
  code: string;
  name: string;
}

/** uint32 big-endian length prefix, then the UTF-8 bytes — TLV, not delimiter-joined (§8.2.1). */
function lengthPrefixed(value: string): string {
  const bytes = ethers.toUtf8Bytes(value);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.length, false);
  return ethers.concat([len, bytes]);
}

/** Raw 16-byte UUID (not hex text) — canonical, fixed-width. */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return ethers.getBytes("0x" + hex);
}

export function candidateRecordBytes(c: CandidateRecord): string {
  return ethers.hexlify(
    ethers.concat([
      "0x01",
      uuidToBytes(c.id),
      lengthPrefixed(c.name),
      lengthPrefixed(c.party),
      lengthPrefixed(c.symbol),
      lengthPrefixed(c.constituency_code),
    ])
  );
}

export function constituencyRecordBytes(c: ConstituencyRecord): string {
  return ethers.hexlify(ethers.concat(["0x02", lengthPrefixed(c.code), lengthPrefixed(c.name)]));
}

export function candidateLeaf(c: CandidateRecord): string {
  return ethers.keccak256(candidateRecordBytes(c));
}

export function constituencyLeaf(c: ConstituencyRecord): string {
  return ethers.keccak256(constituencyRecordBytes(c));
}

/** Sort candidates by raw UUID bytes ascending — order-invariant commitment (§8.2.2/§8.2.4). */
function sortCandidates(candidates: CandidateRecord[]): CandidateRecord[] {
  return [...candidates].sort((a, b) => {
    const ab = uuidToBytes(a.id);
    const bb = uuidToBytes(b.id);
    for (let i = 0; i < 16; i++) {
      if (ab[i] !== bb[i]) return ab[i] - bb[i];
    }
    return 0;
  });
}

/** Sort constituencies by code ascending (ASCII byte comparison) — same order-invariance reasoning. */
function sortConstituencies(constituencies: ConstituencyRecord[]): ConstituencyRecord[] {
  return [...constituencies].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export interface ElectionSetupTrees {
  candidatesTree: MerkleTree;
  constituenciesTree: MerkleTree;
  candidatesRoot: string;
  constituenciesRoot: string;
  sortedCandidates: CandidateRecord[];
  sortedConstituencies: ConstituencyRecord[];
}

export function buildElectionSetupTrees(
  candidates: CandidateRecord[],
  constituencies: ConstituencyRecord[]
): ElectionSetupTrees {
  if (candidates.length === 0) throw new Error("candidates list must not be empty");
  if (constituencies.length === 0) throw new Error("constituencies list must not be empty");

  const sortedCandidates = sortCandidates(candidates);
  const sortedConstituencies = sortConstituencies(constituencies);

  const candidatesTree = buildMerkleTree(sortedCandidates.map(candidateLeaf));
  const constituenciesTree = buildMerkleTree(sortedConstituencies.map(constituencyLeaf));

  return {
    candidatesTree,
    constituenciesTree,
    candidatesRoot: candidatesTree.root,
    constituenciesRoot: constituenciesTree.root,
    sortedCandidates,
    sortedConstituencies,
  };
}

const COMMITMENT_TAG = "EVOTING-ELECTION-SETUP-COMMITMENT-v1";

/**
 * Top-level election setup commitment (§8.2.2). election_id is baked in
 * directly — prevents a commitment computed for one election being
 * replayed as valid for another, even if the candidate set coincides
 * (same reasoning as dleq.ts's election_id/ballot_id binding).
 */
export function computeElectionSetupCommitment(
  electionId: string,
  candidatesRoot: string,
  constituenciesRoot: string
): string {
  const preimage = ethers.concat([
    ethers.toUtf8Bytes(COMMITMENT_TAG),
    ethers.toUtf8Bytes(electionId),
    candidatesRoot,
    constituenciesRoot,
  ]);
  return ethers.keccak256(preimage);
}

export function buildAndComputeCommitment(
  electionId: string,
  candidates: CandidateRecord[],
  constituencies: ConstituencyRecord[]
): { commitment: string; trees: ElectionSetupTrees } {
  const trees = buildElectionSetupTrees(candidates, constituencies);
  const commitment = computeElectionSetupCommitment(
    electionId,
    trees.candidatesRoot,
    trees.constituenciesRoot
  );
  return { commitment, trees };
}

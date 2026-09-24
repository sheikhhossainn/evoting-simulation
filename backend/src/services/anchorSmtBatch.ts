/**
 * anchorSmtBatch.ts — SMT batch-anchoring logic (docs/smt-design.md §9/§12).
 *
 * Anchors the cumulative Sparse Merkle Tree over all confirmed votes'
 * nullifier_hash keys, called in lockstep with the dense-tree batch anchor
 * in anchorBatch.ts's runAnchorBatch(). Additive to the dense-tree flow —
 * does not replace it.
 *
 * Multi-election isolation (threat_model.md §10): every exported function
 * takes an explicit `electionId`. The cumulative SMT is kept as an
 * in-process cache, ONE PER ELECTION (a `Map<electionId, SparseMerkleTree>`,
 * not a single module-level tree) — two elections' nullifier sets must never
 * be mixed into the same tree, or a membership proof for election A's key
 * could accidentally verify as if it were election B's data. Each
 * per-election tree is lazily rebuilt from that election's confirmed votes
 * the first time it's needed, matching the existing single-instance-process
 * assumption (see anchorBatch.ts's `autoAnchorInFlight` comment) and also
 * serving as the backfill path (docs/smt-design.md §13 test 21): any vote
 * confirmed before the SMT feature existed is picked up by the same
 * from-DB rebuild, not left out.
 */

import { supabase } from "../supabaseClient";
import { hashVoteLeaf } from "../merkle/merkleTree";
import { SparseMerkleTree, GENESIS_ROOT } from "../merkle/sparseMerkleTree";
import { getWritableMerkleContract } from "../blockchain/merkleContract";

interface ConfirmedVoteRow {
  id: string;
  nullifier_hash: string;
  encrypted_vote: { c1: string; c2: string };
  created_at: string;
}

const cumulativeTrees = new Map<string, SparseMerkleTree>();
const cumulativeTreeKeyCounts = new Map<string, number>();

/**
 * Rebuild election `electionId`'s cumulative SMT from every confirmed,
 * tx_hash-anchored vote for THAT election. O(N * 256) — acceptable at this
 * simulation's scale (docs/smt-design.md §10 measured proof/rebuild costs up
 * to N=10,000; scalability-benchmark-results.md §2 measured up to N=50,000).
 * Only runs once per (process, electionId); subsequent calls reuse the
 * cached tree and insert incrementally.
 */
async function getCumulativeTree(electionId: string): Promise<SparseMerkleTree> {
  const cached = cumulativeTrees.get(electionId);
  if (cached) return cached;

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash, encrypted_vote, created_at")
    .eq("election_id", electionId)
    .not("tx_hash", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const tree = new SparseMerkleTree();
  for (const v of (votes ?? []) as ConfirmedVoteRow[]) {
    const leaf = hashVoteLeaf({
      voteId: v.id,
      c1: v.encrypted_vote.c1,
      c2: v.encrypted_vote.c2,
      createdAt: v.created_at,
    });
    tree.insert(v.nullifier_hash, leaf);
  }

  cumulativeTrees.set(electionId, tree);
  cumulativeTreeKeyCounts.set(electionId, tree.size());
  return tree;
}

/**
 * Insert votes already known to be new (just confirmed by the caller's own
 * dense-tree batch) into the cumulative tree, without re-querying the DB for
 * membership — the caller already knows these are new.
 */
function insertVotes(tree: SparseMerkleTree, votes: ConfirmedVoteRow[]): void {
  for (const v of votes) {
    const leaf = hashVoteLeaf({
      voteId: v.id,
      c1: v.encrypted_vote.c1,
      c2: v.encrypted_vote.c2,
      createdAt: v.created_at,
    });
    tree.insert(v.nullifier_hash, leaf);
  }
}

export interface AnchorSmtBatchResult {
  smt_batch_id: number;
  smt_root: string;
  previous_smt_root: string;
  new_keys_this_batch: number;
  total_keys_anchored: number;
  tx_hash: string;
}

/**
 * Submit `newRoot` as the next SMT batch for `electionId` (shared by the
 * normal insert-driven flow and the deletion-triggered re-anchor flow
 * below). `newKeysThisBatch` is the count of genuinely NEW insertions this
 * batch — it is 0 for a deletion-only re-anchor, per the contract's
 * documented semantics (MerkleRootStorage.sol's anchorSmtRoot comment):
 * `totalKeysAnchored` is a monotonic ledger of insertions ever made, not the
 * tree's current live key count, so a deletion does not decrement it even
 * though `newRoot` itself reflects the smaller set. Chain continuity
 * (`previousRoot`) is tracked PER ELECTION — one election's chain is never
 * extended using another election's previous root (mirrors
 * MerkleRootStorage.sol's per-electionId continuity check).
 */
async function submitSmtBatch(
  electionId: string,
  newRoot: string,
  newKeysThisBatch: number
): Promise<AnchorSmtBatchResult | null> {
  const contract = getWritableMerkleContract();
  if (!contract) return null;

  const { data: latestSmtBatch, error: latestErr } = await supabase
    .from("smt_batches")
    .select("smt_batch_id, smt_root, total_keys_anchored")
    .eq("election_id", electionId)
    .order("smt_batch_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) throw latestErr;

  const previousSmtRoot = latestSmtBatch ? latestSmtBatch.smt_root : GENESIS_ROOT;
  const previousTotal = latestSmtBatch ? latestSmtBatch.total_keys_anchored : 0;
  if (newRoot.toLowerCase() === previousSmtRoot.toLowerCase()) return null; // nothing changed
  const totalKeysAnchored = previousTotal + newKeysThisBatch;

  const tx = await contract.anchorSmtRoot(
    electionId,
    newRoot,
    previousSmtRoot,
    newKeysThisBatch,
    totalKeysAnchored
  );
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: any) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "SmtBatchAnchored");

  if (!event) {
    throw new Error(
      "Anchored SMT root on-chain but could not parse smtBatchId from the receipt"
    );
  }

  const smtBatchId = Number(event.args.smtBatchId);

  const { error: insertError } = await supabase.from("smt_batches").insert({
    election_id: electionId,
    smt_batch_id: smtBatchId,
    smt_root: newRoot,
    previous_smt_root: previousSmtRoot,
    new_keys_this_batch: newKeysThisBatch,
    total_keys_anchored: totalKeysAnchored,
    tx_hash: tx.hash,
  });

  if (insertError) {
    // Chain state is already committed — same "log loudly, don't roll back"
    // policy as runAnchorBatch's merkle_batches insert.
    console.error(
      "Supabase error inserting smt_batches row (chain anchor already committed!):",
      insertError
    );
  }

  return {
    smt_batch_id: smtBatchId,
    smt_root: newRoot,
    previous_smt_root: previousSmtRoot,
    new_keys_this_batch: newKeysThisBatch,
    total_keys_anchored: totalKeysAnchored,
    tx_hash: tx.hash,
  };
}

/**
 * Anchor election `electionId`'s SMT new cumulative root after `newVotes`
 * have been inserted. `newVotes` must be votes not already reflected in the
 * cumulative tree (the caller — runAnchorBatch — passes exactly the batch it
 * just anchored on the dense tree, for the SAME election). Returns null if
 * anchoring isn't configured or there's nothing new to anchor.
 */
export async function runAnchorSmtBatch(
  electionId: string,
  newVotes: ConfirmedVoteRow[]
): Promise<AnchorSmtBatchResult | null> {
  if (newVotes.length === 0) return null;
  const tree = await getCumulativeTree(electionId);
  insertVotes(tree, newVotes);
  cumulativeTreeKeyCounts.set(electionId, tree.size());
  return submitSmtBatch(electionId, tree.root(), newVotes.length);
}

/**
 * Re-anchor election `electionId`'s SMT root after a key was removed from
 * the underlying set (docs/smt-design.md §13 test 19: simulated deletion
 * detection) without any new insertions. Drops that election's in-process
 * cumulative tree cache and rebuilds it from the DB so the deleted vote's
 * row is no longer counted, then anchors the resulting (necessarily
 * different) root with `newKeysThisBatch = 0` — see submitSmtBatch's
 * comment on why `totalKeysAnchored` does not decrease even though the tree
 * shrank. Returns null if anchoring isn't configured or the root didn't
 * actually change (e.g. called with nothing to detect).
 */
export async function runSmtReanchorAfterDeletion(
  electionId: string
): Promise<AnchorSmtBatchResult | null> {
  invalidateCumulativeTreeCache(electionId);
  const tree = await getCumulativeTree(electionId);
  cumulativeTreeKeyCounts.set(electionId, tree.size());
  return submitSmtBatch(electionId, tree.root(), 0);
}

/**
 * Fetch a membership or non-membership proof for `nullifierHash` against
 * election `electionId`'s current in-process cumulative tree. Rebuilds/loads
 * the tree if this is the first call for this election in this process.
 * Does not anchor anything.
 */
export async function getSmtProof(
  electionId: string,
  nullifierHash: string
): Promise<
  | { type: "membership"; root: string; proof: ReturnType<SparseMerkleTree["getMembershipProof"]> }
  | { type: "non-membership"; root: string; proof: ReturnType<SparseMerkleTree["getNonMembershipProof"]> }
> {
  const tree = await getCumulativeTree(electionId);
  if (tree.has(nullifierHash)) {
    return { type: "membership", root: tree.root(), proof: tree.getMembershipProof(nullifierHash) };
  }
  return { type: "non-membership", root: tree.root(), proof: tree.getNonMembershipProof(nullifierHash) };
}

/**
 * Force the next getCumulativeTree()/getSmtProof() call for `electionId` to
 * rebuild from the DB from scratch. Omit `electionId` to invalidate every
 * cached election's tree at once (e.g. full test-suite teardown).
 */
export function invalidateCumulativeTreeCache(electionId?: string): void {
  if (electionId === undefined) {
    cumulativeTrees.clear();
    cumulativeTreeKeyCounts.clear();
    return;
  }
  cumulativeTrees.delete(electionId);
  cumulativeTreeKeyCounts.delete(electionId);
}

/**
 * Verify that every one of `nullifierHashes` is a member of election
 * `electionId`'s current cumulative SMT — i.e. that a specific dense batch's
 * ballots are actually covered by that election's anchored SMT commitment.
 *
 * Deliberately NOT a "does this dense batch_id have a matching smt_batches
 * row" join: smt_batches and merkle_batches are independent on-chain
 * counters with no FK between them, and a dense batch can legitimately add
 * ZERO new SMT keys (e.g. a backfill already covered its nullifiers before
 * the dense batch was anchored — this is exactly what happened for this
 * project's own batch_id=2). Membership-checking against the live tree is
 * the property that actually matters and is correct in both cases.
 */
export async function verifyBatchSmtCoverage(
  electionId: string,
  nullifierHashes: string[]
): Promise<{ allCovered: boolean; missing: string[]; smtRoot: string }> {
  const tree = await getCumulativeTree(electionId);
  const missing = nullifierHashes.filter((nh) => !tree.has(nh));
  return { allCovered: missing.length === 0, missing, smtRoot: tree.root() };
}

export function getCumulativeTreeKeyCount(electionId: string): number {
  return cumulativeTreeKeyCounts.get(electionId) ?? 0;
}

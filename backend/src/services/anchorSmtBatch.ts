/**
 * anchorSmtBatch.ts — SMT batch-anchoring logic (docs/smt-design.md §9/§12).
 *
 * Anchors the cumulative Sparse Merkle Tree over all confirmed votes'
 * nullifier_hash keys, called in lockstep with the dense-tree batch anchor
 * in anchorBatch.ts's runAnchorBatch(). Additive to the dense-tree flow —
 * does not replace it.
 *
 * The cumulative SMT is kept as an in-process singleton (module-level
 * state), lazily rebuilt from every confirmed vote with a tx_hash the first
 * time it's needed. This matches the existing anchorBatch.ts's single-
 * instance assumption (see its `autoAnchorInFlight` comment) and also
 * serves as the backfill path (docs/smt-design.md §13 test 21): any vote
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

let cumulativeTree: SparseMerkleTree | null = null;
let cumulativeTreeKeyCount = 0;

/**
 * Rebuild the cumulative SMT from every confirmed, tx_hash-anchored vote in
 * the DB. O(N * 256) — acceptable at this simulation's scale (docs/smt-design.md
 * §10 measured proof/rebuild costs up to N=10,000). Only runs once per process
 * lifetime; subsequent calls reuse the cached tree and insert incrementally.
 */
async function getCumulativeTree(): Promise<SparseMerkleTree> {
  if (cumulativeTree) return cumulativeTree;

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash, encrypted_vote, created_at")
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

  cumulativeTree = tree;
  cumulativeTreeKeyCount = tree.size();
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
 * Submit `newRoot` as the next SMT batch (shared by the normal insert-driven
 * flow and the deletion-triggered re-anchor flow below). `newKeysThisBatch`
 * is the count of genuinely NEW insertions this batch — it is 0 for a
 * deletion-only re-anchor, per the contract's documented semantics
 * (MerkleRootStorage.sol's anchorSmtRoot comment): `totalKeysAnchored` is a
 * monotonic ledger of insertions ever made, not the tree's current live key
 * count, so a deletion does not decrement it even though `newRoot` itself
 * reflects the smaller set.
 */
async function submitSmtBatch(
  newRoot: string,
  newKeysThisBatch: number
): Promise<AnchorSmtBatchResult | null> {
  const contract = getWritableMerkleContract();
  if (!contract) return null;

  const { data: latestSmtBatch, error: latestErr } = await supabase
    .from("smt_batches")
    .select("smt_batch_id, smt_root, total_keys_anchored")
    .order("smt_batch_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) throw latestErr;

  const previousSmtRoot = latestSmtBatch ? latestSmtBatch.smt_root : GENESIS_ROOT;
  const previousTotal = latestSmtBatch ? latestSmtBatch.total_keys_anchored : 0;
  if (newRoot.toLowerCase() === previousSmtRoot.toLowerCase()) return null; // nothing changed
  const totalKeysAnchored = previousTotal + newKeysThisBatch;

  const tx = await contract.anchorSmtRoot(
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
 * Anchor the SMT's new cumulative root after `newVotes` have been inserted.
 * `newVotes` must be votes not already reflected in the cumulative tree
 * (the caller — runAnchorBatch — passes exactly the batch it just anchored
 * on the dense tree). Returns null if anchoring isn't configured or there's
 * nothing new to anchor.
 */
export async function runAnchorSmtBatch(
  newVotes: ConfirmedVoteRow[]
): Promise<AnchorSmtBatchResult | null> {
  if (newVotes.length === 0) return null;
  const tree = await getCumulativeTree();
  insertVotes(tree, newVotes);
  cumulativeTreeKeyCount = tree.size();
  return submitSmtBatch(tree.root(), newVotes.length);
}

/**
 * Re-anchor the SMT root after a key was removed from the underlying set
 * (docs/smt-design.md §13 test 19: simulated deletion detection) without
 * any new insertions. Drops the in-process cumulative tree cache and
 * rebuilds it from the DB so the deleted vote's row is no longer counted,
 * then anchors the resulting (necessarily different) root with
 * `newKeysThisBatch = 0` — see submitSmtBatch's comment on why
 * `totalKeysAnchored` does not decrease even though the tree shrank.
 * Returns null if anchoring isn't configured or the root didn't actually
 * change (e.g. called with nothing to detect).
 */
export async function runSmtReanchorAfterDeletion(): Promise<AnchorSmtBatchResult | null> {
  invalidateCumulativeTreeCache();
  const tree = await getCumulativeTree();
  cumulativeTreeKeyCount = tree.size();
  return submitSmtBatch(tree.root(), 0);
}

/**
 * Fetch a membership or non-membership proof for `nullifierHash` against the
 * current in-process cumulative tree. Rebuilds/loads the tree if this is the
 * first call in this process. Does not anchor anything.
 */
export async function getSmtProof(nullifierHash: string): Promise<
  | { type: "membership"; root: string; proof: ReturnType<SparseMerkleTree["getMembershipProof"]> }
  | { type: "non-membership"; root: string; proof: ReturnType<SparseMerkleTree["getNonMembershipProof"]> }
> {
  const tree = await getCumulativeTree();
  if (tree.has(nullifierHash)) {
    return { type: "membership", root: tree.root(), proof: tree.getMembershipProof(nullifierHash) };
  }
  return { type: "non-membership", root: tree.root(), proof: tree.getNonMembershipProof(nullifierHash) };
}

/** Force the next getCumulativeTree()/getSmtProof() call to rebuild from the DB from scratch. */
export function invalidateCumulativeTreeCache(): void {
  cumulativeTree = null;
  cumulativeTreeKeyCount = 0;
}

/**
 * Verify that every one of `nullifierHashes` is a member of the current
 * cumulative SMT — i.e. that a specific dense batch's ballots are actually
 * covered by the anchored SMT commitment.
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
  nullifierHashes: string[]
): Promise<{ allCovered: boolean; missing: string[]; smtRoot: string }> {
  const tree = await getCumulativeTree();
  const missing = nullifierHashes.filter((nh) => !tree.has(nh));
  return { allCovered: missing.length === 0, missing, smtRoot: tree.root() };
}

export function getCumulativeTreeKeyCount(): number {
  return cumulativeTreeKeyCount;
}

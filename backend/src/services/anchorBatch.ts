/**
 * anchorBatch.ts — Core batch-anchoring logic
 *
 * Shared by the manual admin route (POST /anchor/batch in
 * routes/anchor.ts) and the automatic every-50-votes trigger called
 * from routes/vote.ts after each successful vote. Kept here, not in
 * routes/anchor.ts, so vote.ts doesn't have to import another route
 * file to reuse it.
 */

import { supabase } from "../supabaseClient";
import { buildMerkleTree, hashVoteLeaf } from "../merkle/merkleTree";
import { getWritableMerkleContract } from "../blockchain/merkleContract";
import { runAnchorSmtBatch, type AnchorSmtBatchResult } from "./anchorSmtBatch";

/** Auto-anchor triggers once this many votes are waiting, unanchored. */
export const AUTO_ANCHOR_THRESHOLD = 50;

/**
 * Auto-anchor also triggers once the OLDEST unanchored vote has been
 * waiting this long, regardless of count (methodology-audit finding M3).
 * Without this, the pre-anchor integrity window (threat_model.md §6) is
 * unbounded during low turnout: maybeAutoAnchor() only ever runs
 * fire-and-forget after a vote is cast, and only fires on count — a
 * trickle of votes that never reaches AUTO_ANCHOR_THRESHOLD could sit
 * unanchored indefinitely. Configurable via AUTO_ANCHOR_MAX_AGE_MS for
 * testing; defaults to 30 minutes.
 */
export const AUTO_ANCHOR_MAX_AGE_MS = process.env.AUTO_ANCHOR_MAX_AGE_MS
  ? Number(process.env.AUTO_ANCHOR_MAX_AGE_MS)
  : 30 * 60 * 1000;

interface VoteRow {
  id: string;
  nullifier_hash: string;
  encrypted_vote: { c1: string; c2: string };
  created_at: string;
}

export interface AnchorBatchResult {
  batch_id: number;
  root: string;
  tx_hash: string;
  vote_count: number;
  smt: AnchorSmtBatchResult | null;
}

/**
 * Anchor all currently-unanchored votes (tx_hash IS NULL) as one batch.
 * Returns null if anchoring isn't configured or there's nothing to
 * anchor — both are normal, expected states for the auto-trigger to see
 * on most vote casts, not errors.
 */
export async function runAnchorBatch(): Promise<AnchorBatchResult | null> {
  const contract = getWritableMerkleContract();
  if (!contract) return null;

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash, encrypted_vote, created_at")
    .is("tx_hash", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!votes || votes.length === 0) return null;

  const voteRows = votes as VoteRow[];
  const voteIds = voteRows.map((v) => v.id);
  const leaves = voteRows.map((v) =>
    hashVoteLeaf({
      voteId: v.id,
      c1: v.encrypted_vote.c1,
      c2: v.encrypted_vote.c2,
      createdAt: v.created_at,
    })
  );
  const tree = buildMerkleTree(leaves);

  const tx = await contract.anchorRoot(tree.root, voteRows.length);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: any) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "BatchAnchored");

  if (!event) {
    throw new Error(
      "Anchored on-chain but could not parse batchId from the receipt"
    );
  }

  const batchId = Number(event.args.batchId);

  const { error: batchInsertError } = await supabase
    .from("merkle_batches")
    .insert({
      batch_id: batchId,
      root: tree.root,
      tx_hash: tx.hash,
      vote_ids: voteIds,
      vote_count: voteRows.length,
    });

  if (batchInsertError) {
    // The anchor tx already landed on-chain; log loudly but don't
    // pretend to roll it back — chain state is the source of truth.
    console.error(
      "Supabase error inserting merkle_batches row (chain anchor already committed!):",
      batchInsertError
    );
  }

  const { error: updateError } = await supabase
    .from("votes")
    .update({ tx_hash: tx.hash, status: "confirmed" })
    .in("id", voteIds);

  if (updateError) {
    console.error("Supabase error updating anchored votes:", updateError);
  }

  // Anchor the SMT alongside the dense tree (docs/smt-design.md §9: "Both
  // trees are anchored together at each batch"). A failure here is logged,
  // not thrown — the dense-tree anchor above already committed on-chain and
  // must not be rolled back; the SMT simply falls behind until the next
  // batch, same "log loudly, chain state is source of truth" policy used
  // throughout this file.
  let smtResult: AnchorSmtBatchResult | null = null;
  try {
    smtResult = await runAnchorSmtBatch(voteRows);
  } catch (err) {
    console.error("SMT batch anchor failed (dense-tree anchor already committed!):", err);
  }

  return {
    batch_id: batchId,
    root: tree.root,
    tx_hash: tx.hash,
    vote_count: voteRows.length,
    smt: smtResult,
  };
}

// Simple in-process guard against overlapping auto-anchor runs. This is a
// single-instance Express app; if this ever scales horizontally, replace
// with a DB-level advisory lock instead.
let autoAnchorInFlight = false;

/**
 * Check whether unanchored votes have crossed AUTO_ANCHOR_THRESHOLD, OR the
 * oldest unanchored vote has aged past AUTO_ANCHOR_MAX_AGE_MS, and if so,
 * kick off a batch anchor. Called fire-and-forget after each vote is cast —
 * never throws, never blocks/delays the voter's response. Also called
 * periodically by index.ts's timer so the age-based trigger still fires
 * even when no new vote comes in to invoke this function at all.
 */
export async function maybeAutoAnchor(): Promise<void> {
  if (autoAnchorInFlight) return;

  try {
    const { count, error } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .is("tx_hash", null);

    if (error || !count) return;

    let reason: string | null = null;
    if (count >= AUTO_ANCHOR_THRESHOLD) {
      reason = `${count} unanchored votes >= ${AUTO_ANCHOR_THRESHOLD}`;
    } else {
      const { data: oldest, error: oldestErr } = await supabase
        .from("votes")
        .select("created_at")
        .is("tx_hash", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!oldestErr && oldest) {
        const ageMs = Date.now() - new Date(oldest.created_at).getTime();
        if (ageMs >= AUTO_ANCHOR_MAX_AGE_MS) {
          reason = `oldest unanchored vote is ${Math.round(ageMs / 1000)}s old (>= ${AUTO_ANCHOR_MAX_AGE_MS / 1000}s threshold), only ${count} votes waiting`;
        }
      }
    }

    if (!reason) return;

    autoAnchorInFlight = true;
    console.log(`Auto-anchor: ${reason}, anchoring batch...`);

    const result = await runAnchorBatch();

    if (result) {
      console.log(
        `Auto-anchor: batch ${result.batch_id} anchored (tx ${result.tx_hash}, ${result.vote_count} votes)`
      );
    }
  } catch (err) {
    console.error("Auto-anchor failed:", err);
  } finally {
    autoAnchorInFlight = false;
  }
}

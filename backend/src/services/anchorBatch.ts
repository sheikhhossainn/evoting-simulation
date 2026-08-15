/**
 * anchorBatch.ts — Core batch-anchoring logic
 *
 * Shared by the manual admin route (POST /anchor/batch in
 * routes/anchor.ts) and the periodic auto-anchor sweep (maybeAutoAnchor(),
 * called from index.ts's timer). Kept here, not in routes/anchor.ts, so
 * other callers don't have to import a route file to reuse it.
 *
 * Multi-election isolation (threat_model.md §10): `runAnchorBatch` takes an
 * explicit `electionId` and only ever touches that election's unanchored
 * votes/batches. `maybeAutoAnchor` has no single "the election" to check
 * anymore — it enumerates every election with at least one unanchored vote
 * and evaluates the threshold/age trigger independently per election, so
 * one election's vote volume can never mask or delay another's anchor.
 */

import { supabase } from "../supabaseClient";
import { buildMerkleTree, hashVoteLeaf } from "../merkle/merkleTree";
import { getWritableMerkleContract } from "../blockchain/merkleContract";
import { runAnchorSmtBatch, type AnchorSmtBatchResult } from "./anchorSmtBatch";

/** Auto-anchor triggers once this many votes are waiting, unanchored (per election). */
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
 * Anchor all of `electionId`'s currently-unanchored votes (tx_hash IS NULL)
 * as one batch. Returns null if anchoring isn't configured or there's
 * nothing to anchor — both are normal, expected states for the auto-trigger
 * to see on most vote casts, not errors.
 */
export async function runAnchorBatch(electionId: string): Promise<AnchorBatchResult | null> {
  const contract = getWritableMerkleContract();
  if (!contract) return null;

  const { data: votes, error } = await supabase
    .from("votes")
    .select("id, nullifier_hash, encrypted_vote, created_at")
    .eq("election_id", electionId)
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

  const tx = await contract.anchorRoot(electionId, tree.root, voteRows.length);
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
      election_id: electionId,
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
    smtResult = await runAnchorSmtBatch(electionId, voteRows);
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

// Simple in-process guard against overlapping auto-anchor runs, PER
// ELECTION — a single-instance Express app; if this ever scales
// horizontally, replace with a DB-level advisory lock instead.
const autoAnchorInFlight = new Set<string>();

/**
 * Check every election with at least one unanchored vote: has it crossed
 * AUTO_ANCHOR_THRESHOLD, OR has its oldest unanchored vote aged past
 * AUTO_ANCHOR_MAX_AGE_MS — and if so, kick off that election's batch anchor.
 * Called fire-and-forget (never throws, never blocks/delays a caller) by
 * index.ts's periodic timer, so the age-based trigger fires even when no new
 * vote comes in for a given election to prompt a check.
 */
export async function maybeAutoAnchor(): Promise<void> {
  try {
    const { data: unanchored, error } = await supabase
      .from("votes")
      .select("election_id")
      .is("tx_hash", null);

    if (error || !unanchored || unanchored.length === 0) return;

    const electionIds = [...new Set(unanchored.map((v) => v.election_id as string))];

    for (const electionId of electionIds) {
      await maybeAutoAnchorElection(electionId);
    }
  } catch (err) {
    console.error("Auto-anchor sweep failed:", err);
  }
}

async function maybeAutoAnchorElection(electionId: string): Promise<void> {
  if (autoAnchorInFlight.has(electionId)) return;

  try {
    const { count, error } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("election_id", electionId)
      .is("tx_hash", null);

    if (error || !count) return;

    let reason: string | null = null;
    if (count >= AUTO_ANCHOR_THRESHOLD) {
      reason = `${count} unanchored votes >= ${AUTO_ANCHOR_THRESHOLD}`;
    } else {
      const { data: oldest, error: oldestErr } = await supabase
        .from("votes")
        .select("created_at")
        .eq("election_id", electionId)
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

    autoAnchorInFlight.add(electionId);
    console.log(`Auto-anchor: [${electionId}] ${reason}, anchoring batch...`);

    const result = await runAnchorBatch(electionId);

    if (result) {
      console.log(
        `Auto-anchor: [${electionId}] batch ${result.batch_id} anchored (tx ${result.tx_hash}, ${result.vote_count} votes)`
      );
    }
  } catch (err) {
    console.error(`Auto-anchor failed for election ${electionId}:`, err);
  } finally {
    autoAnchorInFlight.delete(electionId);
  }
}

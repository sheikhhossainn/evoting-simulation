/**
 * anchor.ts — Merkle batch anchoring for confirmed votes
 *
 * POST /anchor/batch          — (admin) build a Merkle tree from unanchored
 *                                votes and anchor the root on Ethereum Sepolia
 * GET  /anchor/verify/:id     — (public) regenerate and verify a single
 *                                vote's Merkle inclusion proof, both locally
 *                                and against the on-chain contract
 * GET  /anchor/latest         — (public) latest anchored batch + a sample
 *                                vote id, for the tamper-proof visualizer
 * POST /anchor/tamper/root    — (admin) flip one nibble of a batch's stored
 *                                root, so verify returns 409 (demo vector 1)
 * POST /anchor/restore/root   — (admin) recompute the true root from the
 *                                batch's votes and write it back (repeatable)
 * POST /anchor/tamper/ballot  — (admin) attempt an encrypted_vote edit and
 *                                report that the DB trigger blocks it (vector 2)
 *
 * The three tamper/restore routes back the live "watch tamper get caught"
 * demo (docs/tamper-proof-demo.md, backend/src/scripts/tamper-test.ts). They
 * operate on seeded/mock data only. Restore is stateless — it recomputes the
 * correct root rather than remembering the old one — so the demo can never get
 * stuck in a tampered state and is safe to repeat mid-meeting.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";
import { requireAdminSecret } from "../middleware/adminAuth";
import { buildMerkleTree, getProof, hashVoteLeaf, verifyProof } from "../merkle/merkleTree";
import {
  getReadOnlyMerkleContract,
  getWritableMerkleContract,
} from "../blockchain/merkleContract";
import { runAnchorBatch } from "../services/anchorBatch";

const router = Router();

interface VoteRow {
  id: string;
  encrypted_vote: { c1: string; c2: string };
  created_at: string;
}

/**
 * Recompute the Merkle root for a batch straight from its votes, in the
 * exact leaf order the tree was originally built with. This is the source
 * of truth for what the anchored root *should* be — used by /anchor/restore/root
 * so the demo never depends on remembering the pre-tamper value.
 */
async function recomputeBatchRoot(voteIds: string[]): Promise<string> {
  const { data: batchVotes, error } = await supabase
    .from("votes")
    .select("id, encrypted_vote, created_at")
    .in("id", voteIds);

  if (error || !batchVotes) {
    throw new Error("Could not load batch votes to recompute root");
  }

  // .in() does not preserve order — restore the original leaf ordering.
  const byId = new Map((batchVotes as VoteRow[]).map((v) => [v.id, v]));
  const ordered = voteIds.map((id) => byId.get(id));
  if (ordered.some((v) => !v)) {
    throw new Error("Batch vote set is incomplete — cannot recompute root");
  }

  const leaves = (ordered as VoteRow[]).map((v) =>
    hashVoteLeaf({
      voteId: v.id,
      c1: v.encrypted_vote.c1,
      c2: v.encrypted_vote.c2,
      createdAt: v.created_at,
    })
  );
  return buildMerkleTree(leaves).root;
}

/** Flip the last hex nibble so the value stays valid hex but differs. */
function flipLastNibble(hash: string): string {
  const chars = hash.split("");
  const i = hash.length - 1;
  chars[i] = chars[i] === "0" ? "1" : "0";
  return chars.join("");
}

/**
 * Resolve which batch a tamper/restore action targets. If the caller passes
 * an explicit batch_id, use it; otherwise default to the latest anchored
 * batch (what the visualizer's auto-target mode relies on). Writes a 404 and
 * returns null when there is nothing to act on.
 */
async function resolveBatchId(
  requested: unknown,
  res: Response
): Promise<number | null> {
  if (typeof requested === "number" && Number.isFinite(requested)) {
    return requested;
  }

  const { data: latest, error } = await supabase
    .from("merkle_batches")
    .select("batch_id")
    .order("batch_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !latest) {
    res.status(404).json({ error: "No anchored batch to target" });
    return null;
  }
  return latest.batch_id;
}

router.post(
  "/anchor/batch",
  requireAdminSecret,
  async (_req: Request, res: Response) => {
    try {
      if (!getWritableMerkleContract()) {
        res.status(503).json({
          error:
            "Blockchain anchoring not configured. Set AMOY_RPC_URL, MERKLE_CONTRACT_ADDRESS, and ANCHOR_PRIVATE_KEY in backend/.env.",
        });
        return;
      }

      const result = await runAnchorBatch();

      if (!result) {
        res.status(400).json({ error: "No unanchored votes to batch" });
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      console.error("Unexpected error in POST /anchor/batch:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/anchor/verify/:voteId", async (req: Request, res: Response) => {
  const voteId = String(req.params.voteId);

  try {
    // vote_ids is a JSONB column. supabase-js's .contains() serializes a JS
    // array into Postgres array-literal syntax ({...}), which Postgres then
    // fails to parse as JSON (the UUID's first hyphen trips the JSON lexer).
    // Pass a JSON string so the containment check runs as jsonb @> jsonb.
    const { data: batch, error: batchError } = await supabase
      .from("merkle_batches")
      .select("batch_id, root, tx_hash, vote_ids")
      .contains("vote_ids", JSON.stringify([voteId]))
      .maybeSingle();

    if (batchError) {
      console.error("Supabase error looking up batch for vote:", batchError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!batch) {
      res.status(404).json({ error: "Vote not found in any anchored batch yet" });
      return;
    }

    const voteIds: string[] = batch.vote_ids;
    const index = voteIds.indexOf(voteId);

    const { data: batchVotes, error: votesError } = await supabase
      .from("votes")
      .select("id, encrypted_vote, created_at")
      .in("id", voteIds);

    if (votesError || !batchVotes) {
      console.error("Supabase error fetching batch votes:", votesError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // .in() does not preserve order — restore the original leaf ordering
    // the tree was built with.
    const byId = new Map((batchVotes as VoteRow[]).map((v) => [v.id, v]));
    const orderedVotes = voteIds.map((id) => byId.get(id));
    if (orderedVotes.some((v) => !v)) {
      res.status(500).json({
        error: "Batch vote set is incomplete — cannot regenerate proof",
      });
      return;
    }

    const leaves = (orderedVotes as VoteRow[]).map((v) =>
      hashVoteLeaf({
        voteId: v.id,
        c1: v.encrypted_vote.c1,
        c2: v.encrypted_vote.c2,
        createdAt: v.created_at,
      })
    );
    const tree = buildMerkleTree(leaves);

    if (tree.root.toLowerCase() !== batch.root.toLowerCase()) {
      // The votes we just recomputed from no longer match what was
      // anchored on-chain — the immutability guard should prevent this,
      // but surface it loudly rather than returning a false proof.
      res.status(409).json({
        error:
          "Recomputed root does not match the anchored root — possible data tampering",
      });
      return;
    }

    const leaf = leaves[index];
    const proof = getProof(tree, index);
    const includedLocally = verifyProof(leaf, proof, tree.root);

    let includedOnChain: boolean | null = null;
    const readContract = getReadOnlyMerkleContract();
    if (readContract) {
      try {
        includedOnChain = await readContract.verify(batch.batch_id, leaf, proof);
      } catch (err) {
        console.error("On-chain verify() call failed:", err);
      }
    }

    res.json({
      vote_id: voteId,
      batch_id: batch.batch_id,
      tx_hash: batch.tx_hash,
      root: batch.root,
      proof,
      included_locally: includedLocally,
      included_on_chain: includedOnChain,
    });
  } catch (err) {
    console.error("Unexpected error in GET /anchor/verify:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /anchor/latest — latest anchored batch + a sample vote id.
 *
 * Public, read-only. Backs the visualizer's "Anchor status" zone and gives
 * the tamper console a batch to auto-target without the operator hunting for
 * ids. Returns 404 when nothing is anchored yet.
 */
router.get("/anchor/latest", async (_req: Request, res: Response) => {
  try {
    const { data: batch, error } = await supabase
      .from("merkle_batches")
      .select("batch_id, root, tx_hash, vote_ids, vote_count, created_at")
      .order("batch_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase error loading latest batch:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    if (!batch) {
      res.status(404).json({ error: "No anchored batch yet" });
      return;
    }

    const voteIds: string[] = batch.vote_ids;
    res.json({
      batch_id: batch.batch_id,
      root: batch.root,
      tx_hash: batch.tx_hash,
      vote_count: batch.vote_count,
      created_at: batch.created_at,
      sample_vote_id: voteIds[0] ?? null,
    });
  } catch (err) {
    console.error("Unexpected error in GET /anchor/latest:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /anchor/tamper/root — demo vector 1.
 *
 * Flips one nibble of a batch's stored root (defaults to the latest batch).
 * merkle_batches.root has no immutability trigger, so this edit SUCCEEDS at
 * the DB layer — which is the point: afterwards GET /anchor/verify/:id
 * returns 409 because the recomputed root no longer matches the stored one.
 * Seeded/mock data only.
 */
router.post(
  "/anchor/tamper/root",
  requireAdminSecret,
  async (req: Request, res: Response) => {
    try {
      const batchId = await resolveBatchId(req.body?.batch_id, res);
      if (batchId === null) return;

      const { data: batch, error } = await supabase
        .from("merkle_batches")
        .select("batch_id, root")
        .eq("batch_id", batchId)
        .maybeSingle();

      if (error || !batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      const tamperedRoot = flipLastNibble(batch.root);
      const { error: updErr } = await supabase
        .from("merkle_batches")
        .update({ root: tamperedRoot })
        .eq("batch_id", batchId);

      if (updErr) {
        console.error("Supabase error tampering root:", updErr);
        res.status(500).json({ error: "Internal server error" });
        return;
      }

      res.json({
        batch_id: batchId,
        original_root: batch.root,
        tampered_root: tamperedRoot,
        note: "Root edited in the DB. Re-verify any vote in this batch — it now returns 409.",
      });
    } catch (err) {
      console.error("Unexpected error in POST /anchor/tamper/root:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /anchor/restore/root — undo vector 1, repeatably.
 *
 * Recomputes the correct root from the batch's votes and writes it back, so
 * it works no matter what the current stored value is. This is the demo's
 * safety net: verify returns to 200 afterwards.
 */
router.post(
  "/anchor/restore/root",
  requireAdminSecret,
  async (req: Request, res: Response) => {
    try {
      const batchId = await resolveBatchId(req.body?.batch_id, res);
      if (batchId === null) return;

      const { data: batch, error } = await supabase
        .from("merkle_batches")
        .select("batch_id, root, vote_ids")
        .eq("batch_id", batchId)
        .maybeSingle();

      if (error || !batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      const trueRoot = await recomputeBatchRoot(batch.vote_ids);
      const { error: updErr } = await supabase
        .from("merkle_batches")
        .update({ root: trueRoot })
        .eq("batch_id", batchId);

      if (updErr) {
        console.error("Supabase error restoring root:", updErr);
        res.status(500).json({ error: "Internal server error" });
        return;
      }

      res.json({
        batch_id: batchId,
        restored_root: trueRoot,
        was_tampered: trueRoot.toLowerCase() !== batch.root.toLowerCase(),
        note: "Root recomputed from the batch's votes and written back. Verify returns 200 again.",
      });
    } catch (err) {
      console.error("Unexpected error in POST /anchor/restore/root:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /anchor/tamper/ballot — demo vector 2 (defense-in-depth).
 *
 * Attempts to edit votes.encrypted_vote. The fn_votes_immutable_guard trigger
 * must REJECT this outright, so nothing ever commits. We report whether the
 * DB blocked it — a blocked edit is the success case.
 */
router.post(
  "/anchor/tamper/ballot",
  requireAdminSecret,
  async (req: Request, res: Response) => {
    try {
      const batchId = await resolveBatchId(req.body?.batch_id, res);
      if (batchId === null) return;

      const { data: batch, error } = await supabase
        .from("merkle_batches")
        .select("vote_ids")
        .eq("batch_id", batchId)
        .maybeSingle();

      if (error || !batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      const targetVoteId = (batch.vote_ids as string[])[0];
      const { error: updErr } = await supabase
        .from("votes")
        .update({ encrypted_vote: { c1: "0xtampered", c2: "0xtampered" } })
        .eq("id", targetVoteId);

      // A rejection (updErr set) is the expected, desired outcome.
      res.json({
        batch_id: batchId,
        vote_id: targetVoteId,
        blocked: !!updErr,
        db_message: updErr?.message ?? null,
        note: updErr
          ? "DB immutability trigger rejected the ballot edit before it could land."
          : "WARNING: the edit was NOT blocked — the immutability trigger is missing.",
      });
    } catch (err) {
      console.error("Unexpected error in POST /anchor/tamper/ballot:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

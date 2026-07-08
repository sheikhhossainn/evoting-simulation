/**
 * anchor.ts — Merkle batch anchoring for confirmed votes
 *
 * POST /anchor/batch        — (admin) build a Merkle tree from unanchored
 *                              votes and anchor the root on Polygon Amoy
 * GET  /anchor/verify/:id   — (public) regenerate and verify a single
 *                              vote's Merkle inclusion proof, both locally
 *                              and against the on-chain contract
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
    const { data: batch, error: batchError } = await supabase
      .from("merkle_batches")
      .select("batch_id, root, tx_hash, vote_ids")
      .contains("vote_ids", [voteId])
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

export default router;

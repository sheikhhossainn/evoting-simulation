/**
 * vote.ts — POST /vote
 *
 * Accepts an encrypted vote (ElGamal ciphertext { c1, c2 }),
 * validates it, and stores it in Supabase using the atomic
 * fn_cast_vote stored procedure.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { maybeAutoAnchor } from "../services/anchorBatch";

const router = Router();

// ── Zod Schema ──

const voteSchema = z.object({
  nid_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "nid_hash must be a 64-char hex SHA-256 digest"),
  encrypted_vote: z.object({
    c1: z.string().min(1, "c1 is required"),
    c2: z.string().min(1, "c2 is required"),
  }),
  nullifier_hash: z.string().min(1, "nullifier_hash is required"),
  election_id: z.string().min(1, "election_id is required"),
});

// ── Route ──

router.post("/vote", async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid_hash, encrypted_vote, nullifier_hash, election_id } =
    parsed.data;

  try {
    // ── Step 1: Check nullifier hasn't been used ──
    const { data: existingNullifier, error: nullifierCheckError } =
      await supabase
        .from("nullifiers")
        .select("id")
        .eq("election_id", election_id)
        .eq("nullifier_hash", nullifier_hash)
        .maybeSingle();

    if (nullifierCheckError) {
      console.error("Supabase nullifier check error:", nullifierCheckError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (existingNullifier) {
      res.status(409).json({ error: "You have already voted" });
      return;
    }

    // ── Step 2: Cast vote using atomic stored procedure ──
    // fn_cast_vote handles: voter lookup, eligibility check,
    // vote insertion, and has_voted flip — all in one transaction.
    const { data: voteId, error: castError } = await supabase.rpc(
      "fn_cast_vote",
      {
        p_voter_nid_hash: nid_hash,
        p_encrypted_vote: encrypted_vote,
        p_zkp_proof: null,
      }
    );

    if (castError) {
      console.error("Supabase fn_cast_vote error:", castError);

      // Map PostgreSQL error codes to HTTP responses
      const msg = castError.message || "";

      if (msg.includes("not registered") || castError.code === "P0002") {
        res.status(404).json({ error: "Voter not registered" });
        return;
      }
      if (msg.includes("not eligible") || castError.code === "P0003") {
        res.status(403).json({ error: "Voter is not eligible to vote" });
        return;
      }
      if (msg.includes("already cast") || castError.code === "P0004") {
        res.status(409).json({ error: "You have already voted" });
        return;
      }

      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // ── Step 3: Record the nullifier ──
    const { error: nullifierInsertError } = await supabase
      .from("nullifiers")
      .insert({
        election_id,
        nullifier_hash,
      });

    if (nullifierInsertError) {
      // Log but don't fail — the vote is already recorded.
      // Nullifier insert failure means a race condition (duplicate),
      // which is fine because the vote was already committed.
      console.warn(
        "Nullifier insert warning (vote was still recorded):",
        nullifierInsertError
      );
    }

    res.status(201).json({
      status: "queued",
      vote_id: voteId,
    });

    // Fire-and-forget: anchors a batch once 50+ votes are waiting.
    // Never awaited — must not delay or fail the voter's response.
    // No-ops silently if Amoy anchoring isn't configured yet.
    maybeAutoAnchor().catch((err) =>
      console.error("maybeAutoAnchor threw unexpectedly:", err)
    );
  } catch (err: any) {
    console.error("Error casting vote:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

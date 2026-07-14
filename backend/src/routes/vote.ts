/**
 * vote.ts — POST /vote
 *
 * Accepts a RAW National ID plus an ElGamal-encrypted ballot, derives
 * everything else server-side, and stores the vote via the atomic
 * fn_cast_vote stored procedure.
 *
 * BALLOT SECRECY REDESIGN:
 * The vote row no longer stores voter_nid_hash. Previously, votes were
 * keyed by SHA-256(nid + salt) with a foreign key straight back to the
 * voters table — meaning anyone who could compute a voter's nid_hash
 * could look up exactly which ballot was theirs. Now:
 *
 *   • nid_hash is used ONLY inside fn_cast_vote, to check eligibility and
 *     flip has_voted on the voters table. It is never written to `votes`.
 *   • The vote row is keyed by nullifier_hash — SHA-256(nid + election_id
 *     + NULLIFIER_SECRET). Because NULLIFIER_SECRET never leaves the
 *     server, knowing a voter's NID is not enough to find their ballot.
 *   • constituency_code is stored on the vote row so tallying can group
 *     results without joining back to `voters` at all. It's shared by
 *     thousands of voters, so it doesn't identify anyone.
 *
 * The client therefore sends the raw NID (over HTTPS, as it already does
 * to /voter/register) instead of computing hashes itself. A nullifier
 * computed in the browser could never have included a real secret — a
 * secret shipped to the browser isn't a secret — which is exactly the
 * weakness this replaces.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import {
  hashNidWithSalt,
  computeNullifier,
  constituencyFromNid,
} from "../crypto/identity";

const router = Router();

// ── Zod Schema ──

const voteSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  encrypted_vote: z.object({
    c1: z.string().min(1, "c1 is required"),
    c2: z.string().min(1, "c2 is required"),
  }),
  election_id: z.string().min(1, "election_id is required"),
});

// ── Route ──

router.post("/vote", async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid, encrypted_vote, election_id } = parsed.data;

  // ── Derive everything server-side from the raw NID ──
  // The raw NID is used only here, transiently, and is never persisted.
  const nidHash = hashNidWithSalt(nid);
  const nullifierHash = computeNullifier(nid, election_id);
  const constituencyCode = constituencyFromNid(nid);

  try {
    // ── Step 1: Check nullifier hasn't been used ──
    const { data: existingNullifier, error: nullifierCheckError } =
      await supabase
        .from("nullifiers")
        .select("id")
        .eq("election_id", election_id)
        .eq("nullifier_hash", nullifierHash)
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
    // fn_cast_vote handles: voter lookup (by nid_hash), eligibility check,
    // vote insertion (by nullifier_hash + constituency_code — never
    // nid_hash), and the has_voted flip — all in one transaction.
    const { data: voteId, error: castError } = await supabase.rpc(
      "fn_cast_vote",
      {
        p_voter_nid_hash: nidHash,
        p_nullifier_hash: nullifierHash,
        p_constituency_code: constituencyCode,
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
      // Unique violation on votes.nullifier_hash — a concurrent duplicate
      // submission lost the race. Same user-facing meaning as P0004.
      if (castError.code === "23505") {
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
        nullifier_hash: nullifierHash,
      });

    if (nullifierInsertError) {
      // Log but don't fail — the vote is already recorded.
      // Nullifier insert failure means a race condition (duplicate),
      // which is fine because the vote was already committed and
      // votes.nullifier_hash carries its own UNIQUE constraint.
      console.warn(
        "Nullifier insert warning (vote was still recorded):",
        nullifierInsertError
      );
    }

    res.status(201).json({
      status: "queued",
      vote_id: voteId,
    });
  } catch (err: any) {
    console.error("Error casting vote:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
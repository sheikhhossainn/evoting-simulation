/**
 * voter.ts — Voter registration & nullifier check routes
 *
 * POST /voter/register        — Hash NID (SHA-256 + salt), upsert into
 *                                Supabase voters table
 * POST /voter/check-nullifier — Given a RAW NID, compute its nullifier
 *                                server-side and check whether it already
 *                                exists for this election
 *
 * BALLOT SECRECY NOTE:
 * The nullifier is now computed server-side using NULLIFIER_SECRET (see
 * crypto/identity.ts). It used to be computed in the browser from just
 * SHA-256(nid + election_id), which meant anyone who knew a voter's NID
 * could reproduce their nullifier and link them to their vote. The client
 * therefore now sends the raw NID here (as it already did to /register)
 * rather than a client-computed hash — the server derives everything.
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

// ── Zod Schemas ──

const registerSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
});

const checkNullifierSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  election_id: z.string().min(1, "election_id is required"),
});

// ── Helpers ──

/**
 * Derive a display name from NID (for demo/admin UI).
 */
function nameFromNid(nid: string): string {
  return `Voter-${nid.slice(0, 4)}`;
}

// ── Routes ──

router.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid } = parsed.data;
  const nidHash = hashNidWithSalt(nid);
  const constituencyCode = constituencyFromNid(nid);
  const voterName = nameFromNid(nid);

  try {
    // Check if voter already exists in Supabase
    const { data: existing, error: selectError } = await supabase
      .from("voters")
      .select("id, nid_hash, constituency_code, is_eligible, has_voted")
      .eq("nid_hash", nidHash)
      .maybeSingle();

    if (selectError) {
      console.error("Supabase select error:", selectError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (existing) {
      // Voter already registered — return their record
      if (!existing.is_eligible) {
        res.status(403).json({ error: "Voter is not eligible to vote" });
        return;
      }

      res.json({
        voter_id: existing.id,
        nid_hash: existing.nid_hash,
        constituency_code: existing.constituency_code,
        is_eligible: existing.is_eligible,
        has_voted: existing.has_voted,
      });
      return;
    }

    // Insert new voter into Supabase
    const { data: newVoter, error: insertError } = await supabase
      .from("voters")
      .insert({
        nid_hash: nidHash,
        name: voterName,
        constituency_code: constituencyCode,
        is_eligible: true,
        has_voted: false,
      })
      .select("id, nid_hash, constituency_code, is_eligible, has_voted")
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);

      // Handle unique constraint violation (race condition)
      if (insertError.code === "23505") {
        res.status(409).json({ error: "Voter already registered" });
        return;
      }

      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.status(201).json({
      voter_id: newVoter.id,
      nid_hash: newVoter.nid_hash,
      constituency_code: newVoter.constituency_code,
      is_eligible: newVoter.is_eligible,
      has_voted: newVoter.has_voted,
    });
  } catch (err) {
    console.error("Unexpected error in /voter/register:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/check-nullifier", async (req: Request, res: Response) => {
  const parsed = checkNullifierSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid, election_id } = parsed.data;

  // Derive the nullifier server-side — the client never computes this,
  // and never learns NULLIFIER_SECRET.
  const nullifierHash = computeNullifier(nid, election_id);

  try {
    const { data, error } = await supabase
      .from("nullifiers")
      .select("id")
      .eq("election_id", election_id)
      .eq("nullifier_hash", nullifierHash)
      .maybeSingle();

    if (error) {
      console.error("Supabase error checking nullifier:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Only the boolean is returned — never the nullifier itself, so a
    // caller can't harvest nullifiers for NIDs they happen to guess.
    res.json({ exists: !!data });
  } catch (err) {
    console.error("Unexpected error in /voter/check-nullifier:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
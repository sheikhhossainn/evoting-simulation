/**
 * voter.ts — Voter registration & nullifier check routes
 *
 * POST /voter/register  — Hash NID (SHA-256 + salt), upsert into Supabase voters table
 * POST /voter/check-nullifier — Check if a nullifier exists for an election
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import { supabase } from "../supabaseClient";

const router = Router();

// ── Zod Schemas ──

const registerSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
});

const checkNullifierSchema = z.object({
  nullifier_hash: z.string().min(1, "nullifier_hash is required"),
  election_id: z.string().min(1, "election_id is required"),
});

// ── Helpers ──

/**
 * SHA-256 hash with salt from environment.
 * Salt is loaded from NID_HASH_SALT in .env — ensures hashes
 * cannot be rainbow-tabled even if the DB is leaked.
 */
function sha256WithSalt(input: string): string {
  const salt = process.env.NID_HASH_SALT || "";
  return createHash("sha256").update(input + salt).digest("hex");
}

/**
 * Derive constituency code from NID.
 * First 4 digits mod 8 → CON-01 through CON-08.
 */
function constituencyFromNid(nid: string): string {
  const firstFour = parseInt(nid.slice(0, 4)) || 0;
  const id = (firstFour % 8) + 1;
  return `CON-${String(id).padStart(2, "0")}`;
}

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
  const nidHash = sha256WithSalt(nid);
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

  const { nullifier_hash, election_id } = parsed.data;

  try {
    const { data, error } = await supabase
      .from("nullifiers")
      .select("id")
      .eq("election_id", election_id)
      .eq("nullifier_hash", nullifier_hash)
      .maybeSingle();

    if (error) {
      console.error("Supabase error checking nullifier:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ exists: !!data });
  } catch (err) {
    console.error("Unexpected error in /voter/check-nullifier:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

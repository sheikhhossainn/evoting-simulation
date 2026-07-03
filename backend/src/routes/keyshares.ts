/**
 * keyshares.ts — Key holder share submission and status routes
 *
 * POST /keyshares/submit  — Key holder submits their Shamir share
 * GET  /keyshares/status  — Public status: how many shares submitted
 *
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { reconstructKey } from "../crypto/shamir";

const router = Router();

// ── Zod Schemas ──

const submitShareSchema = z.object({
  election_id: z.string().min(1, "election_id is required"),
  keyholder_id: z
    .string()
    .min(1, "keyholder_id is required")
    .regex(/^KH-\d{3}$/, "keyholder_id must be in format KH-001"),
  share_index: z
    .number()
    .int()
    .min(1)
    .max(4, "share_index must be between 1 and 4"),
  share_value: z.string().min(1, "share_value is required"),
  passphrase: z.string().min(1, "passphrase is required"),
});

// ── POST /keyshares/submit ──
// Key holder submits their Shamir share.
// Validates the share, updates the key_shares row in Supabase.
router.post("/submit", async (req: Request, res: Response) => {
  const parsed = submitShareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { election_id, keyholder_id, share_index, share_value } = parsed.data;

  try {
    // ── Check if this keyholder already submitted ──
    const { data: existing, error: selectError } = await supabase
      .from("key_shares")
      .select("id, submitted")
      .eq("election_id", election_id)
      .eq("keyholder_id", keyholder_id)
      .maybeSingle();

    if (selectError) {
      console.error("Supabase select error:", selectError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (existing?.submitted) {
      res.status(409).json({
        error: "Share already submitted for this election",
      });
      return;
    }

    // ── Upsert the share row ──
    // If pre-seeded row exists → update it
    // If not → insert new row (supports both workflows)
    const { data: upserted, error: upsertError } = await supabase
      .from("key_shares")
      .upsert(
        {
          election_id,
          keyholder_id,
          share_index,
          share_value,
          keyholder_role: share_index === 1 ? "Election Commission"
    : share_index === 2 ? "Judiciary Observer"
    : share_index === 3 ? "Academic Auditor"
    : "Civil Society Observer",
          submitted: true,
          submitted_at: new Date().toISOString(),
        },
        {
          onConflict: "election_id,keyholder_id",
        }
      )
      .select("id, share_index, submitted, submitted_at")
      .single();

    if (upsertError) {
      console.error("Supabase upsert error:", upsertError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // ── Check if threshold (3-of-4) has been reached ──
    const { data: allShares, error: countError } = await supabase
      .from("key_shares")
      .select("share_index, share_value, submitted")
      .eq("election_id", election_id)
      .eq("submitted", true);

    if (countError) {
      console.error("Supabase count error:", countError);
    }

    const submittedCount = allShares?.length ?? 0;
    const thresholdMet = submittedCount >= 3;

    res.status(201).json({
      message: "Share submitted successfully",
      share_id: upserted.id,
      share_index: upserted.share_index,
      submitted_at: upserted.submitted_at,
      threshold_status: {
        submitted: submittedCount,
        required: 3,
        threshold_met: thresholdMet,
      },
    });
  } catch (err) {
    console.error("Unexpected error in /keyshares/submit:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /keyshares/status ──
// Public endpoint — returns submission status for all keyholders.
// Does NOT return share_value (privacy). Only shows who submitted.
router.get("/status", async (req: Request, res: Response) => {
  const election_id = req.query.election_id as string;

  if (!election_id) {
    res.status(400).json({ error: "election_id query param is required" });
    return;
  }

  try {
    const { data: shares, error } = await supabase
      .from("key_shares")
      .select(
        "id, share_index, keyholder_id, keyholder_role, submitted, submitted_at"
      )
      .eq("election_id", election_id)
      .order("share_index", { ascending: true });

    if (error) {
      console.error("Supabase error fetching key share status:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const submittedCount = shares?.filter((s) => s.submitted).length ?? 0;
    const thresholdMet = submittedCount >= 3;

    res.json({
      election_id,
      threshold: { required: 3, total: 4 },
      submitted_count: submittedCount,
      threshold_met: thresholdMet,
      keyholders: shares ?? [],
    });
  } catch (err) {
    console.error("Unexpected error in /keyshares/status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /keyshares/reconstruct ──
// Internal/admin endpoint — reconstructs the private key from submitted shares.
// Only works when threshold (3+) is met.
// In production: this would require additional auth. For simulation: open.
router.get("/reconstruct", async (req: Request, res: Response) => {
  const election_id = req.query.election_id as string;

  if (!election_id) {
    res.status(400).json({ error: "election_id query param is required" });
    return;
  }

  try {
    // Fetch all submitted shares
    const { data: shares, error } = await supabase
      .from("key_shares")
      .select("share_index, share_value, submitted")
      .eq("election_id", election_id)
      .eq("submitted", true)
      .order("share_index", { ascending: true });

    if (error) {
      console.error("Supabase error fetching shares:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!shares || shares.length < 3) {
      res.status(400).json({
        error: `Threshold not met. Need 3 shares, have ${shares?.length ?? 0}`,
      });
      return;
    }

    // Extract share values (non-null only)
    const shareValues = shares
      .map((s) => s.share_value)
      .filter((v): v is string => v !== null && v.length > 0);

    if (shareValues.length < 3) {
      res.status(400).json({ error: "Some shares have missing values" });
      return;
    }

    // Reconstruct the private key
    const reconstructed = reconstructKey(shareValues.slice(0, 3));

    res.json({
      success: true,
      shares_used: shareValues.length,
      // In production: NEVER return the private key over HTTP.
      // For simulation demo only:
      reconstructed_key_preview: reconstructed.slice(0, 16) + "...",
      message:
        "Key reconstructed successfully. In production, this would trigger decryption directly.",
    });
  } catch (err) {
    console.error("Unexpected error in /keyshares/reconstruct:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

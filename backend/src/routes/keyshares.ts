/**
 * keyshares.ts — Key holder share submission and status routes
 *
 * POST /keyshares/submit  — Key holder submits their Shamir share
 * GET  /keyshares/status  — Public status: how many shares submitted
 * GET  /keyshares/reconstruct — Diagnostic: are the shares consistent?
 * POST /keyshares/tally   — Admin: reconstruct key, decrypt, tally
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { reconstructKey } from "../crypto/shamir";
import { verifyKeyholderPassphrase } from "../config/keyholders";
import { decryptCandidateId, type ElGamalPrivateKey } from "../crypto/elgamal";
import { requireAdminSecret } from "../middleware/adminAuth";

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

  const { election_id, keyholder_id, share_index, share_value, passphrase } =
    parsed.data;

  if (!verifyKeyholderPassphrase(keyholder_id, passphrase)) {
    res.status(401).json({ error: "Invalid keyholder id or passphrase" });
    return;
  }

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
          keyholder_role:
            share_index === 1
              ? "Election Commission"
              : share_index === 2
              ? "Judiciary Observer"
              : share_index === 3
              ? "Academic Auditor"
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
// Public diagnostic: confirms the submitted shares are consistent enough to
// reconstruct the private key, WITHOUT ever returning any part of the key
// itself (not even a preview — a partial key is still key material).
// The actual decrypt-and-tally step lives behind POST /keyshares/tally,
// which requires the admin secret.
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

    // Attempt reconstruction purely to confirm the shares are valid —
    // the result itself is discarded, never serialized into the response.
    reconstructKey(shareValues.slice(0, 3));

    res.json({
      success: true,
      shares_used: shareValues.length,
      message:
        "Shares are consistent and can reconstruct the private key. Use POST /keyshares/tally (admin) to decrypt and tally.",
    });
  } catch (err) {
    console.error("Unexpected error in /keyshares/reconstruct:", err);
    res.status(400).json({
      error: "Reconstruction failed — shares may be invalid or mismatched",
    });
  }
});

// ── POST /keyshares/tally ──
// Admin-only (x-admin-secret header). Reconstructs the ElGamal private
// key from the submitted Shamir shares, decrypts every cast vote, and
// returns results grouped by constituency and candidate. The private
// key only ever exists in memory for the duration of this request — it
// is never logged, persisted, or returned to the caller.
//
// BALLOT SECRECY NOTE:
// This route no longer reads the `voters` table at all. Votes now carry
// their own constituency_code (non-identifying), so tallying never needs
// to join a ballot back to a voter identity — not even transiently, in
// memory, inside this handler. The strongest privacy guarantee is the one
// where the linking data simply isn't there to be joined.
router.post(
  "/tally",
  requireAdminSecret,
  async (req: Request, res: Response) => {
    const election_id = req.body?.election_id as string | undefined;

    if (!election_id) {
      res.status(400).json({ error: "election_id is required" });
      return;
    }

    try {
      const { data: shares, error: sharesError } = await supabase
        .from("key_shares")
        .select("share_value, submitted")
        .eq("election_id", election_id)
        .eq("submitted", true);

      if (sharesError) {
        console.error("Supabase error fetching shares for tally:", sharesError);
        res.status(500).json({ error: "Internal server error" });
        return;
      }

      const shareValues = (shares ?? [])
        .map((s) => s.share_value)
        .filter((v): v is string => !!v);

      if (shareValues.length < 3) {
        res.status(400).json({
          error: `Threshold not met. Need 3 shares, have ${shareValues.length}`,
        });
        return;
      }

      const p = process.env.ELGAMAL_P;
      const g = process.env.ELGAMAL_G;
      if (!p || !g) {
        res
          .status(503)
          .json({ error: "ElGamal public parameters not configured" });
        return;
      }

      let privateKey: ElGamalPrivateKey;
      try {
        const x = reconstructKey(shareValues.slice(0, 3));
        privateKey = { p, g, x };
      } catch {
        res.status(400).json({
          error: "Reconstruction failed — shares may be invalid or mismatched",
        });
        return;
      }

      // Votes now carry their own constituency_code — no `voters` join.
      const [votesRes, candidatesRes] = await Promise.all([
        supabase.from("votes").select("id, encrypted_vote, constituency_code"),
        supabase.from("candidates").select("id, name, party, constituency_code"),
      ]);

      if (votesRes.error) throw votesRes.error;
      if (candidatesRes.error) throw candidatesRes.error;

      const candidateById = new Map(
        (candidatesRes.data ?? []).map((c) => [c.id, c])
      );

      interface RejectedVote {
        vote_id: string;
        reason:
          | "decryption_failed"
          | "candidate_not_found"
          | "constituency_mismatch"
          | "duplicate_nullifier"
          | "invalid_signature";
      }

      interface TallyEntry {
        candidate_id: string;
        name: string;
        party: string;
        votes: number;
      }

      const resultsByConstituency = new Map<string, Map<string, TallyEntry>>();

      let validVotes = 0;
      const rejectedVotes: RejectedVote[] = [];

      for (const vote of votesRes.data ?? []) {
        const constituencyCode = vote.constituency_code;

        let candidateId: string;
        try {
          candidateId = decryptCandidateId(
            vote.encrypted_vote as { c1: string; c2: string },
            privateKey
          );
        } catch {
          rejectedVotes.push({ vote_id: vote.id, reason: "decryption_failed" });
          continue;
        }

        const candidate = candidateById.get(candidateId);

        if (!candidate) {
          rejectedVotes.push({
            vote_id: vote.id,
            reason: "candidate_not_found",
          });
          continue;
        }

        // Reject ballots whose candidate isn't standing in the constituency
        // the ballot was cast in — guards tallying against malformed or
        // tampered ciphertexts (there is no ZKP of vote validity yet).
        if (
          !constituencyCode ||
          candidate.constituency_code !== constituencyCode
        ) {
          rejectedVotes.push({
            vote_id: vote.id,
            reason: "constituency_mismatch",
          });
          continue;
        }

        validVotes++;

        if (!resultsByConstituency.has(constituencyCode)) {
          resultsByConstituency.set(constituencyCode, new Map());
        }
        const constituencyResults = resultsByConstituency.get(constituencyCode)!;
        const entry = constituencyResults.get(candidateId) ?? {
          candidate_id: candidateId,
          name: candidate.name,
          party: candidate.party,
          votes: 0,
        };
        entry.votes += 1;
        constituencyResults.set(candidateId, entry);
      }

      const results = [...resultsByConstituency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([constituency_code, candidateMap]) => ({
          constituency_code,
          candidates: [...candidateMap.values()].sort((a, b) => b.votes - a.votes),
        }));

      const tallyRecord = {
        election_id,
        tallied_at: new Date().toISOString(),
        shares_used: shareValues.length,
        total_votes: (votesRes.data ?? []).length,
        valid_votes: validVotes,
        invalid_votes: rejectedVotes.length,
        rejected_votes: rejectedVotes,
        results,
      };

      // Persist aggregate results (never the key, never raw ballots) so
      // GET /public/results can serve them without re-running decryption.
      const { error: persistError } = await supabase
        .from("tally_results")
        .upsert(tallyRecord, { onConflict: "election_id" });

      if (persistError) {
        console.error("Supabase error persisting tally results:", persistError);
        // The tally itself succeeded — surface the result to the caller
        // even if persistence failed, but flag it so the admin knows
        // GET /public/results won't reflect this run.
        res.json({ ...tallyRecord, persisted: false });
        return;
      }

      res.json({ ...tallyRecord, persisted: true });
    } catch (err) {
      console.error("Unexpected error in POST /keyshares/tally:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

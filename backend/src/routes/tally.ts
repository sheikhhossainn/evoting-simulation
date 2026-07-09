/**
 * tally.ts — GET /tally/results
 *
 * Once 3-of-4 key shares are submitted, this route:
 *   1. Reconstructs the ElGamal private key (in-memory only)
 *   2. Fetches all confirmed votes, joined with voter constituency
 *   3. Decrypts each vote to recover the candidate ID
 *   4. Groups results by constituency + candidate
 *   5. Returns the tally — the private key itself is NEVER returned
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";
import { reconstructKey } from "../crypto/shamir";
import { decrypt, ElGamalPrivateKey } from "../crypto/elgamal";

const router = Router();

router.get("/results", async (req: Request, res: Response) => {
  const election_id = req.query.election_id as string;

  if (!election_id) {
    res.status(400).json({ error: "election_id query param is required" });
    return;
  }

  try {
    // ── Step 1: Check threshold (3-of-4) is met ──
    const { data: shares, error: shareError } = await supabase
      .from("key_shares")
      .select("share_index, share_value, submitted")
      .eq("election_id", election_id)
      .eq("submitted", true);

    if (shareError) {
      console.error("Supabase error fetching shares:", shareError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!shares || shares.length < 3) {
      res.status(400).json({
        error: `Threshold not met. Need 3 shares, have ${shares?.length ?? 0}`,
      });
      return;
    }

    const shareValues = shares
      .map((s) => s.share_value)
      .filter((v): v is string => v !== null && v.length > 0);

    if (shareValues.length < 3) {
      res.status(400).json({ error: "Some shares have missing values" });
      return;
    }

    // ── Step 2: Reconstruct the private key (in-memory only) ──
    const reconstructedX = reconstructKey(shareValues.slice(0, 3));

    // Build the full private key object using p, g from .env
    const p = process.env.ELGAMAL_P;
    const g = process.env.ELGAMAL_G;

    if (!p || !g) {
      console.error("Missing ELGAMAL_P or ELGAMAL_G in .env");
      res.status(500).json({ error: "Server misconfiguration" });
      return;
    }

    const privateKey: ElGamalPrivateKey = { p, g, x: reconstructedX };

    // ── Step 3: Fetch all confirmed votes, joined with voter constituency ──
    // Supabase JS client syntax for a join: voters(constituency_code)
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("encrypted_vote, voter_nid_hash, voters(constituency_code)")
      .eq("status", "confirmed");

    if (votesError) {
      console.error("Supabase error fetching votes:", votesError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!votes || votes.length === 0) {
      res.json({
        election_id,
        total_votes: 0,
        results: [],
        message: "No confirmed votes to tally yet.",
      });
      return;
    }

    // ── Step 4: Fetch candidates for ID -> name/party lookup ──
    const { data: candidates, error: candError } = await supabase
      .from("candidates")
      .select("id, name, party, constituency_code");

    if (candError) {
      console.error("Supabase error fetching candidates:", candError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const candidateMap = new Map(
      (candidates ?? []).map((c) => [c.id, c])
    );

    // ── Step 5: Decrypt each vote and tally by constituency + candidate ──
    // tallyMap shape: { [constituency]: { [candidateId]: count } }
    const tallyMap: Record<string, Record<string, number>> = {};
    let decryptFailures = 0;

    for (const vote of votes) {
      try {
        const ciphertext = vote.encrypted_vote as { c1: string; c2: string };
        const candidateId = decrypt(ciphertext, privateKey);

        // voters(constituency_code) comes back as an object (or array,
        // depending on the Supabase client version) — handle both.
        const voterRelation = vote.voters as
          | { constituency_code: string }
          | { constituency_code: string }[]
          | null;

        const constituency = Array.isArray(voterRelation)
          ? voterRelation[0]?.constituency_code
          : voterRelation?.constituency_code;

        if (!constituency) {
          decryptFailures++;
          continue;
        }

        if (!tallyMap[constituency]) tallyMap[constituency] = {};
        tallyMap[constituency][candidateId] =
          (tallyMap[constituency][candidateId] ?? 0) + 1;
      } catch (err) {
        // A vote that fails to decrypt (bad/mock ciphertext, etc.)
        // shouldn't crash the whole tally — skip and count it.
        decryptFailures++;
        console.warn("Failed to decrypt a vote:", err);
      }
    }

    // ── Step 6: Build the final grouped response with candidate details ──
    const results = Object.entries(tallyMap).map(([constituency_code, candidateCounts]) => ({
      constituency_code,
      candidates: Object.entries(candidateCounts).map(([candidateId, count]) => {
        const candidate = candidateMap.get(candidateId);
        return {
          candidate_id: candidateId,
          name: candidate?.name ?? "Unknown candidate",
          party: candidate?.party ?? "Unknown",
          vote_count: count,
        };
      }),
    }));

    res.json({
      election_id,
      total_votes: votes.length,
      decrypt_failures: decryptFailures,
      results,
    });
  } catch (err) {
    console.error("Unexpected error in /tally/results:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
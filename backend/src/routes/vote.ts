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
import { verifyBallotValidity } from "../crypto/zkp";
import { loadPublicKeyFromEnv } from "../crypto/elgamal";
import { getElection } from "../services/electionContext";

const router = Router();

// ── Zod Schema ──

const voteSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  // NOTE: no plaintext candidate_id field. The ZKP disjunction proof is the
  // sole mechanism that establishes ballot validity — it proves the
  // ciphertext encrypts one of the server-derived constituency candidates
  // without revealing which. A plaintext candidate id alongside the
  // ciphertext would be a redundant leak of the voter's choice.
  encrypted_vote: z.object({
    c1: z.string().min(1, "c1 is required"),
    c2: z.string().min(1, "c2 is required"),
  }),
  election_id: z.string().min(1, "election_id is required"),
  // ZKP ballot-validity proof is MANDATORY. A vote with no proof (or one
  // that fails to verify) is rejected — otherwise an attacker could simply
  // omit it and bypass validity checking entirely. The candidate set the
  // proof is checked against is derived SERVER-SIDE (see the route), never
  // taken from the request, so a forged single-element "valid set" can't be
  // smuggled in alongside a forged ciphertext.
  zkp_proof: z.object({
    challenges: z.array(z.string().min(1)),
    responses: z.array(z.string().min(1)),
  }),
});

// ── Route ──

router.post("/vote", async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid, encrypted_vote, election_id, zkp_proof } = parsed.data;

  try {
    // ── Step -1: election must exist (threat_model.md §10) ──
    // Everything derived below (constituency, candidate set) depends on this
    // election's own registered shape — a typo'd/unknown election_id must
    // fail loud here, not silently fall through to another election's data.
    const election = await getElection(election_id);
    if (!election) {
      res.status(404).json({ error: `Unknown election_id: ${election_id}` });
      return;
    }

    // ── Derive everything server-side from the raw NID ──
    // The raw NID is used only here, transiently, and is never persisted.
    const nidHash = hashNidWithSalt(nid);
    const nullifierHash = computeNullifier(nid, election_id);
    const constituencyCode = constituencyFromNid(nid, election.constituency_count);

    // ── Step 0: Election setup commitment must be anchored before any vote ──
    // docs/tally-verifiability-design.md §8.2.5: "POST /vote should refuse to
    // accept ballots for an election_id with no anchored electionSetupCommitment
    // yet — a commitment computed after votes exist could be back-dated to
    // match whatever result is wanted." This was previously unenforced (the
    // check existed only in design-doc prose, not in code) — closing that gap
    // here so candidate-set integrity is an actual precondition, not a claim.
    const { data: setupCommitment, error: setupCheckError } = await supabase
      .from("election_setup_commitments")
      .select("election_id")
      .eq("election_id", election_id)
      .maybeSingle();

    if (setupCheckError) {
      console.error("Supabase election_setup_commitments check error:", setupCheckError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!setupCommitment) {
      res.status(412).json({
        error:
          "No election setup commitment has been anchored for this election yet — candidates/constituencies are not yet locked (docs §8.2.5). Votes cannot be accepted until setup is committed.",
      });
      return;
    }

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

    // ── Step 2: Derive the constituency candidate set SERVER-SIDE ──
    // Fetch every candidate in the voter's constituency, ordered identically
    // to GET /candidates (name ascending). This ordered list is the ZKP
    // valid-candidate set — the client never gets to say what counts as a
    // valid ballot. The frontend prover builds its set from the same
    // GET /candidates response, so an honest ballot's proof verifies against
    // this exact ordering.
    const { data: constituencyCandidates, error: candidateLookupError } =
      await supabase
        .from("candidates")
        .select("id, name")
        .eq("election_id", election_id)
        .eq("constituency_code", constituencyCode)
        .order("name", { ascending: true });

    if (candidateLookupError) {
      console.error("Supabase candidate lookup error:", candidateLookupError);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!constituencyCandidates || constituencyCandidates.length === 0) {
      res.status(404).json({ error: "No candidates found for your constituency" });
      return;
    }

    const candidateIds = constituencyCandidates.map((c) => c.id);

    // ── Step 2b: Mandatory ZKP ballot-validity check ──
    // Verify the proof against the SERVER-DERIVED candidate set. This proves
    // the ciphertext encrypts one of the real constituency candidates without
    // revealing which — this is now the ONLY mechanism that establishes
    // ballot validity; there is no separate plaintext candidate_id guard to
    // bypass or spoof, because there is no plaintext candidate_id at all.
    const elgamalPubKey = loadPublicKeyFromEnv();
    if (!elgamalPubKey) {
      console.error("ZKP verification failed: ElGamal public key not configured");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const zkpValid = verifyBallotValidity(
      encrypted_vote.c1,
      encrypted_vote.c2,
      elgamalPubKey,
      candidateIds,
      zkp_proof
    );

    if (!zkpValid) {
      res.status(400).json({ error: "ZKP ballot validity proof failed" });
      return;
    }

    const verifiedProof: object = zkp_proof;

    // ── Step 3: Cast vote using atomic stored procedure ──
    // fn_cast_vote handles: voter lookup (by nid_hash), eligibility check,
    // vote insertion (by nullifier_hash + constituency_code — never
    // nid_hash), and the has_voted flip — all in one transaction.
    const { data: voteId, error: castError } = await supabase.rpc(
      "fn_cast_vote",
      {
        p_election_id: election_id,
        p_voter_nid_hash: nidHash,
        p_nullifier_hash: nullifierHash,
        p_constituency_code: constituencyCode,
        p_encrypted_vote: encrypted_vote,
        p_zkp_proof: verifiedProof,
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
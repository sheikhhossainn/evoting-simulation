/**
 * candidates.ts — GET /candidates
 *
 * Returns the list of candidates for the authenticated voter's constituency,
 * scoped to a specific election_id (threat_model.md §10) — candidates are no
 * longer a single global list; each election has its own.
 *
 * Identity comes from the SESSION (P2) when a bearer token is presented: the
 * constituency is read from the `voters` row the session is bound to, so the
 * mobile client never sends an NID again. The web client's `x-voter-nid` header
 * is still supported and derives the constituency from the NID exactly as
 * before. The `?constituency=` query parameter is GONE: it let a caller browse
 * any constituency by name, which is the browsing the NID derivation exists to
 * prevent, and no client in this repo ever used it.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";
import { constituencyFromNid } from "../crypto/identity";
import { getElection } from "../services/electionContext";
import { sendError } from "../middleware/errorEnvelope";
import { bearerTokenFrom, deviceIdFrom, sendSessionFailure } from "../middleware/sessionAuth";
import { createSupabaseSessionRepo, resolveSession } from "../services/sessionStore";

const router = Router();

const sessionRepo = createSupabaseSessionRepo(supabase);

router.get("/candidates", async (req: Request, res: Response) => {
  const electionId = req.query.election_id as string | undefined;
  if (!electionId) {
    res.status(400).json({ error: "election_id query parameter is required" });
    return;
  }

  const election = await getElection(electionId);
  if (!election) {
    res.status(404).json({ error: `Unknown election_id: ${electionId}` });
    return;
  }

  // ── Identity: session bearer (mobile) or x-voter-nid header (web) ──
  let constituency: string;

  const token = bearerTokenFrom(req);
  if (token) {
    const resolved = await resolveSession(sessionRepo, token, { deviceId: deviceIdFrom(req) });
    if (!resolved.ok) {
      sendSessionFailure(res, resolved.reason);
      return;
    }

    // A session issued for another election must not read this one's
    // candidates — the session carries the election it was authenticated for.
    if (resolved.session.election_id !== electionId) {
      sendError(res, 403, "UNAUTHORIZED", "This session is not valid for that election.");
      return;
    }

    const { data: voter, error: voterError } = await supabase
      .from("voters")
      .select("constituency_code")
      .eq("election_id", electionId)
      .eq("nid_hash", resolved.session.voter_nid_hash)
      .maybeSingle();

    if (voterError) {
      console.error("Supabase error reading session voter:", voterError);
      sendError(res, 500, "INTERNAL", "Internal server error");
      return;
    }

    if (!voter) {
      sendError(res, 404, "VOTER_NOT_REGISTERED", "This session is not registered for that election.");
      return;
    }

    constituency = voter.constituency_code;
  } else {
    const voterNid = req.header("x-voter-nid");
    if (!voterNid) {
      sendError(
        res,
        401,
        "UNAUTHORIZED",
        "Missing Authorization: Bearer <token> header (or legacy x-voter-nid header)."
      );
      return;
    }

    if (!/^\d{11}$/.test(voterNid)) {
      sendError(
        res,
        400,
        "VALIDATION_FAILED",
        "Invalid x-voter-nid header. NID must be exactly 11 digits."
      );
      return;
    }

    constituency = constituencyFromNid(voterNid, election.constituency_count);
  }

  try {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, name, party, symbol, constituency_code")
      .eq("election_id", electionId)
      .eq("constituency_code", constituency)
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error fetching candidates:", error);
      res.status(500).json({ error: "Failed to fetch candidates" });
      return;
    }

    res.json({
      election_id: electionId,
      constituency_code: constituency,
      candidates: data || [],
    });
  } catch (err) {
    console.error("Unexpected error in GET /candidates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

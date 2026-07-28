/**
 * candidates.ts — GET /candidates
 *
 * Returns the list of candidates for the authenticated voter's constituency.
 *
 * The voter's constituency is derived server-side from the NID supplied in
 * the `x-voter-nid` header — the same pattern used by /vote and
 * /voter/register. This prevents a voter from browsing candidates for a
 * constituency they don't belong to.
 *
 * Backwards compatibility: if `x-voter-nid` is absent, the route falls
 * back to the `?constituency=` query param with a deprecation warning.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";
import { constituencyFromNid } from "../crypto/identity";

const router = Router();

router.get("/candidates", async (req: Request, res: Response) => {
  // ── Derive constituency from voter NID (preferred) ──
  const voterNid = req.header("x-voter-nid");
  let constituency: string;

  if (voterNid) {
    // Validate NID format (11 digits)
    if (!/^\d{11}$/.test(voterNid)) {
      res.status(400).json({ error: "Invalid x-voter-nid header. NID must be exactly 11 digits." });
      return;
    }
    constituency = constituencyFromNid(voterNid);
  } else {
    // ── Backwards compatibility: query param (deprecated) ──
    const queryConstituency = req.query.constituency as string | undefined;

    if (!queryConstituency) {
      res.status(400).json({
        error: "Missing x-voter-nid header (or deprecated ?constituency query param)",
      });
      return;
    }

    console.warn(
      "DEPRECATION: GET /candidates?constituency= query param is deprecated. " +
      "Use the x-voter-nid header instead."
    );

    // Validate format: CON-01 through CON-08
    if (!/^CON-\d{2}$/.test(queryConstituency)) {
      res.status(400).json({
        error: "Invalid constituency format. Expected CON-XX (e.g. CON-01)",
      });
      return;
    }

    constituency = queryConstituency;
  }

  try {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, name, party, symbol, constituency_code")
      .eq("constituency_code", constituency)
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error fetching candidates:", error);
      res.status(500).json({ error: "Failed to fetch candidates" });
      return;
    }

    res.json({
      constituency_code: constituency,
      candidates: data || [],
    });
  } catch (err) {
    console.error("Unexpected error in GET /candidates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

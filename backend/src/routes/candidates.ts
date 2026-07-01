/**
 * candidates.ts — GET /candidates?constituency=CON-XX
 *
 * Returns the list of candidates for a given constituency.
 * Queries the Supabase `candidates` table filtered by constituency_code.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";

const router = Router();

router.get("/candidates", async (req: Request, res: Response) => {
  const constituency = req.query.constituency as string | undefined;

  if (!constituency) {
    res.status(400).json({ error: "Missing required query parameter: constituency" });
    return;
  }

  // Validate format: CON-01 through CON-08
  if (!/^CON-\d{2}$/.test(constituency)) {
    res.status(400).json({
      error: "Invalid constituency format. Expected CON-XX (e.g. CON-01)",
    });
    return;
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

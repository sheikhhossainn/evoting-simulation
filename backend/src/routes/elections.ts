/**
 * elections.ts — election registry routes (threat_model.md §10)
 *
 * POST /elections     — (admin) register a new election — the actual entry
 *                        point for "set this system up for a different
 *                        election," which is what every other table's
 *                        election_id FK requires to exist first.
 * GET  /elections      — (public) list all registered elections
 * GET  /elections/:id  — (public) fetch one election's registry row
 *
 * This route deliberately does NOT deploy contracts itself — contract
 * addresses (merkle_contract_address, election_setup_contract_address) are
 * either supplied by the caller (already deployed via
 * blockchain/scripts/deploy.ts / deploy-election-setup.ts) or left null and
 * filled in later via PATCH-equivalent logic elsewhere. Keeping deployment
 * out of this route matches the existing pattern (deploy-election-setup.ts
 * is a standalone script, not something an HTTP route triggers) and avoids
 * this route needing a funded wallet / RPC access to do its job.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { requireAdminSecret } from "../middleware/adminAuth";

const router = Router();

const createElectionSchema = z.object({
  election_id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, "election_id must be alphanumeric/-/_ only"),
  name: z.string().min(1),
  constituency_count: z.number().int().positive().default(8),
  merkle_contract_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  election_setup_contract_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

router.post("/elections", requireAdminSecret, async (req: Request, res: Response) => {
  const parsed = createElectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, name, constituency_count, merkle_contract_address, election_setup_contract_address } =
    parsed.data;

  try {
    const { data, error } = await supabase
      .from("elections")
      .insert({
        election_id,
        name,
        constituency_count,
        status: "setup",
        merkle_contract_address: merkle_contract_address ?? null,
        election_setup_contract_address: election_setup_contract_address ?? null,
      })
      .select("election_id, name, constituency_count, status, merkle_contract_address, election_setup_contract_address, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: `Election ${election_id} already exists` });
        return;
      }
      console.error("Supabase error creating election:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Unexpected error in POST /elections:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/elections", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("elections")
      .select("election_id, name, constituency_count, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error listing elections:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ elections: data ?? [] });
  } catch (err) {
    console.error("Unexpected error in GET /elections:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/elections/:id", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("elections")
      .select(
        "election_id, name, constituency_count, status, merkle_contract_address, election_setup_contract_address, created_at"
      )
      .eq("election_id", req.params.id)
      .maybeSingle();

    if (error) {
      console.error("Supabase error fetching election:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    if (!data) {
      res.status(404).json({ error: `Unknown election_id: ${req.params.id}` });
      return;
    }

    res.json(data);
  } catch (err) {
    console.error("Unexpected error in GET /elections/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router, Request, Response } from "express";
import { z } from "zod";
import { localDb } from "../db";

const router = Router();

const voteSchema = z.object({
  nid_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "nid_hash must be a 64-char hex SHA-256 digest"),
  encrypted_vote: z.object({
    c1: z.string().min(1, "c1 is required"),
    c2: z.string().min(1, "c2 is required"),
  }),
  nullifier_hash: z.string().min(1, "nullifier_hash is required"),
  election_id: z.string().min(1, "election_id is required"),
});

router.post("/vote", async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid_hash, encrypted_vote, nullifier_hash, election_id } =
    parsed.data;

  try {
    const voteId = localDb.castVote(nid_hash, encrypted_vote, nullifier_hash, election_id);
    
    res.status(201).json({
      status: "queued",
      vote_id: voteId,
    });
  } catch (err: any) {
    console.error("Error casting vote:", err);
    
    if (err.message === "Voter not registered") {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message === "Voter is not eligible to vote") {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err.message === "You have already voted") {
      res.status(409).json({ error: err.message });
      return;
    }
    
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

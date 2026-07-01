import { Router, Request, Response } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import { localDb } from "../db";

const router = Router();

const registerSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
});

const checkNullifierSchema = z.object({
  nullifier_hash: z.string().min(1, "nullifier_hash is required"),
  election_id: z.string().min(1, "election_id is required"),
});

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function constituencyFromNid(nid: string): string {
  const firstFour = parseInt(nid.slice(0, 4)) || 0;
  const id = (firstFour % 8) + 1;
  return `CON-${String(id).padStart(2, "0")}`;
}

function nameFromNid(nid: string): string {
  return `Voter-${nid.slice(0, 4)}`;
}

router.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid } = parsed.data;
  const nidHash = sha256(nid);
  const constituencyCode = constituencyFromNid(nid);
  const voterName = nameFromNid(nid);

  try {
    let existing = localDb.getVoterByNidHash(nidHash);

    if (existing) {
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

    const newVoter = localDb.insertVoter({
      nid_hash: nidHash,
      name: voterName,
      constituency_code: constituencyCode,
      is_eligible: true,
      has_voted: false,
    });

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
    const exists = localDb.checkNullifier(election_id, nullifier_hash);
    res.json({ exists });
  } catch (err) {
    console.error("Unexpected error in /voter/check-nullifier:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

/**
 * dkg.ts — Distributed Key Generation (DKG) ceremony routes
 *
 * Replaces the trusted-dealer key ceremony (scripts/setup-shamir-zq.ts,
 * which momentarily holds the FULL private key x in one Node process
 * before splitting it) with a real 4-party Pedersen DKG run entirely
 * through the web portal (frontend/src/pages/KeyCeremony.tsx). Every
 * route in this file only ever sees PUBLIC values (Feldman commitments,
 * ECDH public keys) or values it cannot decrypt (AES-GCM-encrypted
 * sub-shares, relayed but never read) — the private key never exists in
 * one place, not even momentarily on this server.
 *
 * POST /dkg/init          — (admin) establish public group params (p, g)
 *                            for a fresh election. p/g are NOT secret —
 *                            this step carries none of the trusted-dealer
 *                            risk the rest of this file exists to remove.
 * POST /dkg/round1        — (keyholder) publish own Feldman commitments +
 *                            ceremony ECDH public key
 * GET  /dkg/round1        — (public) fetch all published round-1 material
 * POST /dkg/round2        — (keyholder) publish 4 encrypted sub-shares
 *                            (one per recipient, including self)
 * POST /dkg/round2/inbox  — (keyholder, passphrase-gated) fetch the
 *                            encrypted sub-shares addressed to caller
 * POST /dkg/round3        — (keyholder) confirm local combination
 *                            succeeded; on the 4th confirmation, this
 *                            route server-combines the 4 PUBLIC
 *                            commitment vectors (Feldman VSS is
 *                            additively homomorphic — no private math
 *                            involved) into election_key_ceremony,
 *                            exactly matching the old single-dealer
 *                            script's output shape
 * GET  /dkg/status         — (public) ceremony + per-keyholder round
 *                            progress, for the portal's polling UI
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import { verifyKeyholderPassphrase, getKeyholderIndex } from "../config/keyholders";
import { generateKeypair } from "../crypto/elgamal";
import { deriveShareCommitment, type FeldmanCommitments } from "../crypto/shamirZq";
import { combineFeldmanCommitments } from "../crypto/dkg";
import { requireAdminSecret } from "../middleware/adminAuth";
import { resolveElectionId, getElection } from "../services/electionContext";

const router = Router();

const hex = /^[0-9a-f]+$/;
const keyholderIdSchema = z.string().regex(/^KH-\d{3}$/);

// ── POST /dkg/init ──
// Admin-gated. Generates fresh public domain parameters (p, g) for the
// election and creates its election_key_ceremony row (status='pending').
// Reuses generateKeypair() purely for its safe-prime + generator search —
// the returned privateKey is discarded immediately, never read or stored;
// only p and g (both public by construction) are persisted.
router.post("/init", requireAdminSecret, async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.body as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;

  try {
    const { data: existing, error: existingErr } = await supabase
      .from("election_key_ceremony")
      .select("status")
      .eq("election_id", election_id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      res.status(409).json({ error: `Ceremony already initialized for ${election_id} (status: ${existing.status})` });
      return;
    }

    const { publicKey } = generateKeypair();

    const { error: insertErr } = await supabase.from("election_key_ceremony").insert({
      election_id,
      p_hex: publicKey.p,
      g_hex: publicKey.g,
      feldman_commitments: null,
      status: "pending",
    });
    if (insertErr) throw insertErr;

    res.status(201).json({ election_id, group_params: { p: publicKey.p, g: publicKey.g }, status: "pending" });
  } catch (err) {
    console.error("Unexpected error in POST /dkg/init:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function loadCeremony(electionId: string) {
  const { data, error } = await supabase
    .from("election_key_ceremony")
    .select("p_hex, g_hex, feldman_commitments, status")
    .eq("election_id", electionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── POST /dkg/round1 ──
const round1Schema = z.object({
  election_id: z.string().min(1),
  keyholder_id: keyholderIdSchema,
  passphrase: z.string().min(1),
  commitments: z.array(z.string().regex(hex)).length(3),
  ecdh_pubkey: z.string().regex(hex),
});

router.post("/round1", async (req: Request, res: Response) => {
  const parsed = round1Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, keyholder_id, passphrase, commitments, ecdh_pubkey } = parsed.data;

  try {
    if (!(await getElection(election_id))) {
      res.status(404).json({ error: `Unknown election_id: ${election_id}` });
      return;
    }
    if (!(await verifyKeyholderPassphrase(election_id, keyholder_id, passphrase))) {
      res.status(401).json({ error: "Invalid keyholder id or passphrase" });
      return;
    }
    const index = await getKeyholderIndex(election_id, keyholder_id);
    if (index === null) {
      res.status(400).json({ error: "Unknown keyholder_id for this election" });
      return;
    }

    const ceremony = await loadCeremony(election_id);
    if (!ceremony) {
      res.status(503).json({ error: "Ceremony not initialized — run POST /dkg/init first" });
      return;
    }
    if (ceremony.status === "qualified") {
      res.status(409).json({ error: "Ceremony already qualified for this election" });
      return;
    }

    const { error: upsertErr } = await supabase.from("dkg_participants").upsert(
      { election_id, keyholder_index: index, keyholder_id, commitments, ecdh_pubkey },
      { onConflict: "election_id,keyholder_index" }
    );
    if (upsertErr) throw upsertErr;

    if (ceremony.status === "pending") {
      await supabase.from("election_key_ceremony").update({ status: "round1" }).eq("election_id", election_id);
    }

    res.status(201).json({ election_id, keyholder_id, index });
  } catch (err) {
    console.error("Unexpected error in POST /dkg/round1:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /dkg/round1 ──
router.get("/round1", async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;

  try {
    const { data, error } = await supabase
      .from("dkg_participants")
      .select("keyholder_index, commitments, ecdh_pubkey")
      .eq("election_id", election_id)
      .order("keyholder_index", { ascending: true });
    if (error) throw error;

    const participants = data ?? [];
    res.json({
      election_id,
      participants: participants.map((p) => ({
        index: p.keyholder_index,
        commitments: p.commitments,
        ecdh_pubkey: p.ecdh_pubkey,
      })),
      complete: participants.length === 4,
    });
  } catch (err) {
    console.error("Unexpected error in GET /dkg/round1:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /dkg/round2 ──
const round2Schema = z.object({
  election_id: z.string().min(1),
  keyholder_id: keyholderIdSchema,
  passphrase: z.string().min(1),
  shares: z
    .array(
      z.object({
        to_index: z.number().int().min(1).max(4),
        ciphertext: z.string().regex(hex),
        iv: z.string().regex(hex),
      })
    )
    .length(4),
});

router.post("/round2", async (req: Request, res: Response) => {
  const parsed = round2Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, keyholder_id, passphrase, shares } = parsed.data;

  const toIndices = new Set(shares.map((s) => s.to_index));
  if (toIndices.size !== 4) {
    res.status(400).json({ error: "shares must address each of indices 1-4 exactly once" });
    return;
  }

  try {
    if (!(await verifyKeyholderPassphrase(election_id, keyholder_id, passphrase))) {
      res.status(401).json({ error: "Invalid keyholder id or passphrase" });
      return;
    }
    const index = await getKeyholderIndex(election_id, keyholder_id);
    if (index === null) {
      res.status(400).json({ error: "Unknown keyholder_id for this election" });
      return;
    }

    const { count: participantCount, error: countErr } = await supabase
      .from("dkg_participants")
      .select("keyholder_index", { count: "exact", head: true })
      .eq("election_id", election_id);
    if (countErr) throw countErr;
    if ((participantCount ?? 0) < 4) {
      res.status(409).json({ error: "Round 1 is not complete for this election yet (need all 4 participants)" });
      return;
    }

    const rows = shares.map((s) => ({
      election_id,
      from_index: index,
      to_index: s.to_index,
      ciphertext: s.ciphertext,
      iv: s.iv,
    }));
    const { error: upsertErr } = await supabase
      .from("dkg_shares")
      .upsert(rows, { onConflict: "election_id,from_index,to_index" });
    if (upsertErr) throw upsertErr;

    const ceremony = await loadCeremony(election_id);
    if (ceremony?.status === "round1") {
      await supabase.from("election_key_ceremony").update({ status: "round2" }).eq("election_id", election_id);
    }

    res.status(201).json({ election_id, keyholder_id, index });
  } catch (err) {
    console.error("Unexpected error in POST /dkg/round2:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /dkg/round2/inbox ──
// Passphrase-gated even though the payload is encrypted — avoids exposing
// submission metadata/timing to anyone who isn't the intended recipient.
const inboxSchema = z.object({
  election_id: z.string().min(1),
  keyholder_id: keyholderIdSchema,
  passphrase: z.string().min(1),
});

router.post("/round2/inbox", async (req: Request, res: Response) => {
  const parsed = inboxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, keyholder_id, passphrase } = parsed.data;

  try {
    if (!(await verifyKeyholderPassphrase(election_id, keyholder_id, passphrase))) {
      res.status(401).json({ error: "Invalid keyholder id or passphrase" });
      return;
    }
    const index = await getKeyholderIndex(election_id, keyholder_id);
    if (index === null) {
      res.status(400).json({ error: "Unknown keyholder_id for this election" });
      return;
    }

    const { data, error } = await supabase
      .from("dkg_shares")
      .select("from_index, ciphertext, iv")
      .eq("election_id", election_id)
      .eq("to_index", index);
    if (error) throw error;

    res.json({
      election_id,
      keyholder_id,
      index,
      inbox: (data ?? []).map((r) => ({ from_index: r.from_index, ciphertext: r.ciphertext, iv: r.iv })),
      complete: (data ?? []).length === 4,
    });
  } catch (err) {
    console.error("Unexpected error in POST /dkg/round2/inbox:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /dkg/round3 ──
const round3Schema = z.object({
  election_id: z.string().min(1),
  keyholder_id: keyholderIdSchema,
  passphrase: z.string().min(1),
});

router.post("/round3", async (req: Request, res: Response) => {
  const parsed = round3Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const { election_id, keyholder_id, passphrase } = parsed.data;

  try {
    if (!(await verifyKeyholderPassphrase(election_id, keyholder_id, passphrase))) {
      res.status(401).json({ error: "Invalid keyholder id or passphrase" });
      return;
    }
    const index = await getKeyholderIndex(election_id, keyholder_id);
    if (index === null) {
      res.status(400).json({ error: "Unknown keyholder_id for this election" });
      return;
    }

    const { error: upsertErr } = await supabase
      .from("dkg_confirmations")
      .upsert({ election_id, keyholder_index: index }, { onConflict: "election_id,keyholder_index" });
    if (upsertErr) throw upsertErr;

    const { count: confirmedCount, error: countErr } = await supabase
      .from("dkg_confirmations")
      .select("keyholder_index", { count: "exact", head: true })
      .eq("election_id", election_id);
    if (countErr) throw countErr;

    let qualified = false;
    if (confirmedCount === 4) {
      qualified = await combineAndQualify(election_id);
    }

    res.status(201).json({ election_id, keyholder_id, index, confirmed_count: confirmedCount ?? 0, qualified });
  } catch (err) {
    console.error("Unexpected error in POST /dkg/round3:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * On the 4th round-3 confirmation: combine the 4 dealers' PUBLIC Feldman
 * commitment vectors (combineFeldmanCommitments — elementwise product mod
 * p, no private material involved) and publish the result into
 * election_key_ceremony, then derive each keyholder's combined public
 * commitment y_i and write it to key_shares.public_commitment. From this
 * point on, every existing keyshares.ts route (commitments, submit-partial,
 * tally, verification-bundle) is fed data in EXACTLY the shape the old
 * single-dealer script used to produce — no changes needed there.
 */
async function combineAndQualify(electionId: string): Promise<boolean> {
  const ceremony = await loadCeremony(electionId);
  if (!ceremony) throw new Error(`combineAndQualify: no ceremony row for ${electionId}`);
  if (ceremony.status === "qualified") return true;

  const p = BigInt("0x" + ceremony.p_hex);

  const { data: participants, error: participantsErr } = await supabase
    .from("dkg_participants")
    .select("keyholder_index, commitments")
    .eq("election_id", electionId)
    .order("keyholder_index", { ascending: true });
  if (participantsErr) throw participantsErr;
  if (!participants || participants.length !== 4) {
    throw new Error(`combineAndQualify: expected 4 dkg_participants rows, found ${participants?.length ?? 0}`);
  }

  const vectors: FeldmanCommitments[] = participants.map((row) =>
    (row.commitments as string[]).map((c) => BigInt("0x" + c))
  );
  const combined = combineFeldmanCommitments(vectors, p);
  const combinedHex = combined.map((c) => c.toString(16));

  const { error: ceremonyUpdateErr } = await supabase
    .from("election_key_ceremony")
    .update({ feldman_commitments: combinedHex, status: "qualified" })
    .eq("election_id", electionId);
  if (ceremonyUpdateErr) throw ceremonyUpdateErr;

  const { data: keyholders, error: keyholdersErr } = await supabase
    .from("keyholders")
    .select("keyholder_id, role, share_index")
    .eq("election_id", electionId);
  if (keyholdersErr) throw keyholdersErr;

  for (const kh of keyholders ?? []) {
    const y_i = deriveShareCommitment(BigInt(kh.share_index), combined, p);
    const { error: keyShareErr } = await supabase.from("key_shares").upsert(
      {
        election_id: electionId,
        share_index: kh.share_index,
        keyholder_id: kh.keyholder_id,
        keyholder_role: kh.role,
        public_commitment: y_i.toString(16),
        submitted: false,
      },
      { onConflict: "election_id,keyholder_id" }
    );
    if (keyShareErr) throw keyShareErr;
  }

  return true;
}

// ── GET /dkg/status ──
router.get("/status", async (req: Request, res: Response) => {
  const resolved = await resolveElectionId(req.query as Record<string, unknown>);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const election_id = resolved.electionId;

  try {
    const [ceremony, keyholdersRes, participantsRes, sharesRes, confirmationsRes] = await Promise.all([
      loadCeremony(election_id),
      supabase.from("keyholders").select("keyholder_id, role, share_index").eq("election_id", election_id),
      supabase.from("dkg_participants").select("keyholder_index").eq("election_id", election_id),
      supabase.from("dkg_shares").select("from_index").eq("election_id", election_id),
      supabase.from("dkg_confirmations").select("keyholder_index").eq("election_id", election_id),
    ]);
    if (keyholdersRes.error) throw keyholdersRes.error;
    if (participantsRes.error) throw participantsRes.error;
    if (sharesRes.error) throw sharesRes.error;
    if (confirmationsRes.error) throw confirmationsRes.error;

    if (!ceremony) {
      res.status(404).json({ error: "Ceremony not initialized for this election — run POST /dkg/init first" });
      return;
    }

    const round1Indices = new Set((participantsRes.data ?? []).map((r) => r.keyholder_index));
    const round2Indices = new Set((sharesRes.data ?? []).map((r) => r.from_index));
    const round3Indices = new Set((confirmationsRes.data ?? []).map((r) => r.keyholder_index));

    res.json({
      election_id,
      status: ceremony.status,
      group_params: { p: ceremony.p_hex, g: ceremony.g_hex },
      keyholders: (keyholdersRes.data ?? [])
        .sort((a, b) => a.share_index - b.share_index)
        .map((k) => ({
          index: k.share_index,
          keyholder_id: k.keyholder_id,
          role: k.role,
          round1_submitted: round1Indices.has(k.share_index),
          round2_submitted: round2Indices.has(k.share_index),
          round3_confirmed: round3Indices.has(k.share_index),
        })),
    });
  } catch (err) {
    console.error("Unexpected error in GET /dkg/status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

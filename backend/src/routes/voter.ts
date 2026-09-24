/**
 * voter.ts — Voter registration & nullifier check routes
 *
 * POST /voter/register        — Hash NID (SHA-256 + salt), upsert into
 *                                Supabase voters table
 * POST /voter/check-nullifier — Given a RAW NID, compute its nullifier
 *                                server-side and check whether it already
 *                                exists for this election
 *
 * BALLOT SECRECY NOTE:
 * The nullifier is now computed server-side using NULLIFIER_SECRET (see
 * crypto/identity.ts). It used to be computed in the browser from just
 * SHA-256(nid + election_id), which meant anyone who knew a voter's NID
 * could reproduce their nullifier and link them to their vote. The client
 * therefore now sends the raw NID here (as it already did to /register)
 * rather than a client-computed hash — the server derives everything.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../supabaseClient";
import {
  hashNidWithSalt,
  computeNullifier,
  constituencyFromNid,
} from "../crypto/identity";
import { getElection } from "../services/electionContext";
import { rateLimit } from "../middleware/rateLimit";
import { requireCaptchaIfConfigured } from "../middleware/captcha";
import { bearerTokenFrom, deviceIdFrom, requireSession, sendSessionFailure, sessionFrom } from "../middleware/sessionAuth";
import { sendError, type ApiErrorCode } from "../middleware/errorEnvelope";
import {
  createSession,
  createSupabaseSessionRepo,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from "../services/sessionStore";

const router = Router();

// ── Zod Schemas ──

const registerSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  election_id: z.string().min(1, "election_id is required"),
});

const checkNullifierSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  election_id: z.string().min(1, "election_id is required"),
});

/**
 * POST /voter/session — the mobile client's single authentication call.
 * `device_id` is the per-install UUID the app keeps in secure storage (D6);
 * it is a UUID column in `sessions`, so it is validated as one here rather than
 * stored as free text.
 */
const sessionSchema = z.object({
  nid: z.string().regex(/^\d{11}$/, "NID must be exactly 11 digits"),
  election_id: z.string().min(1, "election_id is required"),
  device_id: z.string().uuid("device_id must be a UUID"),
  captcha_token: z.string().optional(),
});

// ── Helpers ──

/**
 * Derive a display name from NID (for demo/admin UI).
 */
function nameFromNid(nid: string): string {
  return `Voter-${nid.slice(0, 4)}`;
}

/** The voters-table projection every voter-scoped route needs. */
interface RegisteredVoter {
  id: string;
  nid_hash: string;
  constituency_code: string;
  is_eligible: boolean;
  has_voted: boolean;
}

/**
 * Registration semantics, shared by POST /voter/register and POST /voter/session.
 *
 * `onRace` makes the concurrent-insert policy explicit instead of accidental:
 *  • "conflict" — the web endpoint's existing behaviour: two simultaneous
 *    registrations of one NID produce 201 + 409, so a double submit is visible
 *    to the caller.
 *  • "reread"  — the session endpoint treats the race as a retry: whoever won,
 *    the NID is registered and the caller just wants a token for it.
 */
async function ensureVoterRegistered(
  electionId: string,
  nid: string,
  constituencyCount: number,
  onRace: "conflict" | "reread"
): Promise<
  | { ok: true; voter: RegisteredVoter; created: boolean }
  | { ok: false; status: number; code: ApiErrorCode; message: string }
> {
  const nidHash = hashNidWithSalt(nid);

  const { data: existing, error: selectError } = await supabase
    .from("voters")
    .select("id, nid_hash, constituency_code, is_eligible, has_voted")
    .eq("election_id", electionId)
    .eq("nid_hash", nidHash)
    .maybeSingle();

  if (selectError) {
    console.error("Supabase select error:", selectError);
    return { ok: false, status: 500, code: "INTERNAL", message: "Internal server error" };
  }

  if (existing) {
    if (!existing.is_eligible) {
      return {
        ok: false,
        status: 403,
        code: "VOTER_NOT_ELIGIBLE",
        message: "Voter is not eligible to vote",
      };
    }
    return { ok: true, voter: existing as RegisteredVoter, created: false };
  }

  const { data: newVoter, error: insertError } = await supabase
    .from("voters")
    .insert({
      election_id: electionId,
      nid_hash: nidHash,
      name: nameFromNid(nid),
      constituency_code: constituencyFromNid(nid, constituencyCount),
      is_eligible: true,
      has_voted: false,
    })
    .select("id, nid_hash, constituency_code, is_eligible, has_voted")
    .single();

  if (insertError) {
    console.error("Supabase insert error:", insertError);

    if (insertError.code === "23505") {
      if (onRace === "conflict") {
        return {
          ok: false,
          status: 409,
          code: "VOTER_ALREADY_REGISTERED",
          message: "Voter already registered",
        };
      }

      // Lost the race, but the NID *is* registered — read the winner's row and
      // hand back a normal success rather than a spurious error.
      const { data: raced } = await supabase
        .from("voters")
        .select("id, nid_hash, constituency_code, is_eligible, has_voted")
        .eq("election_id", electionId)
        .eq("nid_hash", nidHash)
        .maybeSingle();

      if (raced) return { ok: true, voter: raced as RegisteredVoter, created: false };

      return {
        ok: false,
        status: 409,
        code: "VOTER_ALREADY_REGISTERED",
        message: "Voter already registered",
      };
    }

    return { ok: false, status: 500, code: "INTERNAL", message: "Internal server error" };
  }

  return { ok: true, voter: newVoter as RegisteredVoter, created: true };
}
// ── Routes ──

// T10: scripted NID registration/enumeration. Two independent barriers — a
// per-client fixed window (10/min) and, when CAPTCHA_SECRET is configured, a
// provider token. The limiter is the backstop for when the gate is inert.
router.post(
  "/register",
  rateLimit({ windowMs: 60_000, max: 10 }),
  requireCaptchaIfConfigured(),
  async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid, election_id } = parsed.data;

  try {
    const election = await getElection(election_id);
    if (!election) {
      res.status(404).json({ error: `Unknown election_id: ${election_id}` });
      return;
    }

    const result = await ensureVoterRegistered(
      election_id,
      nid,
      election.constituency_count,
      "conflict"
    );

    if (!result.ok) {
      sendError(res, result.status, result.code, result.message);
      return;
    }

    const payload = {
      voter_id: result.voter.id,
      nid_hash: result.voter.nid_hash,
      constituency_code: result.voter.constituency_code,
      is_eligible: result.voter.is_eligible,
      has_voted: result.voter.has_voted,
    };

    // 201 for a newly inserted voter, 200 for one that already existed — the
    // same distinction this endpoint made before the helper was extracted.
    if (result.created) res.status(201).json(payload);
    else res.json(payload);
  } catch (err) {
    console.error("Unexpected error in /voter/register:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// T10: this endpoint is inherently an enumeration oracle (it answers "has this
// NID voted yet?"), so it gets a wider but still bounded window.
router.post(
  "/check-nullifier",
  rateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
  const parsed = checkNullifierSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { nid, election_id } = parsed.data;

  // Derive the nullifier server-side — the client never computes this,
  // and never learns NULLIFIER_SECRET.
  const nullifierHash = computeNullifier(nid, election_id);

  try {
    const { data, error } = await supabase
      .from("nullifiers")
      .select("id")
      .eq("election_id", election_id)
      .eq("nullifier_hash", nullifierHash)
      .maybeSingle();

    if (error) {
      console.error("Supabase error checking nullifier:", error);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Only the boolean is returned — never the nullifier itself, so a
    // caller can't harvest nullifiers for NIDs they happen to guess.
    res.json({ exists: !!data });
  } catch (err) {
    console.error("Unexpected error in /voter/check-nullifier:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Sessions (P2 / D1 / D6 / T15) ──
//
// POST /voter/session         — authenticate once, get a revocable token
// GET  /voter/me              — voter status from the session (replaces the
//                               NID enumeration oracle for mobile, B8)
// POST /voter/session/refresh — rotate the token (sliding TTL)
// POST /voter/session/revoke  — sign out this device
// POST /voter/session/revoke-all — sign out everywhere (D6)

const sessionRepo = createSupabaseSessionRepo(supabase);
const requireVoterSession = requireSession({ repo: sessionRepo });

// Same tier as /register (T10): this endpoint verifies an NID, so it is the
// other half of the enrollment-inflation surface.
router.post(
  "/session",
  rateLimit({ windowMs: 60_000, max: 10 }),
  requireCaptchaIfConfigured(),
  async (req: Request, res: Response) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "VALIDATION_FAILED", "Invalid session request payload.", {
        issues: parsed.error.issues,
      });
      return;
    }

    const { nid, election_id, device_id } = parsed.data;

    try {
      const election = await getElection(election_id);
      if (!election) {
        sendError(res, 404, "ELECTION_UNKNOWN", `Unknown election_id: ${election_id}`);
        return;
      }

      const registered = await ensureVoterRegistered(
        election_id,
        nid,
        election.constituency_count,
        "reread"
      );
      if (!registered.ok) {
        sendError(res, registered.status, registered.code, registered.message);
        return;
      }

      const created = await createSession(sessionRepo, {
        electionId: election_id,
        voterNidHash: registered.voter.nid_hash,
        deviceId: device_id,
        createdIp: req.ip ?? null,
      });

      if (!created.ok) {
        console.error("Session insert failed:", created.error);
        sendError(res, 500, "INTERNAL", "Could not create a session.");
        return;
      }

      // The one and only time a raw token is emitted. The response carries no
      // nullifier and never echoes the NID back (THREAT_MODEL §4.1).
      res.status(201).json({
        token: created.token,
        token_type: "Bearer",
        expires_at: created.session.expires_at,
        election_id,
        voter: {
          registered: true,
          is_eligible: registered.voter.is_eligible,
          has_voted: registered.voter.has_voted,
          constituency_code: registered.voter.constituency_code,
        },
      });
    } catch (err) {
      console.error("Unexpected error in POST /voter/session:", err);
      sendError(res, 500, "INTERNAL", "Internal server error");
    }
  }
);

router.get("/me", requireVoterSession, async (req: Request, res: Response) => {
  const session = sessionFrom(req);
  if (!session) {
    sendError(res, 401, "UNAUTHORIZED", "Missing session.");
    return;
  }

  try {
    const { data: voter, error } = await supabase
      .from("voters")
      .select("id, constituency_code, is_eligible, has_voted")
      .eq("election_id", session.election_id)
      .eq("nid_hash", session.voter_nid_hash)
      .maybeSingle();

    if (error) {
      console.error("Supabase error reading voter for session:", error);
      sendError(res, 500, "INTERNAL", "Internal server error");
      return;
    }

    // Deliberately answers only these four facts: no participation oracle for
    // NIDs the caller does not hold a session for, and no identity echo.
    res.json({
      election_id: session.election_id,
      registered: !!voter,
      is_eligible: voter?.is_eligible ?? false,
      has_voted: voter?.has_voted ?? false,
      constituency_code: voter?.constituency_code ?? null,
    });
  } catch (err) {
    console.error("Unexpected error in GET /voter/me:", err);
    sendError(res, 500, "INTERNAL", "Internal server error");
  }
});

router.post("/session/refresh", requireVoterSession, async (req: Request, res: Response) => {
  const token = bearerTokenFrom(req);
  if (!token) {
    sendError(res, 401, "UNAUTHORIZED", "Missing Authorization: Bearer <token> header.");
    return;
  }

  try {
    const rotated = await rotateSession(sessionRepo, token, { deviceId: deviceIdFrom(req) });
    if (!rotated.ok) {
      sendSessionFailure(res, rotated.reason);
      return;
    }

    res.json({
      token: rotated.token,
      token_type: "Bearer",
      expires_at: rotated.session.expires_at,
      election_id: rotated.session.election_id,
    });
  } catch (err) {
    console.error("Unexpected error in POST /voter/session/refresh:", err);
    sendError(res, 503, "UPSTREAM_UNAVAILABLE", "Session service is temporarily unavailable — please retry.");
  }
});

router.post("/session/revoke", requireVoterSession, async (req: Request, res: Response) => {
  const session = sessionFrom(req);
  if (!session) {
    sendError(res, 401, "UNAUTHORIZED", "Missing session.");
    return;
  }

  const revoked = await revokeSession(sessionRepo, session.id);
  if (!revoked.ok) {
    console.error("Session revoke failed:", revoked.error);
    sendError(res, 500, "INTERNAL", "Could not revoke the session.");
    return;
  }

  res.status(204).end();
});

// D6: sign out everywhere. Revokes every live session for this voter in this
// election — the count is logged rather than returned, because the endpoint is
// spec'd as 204 (no body). A shared device list is not exposed: the caller
// learns only that the revoke succeeded.
router.post("/session/revoke-all", requireVoterSession, async (req: Request, res: Response) => {
  const session = sessionFrom(req);
  if (!session) {
    sendError(res, 401, "UNAUTHORIZED", "Missing session.");
    return;
  }

  const revoked = await revokeAllSessions(sessionRepo, session.election_id, session.voter_nid_hash);
  if (!revoked.ok) {
    console.error("Session revoke-all failed:", revoked.error);
    sendError(res, 500, "INTERNAL", "Could not revoke sessions.");
    return;
  }

  console.log(
    `Session revoke-all: ${revoked.revoked} session(s) revoked for one voter in ${session.election_id}`
  );
  res.status(204).end();
});

export default router;
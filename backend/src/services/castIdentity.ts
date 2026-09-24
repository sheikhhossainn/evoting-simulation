/**
 * castIdentity.ts — where a ballot's identity comes from (P2; A1/A2/T15).
 *
 * THREAT_MODEL_AND_SECURITY.md §4.1: POST /vote derives
 * `nid_hash`/`nullifier_hash`/`constituency_code` server-side from the SESSION,
 * so the raw NID stops travelling on every cast and a credential stays
 * revocable.
 *
 * How each value is obtained:
 *  • `nid_hash`        — straight from the session (`voter_nid_hash`).
 *  • `nullifier_hash`  — captured in the session at issuance (schema.sql "P2",
 *                        decision A). It CANNOT be recomputed here: it is
 *                        SHA-256(nid ‖ election_id ‖ NULLIFIER_SECRET) and the
 *                        raw NID is gone.
 *  • `constituency_code` — from the `voters` row the session is bound to.
 *
 * The single most important property, asserted in castIdentity.test.ts: the
 * session path and the legacy raw-NID path produce **identical** values for the
 * same voter and election. If they ever diverged, one voter would hold two
 * pseudonyms in one election and could cast twice — precisely what A1 forbids.
 *
 * The legacy `nid` branch exists only for the web client, whose fate is still an
 * open product decision (Open Question #9); it is the compatibility path, not
 * the design.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { constituencyFromNid, computeNullifier, hashNidWithSalt } from "../crypto/identity";
import type { ApiErrorCode } from "../middleware/errorEnvelope";
import {
  SESSION_FAILURE_CODE,
  SESSION_FAILURE_MESSAGE,
  SESSION_FAILURE_STATUS,
  createSupabaseSessionRepo,
  resolveSession,
  type SessionRepo,
} from "./sessionStore";

export interface CastIdentitySuccess {
  ok: true;
  source: "session" | "nid";
  nidHash: string;
  nullifierHash: string;
  constituencyCode: string;
}

export interface CastIdentityFailure {
  ok: false;
  status: number;
  code: ApiErrorCode;
  message: string;
}

export type CastIdentity = CastIdentitySuccess | CastIdentityFailure;

export interface CastIdentityDeps {
  sessionRepo: SessionRepo;
  /** The voter's constituency for (election, nid_hash), or null if absent. */
  lookupConstituency(
    electionId: string,
    nidHash: string
  ): Promise<{ constituencyCode: string | null; errorMessage?: string }>;
}

export function createSupabaseCastIdentityDeps(client: SupabaseClient): CastIdentityDeps {
  return {
    sessionRepo: createSupabaseSessionRepo(client),

    async lookupConstituency(electionId, nidHash) {
      const { data, error } = await client
        .from("voters")
        .select("constituency_code")
        .eq("election_id", electionId)
        .eq("nid_hash", nidHash)
        .maybeSingle();

      if (error) return { constituencyCode: null, errorMessage: error.message };
      return {
        constituencyCode:
          (data as { constituency_code: string } | null)?.constituency_code ?? null,
      };
    },
  };
}

export async function resolveCastIdentity(
  deps: CastIdentityDeps,
  input: {
    token: string | null;
    deviceId: string | null;
    electionId: string;
    constituencyCount: number;
    legacyNid?: string | null;
  }
): Promise<CastIdentity> {
  if (input.token) {
    const resolved = await resolveSession(deps.sessionRepo, input.token, {
      deviceId: input.deviceId,
    });

    if (!resolved.ok) {
      return {
        ok: false,
        status: SESSION_FAILURE_STATUS[resolved.reason],
        code: SESSION_FAILURE_CODE[resolved.reason],
        message: SESSION_FAILURE_MESSAGE[resolved.reason],
      };
    }

    // A session authenticates a voter FOR ONE ELECTION. Without this check a
    // session for election A could cast in election B.
    if (resolved.session.election_id !== input.electionId) {
      return {
        ok: false,
        status: 403,
        code: "UNAUTHORIZED",
        message: "This session is not valid for that election.",
      };
    }

    if (!resolved.session.nullifier_hash) {
      // Only reachable for a row that never went through POST /voter/session
      // (or predates the capture). Refuse rather than invent a pseudonym.
      return {
        ok: false,
        status: 401,
        code: "SESSION_INVALID",
        message: "Session has no ballot identity — please sign in again.",
      };
    }

    const voter = await deps.lookupConstituency(input.electionId, resolved.session.voter_nid_hash);
    if (voter.errorMessage) {
      // Not the voter's fault and not a 401: retryable.
      return {
        ok: false,
        status: 503,
        code: "UPSTREAM_UNAVAILABLE",
        message: "Could not read the voter record — please retry.",
      };
    }
    if (!voter.constituencyCode) {
      return {
        ok: false,
        status: 404,
        code: "VOTER_NOT_REGISTERED",
        message: "This session is not registered for that election.",
      };
    }

    return {
      ok: true,
      source: "session",
      nidHash: resolved.session.voter_nid_hash,
      nullifierHash: resolved.session.nullifier_hash,
      constituencyCode: voter.constituencyCode,
    };
  }

  if (input.legacyNid) {
    return {
      ok: true,
      source: "nid",
      nidHash: hashNidWithSalt(input.legacyNid),
      nullifierHash: computeNullifier(input.legacyNid, input.electionId),
      constituencyCode: constituencyFromNid(input.legacyNid, input.constituencyCount),
    };
  }

  return {
    ok: false,
    status: 401,
    code: "UNAUTHORIZED",
    message: "Missing Authorization: Bearer <token> header (or the legacy nid field).",
  };
}

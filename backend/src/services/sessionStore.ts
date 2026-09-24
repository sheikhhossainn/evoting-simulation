/**
 * sessionStore.ts — server-issued session tokens (P2, D1/D6/T15).
 *
 * Design points that are deliberate, not incidental:
 *
 *  • The raw token is NEVER persisted. Only `sha256(token)` is stored, so a
 *    database dump yields no usable credential (T15 / R7). The raw token exists
 *    only in the HTTP response that mints it and in the device's secure store.
 *  • Lookups are `WHERE token_hash = sha256(header)` — an indexed equality on a
 *    digest — and the returned hash is additionally compared with
 *    `timingSafeEqual`, so R7's "hash-only lookup, timing-safe compare" is
 *    literally true rather than assumed.
 *  • Device binding lives here, not in the app: a token presented with a
 *    different `device_id` is rejected (401), so a stolen token alone is not
 *    enough (D6).
 *  • The store is a port (`SessionRepo`). Production uses `supabaseSessionRepo`;
 *    tests use an in-memory fake, which is what makes the §3.3 lifecycle suite
 *    runnable without a live database (the plan's "mock-Supabase" requirement).
 *  • Sessions authenticate a voter; they never authorize a second ballot.
 *    One-person-one-vote stays entirely inside fn_cast_vote (A1).
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiErrorCode } from "../middleware/errorEnvelope";

/** Sliding window length. 20 minutes: the voting step spans a few minutes. */
export const SESSION_TTL_MS = 20 * 60 * 1000;

/** 32 random bytes → 43-char base64url (256 bits of entropy). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The only representation of a token that is ever stored or queried. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check before touching the database (43 base64url chars). */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface SessionRow {
  id: string;
  election_id: string;
  voter_nid_hash: string;
  /**
   * The ballot pseudonym, captured once at issuance while the server still
   * holds the raw NID (decision A — BUILD_NOTES §7). /vote reads it from here
   * so the session path casts the SAME nullifier the legacy raw-NID path
   * computes; two formulas would let one voter hold two pseudonyms and cast
   * twice, which is exactly what A1 forbids.
   */
  nullifier_hash: string | null;
  token_hash: string;
  device_id: string;
  issued_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_ip: string | null;
}

export interface NewSessionRow {
  election_id: string;
  voter_nid_hash: string;
  nullifier_hash: string;
  token_hash: string;
  device_id: string;
  expires_at: string;
  created_ip: string | null;
}

export interface RepoError {
  code?: string | null;
  message?: string | null;
}

/** The minimal persistence port the service needs (implemented by Supabase/fake). */
export interface SessionRepo {
  insert(row: NewSessionRow): Promise<{ data: SessionRow | null; error: RepoError | null }>;
  findByTokenHash(tokenHash: string): Promise<{ data: SessionRow | null; error: RepoError | null }>;
  extend(id: string, expiresAt: string, lastSeenAt: string): Promise<{ error: RepoError | null }>;
  revoke(id: string, revokedAt: string): Promise<{ error: RepoError | null }>;
  revokeAll(
    electionId: string,
    voterNidHash: string,
    revokedAt: string
  ): Promise<{ data: Array<{ id: string }> | null; error: RepoError | null }>;
}

export type ResolveFailure =
  | "invalid_token"
  | "expired"
  | "revoked"
  | "device_mismatch";

/**
 * HTTP mapping for a resolve failure, owned here so the middleware and the
 * cast-identity resolver cannot drift apart. All are 401: the caller must
 * re-authenticate; only the code differs, so the app can tell "expired" (silent
 * re-auth) from "device changed" (make the voter sign in again).
 */
export const SESSION_FAILURE_STATUS: Record<ResolveFailure, number> = {
  invalid_token: 401,
  expired: 401,
  revoked: 401,
  device_mismatch: 401,
};

export const SESSION_FAILURE_CODE: Record<ResolveFailure, ApiErrorCode> = {
  invalid_token: "SESSION_INVALID",
  expired: "SESSION_EXPIRED",
  revoked: "SESSION_REVOKED",
  device_mismatch: "DEVICE_MISMATCH",
};

export const SESSION_FAILURE_MESSAGE: Record<ResolveFailure, string> = {
  invalid_token: "Session token is not valid — please sign in again.",
  expired: "Session expired — please sign in again.",
  revoked: "Session was revoked — please sign in again.",
  device_mismatch: "This session was issued to a different device — please sign in again.",
};

export type ResolveResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: ResolveFailure };

function isoNow(now: number): string {
  return new Date(now).toISOString();
}

/** Constant-time comparison of two hex digests (R7). */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Mint a session. The caller has already verified the NID and registered the
 * voter; this only turns that verification into a revocable credential.
 */
export async function createSession(
  repo: SessionRepo,
  input: {
    electionId: string;
    voterNidHash: string;
    /** SHA-256(nid + election_id + NULLIFIER_SECRET), computed at issuance. */
    nullifierHash: string;
    deviceId: string;
    createdIp?: string | null;
    now?: number;
  }
): Promise<{ ok: true; token: string; session: SessionRow } | { ok: false; error: RepoError }> {
  const now = input.now ?? Date.now();
  const token = generateSessionToken();

  const { data, error } = await repo.insert({
    election_id: input.electionId,
    voter_nid_hash: input.voterNidHash,
    nullifier_hash: input.nullifierHash,
    token_hash: hashSessionToken(token),
    device_id: input.deviceId,
    expires_at: isoNow(now + SESSION_TTL_MS),
    created_ip: input.createdIp ?? null,
  });

  if (error || !data) return { ok: false, error: error ?? { message: "insert returned no row" } };
  return { ok: true, token, session: data };
}

/**
 * Resolve a presented token. On success the sliding window is extended
 * (`expires_at`, `last_seen_at`) — the two fields fn_sessions_guard permits.
 *
 * `deviceId` is optional only so read-only flows can skip binding; when it is
 * supplied it MUST match the device the session was issued to.
 */
export async function resolveSession(
  repo: SessionRepo,
  token: string,
  options: { deviceId?: string | null; now?: number; touch?: boolean } = {}
): Promise<ResolveResult> {
  if (!isWellFormedToken(token)) return { ok: false, reason: "invalid_token" };

  const now = options.now ?? Date.now();
  const tokenHash = hashSessionToken(token);

  const { data, error } = await repo.findByTokenHash(tokenHash);
  if (error) throw new Error(`session lookup failed: ${error.message ?? "unknown"}`);
  if (!data) return { ok: false, reason: "invalid_token" };

  // Belt-and-braces on top of the indexed digest lookup (R7).
  if (!hashesMatch(tokenHash, data.token_hash)) return { ok: false, reason: "invalid_token" };

  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(data.expires_at).getTime() <= now) return { ok: false, reason: "expired" };

  if (options.deviceId && data.device_id.toLowerCase() !== options.deviceId.toLowerCase()) {
    return { ok: false, reason: "device_mismatch" };
  }

  let session = data;
  if (options.touch !== false) {
    const nextExpiry = isoNow(now + SESSION_TTL_MS);
    const { error: touchError } = await repo.extend(data.id, nextExpiry, isoNow(now));
    if (touchError) {
      // Failing to extend is not a reason to deny an otherwise valid request;
      // the token simply keeps its previous expiry (fail toward the voter).
      console.warn("session touch failed (expiry unchanged):", touchError.message);
    } else {
      session = { ...data, expires_at: nextExpiry, last_seen_at: isoNow(now) };
    }
  }

  return { ok: true, session };
}

/**
 * Rotate a token (POST /voter/session/refresh): the presented session is
 * revoked and a new one issued for the same identity and device, so a stolen
 * token has a single-use window (T15).
 */
export async function rotateSession(
  repo: SessionRepo,
  token: string,
  options: { deviceId?: string | null; now?: number } = {}
): Promise<
  { ok: true; token: string; session: SessionRow } | { ok: false; reason: ResolveFailure }
> {
  const now = options.now ?? Date.now();

  const resolved = await resolveSession(repo, token, {
    deviceId: options.deviceId,
    now,
    touch: false,
  });
  if (!resolved.ok) return resolved;

  // A session with no captured pseudonym (a row predating the capture, or one
  // written out of band) cannot be rotated into a usable session: refuse,
  // rather than mint a token that /vote would then have to reject anyway.
  if (!resolved.session.nullifier_hash) return { ok: false, reason: "invalid_token" };

  const { error: revokeError } = await repo.revoke(resolved.session.id, isoNow(now));
  if (revokeError) throw new Error(`session revoke failed: ${revokeError.message ?? "unknown"}`);

  const created = await createSession(repo, {
    electionId: resolved.session.election_id,
    voterNidHash: resolved.session.voter_nid_hash,
    // Rotation re-issues the SAME pseudonym: the identity and its election are
    // unchanged, so the voter's single ballot position must not move (A1).
    nullifierHash: resolved.session.nullifier_hash,
    deviceId: resolved.session.device_id,
    createdIp: resolved.session.created_ip,
    now,
  });

  if (!created.ok) return { ok: false, reason: "invalid_token" };
  return { ok: true, token: created.token, session: created.session };
}

/** Revoke one session (sign out). */
export async function revokeSession(
  repo: SessionRepo,
  sessionId: string,
  now: number = Date.now()
): Promise<{ ok: boolean; error?: RepoError }> {
  const { error } = await repo.revoke(sessionId, isoNow(now));
  return error ? { ok: false, error } : { ok: true };
}

/** Revoke every live session for this voter in this election (D6). */
export async function revokeAllSessions(
  repo: SessionRepo,
  electionId: string,
  voterNidHash: string,
  now: number = Date.now()
): Promise<{ ok: boolean; revoked: number; error?: RepoError }> {
  const { data, error } = await repo.revokeAll(electionId, voterNidHash, isoNow(now));
  if (error) return { ok: false, revoked: 0, error };
  return { ok: true, revoked: data?.length ?? 0 };
}

/**
 * The production implementation of the port.
 *
 * The client is passed in rather than imported, so this module has NO
 * `supabaseClient` dependency: importing it cannot trigger that module's
 * "missing credentials → process.exit(1)" guard, which is what keeps the
 * session-lifecycle suite runnable in `test:ci` (no live database).
 */
export function createSupabaseSessionRepo(client: SupabaseClient): SessionRepo {
  return {
    async insert(row) {
      const { data, error } = await client.from("sessions").insert(row).select("*").single();
      return { data: (data as SessionRow | null) ?? null, error: error ?? null };
    },

    async findByTokenHash(tokenHash) {
      const { data, error } = await client
        .from("sessions")
        .select("*")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      return { data: (data as SessionRow | null) ?? null, error: error ?? null };
    },

    async extend(id, expiresAt, lastSeenAt) {
      const { error } = await client
        .from("sessions")
        .update({ expires_at: expiresAt, last_seen_at: lastSeenAt })
        .eq("id", id);
      return { error: error ?? null };
    },

    async revoke(id, revokedAt) {
      const { error } = await client
        .from("sessions")
        .update({ revoked_at: revokedAt })
        .eq("id", id);
      return { error: error ?? null };
    },

    async revokeAll(electionId, voterNidHash, revokedAt) {
      // Only rows that are still live: re-revoking an already-revoked session
      // would overwrite the original sign-out time, which the audit trail
      // should be able to tell apart.
      const { data, error } = await client
        .from("sessions")
        .update({ revoked_at: revokedAt })
        .eq("election_id", electionId)
        .eq("voter_nid_hash", voterNidHash)
        .is("revoked_at", null)
        .select("id");
      return { data: (data as Array<{ id: string }> | null) ?? null, error: error ?? null };
    },
  };
}



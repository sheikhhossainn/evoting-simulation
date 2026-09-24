/**
 * errorEnvelope.ts — machine-readable error responses (mobile migration, P1).
 *
 * The mobile client must decide *copy* and *retry behaviour* from a stable
 * code, never by matching message text. Routes previously answered with
 * `{ error: string | ZodIssue[] }` only, and POST /vote mapped PostgreSQL
 * failures by substring-matching the database message.
 *
 * This helper ADDS `code` and `retryable` while KEEPING `error`, so existing
 * web clients and every current test that asserts on `body.error` keep working
 * unchanged — the envelope is additive, not a break.
 */
import { Response } from "express";

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "VOTER_NOT_REGISTERED"
  | "VOTER_NOT_ELIGIBLE"
  | "VOTER_ALREADY_REGISTERED"
  | "VOTE_ALREADY_CAST"
  | "ELECTION_UNKNOWN"
  | "ELECTION_NOT_OPEN"
  | "KEY_NOT_READY"
  | "COMMITMENT_MISSING"
  | "INVALID_BALLOT"
  | "RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "UPSTREAM_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "DEVICE_MISMATCH"
  | "DEVICE_ID_REQUIRED"
  | "NOT_FOUND"
  | "INTERNAL";

/** Whether a client may usefully retry the same request later. */
const RETRYABLE: Record<ApiErrorCode, boolean> = {
  VALIDATION_FAILED: false,
  VOTER_NOT_REGISTERED: false,
  VOTER_NOT_ELIGIBLE: false,
  VOTER_ALREADY_REGISTERED: false,
  VOTE_ALREADY_CAST: false,
  ELECTION_UNKNOWN: false,
  ELECTION_NOT_OPEN: false,
  KEY_NOT_READY: true,
  COMMITMENT_MISSING: false,
  INVALID_BALLOT: false,
  RATE_LIMITED: true,
  CAPTCHA_FAILED: false,
  UPSTREAM_UNAVAILABLE: true,
  UNAUTHORIZED: false,
  SESSION_INVALID: false,
  SESSION_EXPIRED: false,
  SESSION_REVOKED: false,
  DEVICE_MISMATCH: false,
  DEVICE_ID_REQUIRED: false,
  NOT_FOUND: false,
  INTERNAL: true,
};

export function isRetryable(code: ApiErrorCode): boolean {
  return RETRYABLE[code];
}

/**
 * Send an error carrying the stable envelope. `error` is retained verbatim for
 * backward compatibility with the existing web client and test suite.
 */
export function sendError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({
    error: message,
    code,
    retryable: RETRYABLE[code],
    ...(extra ?? {}),
  });
}

/**
 * Map a fn_cast_vote failure to (status, code).
 *
 * schema.sql's stored procedure raises custom SQLSTATEs — P0002 not registered,
 * P0003 not eligible, P0004 already voted — and 23505 is the unique-violation
 * backstop when two concurrent casts race. The SQLSTATE is authoritative; the
 * message substring is kept only as a fallback for environments that surface
 * the text without the code (the previous implementation used the substring
 * alone, which is why this is a code-first rewrite).
 */
export function mapCastVoteError(err: {
  code?: string | null;
  message?: string | null;
}): { status: number; code: ApiErrorCode } {
  const pgCode = err?.code ?? "";
  const msg = err?.message ?? "";

  if (pgCode === "P0002" || msg.includes("not registered")) {
    return { status: 404, code: "VOTER_NOT_REGISTERED" };
  }
  if (pgCode === "P0003" || msg.includes("not eligible")) {
    return { status: 403, code: "VOTER_NOT_ELIGIBLE" };
  }
  if (pgCode === "P0004" || pgCode === "23505" || msg.includes("already cast") || msg.includes("already voted")) {
    return { status: 409, code: "VOTE_ALREADY_CAST" };
  }
  return { status: 500, code: "INTERNAL" };
}

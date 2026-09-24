/**
 * sessionAuth.ts — bearer-session middleware (P2, D1/D6/T15).
 *
 * Every voter-scoped route after P2 authenticates with
 * `Authorization: Bearer <token>` plus `x-device-id: <uuid>`, and derives the
 * voter's identity from the SESSION rather than from the request body. That is
 * the whole point of the layer: the raw NID stops travelling on every call, and
 * a credential can be revoked server-side.
 *
 * The repo is INJECTED rather than imported: this module never touches
 * `supabaseClient`, so importing it cannot trip that module's
 * "missing credentials → process.exit(1)" guard. That is what lets
 * `middleware.test.ts` drive the 401 paths under `test:ci` with a fake store.
 *
 * Failure codes are deliberately distinguishable (`SESSION_EXPIRED` vs
 * `SESSION_REVOKED` vs `DEVICE_MISMATCH`) even though all answer 401: the app
 * needs to know whether to re-authenticate silently or make the voter sign in
 * again, and the distinction reveals nothing an attacker can use.
 */
import { Request, Response, NextFunction } from "express";

import {
  resolveSession,
  type ResolveFailure,
  type SessionRepo,
  type SessionRow,
} from "../services/sessionStore";
import { sendError, type ApiErrorCode } from "./errorEnvelope";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireSession() once a bearer token has been validated. */
      voterSession?: SessionRow;
    }
  }
}

/** Parse `Authorization: Bearer <token>`; returns null when absent/malformed. */
export function bearerTokenFrom(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Parse `x-device-id`; the D6 binding value generated once per install. */
export function deviceIdFrom(req: Request): string | null {
  const value = req.header("x-device-id");
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const FAILURE_CODE: Record<ResolveFailure, ApiErrorCode> = {
  invalid_token: "SESSION_INVALID",
  expired: "SESSION_EXPIRED",
  revoked: "SESSION_REVOKED",
  device_mismatch: "DEVICE_MISMATCH",
};

const FAILURE_MESSAGE: Record<ResolveFailure, string> = {
  invalid_token: "Session token is not valid — please sign in again.",
  expired: "Session expired — please sign in again.",
  revoked: "Session was revoked — please sign in again.",
  device_mismatch: "This session was issued to a different device — please sign in again.",
};

/**
 * Map a resolve failure onto the envelope. Exported so routes that re-resolve a
 * token themselves (POST /voter/session/refresh) answer identically to the
 * middleware rather than inventing a second set of codes.
 */
export function sendSessionFailure(res: Response, reason: ResolveFailure): void {
  sendError(res, 401, FAILURE_CODE[reason], FAILURE_MESSAGE[reason]);
}

export interface SessionAuthOptions {
  repo: SessionRepo;
  /**
   * Require the `x-device-id` header. On by default: D6 device binding is the
   * control that makes a stolen token insufficient on its own.
   */
  requireDeviceId?: boolean;
}

export function requireSession(options: SessionAuthOptions) {
  const requireDeviceId = options.requireDeviceId !== false;

  return async function sessionAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = bearerTokenFrom(req);
    if (!token) {
      sendError(res, 401, "UNAUTHORIZED", "Missing Authorization: Bearer <token> header.");
      return;
    }

    const deviceId = deviceIdFrom(req);
    if (requireDeviceId && !deviceId) {
      sendError(res, 401, "DEVICE_ID_REQUIRED", "Missing x-device-id header.");
      return;
    }

    let resolved;
    try {
      resolved = await resolveSession(options.repo, token, { deviceId });
    } catch (err) {
      // Store unreachable: fail closed, but retryable — this is not the
      // client's fault and re-signing-in would not help.
      console.error("Session resolution failed:", err);
      sendError(
        res,
        503,
        "UPSTREAM_UNAVAILABLE",
        "Session service is temporarily unavailable — please retry."
      );
      return;
    }

    if (!resolved.ok) {
      sendError(res, 401, FAILURE_CODE[resolved.reason], FAILURE_MESSAGE[resolved.reason]);
      return;
    }

    req.voterSession = resolved.session;
    next();
  };
}

/**
 * Read the session a preceding requireSession() attached. Routes should treat a
 * missing value as a programming error (the middleware runs first), not as an
 * authentication failure to report to the caller.
 */
export function sessionFrom(req: Request): SessionRow | undefined {
  return req.voterSession;
}

/**
 * captcha.ts — optional CAPTCHA gate (P1, threat T10).
 *
 * INERT BY DEFAULT, and loudly so: with CAPTCHA_SECRET unset every request
 * passes through and index.ts logs a startup warning. The gate is therefore
 * never *assumed* to be on when it isn't — a silent no-op would be worse than
 * no gate at all, because it would look like protection.
 *
 * When CAPTCHA_SECRET IS set, a provider token is REQUIRED and is verified
 * against the provider's siteverify endpoint over `fetch` (no SDK dependency).
 * Default provider: Cloudflare Turnstile; override with CAPTCHA_VERIFY_URL.
 */
import { Request, Response, NextFunction } from "express";

import { sendError } from "./errorEnvelope";

const DEFAULT_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isCaptchaEnabled(): boolean {
  return Boolean(process.env.CAPTCHA_SECRET);
}

function tokenFrom(req: Request): string | undefined {
  const fromHeader = req.header("x-captcha-token");
  if (fromHeader) return fromHeader;

  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.captcha_token;
  return typeof fromBody === "string" && fromBody.length > 0 ? fromBody : undefined;
}

export function requireCaptchaIfConfigured() {
  return async function captchaMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const secret = process.env.CAPTCHA_SECRET;
    if (!secret) {
      next(); // inert — index.ts warns at startup
      return;
    }

    const token = tokenFrom(req);
    if (!token) {
      sendError(res, 403, "CAPTCHA_FAILED", "A CAPTCHA token is required.");
      return;
    }

    try {
      const url = process.env.CAPTCHA_VERIFY_URL || DEFAULT_VERIFY_URL;
      const params = new URLSearchParams({ secret, response: token });
      if (req.ip) params.set("remoteip", req.ip);

      const response = await fetch(url, { method: "POST", body: params });
      const data = (await response.json()) as { success?: boolean };

      if (!data?.success) {
        sendError(res, 403, "CAPTCHA_FAILED", "CAPTCHA verification failed.");
        return;
      }
      next();
    } catch (err) {
      // Provider unreachable/malformed: fail closed, but tell the client it is
      // retryable rather than pretending the request was fraudulent.
      console.error("CAPTCHA verification error:", err);
      sendError(
        res,
        503,
        "UPSTREAM_UNAVAILABLE",
        "CAPTCHA verification is temporarily unavailable — please retry."
      );
    }
  };
}

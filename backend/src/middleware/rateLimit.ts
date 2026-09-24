/**
 * rateLimit.ts — dependency-free fixed-window rate limiter (P1, threat T10).
 *
 * Why not `express-rate-limit`: the backend has no such dependency and this
 * phase deliberately adds none (adding one would mean another install step and
 * another lockfile change). This is a small fixed-window limiter, which is
 * enough for the concrete attack it mitigates — scripted registration/enumeration
 * of NIDs (T10) — while the CAPTCHA gate covers the rest.
 *
 * SINGLE-INSTANCE ASSUMPTION — stated, not hidden: counters live in this
 * process, exactly like services/anchorBatch.ts's in-flight guard. A
 * horizontally scaled deployment needs a shared store (Redis/Supabase) instead;
 * that is risk R10 and is recorded there rather than silently ignored here.
 */
import { Request, Response, NextFunction } from "express";

import { sendError } from "./errorEnvelope";

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per window per key. */
  max: number;
  /** Stable per-caller key. Defaults to client IP + route path. */
  key?: (req: Request) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Opportunistic sweep so a burst of distinct client keys cannot grow the map
 * without bound. Only runs once the map is large, so the common path stays O(1).
 */
const SWEEP_THRESHOLD = 10_000;

function sweepExpired(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }
}

function defaultKey(req: Request): string {
  return `${req.ip ?? "unknown"}:${req.path}`;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, key = defaultKey } = options;
  const retryAfterSeconds = Math.ceil(windowMs / 1000);

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    sweepExpired(now);

    const bucketKey = key(req);
    const bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      sendError(
        res,
        429,
        "RATE_LIMITED",
        `Too many requests — try again in ${retryAfterSeconds}s.`
      );
      return;
    }

    next();
  };
}

/** Test/ops helper: clear every counter (used between test cases). */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Observability helper: how many live buckets the limiter is holding. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

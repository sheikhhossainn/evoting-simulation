/**
 * middleware.test.ts — unit tests for the P1 hardening layer
 * (error envelope, rate limiter, CAPTCHA gate, tamper-demo gate).
 *
 * No database, no network, no credentials: every case drives the middleware
 * directly with hand-rolled req/res doubles. That is why this file can join
 * `test:ci`, which runs without a live Supabase project — unlike the route
 * suites, which need .env.test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

import { isRetryable, mapCastVoteError, sendError } from "./errorEnvelope";
import { rateLimit, rateLimitBucketCount, resetRateLimits } from "./rateLimit";
import { isCaptchaEnabled, requireCaptchaIfConfigured } from "./captcha";
import { isTamperDemoEnabled, requireTamperDemo } from "./tamperDemo";

interface Captured {
  status: number | null;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** Minimal Express Response double that records status/body/headers. */
function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: null, body: null, headers: {} };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

/** Minimal Express Request double — only the fields the middleware read. */
function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    ip: "203.0.113.7",
    path: "/register",
    header: () => undefined,
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeNext(): { next: NextFunction; calls: () => number } {
  let calls = 0;
  const next: NextFunction = () => {
    calls += 1;
  };
  return { next, calls: () => calls };
}

/**
 * Run `fn` with an env var temporarily set/cleared, always restoring it.
 *
 * Must be awaited: an async body would otherwise still be running when the
 * `finally` restores the variable — which silently disabled the CAPTCHA gate
 * mid-test the first time this was written.
 */
async function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void | Promise<void>
): Promise<void> {
  const original = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    await fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

// ── Error envelope ──

describe("errorEnvelope.sendError", () => {
  it("adds code/retryable while keeping `error` for the existing web client", () => {
    const { res, captured } = makeRes();

    sendError(res, 409, "VOTE_ALREADY_CAST", "You have already voted");

    expect(captured.status).toBe(409);
    expect(captured.body).toEqual({
      error: "You have already voted",
      code: "VOTE_ALREADY_CAST",
      retryable: false,
    });
  });

  it("classifies transient failures as retryable and permanent ones as not", () => {
    expect(isRetryable("RATE_LIMITED")).toBe(true);
    expect(isRetryable("KEY_NOT_READY")).toBe(true);
    expect(isRetryable("UPSTREAM_UNAVAILABLE")).toBe(true);
    expect(isRetryable("INTERNAL")).toBe(true);
    expect(isRetryable("VOTE_ALREADY_CAST")).toBe(false);
    expect(isRetryable("CAPTCHA_FAILED")).toBe(false);
    expect(isRetryable("INVALID_BALLOT")).toBe(false);
  });

  it("merges extra fields without clobbering the envelope", () => {
    const { res, captured } = makeRes();

    sendError(res, 429, "RATE_LIMITED", "slow down", { retry_after_seconds: 60 });

    expect(captured.body?.code).toBe("RATE_LIMITED");
    expect(captured.body?.retry_after_seconds).toBe(60);
  });
});

describe("errorEnvelope.mapCastVoteError", () => {
  it("maps fn_cast_vote custom SQLSTATEs, code first", () => {
    // The SQLSTATE wins even when the message text says something else — the
    // previous implementation substring-matched the message alone.
    expect(mapCastVoteError({ code: "P0002", message: "unrelated text" })).toEqual({
      status: 404,
      code: "VOTER_NOT_REGISTERED",
    });
    expect(mapCastVoteError({ code: "P0003", message: "" })).toEqual({
      status: 403,
      code: "VOTER_NOT_ELIGIBLE",
    });
    expect(mapCastVoteError({ code: "P0004", message: "" })).toEqual({
      status: 409,
      code: "VOTE_ALREADY_CAST",
    });
    // 23505: unique violation on votes.nullifier_hash — two casts raced.
    expect(mapCastVoteError({ code: "23505", message: "duplicate key" })).toEqual({
      status: 409,
      code: "VOTE_ALREADY_CAST",
    });
  });

  it("falls back to message text only when no SQLSTATE is surfaced", () => {
    expect(mapCastVoteError({ message: "Voter has not registered for this election" }).status).toBe(404);
    expect(mapCastVoteError({ message: "Voter is not eligible in this constituency" }).status).toBe(403);
    expect(mapCastVoteError({ message: "Voter has already cast a vote" }).status).toBe(409);
  });

  it("does not mistake an unrelated error for a duplicate vote", () => {
    // "already" alone used to be enough to mean 409; only the two vote-specific
    // phrasings count now.
    expect(mapCastVoteError({ code: "42P01", message: "relation already exists" })).toEqual({
      status: 500,
      code: "INTERNAL",
    });
    expect(mapCastVoteError({})).toEqual({ status: 500, code: "INTERNAL" });
  });
});

// ── Rate limiter ──

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to max, then answers 429 with Retry-After and a stable code", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });

    for (let i = 0; i < 2; i += 1) {
      const { res } = makeRes();
      const { next, calls } = makeNext();
      mw(makeReq(), res, next);
      expect(calls()).toBe(1);
    }

    const { res, captured } = makeRes();
    const { next, calls } = makeNext();
    mw(makeReq(), res, next);

    expect(calls()).toBe(0);
    expect(captured.status).toBe(429);
    expect(captured.body?.code).toBe("RATE_LIMITED");
    expect(captured.body?.retryable).toBe(true);
    expect(captured.headers["Retry-After"]).toBe("60");
  });

  it("keys buckets independently per client and per path", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });

    const sameIpOtherPath = makeNext();
    mw(makeReq({ ip: "198.51.100.1", path: "/vote" }), makeRes().res, sameIpOtherPath.next);
    mw(makeReq({ ip: "198.51.100.1", path: "/register" }), makeRes().res, makeNext().next);

    const otherIp = makeNext();
    mw(makeReq({ ip: "198.51.100.2", path: "/vote" }), makeRes().res, otherIp.next);

    expect(sameIpOtherPath.calls()).toBe(1);
    expect(otherIp.calls()).toBe(1);
    expect(rateLimitBucketCount()).toBe(3);
  });

  it("reopens the window once it has elapsed", () => {
    vi.useFakeTimers();
    try {
      const mw = rateLimit({ windowMs: 1_000, max: 1 });

      const first = makeNext();
      mw(makeReq(), makeRes().res, first.next);
      expect(first.calls()).toBe(1);

      const blocked = makeRes();
      const second = makeNext();
      mw(makeReq(), blocked.res, second.next);
      expect(second.calls()).toBe(0);
      expect(blocked.captured.status).toBe(429);

      vi.advanceTimersByTime(1_001);

      const afterWindow = makeNext();
      mw(makeReq(), makeRes().res, afterWindow.next);
      expect(afterWindow.calls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── CAPTCHA gate ──

describe("requireCaptchaIfConfigured", () => {
  it("is inert while CAPTCHA_SECRET is unset — requests pass through", async () => {
    await withEnv("CAPTCHA_SECRET", undefined, async () => {
      expect(isCaptchaEnabled()).toBe(false);

      const { next, calls } = makeNext();
      await requireCaptchaIfConfigured()(makeReq(), makeRes().res, next);

      expect(calls()).toBe(1);
    });
  });

  it("rejects a missing token once configured, without any network call", async () => {
    await withEnv("CAPTCHA_SECRET", "test-secret", async () => {
      expect(isCaptchaEnabled()).toBe(true);

      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { res, captured } = makeRes();
      const { next, calls } = makeNext();

      await requireCaptchaIfConfigured()(makeReq(), res, next);

      expect(calls()).toBe(0);
      expect(captured.status).toBe(403);
      expect(captured.body?.code).toBe("CAPTCHA_FAILED");
      expect(captured.body?.retryable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  it("fails closed but retryably when the provider is unreachable", async () => {
    await withEnv("CAPTCHA_SECRET", "test-secret", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network down"));

      const { res, captured } = makeRes();
      const { next, calls } = makeNext();

      await requireCaptchaIfConfigured()(makeReq({ header: () => "token-123" }), res, next);

      expect(calls()).toBe(0);
      expect(captured.status).toBe(503);
      expect(captured.body?.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(captured.body?.retryable).toBe(true);

      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  it("passes a provider-confirmed token and rejects a provider-denied one", async () => {
    await withEnv("CAPTCHA_SECRET", "test-secret", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue({ json: async () => ({ success: true }) } as unknown as Awaited<ReturnType<typeof fetch>>);

      const accepted = makeNext();
      await requireCaptchaIfConfigured()(
        makeReq({ header: () => "good-token" }),
        makeRes().res,
        accepted.next
      );
      expect(accepted.calls()).toBe(1);

      fetchSpy.mockResolvedValue({ json: async () => ({ success: false }) } as unknown as Awaited<ReturnType<typeof fetch>>);

      const deniedRes = makeRes();
      const denied = makeNext();
      await requireCaptchaIfConfigured()(
        makeReq({ header: () => "bad-token" }),
        deniedRes.res,
        denied.next
      );
      expect(denied.calls()).toBe(0);
      expect(deniedRes.captured.status).toBe(403);
      expect(deniedRes.captured.body?.code).toBe("CAPTCHA_FAILED");

      fetchSpy.mockRestore();
    });
  });

  it("accepts the token from the request body as well as the header", async () => {
    await withEnv("CAPTCHA_SECRET", "test-secret", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue({ json: async () => ({ success: true }) } as unknown as Awaited<ReturnType<typeof fetch>>);

      const { next, calls } = makeNext();
      await requireCaptchaIfConfigured()(
        makeReq({ body: { captcha_token: "body-token" } }),
        makeRes().res,
        next
      );

      expect(calls()).toBe(1);
      fetchSpy.mockRestore();
    });
  });
});

// ── Tamper-demo gate ──

describe("requireTamperDemo", () => {
  it("answers 404 — the route looks absent — unless ENABLE_TAMPER_DEMO=1", async () => {
    await withEnv("ENABLE_TAMPER_DEMO", undefined, () => {
      expect(isTamperDemoEnabled()).toBe(false);

      const { res, captured } = makeRes();
      const { next, calls } = makeNext();
      requireTamperDemo(makeReq(), res, next);

      expect(calls()).toBe(0);
      expect(captured.status).toBe(404);
      expect(captured.body?.code).toBe("NOT_FOUND");
    });
  });

  it("treats any value other than exactly '1' as disabled", async () => {
    // Fails safe: "true", "yes", "0" and "" must all keep the routes hidden, so
    // a typo can never enable a route that deletes votes.
    for (const value of ["true", "yes", "enabled", "0", ""]) {
      await withEnv("ENABLE_TAMPER_DEMO", value, () => {
        expect(isTamperDemoEnabled()).toBe(false);
      });
    }

    await withEnv("ENABLE_TAMPER_DEMO", "1", () => {
      expect(isTamperDemoEnabled()).toBe(true);

      const { next, calls } = makeNext();
      requireTamperDemo(makeReq(), makeRes().res, next);
      expect(calls()).toBe(1);
    });
  });
});



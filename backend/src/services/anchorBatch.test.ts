/**
 * anchorBatch.test.ts — proves maybeAutoAnchor()'s age-based trigger
 * (methodology-audit finding M3: the pre-anchor window was previously
 * unbounded — count-threshold only, no time fallback, so a trickle of
 * votes below AUTO_ANCHOR_THRESHOLD could sit unanchored indefinitely).
 *
 * getWritableMerkleContract() is mocked to return null so runAnchorBatch()
 * no-ops immediately once triggered — this test is only about WHETHER the
 * trigger decision fires, not the anchoring mechanics themselves (already
 * covered live, per the implementation report).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VOTES_STATE: { count: number; oldestCreatedAt: string | null } = {
  count: 0,
  oldestCreatedAt: null,
};

function makeVotesQuery() {
  const builder: any = {
    select: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({
      data: VOTES_STATE.oldestCreatedAt ? { created_at: VOTES_STATE.oldestCreatedAt } : null,
      error: null,
    }),
    // count-mode select resolves via `then` in the real supabase client;
    // mimic that shape for `{ count, error }` destructuring.
    then: (resolve: any) => resolve({ count: VOTES_STATE.count, error: null }),
  };
  return builder;
}

vi.mock("../supabaseClient", () => ({
  supabase: { from: (table: string) => (table === "votes" ? makeVotesQuery() : makeVotesQuery()) },
}));

vi.mock("../blockchain/merkleContract", () => ({
  getWritableMerkleContract: () => null,
}));

beforeEach(() => {
  vi.resetModules();
  VOTES_STATE.count = 0;
  VOTES_STATE.oldestCreatedAt = null;
});

describe("maybeAutoAnchor — age-based fallback trigger (docs threat_model.md §6)", () => {
  it("does not trigger when below count threshold and the oldest unanchored vote is recent", async () => {
    process.env.AUTO_ANCHOR_MAX_AGE_MS = String(30 * 60 * 1000);
    VOTES_STATE.count = 3;
    VOTES_STATE.oldestCreatedAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min old

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { maybeAutoAnchor } = await import("./anchorBatch");
    await maybeAutoAnchor();

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Auto-anchor:"))).toBe(false);
    logSpy.mockRestore();
  });

  it("triggers on age even when far below the count threshold", async () => {
    process.env.AUTO_ANCHOR_MAX_AGE_MS = String(30 * 60 * 1000);
    VOTES_STATE.count = 3; // well below AUTO_ANCHOR_THRESHOLD (50)
    VOTES_STATE.oldestCreatedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min old

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { maybeAutoAnchor } = await import("./anchorBatch");
    await maybeAutoAnchor();

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Auto-anchor:") && String(c[0]).includes("old"))).toBe(
      true
    );
    logSpy.mockRestore();
  });

  it("still triggers on count alone, unaffected by the age fallback", async () => {
    process.env.AUTO_ANCHOR_MAX_AGE_MS = String(30 * 60 * 1000);
    VOTES_STATE.count = 50;
    VOTES_STATE.oldestCreatedAt = new Date(Date.now() - 1000).toISOString(); // seconds old

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { maybeAutoAnchor } = await import("./anchorBatch");
    await maybeAutoAnchor();

    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes("Auto-anchor:") && String(c[0]).includes(">="))
    ).toBe(true);
    logSpy.mockRestore();
  });
});

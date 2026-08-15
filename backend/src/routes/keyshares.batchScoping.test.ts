/**
 * keyshares.batchScoping.test.ts — proves GET /keyshares/status, GET
 * /keyshares/verification-bundle, and POST /keyshares/tally are scoped to
 * an EXPLICITLY requested batch_id, with no "latest batch" fallback, and
 * that requesting one batch cannot accidentally pull another's data.
 *
 * Directly motivated by a real live-data finding: this project's actual
 * latest anchored batch turned out to be ~80% test/fixture data, while an
 * earlier, smaller batch was fully genuine. The routes must never silently
 * prefer "latest" over "explicitly named."
 *
 * Uses an in-memory mock of supabaseClient (not a live DB — see
 * testUtils/testSupabaseEnv.ts for why DB-touching tests must never run
 * against production without deliberate, isolated test-DB configuration).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";

process.env.ADMIN_SECRET = "test-admin-secret";

const BATCH_0 = { election_id: "TEST-ELECTION", batch_id: 0, root: "0x" + "aa".repeat(32), vote_ids: ["vote-a", "vote-b"] };
const BATCH_2 = { election_id: "TEST-ELECTION", batch_id: 2, root: "0x" + "bb".repeat(32), vote_ids: ["vote-x", "vote-y", "vote-z"] };

const VOTES = [
  { id: "vote-a", election_id: "TEST-ELECTION", nullifier_hash: "n-a", encrypted_vote: { c1: "1a", c2: "2a" }, constituency_code: "CON-01", created_at: "2026-01-01T00:00:00Z" },
  { id: "vote-b", election_id: "TEST-ELECTION", nullifier_hash: "n-b", encrypted_vote: { c1: "1b", c2: "2b" }, constituency_code: "CON-01", created_at: "2026-01-01T00:00:01Z" },
  { id: "vote-x", election_id: "TEST-ELECTION", nullifier_hash: "n-x", encrypted_vote: { c1: "1x", c2: "2x" }, constituency_code: "CON-01", created_at: "2026-01-02T00:00:00Z" },
  { id: "vote-y", election_id: "TEST-ELECTION", nullifier_hash: "n-y", encrypted_vote: { c1: "1y", c2: "2y" }, constituency_code: "CON-01", created_at: "2026-01-02T00:00:01Z" },
  { id: "vote-z", election_id: "TEST-ELECTION", nullifier_hash: "n-z", encrypted_vote: { c1: "1z", c2: "2z" }, constituency_code: "CON-01", created_at: "2026-01-02T00:00:02Z" },
];

const TABLES: Record<string, any[]> = {
  elections: [{ election_id: "TEST-ELECTION", constituency_count: 8 }],
  merkle_batches: [BATCH_0, BATCH_2],
  votes: VOTES,
  partial_decryptions: [
    { election_id: "TEST-ELECTION", keyholder_index: 1, ballot_id: "vote-a" }, // batch 0 only
  ],
  key_shares: [
    { election_id: "TEST-ELECTION", share_index: 1, keyholder_id: "KH-001", keyholder_role: "Election Commission", public_commitment: "0x" + "a1".repeat(32) },
  ],
  election_key_ceremony: [{ election_id: "TEST-ELECTION", p_hex: "17", g_hex: "3", feldman_commitments: [] }],
  election_setup_commitments: [{ election_id: "TEST-ELECTION", commitment: "0x" + "cc".repeat(32), candidates_root: "0x" + "dd".repeat(32), constituencies_root: "0x" + "ee".repeat(32) }],
  tally_results: [],
  voters: [],
  candidates: [],
  constituencies: [],
  smt_batches: [],
};

function makeQuery(rows: any[]) {
  let result = [...rows];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: any) => { result = result.filter((r) => r[col] === val); return builder; },
    in: (col: string, vals: any[]) => { result = result.filter((r) => vals.includes(r[col])); return builder; },
    not: () => builder,
    order: () => builder,
    limit: (n: number) => { result = result.slice(0, n); return builder; },
    maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
    upsert: async () => ({ data: null, error: null }),
    then: (resolve: any) => resolve({ data: result, error: null }),
  };
  return builder;
}

vi.mock("../supabaseClient", () => ({
  supabase: { from: (table: string) => makeQuery(TABLES[table] ?? []) },
}));

vi.mock("../services/anchorSmtBatch", () => ({
  verifyBatchSmtCoverage: vi.fn(async (_electionId: string, _nullifierHashes: string[]) => ({
    allCovered: true,
    missing: [],
    smtRoot: "0x" + "ff".repeat(32),
  })),
  getSmtProof: vi.fn(async (_electionId: string, nullifierHash: string) => ({
    type: "membership" as const,
    root: "0x" + "ff".repeat(32),
    proof: { key: nullifierHash, value: "0x" + "00".repeat(32), bitmap: "0x" + "00".repeat(32), siblings: [] },
  })),
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const keysharesRouter = (await import("./keyshares")).default;
  const app = express();
  app.use(express.json());
  app.use("/keyshares", keysharesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

describe("GET /keyshares/status — explicit batch_id required", () => {
  it("rejects a request with no batch_id (400)", async () => {
    const res = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION`);
    expect(res.status).toBe(400);
  });

  it("batch_id=0 returns exactly batch 0's ballot count, never batch 2's", async () => {
    const res = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION&batch_id=0`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.batch_id).toBe(0);
    expect(body.dense_root).toBe(BATCH_0.root);
    expect(body.anchored_ballot_count).toBe(2);
  });

  it("batch_id=2 returns exactly batch 2's ballot count, never batch 0's", async () => {
    const res = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION&batch_id=2`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.batch_id).toBe(2);
    expect(body.dense_root).toBe(BATCH_2.root);
    expect(body.anchored_ballot_count).toBe(3);
  });

  it("an unknown batch_id 404s rather than silently falling back to latest", async () => {
    const res = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION&batch_id=999`);
    expect(res.status).toBe(404);
  });

  it("a keyholder's submission count is scoped to THIS batch's ballots, not leaked from another batch (methodology-audit finding, live)", async () => {
    // Fixture has a partial_decryptions row for keyholder 1 on vote-a
    // (batch 0's ballot). Batch 2 shares no ballots with batch 0, so
    // keyholder 1's ballots_submitted for batch 2 must be 0, not carried
    // over from their batch-0 submission.
    const res0 = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION&batch_id=0`);
    const body0: any = await res0.json();
    expect(body0.keyholders.find((k: any) => k.index === 1).ballots_submitted).toBe(1);

    const res2 = await fetch(`${baseUrl}/keyshares/status?election_id=TEST-ELECTION&batch_id=2`);
    const body2: any = await res2.json();
    expect(body2.keyholders.find((k: any) => k.index === 1).ballots_submitted).toBe(0);
  });
});

describe("GET /keyshares/verification-bundle — explicit batch_id required, no cross-batch leakage", () => {
  it("rejects a request with no batch_id (400)", async () => {
    const res = await fetch(`${baseUrl}/keyshares/verification-bundle?election_id=TEST-ELECTION`);
    expect(res.status).toBe(400);
  });

  it("batch_id=0 returns ONLY vote-a/vote-b, never any of batch 2's vote-x/y/z", async () => {
    const res = await fetch(`${baseUrl}/keyshares/verification-bundle?election_id=TEST-ELECTION&batch_id=0`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.anchored_batch_ref.dense_batch_id).toBe(0);
    const ids = body.ballots.map((b: any) => b.ballot_id).sort();
    expect(ids).toEqual(["vote-a", "vote-b"]);
  });

  it("batch_id=2 returns ONLY vote-x/y/z, never batch 0's vote-a/vote-b", async () => {
    const res = await fetch(`${baseUrl}/keyshares/verification-bundle?election_id=TEST-ELECTION&batch_id=2`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.anchored_batch_ref.dense_batch_id).toBe(2);
    const ids = body.ballots.map((b: any) => b.ballot_id).sort();
    expect(ids).toEqual(["vote-x", "vote-y", "vote-z"]);
  });
});

describe("POST /keyshares/tally — explicit batch_id required, no cross-batch leakage", () => {
  it("rejects a request with no batch_id (400)", async () => {
    const res = await fetch(`${baseUrl}/keyshares/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": "test-admin-secret" },
      body: JSON.stringify({ election_id: "TEST-ELECTION" }),
    });
    expect(res.status).toBe(400);
  });

  it("batch_id=0 tallies against batch 0's root/vote set, not batch 2's", async () => {
    const res = await fetch(`${baseUrl}/keyshares/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": "test-admin-secret" },
      body: JSON.stringify({ election_id: "TEST-ELECTION", batch_id: 0 }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.anchored_dense_batch_id).toBe(0);
    expect(body.anchored_dense_root).toBe(BATCH_0.root);
    expect(body.total_votes).toBe(2);
  });

  it("batch_id=2 tallies against batch 2's root/vote set, not batch 0's", async () => {
    const res = await fetch(`${baseUrl}/keyshares/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": "test-admin-secret" },
      body: JSON.stringify({ election_id: "TEST-ELECTION", batch_id: 2 }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.anchored_dense_batch_id).toBe(2);
    expect(body.anchored_dense_root).toBe(BATCH_2.root);
    expect(body.total_votes).toBe(3);
  });

  it("rejects (409) when the SMT coverage check fails for the requested batch", async () => {
    const anchorSmtBatch = await import("../services/anchorSmtBatch");
    vi.mocked(anchorSmtBatch.verifyBatchSmtCoverage).mockResolvedValueOnce({
      allCovered: false,
      missing: ["n-a"],
      smtRoot: "0x" + "ff".repeat(32),
    });
    const res = await fetch(`${baseUrl}/keyshares/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": "test-admin-secret" },
      body: JSON.stringify({ election_id: "TEST-ELECTION", batch_id: 0 }),
    });
    expect(res.status).toBe(409);
  });
});

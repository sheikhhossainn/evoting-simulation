/**
 * vote.setupCommitment.test.ts — proves POST /vote refuses ballots for an
 * election_id with no anchored election_setup_commitments row, and does
 * NOT block once a commitment exists (docs/tally-verifiability-design.md
 * §8.2.5: "POST /vote should refuse to accept ballots for an election_id
 * with no anchored electionSetupCommitment yet").
 *
 * This precondition was previously specified in the design doc but never
 * implemented in code — found during the methodology audit. Mocked
 * supabaseClient (in-memory), no live DB — mirrors the pattern in
 * keyshares.batchScoping.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "http";

process.env.NID_HASH_SALT = "test-salt";
process.env.NULLIFIER_SECRET = "test-nullifier-secret";

const TABLES: Record<string, any[]> = {
  election_setup_commitments: [
    { election_id: "COMMITTED-ELECTION", commitment: "0x" + "cc".repeat(32) },
  ],
  nullifiers: [],
  candidates: [],
};

function makeQuery(rows: any[]) {
  let result = [...rows];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: any) => {
      result = result.filter((r) => r[col] === val);
      return builder;
    },
    order: () => builder,
    maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: result, error: null }),
  };
  return builder;
}

vi.mock("../supabaseClient", () => ({
  supabase: { from: (table: string) => makeQuery(TABLES[table] ?? []) },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const voteRouter = (await import("./vote")).default;
  const app = express();
  app.use(express.json());
  app.use(voteRouter);
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

function voteBody(electionId: string) {
  return {
    nid: "12345678901",
    encrypted_vote: { c1: "1a", c2: "2a" },
    election_id: electionId,
    zkp_proof: { challenges: ["c"], responses: ["r"] },
  };
}

describe("POST /vote — election setup commitment precondition (docs §8.2.5)", () => {
  it("rejects (412) a vote for an election with no anchored setup commitment", async () => {
    const res = await fetch(`${baseUrl}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voteBody("UNCOMMITTED-ELECTION")),
    });
    expect(res.status).toBe(412);
    const body: any = await res.json();
    expect(body.error).toMatch(/setup commitment/i);
  });

  it("does not block on the commitment precondition once one is anchored (proceeds past step 0)", async () => {
    const res = await fetch(`${baseUrl}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voteBody("COMMITTED-ELECTION")),
    });
    // Commitment exists, so it clears step 0 and proceeds to candidate
    // derivation — which 404s because the mock's `candidates` table is
    // empty. The point of this test is that it is NOT 412.
    expect(res.status).not.toBe(412);
    expect(res.status).toBe(404);
  });
});

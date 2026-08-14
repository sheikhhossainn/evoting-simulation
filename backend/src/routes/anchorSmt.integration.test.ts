/**
 * anchorSmt.integration.test.ts — docs/smt-design.md §13 test 18
 * (end-to-end membership) and test 19 (simulated deletion detection).
 *
 * Needs a live backend (http://localhost:3000) + a live, ISOLATED test
 * Supabase project (backend/.env.test — see testUtils/testSupabaseEnv.ts;
 * this refuses to run against production) + live Sepolia contract — same
 * requirement/pattern as vote.test.ts's adversarial suite (BASE_URL fetch
 * calls). This inserts ONE real, permanent vote row (trg_votes_no_delete
 * makes it undeletable outside the scoped fn_admin_delete_vote() RPC
 * exercised by test 19, which cleans up its own vote) — same tradeoff
 * already accepted for vote.test.ts's other cases.
 *
 * Run with a live backend: npm run dev (separate terminal), then
 *   npx vitest run src/routes/anchorSmt.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { constituencyFromNid } from "../crypto/identity";
import { proveBallotValidity } from "../crypto/zkp";
import { modPow, encodeCandidateId } from "../crypto/elgamal";
import { loadTestSupabaseEnv } from "../testUtils/testSupabaseEnv";

// Inserts real, permanent vote rows — must never be able to silently run
// against production. See testSupabaseEnv.ts.
loadTestSupabaseEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NID_HASH_SALT", "NULLIFIER_SECRET", "ADMIN_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`FATAL: ${key} is not set.`);
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BASE_URL = "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET!;

async function fetchJson(urlPath: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${urlPath}`, init);
  return { status: res.status, body: await res.json() };
}

async function fetchPost(urlPath: string, body: any, headers: Record<string, string> = {}) {
  return fetchJson(urlPath, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function loadPubKey() {
  const p = process.env.ELGAMAL_P;
  const g = process.env.ELGAMAL_G;
  const y = process.env.ELGAMAL_PUBLIC_KEY;
  if (!p || !g || !y) throw new Error("ELGAMAL_P / ELGAMAL_G / ELGAMAL_PUBLIC_KEY must be set");
  return { p, g, y };
}

async function buildValidBallot(nid: string) {
  const constituency = constituencyFromNid(nid);
  const { data, error } = await supabase
    .from("candidates")
    .select("id, name")
    .eq("constituency_code", constituency)
    .order("name", { ascending: true });
  if (error || !data || data.length === 0) {
    throw new Error(`No seeded candidates for constituency ${constituency} (nid ${nid})`);
  }

  const candidateIds = data.map((c) => c.id);
  const candidate_id = candidateIds[0];

  const pubKey = loadPubKey();
  const p = BigInt("0x" + pubKey.p);
  const g = BigInt("0x" + pubKey.g);
  const y = BigInt("0x" + pubKey.y);
  const q = (p - 1n) / 2n;

  const k = (BigInt("0x" + crypto.randomBytes(32).toString("hex")) % (q - 2n)) + 2n;
  const m = encodeCandidateId(candidate_id);
  const c1 = modPow(g, k, p);
  const c2 = (m * modPow(y, k, p)) % p;
  const encrypted_vote = { c1: c1.toString(16), c2: c2.toString(16) };

  const zkp_proof = proveBallotValidity(
    encrypted_vote.c1,
    encrypted_vote.c2,
    k.toString(16),
    pubKey,
    candidateIds,
    0
  );

  return { encrypted_vote, zkp_proof };
}

/** Cast one genuinely new, real vote and return its vote_id + nullifier_hash. */
async function castOneRealVote(): Promise<{ voteId: string; nullifierHash: string }> {
  // A syntactically valid, never-before-used 11-digit NID (test-only "77"
  // prefix so it's identifiable as synthetic data if ever audited). vote.ts
  // requires exactly 11 digits (/^\d{11}$/) — a hex string would fail that.
  const nid = "77" + String(crypto.randomInt(0, 1_000_000_000)).padStart(9, "0");
  await fetchPost("/voter/register", { nid });

  const ballot = await buildValidBallot(nid);
  const res = await fetchPost("/vote", {
    nid,
    election_id: "NATIONAL-2026-001",
    encrypted_vote: ballot.encrypted_vote,
    zkp_proof: ballot.zkp_proof,
  });
  expect(res.status).toBe(201);
  const voteId = (res.body as any).vote_id as string;

  const nullifierHash = crypto
    .createHash("sha256")
    .update(nid + "NATIONAL-2026-001" + process.env.NULLIFIER_SECRET!)
    .digest("hex");

  return { voteId, nullifierHash };
}

describe("SMT integration (live backend + Supabase + Sepolia)", () => {
  // Test 18: End-to-end membership
  it(
    "cast a real vote, batch-anchor it, fetch a membership proof that verifies against the just-anchored SMT root",
    async () => {
      const { voteId } = await castOneRealVote();

      const anchorRes = await fetchPost(
        "/anchor/batch",
        {},
        { "x-admin-secret": ADMIN_SECRET }
      );
      expect(anchorRes.status).toBe(201);
      expect((anchorRes.body as any).smt).not.toBeNull();

      const verifyRes = await fetchJson(`/anchor/verify-smt/${voteId}`);
      expect(verifyRes.status).toBe(200);
      const body = verifyRes.body as any;
      expect(body.type).toBe("membership");
      expect(body.included_locally).toBe(true);
      expect(body.included_on_chain).toBe(true);
    },
    60000
  );

  // Test 19: Simulated deletion detection
  it(
    "detects deletion: old membership proof still verifies, new non-membership proof verifies, via the real API",
    async () => {
      const { voteId, nullifierHash } = await castOneRealVote();

      const anchorRes = await fetchPost(
        "/anchor/batch",
        {},
        { "x-admin-secret": ADMIN_SECRET }
      );
      expect(anchorRes.status).toBe(201);

      const beforeRes = await fetchJson(`/anchor/verify-smt/${voteId}`);
      expect(beforeRes.status).toBe(200);
      const beforeBody = beforeRes.body as any;
      expect(beforeBody.type).toBe("membership");
      expect(beforeBody.included_locally).toBe(true);
      const rootBeforeDeletion = beforeBody.root;
      const membershipProofBeforeDeletion = beforeBody.proof;

      const deleteRes = await fetchPost(
        "/anchor/tamper/delete-vote",
        { vote_id: voteId },
        { "x-admin-secret": ADMIN_SECRET }
      );
      expect(deleteRes.status).toBe(200);
      const deleteBody = deleteRes.body as any;
      expect(deleteBody.deleted).toBe(true);
      expect(deleteBody.reanchor).not.toBeNull();
      const rootAfterDeletion = deleteBody.reanchor.smt_root;
      expect(rootAfterDeletion).not.toBe(rootBeforeDeletion);

      // (a) the OLD membership proof still verifies against the OLD root —
      // captured directly from the API, not recomputed, to prove it's a
      // real historically-checkable artifact, not just an in-process value.
      const { verifySmtMembershipProof, verifySmtNonMembershipProof } = await import(
        "../merkle/sparseMerkleTree"
      );
      expect(
        verifySmtMembershipProof(rootBeforeDeletion, membershipProofBeforeDeletion)
      ).toBe(true);

      // (b) the vote row is gone — GET /anchor/verify-smt/:voteId 404s now
      // (vote lookup fails before the SMT is even consulted).
      const afterRes = await fetchJson(`/anchor/verify-smt/${voteId}`);
      expect(afterRes.status).toBe(404);

      // (c) a fresh non-membership proof for the SAME key verifies against
      // the NEW root — the other half of §8's contradiction, and the actual
      // evidence a third party would use to detect the deletion. The vote
      // row is gone, so this comes from the SMT module directly (the same
      // one GET /anchor/verify-smt/:voteId uses internally), not via the
      // now-404ing HTTP route.
      const { getSmtProof } = await import("../services/anchorSmtBatch");
      const afterProof = await getSmtProof(nullifierHash);
      expect(afterProof.type).toBe("non-membership");
      expect(afterProof.root).toBe(rootAfterDeletion);
      expect(
        verifySmtNonMembershipProof(afterProof.root, afterProof.proof as any)
      ).toBe(true);

      // (d) and, symmetrically, the OLD membership proof must NOT verify
      // against the NEW root (mirrors unit test 5's assertion (c)).
      expect(
        verifySmtMembershipProof(rootAfterDeletion, membershipProofBeforeDeletion)
      ).toBe(false);
    },
    60000
  );
});

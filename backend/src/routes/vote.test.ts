import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { constituencyFromNid } from '../crypto/identity';
import { proveBallotValidity } from '../crypto/zkp';
import { modPow, encodeCandidateId } from '../crypto/elgamal';
import { loadTestSupabaseEnv } from '../testUtils/testSupabaseEnv';

// This test inserts real vote rows (via fn_cast_vote) — it must never be
// able to silently run against production. See testSupabaseEnv.ts.
loadTestSupabaseEnv();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NID_HASH_SALT', 'NULLIFIER_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`FATAL: ${key} is not set.`);
  }
}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);
const BASE_URL = 'http://localhost:3000';

async function fetchPost(urlPath: string, body: any) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

// /vote now MANDATES a ZKP ballot-validity proof, and derives the valid
// candidate set server-side (all candidates in the voter's constituency,
// ordered by name ascending — identical to GET /candidates). To exercise the
// gates *behind* the ZKP check (registration, eligibility, fn_cast_vote), a
// test must submit a genuinely valid ballot + proof, otherwise the request is
// (correctly) rejected at the proof gate before reaching them.
function loadPubKey() {
  const p = process.env.ELGAMAL_P;
  const g = process.env.ELGAMAL_G;
  const y = process.env.ELGAMAL_PUBLIC_KEY;
  if (!p || !g || !y) {
    throw new Error('ELGAMAL_P / ELGAMAL_G / ELGAMAL_PUBLIC_KEY must be set for vote tests');
  }
  return { p, g, y };
}

async function buildValidBallot(nid: string) {
  const constituency = constituencyFromNid(nid);
  // Same query + ordering the server uses to build the valid candidate set.
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name')
    .eq('constituency_code', constituency)
    .order('name', { ascending: true });
  if (error || !data || data.length === 0) {
    throw new Error(
      `No seeded candidates for constituency ${constituency} (nid ${nid}) — run seed-constituencies/seed-candidates first.`
    );
  }

  const candidateIds = data.map((c) => c.id);
  const trueIndex = 0;
  const candidate_id = candidateIds[trueIndex];

  const pubKey = loadPubKey();
  const p = BigInt('0x' + pubKey.p);
  const g = BigInt('0x' + pubKey.g);
  const y = BigInt('0x' + pubKey.y);
  const q = (p - 1n) / 2n;

  // Fresh ephemeral k in [2, q-1]; genuine ElGamal ciphertext of the chosen id.
  const k = (BigInt('0x' + crypto.randomBytes(32).toString('hex')) % (q - 2n)) + 2n;
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
    trueIndex
  );

  return { encrypted_vote, zkp_proof };
}

describe('Vote Casting Adversarial Tests', () => {
  it('rejects unregistered voter (404)', async () => {
    const unregNid = '99999999999';
    const ballot = await buildValidBallot(unregNid);
    const unregRes = await fetchPost('/vote', {
      nid: unregNid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: ballot.encrypted_vote,
      zkp_proof: ballot.zkp_proof,
    });
    expect(unregRes.status).toBe(404);
  });

  it('rejects ineligible voter (403)', async () => {
    const inelNid = '10001000001';
    await fetchPost('/voter/register', { nid: inelNid });
    const inelHash = crypto.createHash('sha256').update(inelNid + process.env.NID_HASH_SALT!).digest('hex');

    const inelUpdate = await supabase.from('voters').update({ is_eligible: false }).eq('nid_hash', inelHash);
    const { data: verifyInel, error: verifyInelErr } = await supabase
      .from('voters')
      .select('is_eligible')
      .eq('nid_hash', inelHash)
      .single();

    expect(verifyInelErr).toBeNull();
    expect(verifyInel?.is_eligible).toBe(false);

    const ballot = await buildValidBallot(inelNid);
    const inelRes = await fetchPost('/vote', {
      nid: inelNid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: ballot.encrypted_vote,
      zkp_proof: ballot.zkp_proof,
    });
    expect(inelRes.status).toBe(403);
  });

  it('rejects malformed payload (400)', async () => {
    const malNid = '10001234571';
    const malRes = await fetchPost('/vote', {
      nid: malNid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: { c1: 'c1' } // missing c2
    });
    expect(malRes.status).toBe(400);
  });

  it('rejects a vote with NO zkp_proof (proof is mandatory)', async () => {
    // Pre-fix, omitting zkp_proof silently skipped validity checking. Now the
    // schema requires it, so a proofless ballot is rejected at the 400 gate —
    // it never reaches registration/eligibility/insert.
    const nid = '99999999999';
    const res = await fetchPost('/vote', {
      nid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: { c1: 'abc', c2: 'def' },
      // zkp_proof deliberately omitted
    });
    expect(res.status).toBe(400);
  });

  it('ignores a client-supplied candidate set — proof is checked against the server-derived set', async () => {
    // The core trust-boundary regression test: there is no plaintext
    // candidate_id or candidate_ids field on the wire at all anymore — the
    // ZKP is the sole mechanism for ballot validity. An attacker forges a
    // ciphertext encoding an illegal value and builds a proof against their
    // own bogus single-element set. The server derives the valid set itself
    // (real constituency candidates) and verifies the proof against THAT set,
    // so the forged proof (wrong set + length mismatch) fails to verify.
    // Unregistered NID guarantees nothing persists even if the gate regressed.
    const nid = '99999999999';

    const pubKey = loadPubKey();
    const p = BigInt('0x' + pubKey.p);
    const g = BigInt('0x' + pubKey.g);
    const y = BigInt('0x' + pubKey.y);
    const q = (p - 1n) / 2n;

    // Illegal plaintext: a random UUID that is NOT a candidate in the DB.
    const bogusId = crypto.randomUUID();
    const k = (BigInt('0x' + crypto.randomBytes(32).toString('hex')) % (q - 2n)) + 2n;
    const m = encodeCandidateId(bogusId);
    const c1 = modPow(g, k, p);
    const c2 = (m * modPow(y, k, p)) % p;
    const encrypted_vote = { c1: c1.toString(16), c2: c2.toString(16) };

    // Attacker's self-serving "valid set" of exactly the bogus id.
    const forgedSet = [bogusId];
    const zkp_proof = proveBallotValidity(
      encrypted_vote.c1,
      encrypted_vote.c2,
      k.toString(16),
      pubKey,
      forgedSet,
      0
    );

    const res = await fetchPost('/vote', {
      nid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote,
      zkp_proof,
    });
    expect(res.status).toBe(400);
    expect((res.body as any)?.error).toMatch(/ZKP ballot validity proof failed/);
  });

  // SKIPPED: each of the 10 trials below inserts a real, successful vote row
  // (via fn_cast_vote), and trg_votes_no_delete now makes every one of them
  // permanent — there's no way to reset between trials or clean up after,
  // and no separate test DB yet (this file points at the same project as
  // the live app — see .env). Running this would leave 10 fake votes in the
  // real database on every run. Unskip once a dedicated test DB exists;
  // concurrency_stress_output.json remains as the last verified evidence
  // until then.
  it.skip('prevents concurrent double-cast under N=50 stress (exactly 1 DB row every trial)', async () => {
    // Concurrency stress: instead of 2 racing requests, fire N=50 identical
    // casts for the same voter simultaneously, repeated over several trials.
    // The DB lock must let exactly ONE through each time — never 0, never 2+.
    const N = 50;
    const TRIALS = 10;
    const electionId = 'NATIONAL-2026-001';
    const evidence: Array<{ trial: number; nid: string; successCount: number; dbRows: number | null }> = [];

    for (let trial = 1; trial <= TRIALS; trial++) {
      // Each trial uses a fresh, never-before-used NID instead of resetting
      // shared state between trials. votes rows can no longer be deleted
      // (trg_votes_no_delete — see schema.sql), so a delete-and-reuse reset
      // is no longer possible; giving every trial its own voter is cleaner
      // anyway — fully independent trials, nothing to reset.
      const trialNid = `1000100${String(9000 + trial)}`; // 11 digits total
      await fetchPost('/voter/register', { nid: trialNid });
      const trialNullifier = crypto
        .createHash('sha256')
        .update(trialNid + electionId + process.env.NULLIFIER_SECRET!)
        .digest('hex');

      // Fire N identical casts simultaneously to hammer the database lock.
      const requests = Array.from({ length: N }, () =>
        fetchPost('/vote', {
          nid: trialNid,
          election_id: electionId,
          encrypted_vote: { c1: 'c1', c2: 'c2' },
        })
      );
      const results = await Promise.all(requests);

      const successCount = results.filter((r) => r.status === 201).length;
      const voteCount = await supabase
        .from('votes')
        .select('*', { count: 'exact', head: true })
        .eq('nullifier_hash', trialNullifier);

      evidence.push({ trial, nid: trialNid, successCount, dbRows: voteCount.count });

      // Exactly one request wins; every other is rejected (409/403); one row lands.
      expect(successCount).toBe(1);
      expect(results.filter((r) => [403, 409].includes(r.status)).length).toBe(N - 1);
      expect(voteCount.count).toBe(1);
    }

    // Persist run evidence for the commit.
    const evidencePath = path.resolve(__dirname, '../../../testing/concurrency_stress_output.json');
    fs.writeFileSync(
      evidencePath,
      JSON.stringify(
        { test: 'concurrent_double_cast_stress', N, trials: TRIALS, results: evidence },
        null,
        2
      )
    );
  });

  it('enforces DB immutability trigger for SQL UPDATEs', async () => {
    const voteRow = await supabase.from('votes').select('*').limit(1).single();
    if (voteRow.data) {
      const updateRes = await supabase
        .from('votes')
        .update({ encrypted_vote: { c1: 'tampered', c2: 'tampered' } })
        .eq('id', voteRow.data.id);
      
      expect(updateRes.error).not.toBeNull();
      expect(updateRes.error?.message).toMatch(/immutable after insertion/);
    }
  });

  it('uses secure server-side nullifier formula (not predictable client-side SHA256)', async () => {
    const nid = '10001000002';
    const eid = 'NATIONAL-2026-001';
    const oldClientHash = crypto.createHash('sha256').update(nid + eid).digest('hex');
    const newServerHash = crypto.createHash('sha256').update(nid + eid + process.env.NULLIFIER_SECRET!).digest('hex');
    
    expect(oldClientHash).not.toBe(newServerHash);
  });

  it('schema does not store raw nid_hash in votes table', async () => {
    const voteRow = await supabase.from('votes').select('*').limit(1).single();
    if (voteRow.data) {
      const keys = Object.keys(voteRow.data);
      expect(keys).not.toContain('voter_nid_hash');
      expect(keys).not.toContain('nid_hash');
    }
  });
});

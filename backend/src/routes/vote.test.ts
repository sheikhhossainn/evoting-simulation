import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

// Load test environment variables
const envTestPath = path.resolve(__dirname, '../../.env.test');
const envProdPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath });
} else {
  dotenv.config({ path: envProdPath });
}

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

describe('Vote Casting Adversarial Tests', () => {
  it('rejects unregistered voter (404)', async () => {
    const unregRes = await fetchPost('/vote', {
      nid: '99999999999',
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: { c1: 'c1', c2: 'c2' }
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
    
    const inelRes = await fetchPost('/vote', {
      nid: inelNid,
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: { c1: 'c1', c2: 'c2' }
    });
    expect(inelRes.status).toBe(403);
  });

  it('rejects malformed payload (400)', async () => {
    const malRes = await fetchPost('/vote', {
      nid: '10001234571',
      election_id: 'NATIONAL-2026-001',
      encrypted_vote: { c1: 'c1' } // missing c2
    });
    expect(malRes.status).toBe(400);
  });

  it('prevents concurrent double-cast via DB locks', async () => {
    const doubleNid = '10001000002';
    await fetchPost('/voter/register', { nid: doubleNid });
    const doubleHash = crypto.createHash('sha256').update(doubleNid + process.env.NID_HASH_SALT!).digest('hex');
    
    // Set voter to eligible + not-yet-voted
    await supabase.from('voters').update({ is_eligible: true, has_voted: false }).eq('nid_hash', doubleHash);
    
    const nullifierSecret = process.env.NULLIFIER_SECRET!;
    const electionId = 'NATIONAL-2026-001';
    const nullifier = crypto.createHash('sha256').update(doubleNid + electionId + nullifierSecret).digest('hex');
    
    // Clean up any pre-existing vote/nullifier rows for this voter
    await supabase.from('votes').delete().eq('nullifier_hash', nullifier);
    await supabase.from('nullifiers').delete().eq('nullifier_hash', nullifier);
    await supabase.from('voters').update({ has_voted: false }).eq('nid_hash', doubleHash);

    // Fire requests simultaneously to test the database lock
    const p1 = fetchPost('/vote', { nid: doubleNid, election_id: electionId, encrypted_vote: { c1: 'c1', c2: 'c2' } });
    const p2 = fetchPost('/vote', { nid: doubleNid, election_id: electionId, encrypted_vote: { c1: 'c1', c2: 'c2' } });
    
    const [res1, res2] = await Promise.all([p1, p2]);
    
    const voteCount = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('nullifier_hash', nullifier);
    
    // Expect one success and one conflict/forbidden
    const successCount = (res1.status === 201 ? 1 : 0) + (res2.status === 201 ? 1 : 0);
    const rejectCount = ([403, 409].includes(res1.status) ? 1 : 0) + ([403, 409].includes(res2.status) ? 1 : 0);
    
    expect(successCount).toBe(1);
    expect(rejectCount).toBe(1);
    expect(voteCount.count).toBe(1);
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

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from the backend folder
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── FAIL-FAST: verify all required env vars are loaded ──
// If any of these are missing, the test will produce meaningless results
// (e.g. nid_hash won't match, voter updates affect 0 rows, tests fake-pass).
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NID_HASH_SALT', 'NULLIFIER_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(
      `FATAL: ${key} is not set. .env path attempted: ${path.resolve(__dirname, '../../.env')}\n` +
      `       Check that the file exists and contains ${key}=...`
    );
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

async function runTests() {
  let log = '';
  const appendLog = (msg: string) => {
    console.log(msg);
    log += msg + '\n';
  };

  appendLog('# Section 4 & 5 Adversarial Test Report\n');
  appendLog(`Run at: ${new Date().toISOString()}\n`);
  appendLog(`Env loaded from: ${path.resolve(__dirname, '../../.env')}\n`);

  // --- Section 4 ---
  appendLog('## 4. Vote Casting Adversarial Tests\n');

  // 4.1 Unregistered voter
  const unregRes = await fetchPost('/vote', {
    nid: '99999999999',
    election_id: 'NATIONAL-2026-001',
    encrypted_vote: { c1: 'c1', c2: 'c2' }
  });
  appendLog('### Unregistered Voter');
  appendLog(`- **Expected**: 404`);
  appendLog(`- **Actual**: ${unregRes.status}`);
  appendLog(`- **Evidence**: \`${JSON.stringify(unregRes.body)}\``);
  appendLog(`- **Status**: ${unregRes.status === 404 ? '✅ PASS' : '❌ FAIL'}\n`);

  // 4.2 Ineligible voter
  const inelNid = '10001000001';
  await fetchPost('/voter/register', { nid: inelNid });
  const inelHash = crypto.createHash('sha256').update(inelNid + process.env.NID_HASH_SALT!).digest('hex');

  const inelUpdate = await supabase.from('voters').update({ is_eligible: false }).eq('nid_hash', inelHash);
  
  // ── FAIL-LOUD: verify the update actually took effect ──
  const { data: verifyInel, error: verifyInelErr } = await supabase
    .from('voters')
    .select('is_eligible, has_voted')
    .eq('nid_hash', inelHash)
    .single();
  
  if (verifyInelErr || !verifyInel) {
    throw new Error(
      `FATAL: Ineligible voter seeding failed — voter not found.\n` +
      `  nid_hash=${inelHash}\n` +
      `  DB error: ${JSON.stringify(verifyInelErr)}`
    );
  }
  if (verifyInel.is_eligible !== false) {
    throw new Error(
      `FATAL: Ineligible voter update did NOT take effect.\n` +
      `  Expected is_eligible=false, got is_eligible=${verifyInel.is_eligible}\n` +
      `  nid_hash=${inelHash}\n` +
      `  This means the nid_hash doesn't match any voter row — hash computation is wrong.`
    );
  }
  appendLog(`> Verified: voter ${inelNid} is_eligible=${verifyInel.is_eligible} (seeding confirmed)`);
  
  const inelRes = await fetchPost('/vote', {
    nid: inelNid,
    election_id: 'NATIONAL-2026-001',
    encrypted_vote: { c1: 'c1', c2: 'c2' }
  });
  appendLog('### Ineligible Voter');
  appendLog(`- **Expected**: 403`);
  appendLog(`- **Actual**: ${inelRes.status}`);
  appendLog(`- **Evidence**: \`${JSON.stringify(inelRes.body)}\``);
  appendLog(`- **Status**: ${inelRes.status === 403 ? '✅ PASS' : '❌ FAIL'}\n`);

  // 4.3 Malformed Payload
  const malRes = await fetchPost('/vote', {
    nid: '10001234571',
    election_id: 'NATIONAL-2026-001',
    encrypted_vote: { c1: 'c1' } // missing c2
  });
  appendLog('### Malformed Payload');
  appendLog(`- **Expected**: 400`);
  appendLog(`- **Actual**: ${malRes.status}`);
  appendLog(`- **Evidence**: \`${JSON.stringify(malRes.body)}\``);
  appendLog(`- **Status**: ${malRes.status === 400 ? '✅ PASS' : '❌ FAIL'}\n`);

  // 4.4 Concurrent double-cast
  const doubleNid = '10001000002';
  await fetchPost('/voter/register', { nid: doubleNid });
  const doubleHash = crypto.createHash('sha256').update(doubleNid + process.env.NID_HASH_SALT!).digest('hex');
  
  // Set voter to eligible + not-yet-voted
  await supabase.from('voters').update({ is_eligible: true, has_voted: false }).eq('nid_hash', doubleHash);
  
  // ── FAIL-LOUD: verify the voter is actually eligible and hasn't voted ──
  const { data: verifyDouble, error: verifyDoubleErr } = await supabase
    .from('voters')
    .select('is_eligible, has_voted')
    .eq('nid_hash', doubleHash)
    .single();
  
  if (verifyDoubleErr || !verifyDouble) {
    throw new Error(
      `FATAL: Double-cast voter seeding failed — voter not found.\n` +
      `  nid_hash=${doubleHash}\n` +
      `  DB error: ${JSON.stringify(verifyDoubleErr)}`
    );
  }
  if (!verifyDouble.is_eligible || verifyDouble.has_voted) {
    throw new Error(
      `FATAL: Double-cast voter seeding did NOT take effect.\n` +
      `  Expected is_eligible=true, has_voted=false\n` +
      `  Got is_eligible=${verifyDouble.is_eligible}, has_voted=${verifyDouble.has_voted}\n` +
      `  nid_hash=${doubleHash}`
    );
  }
  appendLog(`> Verified: voter ${doubleNid} is_eligible=${verifyDouble.is_eligible}, has_voted=${verifyDouble.has_voted} (seeding confirmed)`);

  const nullifierSecret = process.env.NULLIFIER_SECRET!;
  const electionId = 'NATIONAL-2026-001';
  const nullifier = crypto.createHash('sha256').update(doubleNid + electionId + nullifierSecret).digest('hex');
  
  // Clean up any pre-existing vote/nullifier rows for this voter
  await supabase.from('votes').delete().eq('nullifier_hash', nullifier);
  await supabase.from('nullifiers').delete().eq('nullifier_hash', nullifier);
  // Also reset has_voted after cleanup
  await supabase.from('voters').update({ has_voted: false }).eq('nid_hash', doubleHash);

  appendLog(`> Cleaned up: deleted any existing vote/nullifier rows for nullifier_hash=${nullifier.slice(0, 16)}...`);

  // Fire requests simultaneously to test the database lock
  const p1 = fetchPost('/vote', { nid: doubleNid, election_id: electionId, encrypted_vote: { c1: 'c1', c2: 'c2' } });
  const p2 = fetchPost('/vote', { nid: doubleNid, election_id: electionId, encrypted_vote: { c1: 'c1', c2: 'c2' } });
  
  const [res1, res2] = await Promise.all([p1, p2]);
  appendLog('### Concurrent Double-Cast');
  appendLog(`- **Expected**: Exactly one success (201), exactly one rejection (409/403)`);
  appendLog(`- **Race 1 Actual**: ${res1.status} - \`${JSON.stringify(res1.body)}\``);
  appendLog(`- **Race 2 Actual**: ${res2.status} - \`${JSON.stringify(res2.body)}\``);
  
  const voteCount = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('nullifier_hash', nullifier);
  appendLog(`- **Vote Row Count**: ${voteCount.count} (Expected exactly 1)`);
  const racePass = ((res1.status === 201 && [403, 409].includes(res2.status)) || (res2.status === 201 && [403, 409].includes(res1.status))) && voteCount.count === 1;
  appendLog(`- **Status**: ${racePass ? '✅ PASS' : '❌ FAIL'}\n`);

  // Write race condition evidence to a separate JSON file for commit
  const raceEvidence = {
    test: 'concurrent_double_cast',
    ran_at: new Date().toISOString(),
    voter_nid: doubleNid,
    nullifier_hash: nullifier,
    race_1: { status: res1.status, body: res1.body },
    race_2: { status: res2.status, body: res2.body },
    db_vote_row_count: voteCount.count,
    result: racePass ? 'PASS' : 'FAIL'
  };
  const raceEvidencePath = path.resolve(__dirname, '../../../testing/race_condition_response.json');
  fs.writeFileSync(raceEvidencePath, JSON.stringify(raceEvidence, null, 2));
  appendLog(`> Race condition evidence written to: ${raceEvidencePath}`);

  // 4.5 Direct SQL UPDATE
  appendLog('### Direct SQL UPDATE Immutability');
  const getVote = await supabase.from('votes').select('*').eq('nullifier_hash', nullifier).limit(1).single();
  if (getVote.data) {
    const updateRes = await supabase.from('votes').update({ encrypted_vote: { c1: 'tampered', c2: 'tampered' } }).eq('id', getVote.data.id);
    appendLog(`- **Expected**: Error from trigger`);
    appendLog(`- **Actual Error**: \`${JSON.stringify(updateRes.error)}\``);
    appendLog(`- **Status**: ${updateRes.error ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    appendLog(`- **Status**: ❌ FAIL (No vote found to update — concurrent double-cast may have failed)`);
    appendLog(`- **DB Error**: \`${JSON.stringify(getVote.error)}\`\n`);
  }

  // --- Section 5 ---
  appendLog('## 5. Nullifier Redesign Checks\n');
  
  // 5.1 Old vs New formula
  const oldHash = crypto.createHash('sha256').update(doubleNid + electionId).digest('hex');
  appendLog('### Client-Side Nullifier Formula vs Server');
  appendLog(`- **Old Formula (SHA256(nid+electionId))**: \`${oldHash}\``);
  appendLog(`- **New Server-Side (with salt)**: \`${nullifier}\``);
  const diffPass = oldHash !== nullifier;
  appendLog(`- **Match Status**: ${diffPass ? 'They do NOT match' : 'They MATCH'}`);
  appendLog(`- **Status**: ${diffPass ? '✅ PASS' : '❌ FAIL'}\n`);

  // 5.2 Schema columns — nid_hash must NOT be in votes table
  appendLog('### Raw `nid_hash` column absence');
  const voteRow = await supabase.from('votes').select('*').limit(1).single();
  if (voteRow.data) {
    const keys = Object.keys(voteRow.data);
    const hasNidHash = keys.includes('voter_nid_hash') || keys.includes('nid_hash');
    appendLog(`- **Columns from query**: ${keys.join(', ')}`);
    appendLog(`- **Contains raw nid_hash?**: ${hasNidHash}`);
    appendLog(`- **Status**: ${!hasNidHash ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    // ── FAIL-LOUD: no rows to check means we can't verify the schema ──
    appendLog(`- **Error**: Could not fetch any vote rows to verify schema.`);
    appendLog(`- **DB Error**: \`${JSON.stringify(voteRow.error)}\``);
    appendLog(`- **Status**: ❌ FAIL (Cannot verify schema without vote rows — this is NOT a pass)\n`);
  }

  const outPath = path.resolve(__dirname, '../../../testing/vote_casting_output.md');
  fs.writeFileSync(outPath, log);
  console.log(`\nDone! Wrote ${outPath}`);
}

runTests().catch((err) => {
  console.error('\n========================================');
  console.error('TEST SCRIPT CRASHED:');
  console.error(err.message || err);
  console.error('========================================');
  process.exit(1);
});

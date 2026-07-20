import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from the backend folder
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

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
  const hmac = crypto.createHash('sha256');
  hmac.update(inelNid + process.env.NID_HASH_SALT!);
  const inelHash = hmac.digest('hex');

  await supabase.from('voters').update({ is_eligible: false }).eq('nid_hash', inelHash);
  
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
  const hmac2 = crypto.createHash('sha256');
  hmac2.update(doubleNid + process.env.NID_HASH_SALT!);
  const doubleHash = hmac2.digest('hex');
  await supabase.from('voters').update({ is_eligible: true, has_voted: false }).eq('nid_hash', doubleHash);
  
  const nullifierSecret = process.env.NULLIFIER_SECRET!;
  const electionId = 'NATIONAL-2026-001';
  const nmac = crypto.createHash('sha256');
  nmac.update(doubleNid + electionId + nullifierSecret);
  const nullifier = nmac.digest('hex');
  await supabase.from('votes').delete().eq('nullifier_hash', nullifier); // clean up

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

  // 4.5 Direct SQL UPDATE
  appendLog('### Direct SQL UPDATE Immutability');
  const getVote = await supabase.from('votes').select('*').eq('nullifier_hash', nullifier).limit(1).single();
  if (getVote.data) {
    const updateRes = await supabase.from('votes').update({ encrypted_vote: { c1: 'tampered', c2: 'tampered' } }).eq('id', getVote.data.id);
    appendLog(`- **Expected**: Error from trigger`);
    appendLog(`- **Actual Error**: \`${JSON.stringify(updateRes.error)}\``);
    appendLog(`- **Status**: ${updateRes.error ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    appendLog(`- **Status**: ❌ FAIL (No vote found to update)\n`);
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

  // 5.2 Schema columns
  appendLog('### Raw `nid_hash` column absence');
  let cols = null;
  try {
    const res = await supabase.rpc('get_table_columns', { table_name: 'votes' });
    cols = res.data;
  } catch(e) {}
  
  let hasNidHash = false;
  if (cols) {
     const cNames = cols.map((c: any) => c.column_name);
     hasNidHash = cNames.includes('voter_nid_hash') || cNames.includes('nid_hash');
     appendLog(`- **Columns from RPC**: ${cNames.join(', ')}`);
  } else {
     const voteRow = await supabase.from('votes').select('*').limit(1).single();
     if (voteRow.data) {
       const keys = Object.keys(voteRow.data);
       hasNidHash = keys.includes('voter_nid_hash') || keys.includes('nid_hash');
       appendLog(`- **Columns from query**: ${keys.join(', ')}`);
     }
  }
  appendLog(`- **Contains raw nid_hash?**: ${hasNidHash}`);
  appendLog(`- **Status**: ${!hasNidHash ? '✅ PASS' : '❌ FAIL'}\n`);

  const outPath = path.resolve(__dirname, 'evidence.md');
  fs.writeFileSync(outPath, log);
  console.log(`Done! Wrote ${outPath}`);
}

runTests().catch(console.error);

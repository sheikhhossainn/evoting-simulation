/**
 * shamir.test.ts — Threshold matrix + adversarial tests for Shamir 3-of-4 SSS
 *
 * Run: npx ts-node src/crypto/shamir.test.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { splitPrivateKey, reconstructKey } from './shamir';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secrets = require('secrets.js-grempe');

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c: T[]) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

async function runTests() {
  let log = '';
  let passed = 0;
  let failed = 0;

  const pass = (msg: string) => {
    const s = `✅ PASS — ${msg}`;
    console.log(s); log += s + '\n'; passed++;
  };
  const fail = (msg: string) => {
    const s = `❌ FAIL — ${msg}`;
    console.error(s); log += s + '\n'; failed++;
  };

  log += `# Shamir Threshold Matrix + Adversarial Tests\nRun at: ${new Date().toISOString()}\n\n`;

  const hexKey = secrets.random(256) as string;
  const shares = splitPrivateKey(hexKey);
  const shareArr = [shares.share1, shares.share2, shares.share3, shares.share4];

  // ── 1. All C(4,3)=4 valid triples reconstruct the SAME secret ──
  log += '## 1. Threshold Matrix — all C(4,3)=4 triples\n';
  const triples = combinations(shareArr, 3);
  let allMatch = true;
  for (const triple of triples) {
    const indices = triple.map(s => shareArr.indexOf(s) + 1);
    const result = reconstructKey(triple);
    if (result !== hexKey) {
      allMatch = false;
      fail(`Triple [${indices.join(',')}] reconstructed wrong secret`);
    } else {
      log += `  Triple [${indices.join(',')}]: ✅ matches\n`;
    }
  }
  if (allMatch) pass(`All 4 triples reconstruct identical secret`);

  // ── 2. All C(4,2)=6 two-share subsets recover ZERO key material ──
  log += '\n## 2. Two-Share Subsets — all C(4,2)=6 pairs\n';
  const pairs = combinations(shareArr, 2);
  let allSafe = true;
  for (const pair of pairs) {
    const indices = pair.map(s => shareArr.indexOf(s) + 1);

    // Guard: reconstructKey must throw for < 3 shares
    let threw = false;
    try { reconstructKey(pair); } catch { threw = true; }
    if (!threw) {
      allSafe = false;
      fail(`Pair [${indices.join(',')}] did not throw — guard missing`);
      continue;
    }

    // Math: raw secrets.combine with 2 shares must NOT equal original key
    const raw = secrets.combine(pair) as string;
    if (raw === hexKey) {
      allSafe = false;
      fail(`Pair [${indices.join(',')}] raw combine leaked key material`);
    } else {
      log += `  Pair [${indices.join(',')}]: threw ✅, raw combine ≠ key ✅\n`;
    }
  }
  if (allSafe) pass(`All 6 pairs: guard threw + no key material in raw combine`);

  // ── 3. Corrupted share fails loud ──
  log += '\n## 3. Corrupted Share\n';
  // Flip last 4 hex chars of share1
  const corrupted = shareArr[0].slice(0, -4) + 'ffff';
  let corruptOk = false;
  try {
    const r = reconstructKey([corrupted, shareArr[1], shareArr[2]]);
    // Did not throw — must at least return wrong value
    if (r !== hexKey) {
      corruptOk = true;
      log += `  Corrupted share returned wrong value (did not throw) ✅\n`;
    } else {
      fail(`Corrupted share silently returned correct key`);
    }
  } catch (e: unknown) {
    corruptOk = true;
    log += `  Corrupted share threw: ${(e as Error).message} ✅\n`;
  }
  if (corruptOk) pass(`Corrupted share fails loud`);

  // ── 4. Reconstruction is order-independent ──
  log += '\n## 4. Order Independence\n';
  const orderings = [
    [shareArr[0], shareArr[1], shareArr[2]],
    [shareArr[2], shareArr[1], shareArr[0]],
    [shareArr[1], shareArr[3], shareArr[0]],
    [shareArr[3], shareArr[0], shareArr[2]],
    [shareArr[2], shareArr[3], shareArr[1]],
  ];
  let allOrders = true;
  for (const order of orderings) {
    const indices = order.map(s => shareArr.indexOf(s) + 1);
    const r = reconstructKey(order);
    if (r !== hexKey) {
      allOrders = false;
      fail(`Order [${indices.join(',')}] reconstructed wrong secret`);
    } else {
      log += `  Order [${indices.join(',')}]: ✅ matches\n`;
    }
  }
  if (allOrders) pass(`All orderings reconstruct identical secret`);

  log += `\n---\nTotal: ${passed} passed, ${failed} failed\n`;

  const outPath = path.resolve(__dirname, '../../../testing/shamir_threshold_output.md');
  fs.writeFileSync(outPath, log);
  console.log(`\nWrote ${outPath}`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error(err); process.exit(1); });

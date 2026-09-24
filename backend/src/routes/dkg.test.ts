/**
 * dkg.test.ts — full 3-round DKG ceremony flow against a mutable in-memory
 * mock of Supabase, proving:
 *   1. The ceremony reaches 'qualified' with the CORRECT combined Feldman
 *      commitment vector (elementwise product of the 4 dealers' public
 *      commitments, verified against direct computation).
 *   2. Each keyholder's key_shares.public_commitment matches their actual
 *      combined share.
 *   3. The existing, UNMODIFIED keyshares.ts routes (GET /commitments,
 *      POST /submit-partial) work correctly against DKG-produced data —
 *      the interop claim this whole design rests on.
 *
 * Round-2 ciphertext/iv payloads are dummy hex strings here — the backend
 * never decrypts them (pure relay, see dkg.ts's header comment), so
 * exercising the route logic doesn't require real AES-GCM. That math lives
 * in frontend/src/utils/dkgCrypto.ts and is a browser-only concern.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { createHash } from "crypto";
import crypto from "crypto";
import { modPow } from "../crypto/elgamal";
import { deriveShareCommitment, type FeldmanCommitments } from "../crypto/shamirZq";
import { combineFeldmanCommitments } from "../crypto/dkg";
import { proveDleq } from "../crypto/dleq";

process.env.ADMIN_SECRET = "test-admin-secret";

const EID = "TEST-DKG-ELECTION";

function hashPassphrase(passphrase: string): string {
  return createHash("sha256")
    .update(passphrase + (process.env.KEYHOLDER_PASSPHRASE_SALT || ""))
    .digest("hex");
}

function randomBigIntBelow(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  do {
    const buf = crypto.randomBytes(byteLength);
    result = BigInt("0x" + buf.toString("hex")) % max;
  } while (result === 0n);
  return result;
}

const ROLES = ["Election Commission", "Judiciary Observer", "Academic Auditor", "Civil Society Observer"];
const KEYHOLDERS = [1, 2, 3, 4].map((i) => ({
  election_id: EID,
  keyholder_id: `KH-00${i}`,
  role: ROLES[i - 1],
  share_index: i,
  passphrase_hash: hashPassphrase(`pass00${i}`),
}));

// ── In-memory, MUTABLE mock of the Supabase tables the ceremony touches —
// unlike keyshares.batchScoping.test.ts's read-only mock, upsert/insert/
// update here actually persist, since the ceremony's whole point is state
// accumulating across 12 separate requests (4 keyholders x 3 rounds). ──
const TABLES: Record<string, any[]> = {
  elections: [{ election_id: EID, constituency_count: 8 }],
  keyholders: [...KEYHOLDERS],
  election_key_ceremony: [],
  dkg_participants: [],
  dkg_shares: [],
  dkg_confirmations: [],
  key_shares: [],
  votes: [],
  partial_decryptions: [],
};

type Filter = { type: "eq" | "in"; col: string; val?: any; vals?: any[] };

function applyFilters(rows: any[], filters: Filter[]) {
  return rows.filter((r) => filters.every((f) => (f.type === "eq" ? r[f.col] === f.val : f.vals!.includes(r[f.col]))));
}

function onConflictKeys(onConflict: string | undefined): string[] {
  return (onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function makeBuilder(table: string) {
  const filters: Filter[] = [];
  let countMode = false;
  let updatePatch: Record<string, any> | null = null;
  let orderCol: string | null = null;

  const builder: any = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      countMode = !!opts?.count;
      return builder;
    },
    eq(col: string, val: any) {
      filters.push({ type: "eq", col, val });
      return builder;
    },
    in(col: string, vals: any[]) {
      filters.push({ type: "in", col, vals });
      return builder;
    },
    order(col: string) {
      orderCol = col;
      return builder;
    },
    update(patch: Record<string, any>) {
      updatePatch = patch;
      return builder;
    },
    async maybeSingle() {
      const rows = applyFilters(TABLES[table], filters);
      return { data: rows[0] ?? null, error: null };
    },
    async upsert(rowOrRows: any, opts?: { onConflict?: string }) {
      const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      const keys = onConflictKeys(opts?.onConflict);
      for (const row of rows) {
        const idx = TABLES[table].findIndex((r) => keys.length > 0 && keys.every((k) => r[k] === row[k]));
        if (idx >= 0) TABLES[table][idx] = { ...TABLES[table][idx], ...row };
        else TABLES[table].push({ ...row });
      }
      return { data: null, error: null };
    },
    async insert(rowOrRows: any) {
      const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      for (const row of rows) TABLES[table].push({ ...row });
      return { data: null, error: null };
    },
    then(resolve: any) {
      if (updatePatch !== null) {
        const matched = applyFilters(TABLES[table], filters);
        for (const row of matched) Object.assign(row, updatePatch);
        resolve({ data: matched, error: null });
        return;
      }
      let rows = applyFilters(TABLES[table], filters);
      if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol!] > b[orderCol!] ? 1 : -1));
      if (countMode) {
        resolve({ count: rows.length, data: null, error: null });
      } else {
        resolve({ data: rows, error: null });
      }
    },
  };
  return builder;
}

vi.mock("../supabaseClient", () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const dkgRouter = (await import("./dkg")).default;
  const keysharesRouter = (await import("./keyshares")).default;
  const app = express();
  app.use(express.json());
  app.use("/dkg", dkgRouter);
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

async function postJson(path: string, body: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-secret": "test-admin-secret" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function evalPoly(poly: bigint[], index: bigint, q: bigint): bigint {
  let value = 0n;
  let power = 1n;
  for (const coeff of poly) {
    value = (value + coeff * power) % q;
    power = (power * index) % q;
  }
  return value;
}

describe("DKG ceremony — full 3-round flow", () => {
  it("runs init -> round1 x4 -> round2 x4 -> round3 x4, qualifies with the correct combined commitments, and interops with the unmodified keyshares.ts routes", async () => {
    const init = await postJson("/dkg/init", { election_id: EID });
    expect(init.status).toBe(201);

    // Use the ACTUAL group params /dkg/init just established for this
    // election (it generates its own fresh p, g — a test-local P/G would
    // silently mismatch what the server stores everything else against).
    const P = BigInt("0x" + init.body.group_params.p);
    const G = BigInt("0x" + init.body.group_params.g);
    const Q = (P - 1n) / 2n;

    // Each keyholder's own polynomial — ground truth kept in the test,
    // exactly mirroring what each keyholder's own browser generates.
    const polynomials: bigint[][] = [0, 1, 2, 3].map(() => [
      randomBigIntBelow(Q),
      randomBigIntBelow(Q),
      randomBigIntBelow(Q),
    ]);
    const commitmentVectors: FeldmanCommitments[] = polynomials.map((poly) => poly.map((c) => modPow(G, c, P)));

    // ── round 1 ──
    for (let i = 0; i < 4; i++) {
      const r = await postJson("/dkg/round1", {
        election_id: EID,
        keyholder_id: `KH-00${i + 1}`,
        passphrase: `pass00${i + 1}`,
        commitments: commitmentVectors[i].map((c) => c.toString(16)),
        ecdh_pubkey: "ab".repeat(32),
      });
      expect(r.status).toBe(201);
      expect(r.body.index).toBe(i + 1);
    }

    const round1Res = await fetch(`${baseUrl}/dkg/round1?election_id=${EID}`);
    const r1: any = await round1Res.json();
    expect(r1.complete).toBe(true);
    expect(r1.participants).toHaveLength(4);

    // ── round 2 (dummy ciphertext — backend only relays it) ──
    for (let i = 0; i < 4; i++) {
      const shares = [1, 2, 3, 4].map((to) => ({ to_index: to, ciphertext: "cd".repeat(16), iv: "ef".repeat(12) }));
      const r = await postJson("/dkg/round2", {
        election_id: EID,
        keyholder_id: `KH-00${i + 1}`,
        passphrase: `pass00${i + 1}`,
        shares,
      });
      expect(r.status).toBe(201);
    }

    const inbox1 = await postJson("/dkg/round2/inbox", { election_id: EID, keyholder_id: "KH-001", passphrase: "pass001" });
    expect(inbox1.body.complete).toBe(true);
    expect(inbox1.body.inbox).toHaveLength(4);

    // ── round 3 — the 4th confirmation triggers server-side combination ──
    for (let i = 0; i < 3; i++) {
      const r = await postJson("/dkg/round3", { election_id: EID, keyholder_id: `KH-00${i + 1}`, passphrase: `pass00${i + 1}` });
      expect(r.status).toBe(201);
      expect(r.body.qualified).toBe(false);
    }
    const last = await postJson("/dkg/round3", { election_id: EID, keyholder_id: "KH-004", passphrase: "pass004" });
    expect(last.status).toBe(201);
    expect(last.body.qualified).toBe(true);

    // ── combined commitments must match direct computation ──
    const expectedCombined = combineFeldmanCommitments(commitmentVectors, P);
    const ceremonyRow = TABLES.election_key_ceremony.find((r) => r.election_id === EID);
    expect(ceremonyRow.status).toBe("qualified");
    expect((ceremonyRow.feldman_commitments as string[]).map((h) => BigInt("0x" + h))).toEqual(expectedCombined);

    // ── each keyholder's public_commitment must match their actual combined share ──
    for (let idx = 1; idx <= 4; idx++) {
      const expectedY = deriveShareCommitment(BigInt(idx), expectedCombined, P);
      const row = TABLES.key_shares.find((r) => r.election_id === EID && r.share_index === idx);
      expect(BigInt("0x" + row.public_commitment)).toBe(expectedY);
    }

    // ── interop: the existing, UNMODIFIED keyshares.ts routes ──
    const commitmentsRes = await fetch(`${baseUrl}/keyshares/commitments?election_id=${EID}`);
    expect(commitmentsRes.status).toBe(200);
    const commitmentsBody: any = await commitmentsRes.json();
    expect(commitmentsBody.keyholder_commitments).toHaveLength(4);

    const ballotId = "11111111-1111-4111-8111-111111111111";
    const k = randomBigIntBelow(Q);
    const c1 = modPow(G, k, P);
    TABLES.votes.push({ id: ballotId, election_id: EID, encrypted_vote: { c1: c1.toString(16), c2: "1" } });

    // Each keyholder's ACTUAL combined share — what round 3 computes inside
    // their browser, summed from the 4 dealers' sub-shares at their index.
    const combinedShareAt = (index: bigint) => polynomials.reduce((acc, poly) => (acc + evalPoly(poly, index, Q)) % Q, 0n);

    for (let idx = 1; idx <= 3; idx++) {
      const x_i = combinedShareAt(BigInt(idx));
      const y_iHex = deriveShareCommitment(BigInt(idx), expectedCombined, P).toString(16);
      const d_i = modPow(c1, x_i, P);
      const proof = proveDleq(EID, ballotId, c1.toString(16), d_i.toString(16), x_i, y_iHex, G, P, Q);

      const r = await postJson("/keyshares/submit-partial", {
        election_id: EID,
        keyholder_id: `KH-00${idx}`,
        passphrase: `pass00${idx}`,
        partials: [{ ballot_id: ballotId, d_i: d_i.toString(16), proof }],
      });
      expect(r.status).toBe(201);
      expect(r.body.results[0].verified).toBe(true);
    }
  });

  it("rejects round2 before round1 is complete for that election (409)", async () => {
    const alone = "TEST-DKG-ROUND2-GUARD";
    TABLES.elections.push({ election_id: alone, constituency_count: 8 });
    TABLES.keyholders.push(...KEYHOLDERS.map((k) => ({ ...k, election_id: alone })));

    await postJson("/dkg/init", { election_id: alone });
    await postJson("/dkg/round1", {
      election_id: alone,
      keyholder_id: "KH-001",
      passphrase: "pass001",
      commitments: ["1", "2", "3"],
      ecdh_pubkey: "ab".repeat(32),
    });

    const r = await postJson("/dkg/round2", {
      election_id: alone,
      keyholder_id: "KH-001",
      passphrase: "pass001",
      shares: [1, 2, 3, 4].map((to) => ({ to_index: to, ciphertext: "cd".repeat(16), iv: "ef".repeat(12) })),
    });
    expect(r.status).toBe(409);
  });

  it("rejects an invalid passphrase (401)", async () => {
    const r = await postJson("/dkg/round1", {
      election_id: EID,
      keyholder_id: "KH-001",
      passphrase: "wrong-passphrase",
      commitments: ["1", "2", "3"],
      ecdh_pubkey: "ab".repeat(32),
    });
    expect(r.status).toBe(401);
  });

  it("rejects re-initializing an already-initialized ceremony (409)", async () => {
    const r = await postJson("/dkg/init", { election_id: EID });
    expect(r.status).toBe(409);
  });
});

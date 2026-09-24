/**
 * castIdentity.test.ts — the A1 spine of P2 (no database, no network).
 *
 * The load-bearing assertion here is that the SESSION path and the legacy
 * raw-NID path produce byte-identical (nid_hash, nullifier_hash,
 * constituency_code) for the same voter and election. If they ever diverged,
 * one voter would hold two pseudonyms in one election and could cast twice —
 * exactly what A1 forbids, and something the existing concurrency stress test
 * cannot catch because it exercises only the raw-NID path.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { computeNullifier, hashNidWithSalt } from "../crypto/identity";
import { resolveCastIdentity, type CastIdentityDeps } from "./castIdentity";
import { createSession } from "./sessionStore";
import { createFakeSessionRepo, type FakeSessionRepo } from "../testUtils/fakeSessionRepo";

const ELECTION = "election-1";
const OTHER_ELECTION = "election-2";
const NID = "12345678901";
const DEVICE = "11111111-1111-4111-8111-111111111111";
const CONSTITUENCY_COUNT = 8;

let repo: FakeSessionRepo;
let deps: CastIdentityDeps;
let lookupCalls: Array<{ electionId: string; nidHash: string }>;

beforeEach(() => {
  repo = createFakeSessionRepo();
  lookupCalls = [];
  deps = {
    sessionRepo: repo,
    async lookupConstituency(electionId, nidHash) {
      lookupCalls.push({ electionId, nidHash });
      // Stands in for the `voters` row: registered for this election only.
      if (nidHash === hashNidWithSalt(NID) && electionId === ELECTION) {
        return { constituencyCode: "CON-03" };
      }
      return { constituencyCode: null };
    },
  };
});

/** Issue a session for the NID exactly as POST /voter/session does. */
async function issueSession(electionId = ELECTION, deviceId = DEVICE) {
  const created = await createSession(repo, {
    electionId,
    voterNidHash: hashNidWithSalt(NID),
    nullifierHash: computeNullifier(NID, electionId),
    deviceId,
  });
  if (!created.ok) throw new Error("fixture failed");
  return created.token;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    token: null as string | null,
    deviceId: null as string | null,
    electionId: ELECTION,
    constituencyCount: CONSTITUENCY_COUNT,
    legacyNid: null as string | null,
    ...overrides,
  };
}

describe("resolveCastIdentity — session path", () => {
  it("derives all three values from the session, never from the request body", async () => {
    const token = await issueSession();

    const identity = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));

    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    expect(identity.source).toBe("session");
    expect(identity.nidHash).toBe(hashNidWithSalt(NID));
    expect(identity.nullifierHash).toBe(computeNullifier(NID, ELECTION));
    expect(identity.constituencyCode).toBe("CON-03");
    // The constituency came from the voters row the session is bound to.
    expect(lookupCalls).toEqual([{ electionId: ELECTION, nidHash: hashNidWithSalt(NID) }]);
  });

  it("THE A1 ASSERTION: session and legacy paths agree byte-for-byte", async () => {
    const token = await issueSession();

    const viaSession = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));
    const viaNid = await resolveCastIdentity(deps, baseInput({ legacyNid: NID }));

    expect(viaSession.ok && viaNid.ok).toBe(true);
    if (!viaSession.ok || !viaNid.ok) return;

    // One voter must occupy one pseudonym per election regardless of which
    // credential they used — otherwise mixed web/mobile voting would let them
    // cast twice under two different nullifiers.
    expect(viaSession.nidHash).toBe(viaNid.nidHash);
    expect(viaSession.nullifierHash).toBe(viaNid.nullifierHash);
    expect(viaSession.constituencyCode).toBe(viaNid.constituencyCode);
    expect(viaSession.source).not.toBe(viaNid.source);
  });

  it("refuses a session issued for a different election (403, no cross-election cast)", async () => {
    const token = await issueSession(OTHER_ELECTION);

    const identity = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));

    expect(identity.ok).toBe(false);
    if (identity.ok) return;
    expect(identity.status).toBe(403);
    expect(identity.code).toBe("UNAUTHORIZED");
    // Refused before any voter lookup, so a foreign session cannot even probe.
    expect(lookupCalls).toHaveLength(0);
  });

  it("refuses a session with no captured ballot identity", async () => {
    const token = await issueSession();
    repo.rows[0].nullifier_hash = null; // e.g. a row written out of band

    const identity = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));

    expect(identity.ok).toBe(false);
    if (identity.ok) return;
    expect(identity.status).toBe(401);
    expect(identity.code).toBe("SESSION_INVALID");
  });

  it("maps session failures to the app-actionable codes", async () => {
    const token = await issueSession();

    const deviceSwapped = await resolveCastIdentity(
      deps,
      baseInput({ token, deviceId: "22222222-2222-4222-8222-222222222222" })
    );
    expect(deviceSwapped.ok).toBe(false);
    if (!deviceSwapped.ok) expect(deviceSwapped.code).toBe("DEVICE_MISMATCH");

    const garbage = await resolveCastIdentity(
      deps,
      baseInput({ token: "z".repeat(43), deviceId: DEVICE })
    );
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.code).toBe("SESSION_INVALID");

    repo.rows[0].expires_at = new Date(Date.now() - 1_000).toISOString();
    const expired = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe("SESSION_EXPIRED");
  });

  it("reports 404 when the session's voter row is gone", async () => {
    const token = await issueSession();
    repo.rows[0].voter_nid_hash = "f".repeat(64);

    const identity = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));

    expect(identity.ok).toBe(false);
    if (identity.ok) return;
    expect(identity.status).toBe(404);
    expect(identity.code).toBe("VOTER_NOT_REGISTERED");
  });

  it("reports a retryable 503 when the voter lookup itself fails", async () => {
    const token = await issueSession();
    deps.lookupConstituency = async () => ({
      constituencyCode: null,
      errorMessage: "connection reset",
    });

    const identity = await resolveCastIdentity(deps, baseInput({ token, deviceId: DEVICE }));

    expect(identity.ok).toBe(false);
    if (identity.ok) return;
    expect(identity.status).toBe(503);
    expect(identity.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("resolveCastIdentity — legacy NID path", () => {
  it("is the compatibility branch, and is labelled as such", async () => {
    const identity = await resolveCastIdentity(deps, baseInput({ legacyNid: NID }));

    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    expect(identity.source).toBe("nid");
    expect(identity.constituencyCode).toBe("CON-03");
  });

  it("does not read the voters table (the derivation is deterministic)", async () => {
    await resolveCastIdentity(deps, baseInput({ legacyNid: NID }));

    expect(lookupCalls).toHaveLength(0);
  });

  it("refuses a request carrying neither credential", async () => {
    const identity = await resolveCastIdentity(deps, baseInput());

    expect(identity.ok).toBe(false);
    if (identity.ok) return;
    expect(identity.status).toBe(401);
    expect(identity.code).toBe("UNAUTHORIZED");
  });
});


/**
 * sessionStore.test.ts — §3.3 session lifecycle (P2 required tests).
 *
 * Runs entirely against the in-memory repo port: no database, no credentials,
 * no network. Covers the four required P2 assertions —
 *   1. lifecycle (issue → resolve → touch → expire → revoke → rotate)
 *   2. A-2(c): a tampered token is refused
 *   3. T15: only the hash is ever stored
 *   4. one NID, two sessions — and that the session binds to the SAME
 *      `voter_nid_hash` the raw-NID vote path computes, so A1 cannot weaken.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { hashNidWithSalt } from "../crypto/identity";
import {
  SESSION_TTL_MS,
  createSession,
  generateSessionToken,
  hashSessionToken,
  isWellFormedToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from "./sessionStore";
import { createFakeSessionRepo, type FakeSessionRepo } from "../testUtils/fakeSessionRepo";

const ELECTION = "election-1";
const NID = "12345678901";
const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";

let repo: FakeSessionRepo;

beforeEach(() => {
  repo = createFakeSessionRepo();
});

/** Issue a session exactly the way POST /voter/session does. */
async function issue(deviceId = DEVICE_A, now = Date.now()) {
  const result = await createSession(repo, {
    electionId: ELECTION,
    voterNidHash: hashNidWithSalt(NID),
    deviceId,
    createdIp: "203.0.113.9",
    now,
  });
  if (!result.ok) throw new Error("fixture failed to create a session");
  return result;
}

describe("session token storage (T15)", () => {
  it("mints a 256-bit opaque token that satisfies the format check", async () => {
    const { token } = await issue();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedToken(token)).toBe(true);
  });

  it("stores ONLY sha256(token) — never the token itself", async () => {
    const { token } = await issue();

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].token_hash).toBe(hashSessionToken(token));
    expect(repo.rows[0].token_hash).not.toBe(token);

    // The strongest form of the assertion: no field of the persisted row
    // contains the token, so a database dump yields no usable credential.
    expect(JSON.stringify(repo.rows)).not.toContain(token);
  });

  it("mints a different token every time", async () => {
    const first = await issue();
    const second = await issue();

    expect(second.token).not.toBe(first.token);
    expect(repo.rows[0].token_hash).not.toBe(repo.rows[1].token_hash);
  });

  it("rejects a malformed token before it ever reaches the database", async () => {
    const result = await resolveSession(repo, "not-a-real-token", { deviceId: DEVICE_A });

    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    // The rejection is pre-database: no lookup was wasted on an obviously
    // malformed value, so junk cannot drive query load.
    expect(repo.lookups).toBe(0);
  });
});

describe("session identity binding (A1 must not weaken)", () => {
  it("binds the session to the same voter_nid_hash the raw-NID path computes", async () => {
    await issue();

    // /voter/me and the future session-scoped /vote resolve the voter row with
    // this exact value. If the two derivations ever diverge, a session would
    // authenticate a voter whose ballot the vote path cannot attribute — so the
    // equality is asserted rather than assumed.
    expect(repo.rows[0].voter_nid_hash).toBe(hashNidWithSalt(NID));
    expect(repo.rows[0].voter_nid_hash).toHaveLength(64);
  });

  it("never stores the raw NID", async () => {
    await issue();

    expect(JSON.stringify(repo.rows)).not.toContain(NID);
  });

  it("allows a second device to hold its own session (multi-device is the deferred product decision)", async () => {
    const first = await issue(DEVICE_A);
    const second = await issue(DEVICE_B);

    expect(repo.rows).toHaveLength(2);
    // Two live sessions, one NID. Single-active-device was explicitly left as an
    // open product decision (THREAT_MODEL §4.T15 / MOBILE_UX D1), so the
    // *session* layer permits both; A1 still bounds the voter to one ballot.
    expect(repo.rows.every((row) => row.revoked_at === null)).toBe(true);

    const resolvedA = await resolveSession(repo, first.token, { deviceId: DEVICE_A });
    const resolvedB = await resolveSession(repo, second.token, { deviceId: DEVICE_B });
    expect(resolvedA.ok && resolvedB.ok).toBe(true);
  });
});

describe("session lifecycle", () => {
  it("resolves a valid token and slides the expiry window", async () => {
    const { token } = await issue();
    const now = Date.now() + 60_000;

    const result = await resolveSession(repo, token, { deviceId: DEVICE_A, now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.expires_at).toBe(new Date(now + SESSION_TTL_MS).toISOString());
    expect(repo.rows[0].expires_at).toBe(new Date(now + SESSION_TTL_MS).toISOString());
  });

  it("only ever writes the columns fn_sessions_guard permits", async () => {
    const { token } = await issue();
    await resolveSession(repo, token, { deviceId: DEVICE_A });
    await revokeSession(repo, repo.rows[0].id);

    // The guard rejects any change to token_hash, voter_nid_hash, election_id,
    // device_id or issued_at. Asserting field names here means a future edit
    // that tries to write something else fails in CI rather than on the first
    // live request.
    const allowed = new Set(["expires_at", "last_seen_at", "revoked_at"]);
    for (const update of repo.updates) {
      for (const field of update.fields) expect(allowed.has(field)).toBe(true);
    }
    expect(repo.updates.length).toBeGreaterThan(0);
  });

  it("does not touch the row when touch:false (refresh re-validates, it does not extend)", async () => {
    const { token } = await issue();
    const before = repo.rows[0].last_seen_at;

    const result = await resolveSession(repo, token, { deviceId: DEVICE_A, touch: false });

    expect(result.ok).toBe(true);
    expect(repo.rows[0].last_seen_at).toBe(before);
    expect(repo.updates).toHaveLength(0);
  });

  it("A-2(c): refuses a tampered token", async () => {
    const { token } = await issue();
    // Flip one character of an otherwise well-formed token.
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    const result = await resolveSession(repo, flipped, { deviceId: DEVICE_A });

    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(repo.lookups).toBe(1); // looked up and found nothing — not a format rejection
  });

  it("refuses a well-formed but unknown token (no session enumeration)", async () => {
    await issue();

    const result = await resolveSession(repo, generateSessionToken(), { deviceId: DEVICE_A });

    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("refuses a token presented from a different device (D6)", async () => {
    const { token } = await issue(DEVICE_A);

    const result = await resolveSession(repo, token, { deviceId: DEVICE_B });

    expect(result).toEqual({ ok: false, reason: "device_mismatch" });
  });

  it("compares device ids case-insensitively (UUID case must not lock a voter out)", async () => {
    const { token } = await issue(DEVICE_A);

    const result = await resolveSession(repo, token, { deviceId: DEVICE_A.toUpperCase() });

    expect(result.ok).toBe(true);
  });

  it("expires at the window boundary", async () => {
    const issuedAt = Date.now();
    const { token } = await issue(DEVICE_A, issuedAt);

    // touch:false on the first call is load-bearing: resolving a live token
    // slides the window forward, so a boundary check that touched would move
    // the very expiry it is about to test.
    const stillValid = await resolveSession(repo, token, {
      deviceId: DEVICE_A,
      now: issuedAt + SESSION_TTL_MS - 1,
      touch: false,
    });
    const justExpired = await resolveSession(repo, token, {
      deviceId: DEVICE_A,
      now: issuedAt + SESSION_TTL_MS,
    });

    expect(stillValid.ok).toBe(true);
    expect(justExpired).toEqual({ ok: false, reason: "expired" });
    // Refused before the touch, so an expired row is not silently revived.
    expect(repo.rows[0].expires_at).toBe(new Date(issuedAt + SESSION_TTL_MS).toISOString());
  });

  it("refuses a revoked session (sign-out is server-side and immediate)", async () => {
    const { token } = await issue();

    await revokeSession(repo, repo.rows[0].id);
    const result = await resolveSession(repo, token, { deviceId: DEVICE_A });

    expect(result).toEqual({ ok: false, reason: "revoked" });
    expect(new Date(repo.rows[0].revoked_at as string).getTime()).toBeGreaterThan(0);
  });

  it("rotate: the old token dies and the new one inherits identity + device", async () => {
    const original = await issue();

    const rotated = await rotateSession(repo, original.token, { deviceId: DEVICE_A });

    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.token).not.toBe(original.token);
    expect(rotated.session.voter_nid_hash).toBe(original.session.voter_nid_hash);
    expect(rotated.session.device_id).toBe(DEVICE_A);

    // The rotated-away token must stop working — that is the point of rotation.
    const reuse = await resolveSession(repo, original.token, { deviceId: DEVICE_A });
    expect(reuse).toEqual({ ok: false, reason: "revoked" });

    const fresh = await resolveSession(repo, rotated.token, { deviceId: DEVICE_A });
    expect(fresh.ok).toBe(true);
  });

  it("rotate refuses a device-swapped or unknown token", async () => {
    const first = await issue();

    const swapped = await rotateSession(repo, first.token, { deviceId: DEVICE_B });
    expect(swapped).toEqual({ ok: false, reason: "device_mismatch" });

    const unknown = await rotateSession(repo, "x".repeat(43), { deviceId: DEVICE_A });
    expect(unknown).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("revoke-all signs out every live device for one voter and nobody else", async () => {
    await issue(DEVICE_A);
    await issue(DEVICE_B);

    const otherVoter = await createSession(repo, {
      electionId: ELECTION,
      voterNidHash: hashNidWithSalt("99999999999"),
      deviceId: DEVICE_A,
    });
    expect(otherVoter.ok).toBe(true);

    const first = await revokeAllSessions(repo, ELECTION, hashNidWithSalt(NID));

    expect(first.ok).toBe(true);
    expect(first.revoked).toBe(2);
    expect(repo.rows.filter((row) => row.revoked_at === null)).toHaveLength(1);

    // Idempotent: nothing live remains for that voter, and the already-revoked
    // rows keep their original sign-out time.
    const second = await revokeAllSessions(repo, ELECTION, hashNidWithSalt(NID));
    expect(second.revoked).toBe(0);
  });

  it("revoke-all is scoped per election (one election's sign-out cannot reach another's)", async () => {
    await issue(DEVICE_A);
    const otherElection = await createSession(repo, {
      electionId: "election-2",
      voterNidHash: hashNidWithSalt(NID),
      deviceId: DEVICE_A,
    });
    expect(otherElection.ok).toBe(true);

    const result = await revokeAllSessions(repo, ELECTION, hashNidWithSalt(NID));

    expect(result.revoked).toBe(1);
    const survivors = repo.rows.filter((row) => row.revoked_at === null);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].election_id).toBe("election-2");
  });

  it("surfaces a store failure as a throw (the middleware turns it into a retryable 503)", async () => {
    const { token } = await issue();
    repo.failNextLookup({ message: "connection reset" });

    await expect(resolveSession(repo, token, { deviceId: DEVICE_A })).rejects.toThrow(
      /connection reset/
    );
  });
});


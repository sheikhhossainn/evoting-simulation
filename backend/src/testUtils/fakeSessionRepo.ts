/**
 * fakeSessionRepo.ts — in-memory `SessionRepo` for tests.
 *
 * Exists so the §3.3 session-lifecycle suite can run under `test:ci` with no
 * live database (the plan's "mock-Supabase" requirement). It is a *port*
 * implementation, not a mock of the service: the service code under test is the
 * real thing, only persistence is swapped.
 *
 * It additionally records the exact field names of every UPDATE, which lets a
 * test prove the service only ever touches `expires_at`/`last_seen_at`/
 * `revoked_at` — the columns `fn_sessions_guard` permits — without needing the
 * trigger itself.
 */
import type { NewSessionRow, RepoError, SessionRepo, SessionRow } from "../services/sessionStore";

export interface FakeSessionRepo extends SessionRepo {
  rows: SessionRow[];
  /** Field names of each update the service issued, in order. */
  updates: Array<{ id: string; fields: string[] }>;
  /** How many times the service looked a token up (pre-database rejections skip this). */
  lookups: number;
  /** Make the next lookups fail, to exercise the 503 path. */
  failNextLookup(error: RepoError): void;
  /** Insert a row directly, e.g. a session minted before a test's `now`. */
  seed(row: Partial<SessionRow> & { token_hash: string; voter_nid_hash: string; device_id: string }): SessionRow;
}

export function createFakeSessionRepo(): FakeSessionRepo {
  const rows: SessionRow[] = [];
  const updates: Array<{ id: string; fields: string[] }> = [];
  let lookups = 0;
  let sequence = 0;
  let forcedLookupError: RepoError | null = null;

  const clone = (row: SessionRow): SessionRow => ({ ...row });

  return {
    rows,
    updates,

    get lookups() {
      return lookups;
    },

    failNextLookup(error) {
      forcedLookupError = error;
    },

    seed(row) {
      sequence += 1;
      const now = new Date().toISOString();
      const full: SessionRow = {
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        election_id: "election-1",
        nullifier_hash: "b".repeat(64),
        issued_at: now,
        expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        last_seen_at: now,
        revoked_at: null,
        created_ip: null,
        ...row,
      } as SessionRow;
      rows.push(full);
      return clone(full);
    },

    async insert(input: NewSessionRow) {
      sequence += 1;
      const now = new Date().toISOString();
      const row: SessionRow = {
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        election_id: input.election_id,
        voter_nid_hash: input.voter_nid_hash,
        nullifier_hash: input.nullifier_hash,
        token_hash: input.token_hash,
        device_id: input.device_id,
        issued_at: now,
        expires_at: input.expires_at,
        last_seen_at: now,
        revoked_at: null,
        created_ip: input.created_ip,
      };
      rows.push(row);
      return { data: clone(row), error: null };
    },

    async findByTokenHash(tokenHash: string) {
      lookups += 1;
      if (forcedLookupError) {
        const error = forcedLookupError;
        forcedLookupError = null;
        return { data: null, error };
      }
      const found = rows.find((row) => row.token_hash === tokenHash) ?? null;
      return { data: found ? clone(found) : null, error: null };
    },

    async extend(id: string, expiresAt: string, lastSeenAt: string) {
      updates.push({ id, fields: ["expires_at", "last_seen_at"] });
      const row = rows.find((candidate) => candidate.id === id);
      if (row) {
        row.expires_at = expiresAt;
        row.last_seen_at = lastSeenAt;
      }
      return { error: null };
    },

    async revoke(id: string, revokedAt: string) {
      updates.push({ id, fields: ["revoked_at"] });
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.revoked_at = revokedAt;
      return { error: null };
    },

    async revokeAll(electionId: string, voterNidHash: string, revokedAt: string) {
      const live = rows.filter(
        (row) =>
          row.election_id === electionId &&
          row.voter_nid_hash === voterNidHash &&
          row.revoked_at === null
      );
      for (const row of live) {
        updates.push({ id: row.id, fields: ["revoked_at"] });
        row.revoked_at = revokedAt;
      }
      return { data: live.map((row) => ({ id: row.id })), error: null };
    },
  };
}

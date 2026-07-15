/**
 * nullifier.ts — Election constants & NID hashing helpers
 *
 * BALLOT SECRECY REDESIGN:
 * The client-side generateNullifier() function has been REMOVED. Nullifiers
 * are now computed exclusively server-side as
 * SHA-256(nid + election_id + NULLIFIER_SECRET) — see
 * backend/src/crypto/identity.ts. A nullifier computed in the browser could
 * never include a real secret (any "secret" shipped to the browser isn't a
 * secret), which meant anyone who knew a voter's NID could reproduce their
 * nullifier and link them to their vote. The client now sends the raw NID
 * to the backend (as it already did for /voter/register) and the server
 * derives everything.
 */

/**
 * The hardcoded election ID for this simulation.
 * Must match the id used across the keyholder/tallying flow
 * (KeyShareSubmit.tsx, KeyShareStatus.tsx) — votes and key shares are
 * both keyed by election_id, so a mismatch here would silently split
 * them into two unrelated "elections" and break tallying.
 */
export const ELECTION_ID = "NATIONAL-2026-001";

/**
 * Hash an NID to its SHA-256 hex digest.
 *
 * NOTE: this is an UNSALTED hash kept only for legacy display purposes
 * (e.g. showing a shortened voter identifier in the UI). It does NOT match
 * the server's salted nid_hash and must not be used for any lookup or
 * submission — the backend derives all real identifiers itself from the
 * raw NID.
 */
export async function hashNid(nid: string): Promise<string> {
  const payload = new TextEncoder().encode(nid);
  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
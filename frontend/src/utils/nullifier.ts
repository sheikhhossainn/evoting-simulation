/**
 * nullifier.ts — Client-side nullifier generation
 *
 * Computes SHA-256(NID + election_id) using the Web Crypto API.
 * The NID never leaves the browser in plaintext — only the
 * irreversible hash is sent to the server.
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
 * Generate a nullifier hash from NID and election ID.
 * Returns a 64-char lowercase hex string.
 */
export async function generateNullifier(
  nid: string,
  electionId: string = ELECTION_ID
): Promise<string> {
  const payload = new TextEncoder().encode(nid + electionId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash an NID to its SHA-256 hex digest (for nid_hash field).
 * Same algorithm the backend uses — ensures consistency.
 */
export async function hashNid(nid: string): Promise<string> {
  const payload = new TextEncoder().encode(nid);
  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

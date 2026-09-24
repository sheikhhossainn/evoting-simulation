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
 * Default election id, used when no `?election_id=` is present in the URL.
 * Multi-election isolation (threat_model.md §10): the frontend previously
 * hardcoded this as a module-level constant, duplicated across five files —
 * a mismatch between any two of them would silently split votes/key-shares
 * into two unrelated "elections." getElectionId() below is now the single
 * place every page reads it from, sourced from the URL (same pattern
 * already used for ?batch_id= in the Key Holder Portal), falling back to
 * this default so existing links/bookmarks with no election_id keep
 * working unchanged.
 */
export const DEFAULT_ELECTION_ID = "NATIONAL-2026-001";

/** Read `election_id` from a `location.search` string, or fall back to the default. */
export function getElectionId(search: string): string {
  const fromUrl = new URLSearchParams(search).get("election_id");
  return fromUrl && fromUrl.trim().length > 0 ? fromUrl : DEFAULT_ELECTION_ID;
}

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
/**
 * identity.ts — Shared identity-derivation helpers
 *
 * Centralizes the hashing/derivation logic that voter.ts and vote.ts
 * both need, so there's exactly one place that knows how nid_hash,
 * nullifier_hash, and constituency_code are computed.
 *
 * IMPORTANT: These functions take the RAW National ID. The raw NID
 * must never be persisted anywhere — it exists only transiently in
 * request handling to compute these derived values, then discarded.
 */

import { createHash } from "crypto";

/**
 * SHA-256(nid + NID_HASH_SALT).
 * Used to look up / register a voter in the `voters` table.
 * Server-side only — NID_HASH_SALT is never exposed to the client.
 */
export function hashNidWithSalt(nid: string): string {
  const salt = process.env.NID_HASH_SALT || "";
  return createHash("sha256").update(nid + salt).digest("hex");
}

/**
 * SHA-256(nid + electionId + NULLIFIER_SECRET).
 *
 * This is the ballot-secrecy fix: nullifiers must be computed with a
 * secret only the server holds, or anyone who knows a voter's NID
 * could compute their nullifier themselves. Deliberately NOT done
 * client-side — a "secret" sent to the browser isn't a secret.
 */
export function computeNullifier(nid: string, electionId: string): string {
  const secret = process.env.NULLIFIER_SECRET || "";
  return createHash("sha256")
    .update(nid + electionId + secret)
    .digest("hex");
}

/**
 * Derive constituency code from NID.
 * First 4 digits mod 8 → CON-01 through CON-08.
 * Deterministic — no DB lookup needed.
 */
export function constituencyFromNid(nid: string): string {
  const firstFour = parseInt(nid.slice(0, 4)) || 0;
  const id = (firstFour % 8) + 1;
  return `CON-${String(id).padStart(2, "0")}`;
}
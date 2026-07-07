/**
 * keyholders.ts — Keyholder passphrase verification
 *
 * POST /keyshares/submit previously accepted ANY non-empty passphrase for
 * ANY keyholder_id — nothing tied a submitted share to the person who was
 * supposed to hold it. That let anyone squat on a keyholder slot (submit
 * garbage before the real holder does) and corrupt the 3-of-4
 * reconstruction, or silently swap in a bogus share.
 *
 * This module verifies the passphrase against a salted hash per keyholder.
 * Demo defaults match the credentials shown on the Key Holder Portal UI
 * (KH-001/share001 ... KH-004/share004) so the out-of-box demo still
 * works. For a real deployment, override via KEYHOLDER_PASSPHRASE_HASH_1..4
 * in .env (sha256(passphrase + KEYHOLDER_PASSPHRASE_SALT) hex digest) so
 * the actual passphrases are never stored in the repo.
 */

import { createHash, timingSafeEqual } from "crypto";

const DEMO_PASSPHRASES: Record<string, string> = {
  "KH-001": "share001",
  "KH-002": "share002",
  "KH-003": "share003",
  "KH-004": "share004",
};

function hashPassphrase(passphrase: string): string {
  const salt = process.env.KEYHOLDER_PASSPHRASE_SALT || "";
  return createHash("sha256").update(passphrase + salt).digest("hex");
}

function envHashKeyFor(keyholderId: string): string {
  const index = keyholderId.replace(/^KH-0*/, "");
  return `KEYHOLDER_PASSPHRASE_HASH_${index}`;
}

/**
 * Verify that `passphrase` is the one assigned to `keyholderId`.
 * Falls back to the documented demo passphrase if no
 * KEYHOLDER_PASSPHRASE_HASH_<n> override is configured in .env.
 */
export function verifyKeyholderPassphrase(
  keyholderId: string,
  passphrase: string
): boolean {
  const configuredHash = process.env[envHashKeyFor(keyholderId)];
  const demoPassphrase = DEMO_PASSPHRASES[keyholderId];

  const expectedHash = configuredHash || (demoPassphrase ? hashPassphrase(demoPassphrase) : null);
  if (!expectedHash) return false;

  const actual = Buffer.from(hashPassphrase(passphrase), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

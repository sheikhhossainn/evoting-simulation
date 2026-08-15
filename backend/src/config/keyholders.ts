/**
 * keyholders.ts — Keyholder identity/passphrase verification, per election
 *
 * Multi-election isolation (threat_model.md §10): this used to be a static,
 * global map (DEMO_PASSPHRASES / KEYHOLDER_INDEX) — the same 4 keyholder ids
 * with the same passphrases and indices applied to every election, so two
 * concurrent elections would collide entirely on keyholder identity. Now
 * backed by the `keyholders` DB table (schema.sql), keyed by
 * (election_id, keyholder_id) — each election can have its own, disjoint
 * set of 4 keyholders.
 *
 * POST /keyshares/submit previously accepted ANY non-empty passphrase for
 * ANY keyholder_id — nothing tied a submitted share to the person who was
 * supposed to hold it. This module verifies the passphrase against a salted
 * hash per (election, keyholder). Seed rows via
 * backend/src/scripts/seed-keyholders.ts.
 */

import { createHash, timingSafeEqual } from "crypto";
import { supabase } from "../supabaseClient";

interface KeyholderRow {
  keyholder_id: string;
  role: string;
  share_index: number;
  passphrase_hash: string;
}

async function loadKeyholder(
  electionId: string,
  keyholderId: string
): Promise<KeyholderRow | null> {
  const { data, error } = await supabase
    .from("keyholders")
    .select("keyholder_id, role, share_index, passphrase_hash")
    .eq("election_id", electionId)
    .eq("keyholder_id", keyholderId)
    .maybeSingle();
  if (error) throw error;
  return data as KeyholderRow | null;
}

/**
 * Server-side (election_id, keyholder_id) -> share index mapping. The old
 * /keyshares/submit trusted a client-supplied share_index field (validated
 * only for range, not correctness) — the verifiable-tally flow derives it
 * server-side instead, so a keyholder cannot claim a different index than
 * the one they were actually issued.
 */
export async function getKeyholderIndex(
  electionId: string,
  keyholderId: string
): Promise<number | null> {
  const row = await loadKeyholder(electionId, keyholderId);
  return row?.share_index ?? null;
}

function hashPassphrase(passphrase: string): string {
  const salt = process.env.KEYHOLDER_PASSPHRASE_SALT || "";
  return createHash("sha256").update(passphrase + salt).digest("hex");
}

/**
 * Verify that `passphrase` is the one assigned to `keyholderId` for
 * `electionId`.
 */
export async function verifyKeyholderPassphrase(
  electionId: string,
  keyholderId: string,
  passphrase: string
): Promise<boolean> {
  const row = await loadKeyholder(electionId, keyholderId);
  if (!row) return false;

  const actual = Buffer.from(hashPassphrase(passphrase), "hex");
  const expected = Buffer.from(row.passphrase_hash, "hex");
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

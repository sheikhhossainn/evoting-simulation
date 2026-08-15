/**
 * electionContext.ts — single source of truth for "which election is this
 * request about" (threat_model.md §10, multi-election isolation).
 *
 * Replaces the two independently-copied `DEFAULT_ELECTION_ID =
 * "NATIONAL-2026-001"` constants that previously lived in keyshares.ts and
 * public.ts. Deliberately has NO fallback default — an omitted or typo'd
 * election_id must fail loud (404), not silently resolve to whichever
 * election happens to exist. A silent default is exactly what would make
 * cross-election leakage invisible: if a caller forgets `election_id` and
 * the request quietly serves election A's data, nothing about the response
 * looks wrong until someone notices it's the wrong election.
 */

import { supabase } from "../supabaseClient";

export interface ElectionRow {
  election_id: string;
  name: string;
  constituency_count: number;
  status: string;
  merkle_contract_address: string | null;
  election_setup_contract_address: string | null;
}

/**
 * Look up an election by id. Returns null if it doesn't exist — callers
 * decide the HTTP status (404 for most routes).
 */
export async function getElection(electionId: string): Promise<ElectionRow | null> {
  const { data, error } = await supabase
    .from("elections")
    .select(
      "election_id, name, constituency_count, status, merkle_contract_address, election_setup_contract_address"
    )
    .eq("election_id", electionId)
    .maybeSingle();
  if (error) throw error;
  return data as ElectionRow | null;
}

/**
 * Extract `election_id` from `source` (typically req.query or req.body) and
 * validate it against the elections registry.
 *
 * Returns `{ ok: true, electionId }` on success, or `{ ok: false, status,
 * error }` describing the HTTP response the caller should send — 400 for a
 * missing/malformed value, 404 for a well-formed but unregistered election.
 */
export async function resolveElectionId(
  source: Record<string, unknown> | undefined
): Promise<
  | { ok: true; electionId: string }
  | { ok: false; status: number; error: string }
> {
  const raw = source?.election_id;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, status: 400, error: "election_id is required" };
  }

  const election = await getElection(raw);
  if (!election) {
    return { ok: false, status: 404, error: `Unknown election_id: ${raw}` };
  }

  return { ok: true, electionId: raw };
}

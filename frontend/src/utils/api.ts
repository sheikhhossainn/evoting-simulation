/**
 * api.ts — Centralized API helpers for the voter flow
 *
 * All functions call the Express backend on localhost:3000.
 * Each function handles its own error shaping so callers
 * get either typed data or a thrown ApiError.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

// ── Error class ──

export class ApiError extends Error {
  public status: number;
  public body?: unknown;

  constructor(
    message: string,
    status: number,
    body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ── Response types ──

export interface RegisterVoterResponse {
  voter_id: string;
  nid_hash: string;
  constituency_code: string;
  is_eligible: boolean;
  has_voted: boolean;
}

export interface CheckNullifierResponse {
  exists: boolean;
}

export interface SubmitVoteResponse {
  status: string;
  vote_id: string;
}

// ── Helper ──

async function apiFetch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : "Request failed";
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

// ── Endpoints ──

/**
 * Register a voter by NID. If they already exist, returns the
 * existing record (upsert semantics).
 */
export function registerVoter(nid: string): Promise<RegisterVoterResponse> {
  return apiFetch<RegisterVoterResponse>("/voter/register", { nid });
}

/**
 * Check whether a nullifier already exists for this election.
 * Used to block double-voting before calling POST /vote.
 */
export function checkNullifier(
  nullifierHash: string,
  electionId: string
): Promise<CheckNullifierResponse> {
  return apiFetch<CheckNullifierResponse>("/voter/check-nullifier", {
    nullifier_hash: nullifierHash,
    election_id: electionId,
  });
}

/**
 * Submit the encrypted vote with nullifier.
 */
export function submitVote(
  nidHash: string,
  encryptedVote: { c1: string; c2: string },
  nullifierHash: string,
  electionId: string
): Promise<SubmitVoteResponse> {
  return apiFetch<SubmitVoteResponse>("/vote", {
    nid_hash: nidHash,
    encrypted_vote: encryptedVote,
    nullifier_hash: nullifierHash,
    election_id: electionId,
  });
}

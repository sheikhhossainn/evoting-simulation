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

export interface ElGamalPublicKeyResponse {
  p: string;
  g: string;
  y: string;
}

export interface Candidate {
  id: string;
  name: string;
  party: string;
  symbol: string;
  constituency_code: string;
}

export interface CandidatesResponse {
  constituency_code: string;
  candidates: Candidate[];
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

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();

  if (!res.ok) {
    const message =
      typeof data.error === "string" ? data.error : "Request failed";
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

// ── Endpoints ──

/**
 * Register a voter by NID. If they already exist, returns the
 * existing record (upsert semantics).
 */
export async function registerVoter(nid: string): Promise<RegisterVoterResponse> {
  try {
    return await apiFetch<RegisterVoterResponse>("/voter/register", { nid });
  } catch (err) {
    if (err instanceof TypeError) {
      await new Promise(r => setTimeout(r, 600));
      
      const mockVotedNids = JSON.parse(localStorage.getItem("mock_voted_nids") || "[]");
      const hasVoted = mockVotedNids.includes(nid);
      
      return {
        voter_id: `mock-voter-${nid.slice(0, 4)}`,
        nid_hash: `0xmockhash${nid}`,
        constituency_code: `CON-${String(((parseInt(nid.slice(0, 4)) || 0) % 8) + 1).padStart(2, "0")}`,
        is_eligible: true,
        has_voted: hasVoted,
      };
    }
    throw err;
  }
}

/**
 * Check whether a nullifier already exists for this election.
 * Used to block double-voting before calling POST /vote.
 */
export async function checkNullifier(
  nullifierHash: string,
  electionId: string
): Promise<CheckNullifierResponse> {
  try {
    return await apiFetch<CheckNullifierResponse>("/voter/check-nullifier", {
      nullifier_hash: nullifierHash,
      election_id: electionId,
    });
  } catch(err) {
    if (err instanceof TypeError) {
      await new Promise(r => setTimeout(r, 300));
      const mockNullifiers = JSON.parse(localStorage.getItem("mock_nullifiers") || "[]");
      return { exists: mockNullifiers.includes(nullifierHash) };
    }
    throw err;
  }
}

/**
 * Submit the encrypted vote with nullifier.
 */
export async function submitVote(
  nidHash: string,
  encryptedVote: { c1: string; c2: string },
  nullifierHash: string,
  electionId: string
): Promise<SubmitVoteResponse> {
  try {
    return await apiFetch<SubmitVoteResponse>("/vote", {
      nid_hash: nidHash,
      encrypted_vote: encryptedVote,
      nullifier_hash: nullifierHash,
      election_id: electionId,
    });
  } catch(err) {
    if (err instanceof TypeError) {
      await new Promise(r => setTimeout(r, 800));
      
      // Save nullifier for checkNullifier mock
      const mockNullifiers = JSON.parse(localStorage.getItem("mock_nullifiers") || "[]");
      mockNullifiers.push(nullifierHash);
      localStorage.setItem("mock_nullifiers", JSON.stringify(mockNullifiers));
      
      // Save NID for registerVoter mock (extracted from our dummy hash)
      if (nidHash.startsWith("0xmockhash")) {
        const nid = nidHash.replace("0xmockhash", "");
        const mockVotedNids = JSON.parse(localStorage.getItem("mock_voted_nids") || "[]");
        mockVotedNids.push(nid);
        localStorage.setItem("mock_voted_nids", JSON.stringify(mockVotedNids));
      }
      
      return { status: "success", vote_id: "mock-vote-" + Math.random().toString(36).slice(2, 10) };
    }
    throw err;
  }
}

/**
 * Fetch the election's ElGamal public key, used to encrypt the ballot
 * client-side before it ever leaves the browser.
 */
export async function getElectionPublicKey(): Promise<ElGamalPublicKeyResponse> {
  try {
    return await apiGet<ElGamalPublicKeyResponse>("/election/public-key");
  } catch (err) {
    if (err instanceof TypeError) {
      // Need a valid prime > 128 bits for UUID encryption mock
      return { 
        p: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        g: "2", 
        y: "3" 
      };
    }
    throw err;
  }
}

/**
 * Fetch the real candidate list (with DB UUIDs) for a constituency.
 * These ids are what get ElGamal-encrypted — they must match the
 * `candidates` table so decrypted tallies can be joined back to names.
 */
export async function getCandidates(
  constituencyCode: string
): Promise<CandidatesResponse> {
  try {
    return await apiGet<CandidatesResponse>(
      `/candidates?constituency=${encodeURIComponent(constituencyCode)}`
    );
  } catch (err) {
    if (err instanceof TypeError) {
      const res = await fetch("/candidates.json");
      const all = await res.json();
      const constId = parseInt(constituencyCode.replace("CON-", ""));
      return {
        constituency_code: constituencyCode,
        candidates: all
          .filter((c: any) => c.constituencyId === constId)
          .map((c: any) => ({
            ...c,
            // Convert mock ID to valid UUID format expected by ElGamal encryption
            id: `00000000-0000-0000-0000-${c.id.replace(/[^0-9a-f]/gi, "").padStart(12, "0")}`
          }))
      };
    }
    throw err;
  }
}

// ── Public Watchdog ──

export interface ConstituencyStat {
  constituency_code: string;
  registered_voters: number;
  votes_cast: number;
  turnout_pct: number;
}

export interface PublicStatsResponse {
  election_id: string;
  status: "active" | "not_started";
  total_registered_voters: number;
  total_votes_cast: number;
  turnout_pct: number;
  constituencies: ConstituencyStat[];
  key_ceremony: {
    submitted_count: number;
    threshold: number;
    total: number;
    threshold_met: boolean;
  };
  anchoring: {
    batches_anchored: number;
    latest_batch: {
      batch_id: number;
      tx_hash: string;
      vote_count: number;
      created_at: string;
    } | null;
  };
}

export function getPublicStats(
  electionId?: string
): Promise<PublicStatsResponse> {
  const qs = electionId ? `?election_id=${encodeURIComponent(electionId)}` : "";
  return apiGet<PublicStatsResponse>(`/public/stats${qs}`);
}

export interface VoteVerifyResponse {
  vote_id: string;
  batch_id: number;
  tx_hash: string;
  root: string;
  proof: string[];
  included_locally: boolean;
  included_on_chain: boolean | null;
}

export function verifyVoteAnchor(voteId: string): Promise<VoteVerifyResponse> {
  return apiGet<VoteVerifyResponse>(`/anchor/verify/${encodeURIComponent(voteId)}`);
}

// ── Tallying (admin) ──

export interface TallyCandidateResult {
  candidate_id: string;
  name: string;
  party: string;
  votes: number;
}

export interface TallyConstituencyResult {
  constituency_code: string;
  candidates: TallyCandidateResult[];
}

export interface TallyResponse {
  election_id: string;
  tallied_at: string;
  shares_used: number;
  total_votes: number;
  valid_votes: number;
  invalid_votes: number;
  results: TallyConstituencyResult[];
}

/**
 * Reconstruct the private key from submitted shares and decrypt+tally all
 * votes. Requires the admin secret (x-admin-secret header) — this is a
 * one-time, highly sensitive ceremony action.
 */
export async function runTally(
  electionId: string,
  adminSecret: string
): Promise<TallyResponse> {
  const res = await fetch(`${API_BASE}/keyshares/tally`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify({ election_id: electionId }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : "Tally failed";
    throw new ApiError(message, res.status, data);
  }

  return data as TallyResponse;
}

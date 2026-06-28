// =============================================================
// E-Voting Simulation — Shared Type Definitions
// =============================================================
// Types shared between frontend/ and backend/ packages.
// Keep in sync with backend/src/schema.sql.
// =============================================================

// ── Vote Status ──

/** Possible states of a submitted vote (mirrors `vote_status` ENUM in DB) */
export type VoteStatus = "queued" | "confirmed" | "rejected";

// ── ElGamal Ciphertext ──

/** ElGamal ciphertext components (mirrors `encrypted_vote` JSONB in DB) */
export interface ElGamalCiphertext {
  c1: string; // Generator component (base64 or hex)
  c2: string; // Message component (base64 or hex)
}

// ── Database Row Types ──
// Mirror the Supabase/PostgreSQL table schemas

/** Row shape for the `voters` table */
export interface Voter {
  id: string;             // UUID
  nid_hash: string;       // CHAR(64) — SHA-256 hex digest
  name: string;
  is_eligible: boolean;
  has_voted: boolean;
  registered_at: string;  // ISO 8601 timestamp
  updated_at: string;     // ISO 8601 timestamp
}

/** Row shape for the `votes` table */
export interface Vote {
  id: string;                       // UUID
  voter_nid_hash: string;           // CHAR(64) — FK → voters.nid_hash
  encrypted_vote: ElGamalCiphertext; // JSONB — ElGamal ciphertext
  zkp_proof: Record<string, unknown> | null; // JSONB — ZKP blob, null until implemented
  tx_hash: string | null;           // VARCHAR(66) — Polygon tx hash, null until anchored
  status: VoteStatus;               // ENUM — 'queued' | 'confirmed' | 'rejected'
  created_at: string;               // ISO 8601 timestamp
  updated_at: string;               // ISO 8601 timestamp
}

// ── API Request Types ──

/** POST /vote — request body */
export interface VoteRequest {
  nid: string; // Raw 11-digit NID (hashed server-side)
}

/** POST /voter/register — request body (future) */
export interface VoterRegistrationRequest {
  nid: string;  // Raw 11-digit NID
  name: string;
}

// ── API Response Types ──

/** POST /vote — success response */
export interface VoteResponse {
  status: VoteStatus;
  vote_id?: string; // UUID of the created vote record
}

/** Generic API error response */
export interface ApiErrorResponse {
  error: string | Record<string, unknown>[];
}

/** POST /voter/register — success response (future) */
export interface VoterRegistrationResponse {
  voter_id: string; // UUID
  registered: boolean;
}

// =============================================================
// E-Voting Simulation — Shared Type Definitions
// =============================================================
// Types shared between frontend/ and backend/ packages.
// Keep in sync with backend/src/schema.sql.
// =============================================================

// ── User Roles ──

/** The three portal roles in the system */
export type UserRole = "voter" | "keyholder" | "admin";

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
  id: string;                 // UUID
  nid_hash: string;           // CHAR(64) — SHA-256 hex digest
  name: string;
  constituency_code: string;  // VARCHAR(10) — e.g. "DHK-01"
  is_eligible: boolean;
  has_voted: boolean;
  registered_at: string;      // ISO 8601 timestamp
  updated_at: string;         // ISO 8601 timestamp
}

/** Row shape for the `candidates` table */
export interface Candidate {
  id: string;                 // UUID
  name: string;               // Candidate display name
  party: string;              // Political party name
  symbol: string;             // Party symbol identifier (emoji or icon key)
  constituency_code: string;  // VARCHAR(10) — e.g. "DHK-01"
  created_at: string;         // ISO 8601 timestamp
}

/** Row shape for the `constituencies` table (future — not yet in schema) */
export interface Constituency {
  code: string;               // VARCHAR(10) — PK, e.g. "DHK-01"
  name: string;               // Display name, e.g. "Dhaka-1"
  district: string;           // District name
  division: string;           // Division name
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

/** Row shape for the `key_shares` table */
export interface KeyShare {
  id: string;                 // UUID
  election_id: string;
  share_index: number;        // 1–4 for (3,4) scheme
  share_value: string | null; // Null until submitted
  keyholder_id: string;
  keyholder_role: string;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
}

// ── Admin / EC Types ──

/** Admin EC user (for login and dashboard) */
export interface AdminEC {
  id: string;
  username: string;
  role: "ec_admin";
  display_name: string;
  created_at: string;
}

// ── API Request Types ──

/** POST /vote — request body */
export interface VoteRequest {
  nid: string; // Raw 11-digit NID (hashed server-side)
}

/** POST /voter/register — request body (future) */
export interface VoterRegistrationRequest {
  nid: string;              // Raw 11-digit NID
  name: string;
  constituency_code: string; // Assigned constituency
}

/** POST /admin/login — request body */
export interface AdminLoginRequest {
  username: string;
  password: string;
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

/** GET /candidates?constituency_code=X — response */
export interface CandidateListResponse {
  candidates: Candidate[];
  constituency_code: string;
}

/** POST /admin/login — success response */
export interface AdminLoginResponse {
  token: string;
  admin: Pick<AdminEC, "id" | "username" | "display_name">;
}

-- =============================================================
-- E-Voting Simulation — Votes Table Schema
-- Database: Supabase (PostgreSQL)
-- =============================================================
-- This table stores encrypted vote records. Each row represents
-- a single voter's submission. The actual vote content is ElGamal-
-- encrypted and never stored in plaintext.
-- =============================================================

-- Enable UUID generation (Supabase has this by default, but explicit is safer)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop table if re-running during development
-- DROP TABLE IF EXISTS votes;

CREATE TABLE votes (
    -- Primary key: auto-generated UUID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- SHA-256 hash of the voter's NID — ensures one vote per person
    -- without storing the raw NID (privacy by design)
    voter_nid_hash  TEXT        NOT NULL,

    -- ElGamal ciphertext of the voter's choice
    encrypted_vote  TEXT        NOT NULL,

    -- Zero-Knowledge Proof blob proving vote validity
    -- Nullable until ZKP logic is implemented
    zkp_proof       TEXT,

    -- Polygon transaction hash for blockchain anchoring
    -- Nullable until blockchain integration is implemented
    tx_hash         TEXT,

    -- Vote processing status
    status          TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'confirmed', 'rejected')),

    -- Timestamp of vote submission
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── Constraints ──
    -- Each voter (identified by hashed NID) may only vote once
    CONSTRAINT uq_voter_nid_hash UNIQUE (voter_nid_hash)
);

-- ── Indexes ──

-- Fast lookups by voter hash (covered by UNIQUE constraint above,
-- but explicit for clarity)
-- CREATE INDEX idx_votes_voter_nid_hash ON votes (voter_nid_hash);

-- Filter/aggregate by status (e.g., count confirmed votes)
CREATE INDEX idx_votes_status ON votes (status);

-- Chronological ordering
CREATE INDEX idx_votes_created_at ON votes (created_at DESC);

-- ── Row-Level Security (Supabase best practice) ──
-- Enable RLS but don't add policies yet — they depend on auth design
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • voter_nid_hash should be SHA-256(nid + salt)
--   • encrypted_vote stores the ElGamal ciphertext as a JSON or
--     base64 string, format TBD when encryption module is built
--   • zkp_proof stores the serialized ZKP, format TBD
--   • tx_hash is populated after Polygon anchoring succeeds
--   • RLS policies will be added once Supabase Auth is integrated
-- =============================================================

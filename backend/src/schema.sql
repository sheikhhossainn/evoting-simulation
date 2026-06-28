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


-- =============================================================
-- E-Voting Simulation — Key Shares Table Schema

-- This table stores Shamir's Secret Sharing share submissions
-- from key holders during the tallying phase. Each row represents
-- one key holder submitting their assigned share for a specific
-- election. Threshold scheme: (3, 4) — any 3 of 4 shares can
-- reconstruct the private decryption key.
-- =============================================================

CREATE TABLE key_shares (
    -- Primary key: auto-generated UUID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which election this share belongs to
    election_id     TEXT        NOT NULL,

    -- Share index (x value in the polynomial f(x))
    -- For (3, 4) scheme this must be 1, 2, 3, or 4
    share_index     INTEGER     NOT NULL
                    CHECK (share_index BETWEEN 1 AND 4),

    -- Share value (y value at f(share_index))
    -- Stored as TEXT to support large cryptographic numbers
    -- Nullable until the share holder actually submits
    share_value     TEXT,

    -- Identifier for the keyholder who owns this share
    -- Anonymized — does not store personal identity
    keyholder_id    TEXT        NOT NULL,

    -- Human-readable role label (e.g., "Election Commission")
    -- For display on the public status page
    keyholder_role  TEXT        NOT NULL,

    -- Submission status flag
    submitted       BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Timestamp of share submission (nullable until submitted)
    submitted_at    TIMESTAMPTZ,

    -- Timestamp of row creation (during key ceremony)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── Constraints ──
    -- Each keyholder can only have one row per election
    CONSTRAINT uq_keyholder_per_election
        UNIQUE (election_id, keyholder_id),

    -- Each share index can only exist once per election
    CONSTRAINT uq_share_index_per_election
        UNIQUE (election_id, share_index)
);

-- ── Indexes ──

-- Fast lookup of all shares for a given election (used during tallying)
CREATE INDEX idx_key_shares_election_id ON key_shares (election_id);

-- Fast filter for submitted vs pending (used by status page)
CREATE INDEX idx_key_shares_submitted ON key_shares (election_id, submitted);

-- ── Row-Level Security ──
ALTER TABLE key_shares ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • Pre-seed 4 rows per election during key ceremony with
--     submitted=false and share_value=NULL
--   • Submission endpoint UPDATEs the row (does not INSERT new)
--   • Tallying query: SELECT share_index, share_value FROM
--     key_shares WHERE election_id = $1 AND submitted = TRUE
--     — must return >= 3 rows before reconstruction
-- =============================================================



-- =============================================================
-- E-Voting Simulation — Nullifiers Table Schema

-- This table stores nullifiers — one-way hashes that prove
-- "someone voted" without revealing who. The nullifier is
-- computed in the voter's browser as:
--
--     nullifier = Hash(NID + election_id + secret_key)
--
-- Used to prevent double-voting. Same NID always produces the
-- same nullifier (for the same election), so duplicates are
-- caught. But the hash is irreversible — the NID cannot be
-- recovered from the nullifier.


CREATE TABLE nullifiers (
    -- Primary key: auto-generated UUID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The nullifier hash — one-way, irreversible
    -- This is what prevents double-voting without storing identity
    nullifier_hash  TEXT        NOT NULL,

    -- Which election this nullifier was used in
    election_id     TEXT        NOT NULL,

    -- Timestamp of when the nullifier was registered
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── Constraints ──
    -- A nullifier can only exist once per election (this is what
    -- enforces one-person-one-vote)
    CONSTRAINT uq_nullifier_per_election
        UNIQUE (election_id, nullifier_hash)
);

-- ── Indexes ──

-- Fast lookup during vote submission (check if nullifier exists)
CREATE INDEX idx_nullifiers_election_hash
    ON nullifiers (election_id, nullifier_hash);

-- ── Row-Level Security ──
ALTER TABLE nullifiers ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • Redis holds nullifiers during active voting for fast checks
--   • This table is the persistent record after vote confirmation
--   • The nullifier is computed client-side; the server never
--     sees the raw NID

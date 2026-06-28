-- =============================================================
-- E-Voting Simulation — Database Schema (Optimized)
-- Database: Supabase (PostgreSQL 15+)
-- =============================================================
-- Tables:
--   1. voters  — registered voter identity & eligibility
--   2. votes   — encrypted vote records (ElGamal ciphertext)
--
-- Design principles:
--   • Privacy by design — raw NIDs are never stored
--   • Strict typing — ENUM for status, CHAR(64) for hashes
--   • Partial indexes — only index the rows you actually query
--   • Immutability — votes cannot be altered after submission
-- =============================================================

-- ── Extensions ──
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Custom Types ──
-- Enum is stored as 4 bytes (vs variable TEXT) and enforced at the type level
DO $$ BEGIN
    CREATE TYPE vote_status AS ENUM ('queued', 'confirmed', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Drop tables if re-running during development (order matters for FK)
-- DROP TABLE IF EXISTS votes;
-- DROP TABLE IF EXISTS voters;
-- DROP TYPE IF EXISTS vote_status;

-- =============================================================
-- 1. VOTERS TABLE
-- =============================================================
-- Stores registered voter records. The raw NID is never stored;
-- only a SHA-256 hash is kept (privacy by design).
-- =============================================================

CREATE TABLE voters (
    -- Primary key: auto-generated UUID
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- SHA-256 hash of the voter's NID — unique identifier
    -- Fixed 64 hex chars: SHA-256 always produces 256 bits = 64 hex digits
    nid_hash        CHAR(64)        NOT NULL
                    CONSTRAINT ck_voters_nid_hash_hex
                        CHECK (nid_hash ~ '^[a-f0-9]{64}$'),

    -- Voter's display name (for UI/admin purposes)
    name            TEXT            NOT NULL
                    CONSTRAINT ck_voters_name_not_empty
                        CHECK (length(trim(name)) > 0),

    -- Whether this voter is eligible to cast a vote
    is_eligible     BOOLEAN         NOT NULL DEFAULT true,

    -- Flipped to true after a vote is successfully submitted
    has_voted       BOOLEAN         NOT NULL DEFAULT false,

    -- Timestamps
    registered_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- ── Constraints ──
    CONSTRAINT uq_voters_nid_hash UNIQUE (nid_hash)
);

-- ── Voters Indexes ──
-- Partial indexes: only index the rows you'll actually query.
-- "Find eligible voters who haven't voted" is the hot query path.
CREATE INDEX idx_voters_eligible_not_voted
    ON voters (nid_hash)
    WHERE is_eligible = true AND has_voted = false;

-- ── Voters RLS ──
ALTER TABLE voters ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. VOTES TABLE
-- =============================================================
-- Stores encrypted vote records. Each row represents a single
-- voter's submission. The actual vote content is ElGamal-
-- encrypted and never stored in plaintext.
-- =============================================================

CREATE TABLE votes (
    -- Primary key: auto-generated UUID
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- SHA-256 hash of the voter's NID — ensures one vote per person
    voter_nid_hash  CHAR(64)        NOT NULL
                    CONSTRAINT ck_votes_nid_hash_hex
                        CHECK (voter_nid_hash ~ '^[a-f0-9]{64}$'),

    -- ElGamal ciphertext of the voter's choice
    -- JSONB stores the structured ciphertext { c1, c2 } and allows
    -- validation/querying. More efficient than serialized TEXT for
    -- structured data.
    encrypted_vote  JSONB           NOT NULL,

    -- Zero-Knowledge Proof blob proving vote validity
    -- Nullable until ZKP logic is implemented
    zkp_proof       JSONB,

    -- Polygon transaction hash for blockchain anchoring
    -- Format: 0x + 64 hex chars = 66 chars total
    -- Nullable until blockchain integration is implemented
    tx_hash         VARCHAR(66)
                    CONSTRAINT ck_votes_tx_hash_hex
                        CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[a-fA-F0-9]{64}$'),

    -- Vote processing status (uses ENUM — 4 bytes, type-safe)
    status          vote_status     NOT NULL DEFAULT 'queued',

    -- Timestamps
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- ── Constraints ──
    CONSTRAINT uq_votes_voter_nid_hash UNIQUE (voter_nid_hash),

    -- Foreign key: links back to the voters table
    CONSTRAINT fk_votes_voter FOREIGN KEY (voter_nid_hash)
        REFERENCES voters (nid_hash)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

-- ── Votes Indexes ──

-- Filter/aggregate by status (partial: only non-final states need fast lookup)
CREATE INDEX idx_votes_queued
    ON votes (created_at)
    WHERE status = 'queued';

-- Chronological ordering for confirmed votes (the "results" query)
CREATE INDEX idx_votes_confirmed
    ON votes (created_at DESC)
    WHERE status = 'confirmed';

-- Blockchain verification lookups (only indexed when populated)
CREATE INDEX idx_votes_tx_hash
    ON votes (tx_hash)
    WHERE tx_hash IS NOT NULL;

-- ── Votes RLS ──
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 3. FUNCTIONS & TRIGGERS
-- =============================================================

-- ── Auto-update `updated_at` on row modification ──
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER trg_voters_updated_at
    BEFORE UPDATE ON voters
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- NOTE: votes.updated_at fires when mutable fields change (status, tx_hash,
-- zkp_proof). The immutability guard below prevents changes to core fields
-- (voter_nid_hash, encrypted_vote, created_at). These two triggers work
-- together — updated_at tracks processing state transitions, not vote edits.
CREATE TRIGGER trg_votes_updated_at
    BEFORE UPDATE ON votes
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── Immutability guard: prevent tampering with core vote data ──
-- Once a vote is cast, the voter identity and encrypted ballot
-- must never change. Only `status`, `tx_hash`, and `zkp_proof`
-- may be updated (by backend processing) — and those updates
-- are what trigger `updated_at` above.
CREATE OR REPLACE FUNCTION fn_votes_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.voter_nid_hash IS DISTINCT FROM NEW.voter_nid_hash THEN
        RAISE EXCEPTION 'voter_nid_hash is immutable after insertion';
    END IF;
    IF OLD.encrypted_vote IS DISTINCT FROM NEW.encrypted_vote THEN
        RAISE EXCEPTION 'encrypted_vote is immutable after insertion';
    END IF;
    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'created_at is immutable after insertion';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_votes_immutable
    BEFORE UPDATE ON votes
    FOR EACH ROW EXECUTE FUNCTION fn_votes_immutable_guard();

-- =============================================================
-- 4. STORED PROCEDURES
-- =============================================================

-- ── Atomic vote casting ──
-- Prevents double-vote vulnerability by wrapping eligibility check,
-- vote insertion, and has_voted flip in a single transaction.
--
-- If ANY step fails, the entire operation rolls back — no partial
-- state where a vote exists but has_voted is still false.
--
-- Usage from backend:
--   const { data, error } = await supabase.rpc('fn_cast_vote', {
--     p_voter_nid_hash: hashedNid,
--     p_encrypted_vote: { c1: '...', c2: '...' },
--     p_zkp_proof: null
--   });
CREATE OR REPLACE FUNCTION fn_cast_vote(
    p_voter_nid_hash CHAR(64),
    p_encrypted_vote JSONB,
    p_zkp_proof      JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with the function owner's permissions (bypasses RLS)
AS $$
DECLARE
    v_vote_id UUID;
    v_voter   RECORD;
BEGIN
    -- Step 1: Lock the voter row and check eligibility
    -- SELECT ... FOR UPDATE prevents concurrent vote attempts
    SELECT id, is_eligible, has_voted
    INTO v_voter
    FROM voters
    WHERE nid_hash = p_voter_nid_hash
    FOR UPDATE;

    -- Voter not found
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Voter not registered (nid_hash not found)'
            USING ERRCODE = 'P0002';  -- no_data_found
    END IF;

    -- Voter not eligible
    IF NOT v_voter.is_eligible THEN
        RAISE EXCEPTION 'Voter is not eligible to vote'
            USING ERRCODE = 'P0003';
    END IF;

    -- Voter already voted
    IF v_voter.has_voted THEN
        RAISE EXCEPTION 'Voter has already cast a vote'
            USING ERRCODE = 'P0004';
    END IF;

    -- Step 2: Insert the vote record
    INSERT INTO votes (voter_nid_hash, encrypted_vote, zkp_proof)
    VALUES (p_voter_nid_hash, p_encrypted_vote, p_zkp_proof)
    RETURNING id INTO v_vote_id;

    -- Step 3: Flip has_voted (same transaction — atomic)
    UPDATE voters
    SET has_voted = true
    WHERE nid_hash = p_voter_nid_hash;

    -- All 3 steps succeed or none do
    RETURN v_vote_id;
END;
$$;

-- =============================================================
-- Notes for future implementation:
--   • nid_hash = lower(encode(sha256(nid || salt), 'hex'))
--   • encrypted_vote JSONB shape: { "c1": "...", "c2": "..." }
--     (ElGamal ciphertext components as base64/hex strings)
--   • zkp_proof JSONB shape: TBD when ZKP module is built
--   • tx_hash is populated after Polygon anchoring succeeds
--   • RLS policies will be added once Supabase Auth is integrated
-- =============================================================


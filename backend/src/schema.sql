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

    -- Constituency assignment (e.g. "DHK-01", "CTG-03")
    -- Links the voter to their constituency for candidate lookup
    constituency_code VARCHAR(10)   NOT NULL
                    CONSTRAINT ck_voters_constituency_code_format
                        CHECK (constituency_code ~ '^[A-Z]{2,4}-\d{1,3}$'),

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
-- 3. CANDIDATES TABLE
-- =============================================================
-- Stores the slate of candidates standing in each constituency.
-- Populated by the EC Admin before voting opens.
-- =============================================================

CREATE TABLE candidates (
    -- Primary key: auto-generated UUID
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Candidate's display name
    name                TEXT        NOT NULL
                        CONSTRAINT ck_candidates_name_not_empty
                            CHECK (length(trim(name)) > 0),

    -- Political party name
    party               TEXT        NOT NULL
                        CONSTRAINT ck_candidates_party_not_empty
                            CHECK (length(trim(party)) > 0),

    -- Party symbol identifier (emoji or icon key, e.g. "⛵", "sheaf")
    symbol              TEXT        NOT NULL,

    -- Constituency this candidate is standing in
    constituency_code   VARCHAR(10) NOT NULL
                        CONSTRAINT ck_candidates_constituency_code_format
                            CHECK (constituency_code ~ '^[A-Z]{2,4}-\d{1,3}$'),

    -- Timestamp
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── Constraints ──
    -- A candidate can only stand in one constituency (name + constituency unique)
    CONSTRAINT uq_candidate_per_constituency
        UNIQUE (name, constituency_code)
);

-- ── Candidates Indexes ──

-- Fast lookup of all candidates for a given constituency (the ballot query)
CREATE INDEX idx_candidates_constituency_code
    ON candidates (constituency_code);

-- ── Candidates RLS ──
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 4. FUNCTIONS & TRIGGERS
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
    nullifier_hash  CHAR(64)    NOT NULL
                CONSTRAINT ck_nullifiers_hash_hex
                    CHECK (nullifier_hash ~ '^[a-f0-9]{64}$'),

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
-- =============================================================


-- =============================================================
-- E-Voting Simulation — Merkle Batches Table Schema
--
-- Each row records one batch of votes anchored on Polygon: the Merkle
-- root submitted on-chain, the ordered list of vote ids the tree was
-- built from (needed to regenerate proofs later), and the resulting
-- transaction hash. batch_id mirrors the sequential id assigned by
-- MerkleRootStorage.sol on-chain (batches[batch_id]).
-- =============================================================

CREATE TABLE merkle_batches (
    -- Primary key: auto-generated UUID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sequential on-chain batch id (MerkleRootStorage.batches[batch_id])
    batch_id        BIGINT      NOT NULL UNIQUE,

    -- Merkle root anchored on-chain for this batch
    root            CHAR(66)    NOT NULL
                    CONSTRAINT ck_merkle_batches_root_hex
                        CHECK (root ~ '^0x[a-fA-F0-9]{64}$'),

    -- Polygon transaction hash for the anchorRoot() call
    tx_hash         VARCHAR(66) NOT NULL
                    CONSTRAINT ck_merkle_batches_tx_hash_hex
                        CHECK (tx_hash ~ '^0x[a-fA-F0-9]{64}$'),

    -- Ordered vote ids the tree was built from (index = leaf position,
    -- required to regenerate a Merkle proof for any vote in the batch)
    vote_ids        JSONB       NOT NULL,

    vote_count      INTEGER     NOT NULL
                    CONSTRAINT ck_merkle_batches_vote_count_positive
                        CHECK (vote_count > 0),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_merkle_batches_batch_id ON merkle_batches (batch_id);

-- ── Row-Level Security ──
ALTER TABLE merkle_batches ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • POST /anchor/batch (admin) selects votes with tx_hash IS NULL,
--     builds a Merkle tree (backend/src/merkle/merkleTree.ts), calls
--     MerkleRootStorage.anchorRoot(), then writes one merkle_batches
--     row and flips those votes' tx_hash + status='confirmed'
--   • GET /anchor/verify/:voteId regenerates the proof for a single
--     vote from its batch's stored vote_ids and verifies it both
--     locally and against the on-chain contract
-- =============================================================


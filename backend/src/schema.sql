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
-- DROP TABLE IF EXISTS constituencies;
-- DROP TYPE IF EXISTS vote_status;

-- =============================================================
-- 0. CONSTITUENCIES TABLE
-- =============================================================
-- Defines the valid set of constituency codes. All other tables
-- reference this via FK so that only seeded constituencies are
-- accepted. Must be populated before voters/candidates.
-- =============================================================

CREATE TABLE constituencies (
    -- Primary key: the short code (e.g. "CON-01")
    code            VARCHAR(10) PRIMARY KEY
                    CONSTRAINT ck_constituency_code_format
                        CHECK (code ~ '^[A-Z]{2,4}-\d{1,3}$'),

    -- Human-readable name (e.g. "Dhaka North")
    name            TEXT        NOT NULL
                    CONSTRAINT ck_constituency_name_not_empty
                        CHECK (length(trim(name)) > 0),

    -- Timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Constituencies RLS ──
ALTER TABLE constituencies ENABLE ROW LEVEL SECURITY;

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
    CONSTRAINT uq_voters_nid_hash UNIQUE (nid_hash),
    CONSTRAINT fk_voters_constituency
        FOREIGN KEY (constituency_code) REFERENCES constituencies (code)
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

    -- ── Ballot secrecy redesign ──
    -- votes no longer store voter_nid_hash (which directly identified the
    -- voter via a FK to the voters table). Instead:
    --   • nullifier_hash prevents double-voting without linking to identity
    --     — it's computed server-side as SHA-256(nid + election_id + secret),
    --     using a secret the server never exposes, so it can't be
    --     reconstructed by anyone who only knows the voter's NID.
    --   • constituency_code is non-identifying (shared by thousands of
    --     voters) and lets tallying group results without ever touching
    --     the voters table.
    -- Eligibility and double-vote prevention still happen via nid_hash
    -- lookups against `voters`/`nullifiers`, but that hash is never
    -- persisted on the vote row itself.

    -- One-way hash proving "someone voted" without revealing who.
    -- Same value as nullifiers.nullifier_hash for this vote's submission.
    nullifier_hash  CHAR(64)        NOT NULL
                    CONSTRAINT ck_votes_nullifier_hash_hex
                        CHECK (nullifier_hash ~ '^[a-f0-9]{64}$'),

    -- Non-identifying constituency code, used for tally grouping only.
    constituency_code VARCHAR(10)   NOT NULL
                    CONSTRAINT ck_votes_constituency_code_format
                        CHECK (constituency_code ~ '^[A-Z]{2,4}-\d{1,3}$'),

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
    -- One vote per nullifier — enforces one-person-one-vote without
    -- ever storing which specific person cast which specific vote.
    CONSTRAINT uq_votes_nullifier_hash UNIQUE (nullifier_hash),
    CONSTRAINT fk_votes_constituency
        FOREIGN KEY (constituency_code) REFERENCES constituencies (code)
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
        UNIQUE (name, constituency_code),
    CONSTRAINT fk_candidates_constituency
        FOREIGN KEY (constituency_code) REFERENCES constituencies (code)
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
    IF OLD.nullifier_hash IS DISTINCT FROM NEW.nullifier_hash THEN
        RAISE EXCEPTION 'nullifier_hash is immutable after insertion';
    END IF;
    IF OLD.constituency_code IS DISTINCT FROM NEW.constituency_code THEN
        RAISE EXCEPTION 'constituency_code is immutable after insertion';
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

-- ── Deletion guard: cast votes may never be removed ──
-- A vote row is part of the permanent audit/tally record once inserted.
-- Processing only ever UPDATEs mutable fields (status, tx_hash, zkp_proof)
-- — nothing in normal operation should ever DELETE a vote row, so any
-- DELETE attempt is rejected outright, same as the UPDATE guard above.
CREATE OR REPLACE FUNCTION fn_votes_no_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'votes rows are immutable and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_votes_no_delete
    BEFORE DELETE ON votes
    FOR EACH ROW EXECUTE FUNCTION fn_votes_no_delete();

-- ── Scoped, audited exception: admin-triggered vote deletion (demo only) ──
-- Normal DELETEs stay blocked by trg_votes_no_delete above — this function
-- is the ONE narrow, explicit path around it, used solely by the SMT
-- deletion-detection demo (docs/smt-design.md §13 test 19,
-- POST /anchor/tamper/delete-vote in backend/src/routes/anchor.ts, gated by
-- requireAdminSecret). It disables the guard trigger only for the duration
-- of this single call, on this session, then re-enables it unconditionally
-- (including on error) — it is not a standing bypass. Update
-- docs/threat_model.md if this function's existence changes the DB-admin
-- threat entry.
CREATE OR REPLACE FUNCTION fn_admin_delete_vote(p_vote_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    ALTER TABLE votes DISABLE TRIGGER trg_votes_no_delete;
    DELETE FROM votes WHERE id = p_vote_id;
    ALTER TABLE votes ENABLE TRIGGER trg_votes_no_delete;
EXCEPTION WHEN OTHERS THEN
    ALTER TABLE votes ENABLE TRIGGER trg_votes_no_delete;
    RAISE;
END;
$$;

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
-- ── Atomic vote casting (redesigned for ballot secrecy) ──
-- p_voter_nid_hash is used ONLY to check eligibility and flip has_voted
-- on the voters table — it is never written to the votes row itself.
-- The vote row stores p_nullifier_hash + p_constituency_code instead,
-- which cannot be traced back to a specific voter without the
-- server-side NULLIFIER_SECRET.
CREATE OR REPLACE FUNCTION fn_cast_vote(
    p_voter_nid_hash    CHAR(64),
    p_nullifier_hash    CHAR(64),
    p_constituency_code VARCHAR(10),
    p_encrypted_vote    JSONB,
    p_zkp_proof         JSONB DEFAULT NULL
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

    -- Step 2: Insert the vote record — nullifier_hash and
    -- constituency_code only, never voter_nid_hash
    INSERT INTO votes (nullifier_hash, constituency_code, encrypted_vote, zkp_proof)
    VALUES (p_nullifier_hash, p_constituency_code, p_encrypted_vote, p_zkp_proof)
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
--   • nid_hash = lower(encode(sha256(nid || salt), 'hex'))  (NID_HASH_SALT)
--   • nullifier_hash = lower(encode(sha256(nid || election_id || secret), 'hex'))
--     (NULLIFIER_SECRET) — computed server-side only, never client-side,
--     so it can't be reconstructed by anyone who only knows the NID
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


-- =============================================================
-- E-Voting Simulation — Tally Results Table Schema
--
-- POST /keyshares/tally reconstructs the private key in memory and
-- decrypts every vote, but never persists the key. The DECRYPTED
-- RESULTS (aggregate counts only — never raw ballots or the key) are
-- persisted here so the public can read them afterward without
-- triggering another decryption ceremony. One row per election;
-- re-running the tally overwrites the previous row for that election.
-- =============================================================

CREATE TABLE tally_results (
    -- Primary key: auto-generated UUID
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- One tally row per election
    election_id     TEXT        NOT NULL UNIQUE,

    tallied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    shares_used     INTEGER     NOT NULL,
    total_votes     INTEGER     NOT NULL,
    valid_votes     INTEGER     NOT NULL,
    invalid_votes   INTEGER     NOT NULL,

    -- [{ constituency_code, candidates: [{candidate_id, name, party, votes}] }]
    results         JSONB       NOT NULL
);

-- ── Row-Level Security ──
ALTER TABLE tally_results ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • POST /keyshares/tally (admin) upserts this row on election_id
--     after computing results
--   • GET /public/results (public, no auth) reads the latest row —
--     returns { status: "not_tallied" } if none exists yet
-- =============================================================


-- =============================================================
-- E-Voting Simulation — SMT Batches Table Schema (docs/smt-design.md)
--
-- Each row records one anchor of the cumulative Sparse Merkle Tree over
-- nullifier_hash keys (backend/src/merkle/sparseMerkleTree.ts), anchored
-- alongside — not replacing — the per-batch dense tree in merkle_batches
-- above. smt_batch_id mirrors MerkleRootStorage.sol's sequential
-- smtBatches[smtBatchId], independent of merkle_batches.batch_id.
-- =============================================================

CREATE TABLE smt_batches (
    -- Primary key: auto-generated UUID
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sequential on-chain SMT batch id (MerkleRootStorage.smtBatches[smtBatchId])
    smt_batch_id        BIGINT      NOT NULL UNIQUE,

    -- New cumulative SMT root anchored on-chain for this batch
    smt_root            CHAR(66)    NOT NULL
                        CONSTRAINT ck_smt_batches_smt_root_hex
                            CHECK (smt_root ~ '^0x[a-fA-F0-9]{64}$'),

    -- The previous smt_root this batch chains from (EMPTY_TREE_ROOT for the
    -- first batch) — the chain-continuity value the contract re-derives and
    -- checks, kept here too for local auditability without a chain read.
    previous_smt_root   CHAR(66)    NOT NULL
                        CONSTRAINT ck_smt_batches_previous_smt_root_hex
                            CHECK (previous_smt_root ~ '^0x[a-fA-F0-9]{64}$'),

    -- Count of genuinely new keys inserted this batch. May be 0 for a
    -- deletion-triggered re-anchor (docs/smt-design.md §13 test 19) — the
    -- root changes but no new key was added.
    new_keys_this_batch  INTEGER    NOT NULL
                        CONSTRAINT ck_smt_batches_new_keys_non_negative
                            CHECK (new_keys_this_batch >= 0),

    -- Running total of insertions ever made — a monotonic ledger, NOT the
    -- tree's current live key count (a later deletion does not decrement
    -- this; see MerkleRootStorage.sol's anchorSmtRoot comment).
    total_keys_anchored  BIGINT     NOT NULL
                        CONSTRAINT ck_smt_batches_total_keys_non_negative
                            CHECK (total_keys_anchored >= 0),

    -- Polygon transaction hash for the anchorSmtRoot() call
    tx_hash              VARCHAR(66) NOT NULL
                        CONSTRAINT ck_smt_batches_tx_hash_hex
                            CHECK (tx_hash ~ '^0x[a-fA-F0-9]{64}$'),

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_smt_batches_smt_batch_id ON smt_batches (smt_batch_id);

-- ── Row-Level Security ──
ALTER TABLE smt_batches ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • runAnchorSmtBatch() (backend/src/services/anchorSmtBatch.ts) inserts
--     one row here after each successful on-chain anchorSmtRoot() call,
--     called in lockstep with runAnchorBatch()'s merkle_batches insert
--   • GET /anchor/verify-smt/:voteId regenerates a membership or
--     non-membership proof against the current cumulative tree and
--     verifies it both locally and against the on-chain contract
-- =============================================================


-- =============================================================
-- E-Voting Simulation — Verifiable Tally Schema (docs/tally-verifiability-design.md)
--
-- Replaces the old raw-Shamir-share submission flow (key_shares.share_value,
-- GF(2^8)) with the Z_q + Feldman VSS + Chaum-Pedersen DLEQ flow. The old
-- share_value column and the old shamir.ts module are left in place,
-- untouched, but are no longer written or read by any route — see
-- backend/src/crypto/shamirZq.ts, dleq.ts, docs/tally-verifiability-design.md §14.
-- =============================================================

-- ── key_shares: add the public commitment column for the new flow ──
-- public_commitment = y_i = g^(x_i) mod p (§2.1) — NOT secret, published at
-- ceremony time so keyholders and verifiers can check it against the
-- Feldman coefficient commitments in election_key_ceremony below. Distinct
-- from the old share_value column (the old flow's raw GF(2^8) share,
-- deprecated, never populated by the new ceremony script).
ALTER TABLE key_shares
    ADD COLUMN IF NOT EXISTS public_commitment TEXT
        CONSTRAINT ck_key_shares_public_commitment_hex
            CHECK (public_commitment IS NULL OR public_commitment ~ '^[0-9a-f]+$');

-- ── Election key ceremony: per-election group params + Feldman commitments ──
-- One row per election. Published once at ceremony time — p, g, and the
-- Feldman coefficient commitments C_0..C_2 (docs §2.1) are all public; no
-- secret material is ever stored here. C_0 == the ElGamal public key y.
CREATE TABLE election_key_ceremony (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id         TEXT        NOT NULL UNIQUE,
    p_hex               TEXT        NOT NULL,
    g_hex               TEXT        NOT NULL,
    -- Feldman commitments C_0..C_2 (t=3), each a hex-encoded group element.
    -- C_0 must equal the public key y — cross-checked at ceremony time, not
    -- re-derived here (no CHECK constraint can compare against an external value).
    feldman_commitments JSONB       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE election_key_ceremony ENABLE ROW LEVEL SECURITY;

-- ── Partial decryptions: the new /keyshares/submit-partial payload ──
-- One row per (election_id, ballot_id, keyholder_index) submission.
-- d_i and the DLEQ proof are the ONLY things that ever cross the wire from
-- a keyholder in the new flow — the raw share x_i is computed and held
-- client-side and never appears here or anywhere backend-reachable
-- (docs/tally-verifiability-design.md §7/§7.1).
CREATE TABLE partial_decryptions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     TEXT        NOT NULL,
    ballot_id       UUID        NOT NULL REFERENCES votes (id),
    keyholder_index INTEGER     NOT NULL CHECK (keyholder_index BETWEEN 1 AND 4),

    d_i             TEXT        NOT NULL
                    CONSTRAINT ck_partial_decryptions_d_i_hex
                        CHECK (d_i ~ '^[0-9a-f]+$'),

    -- Chaum-Pedersen DLEQ proof (docs §5.1) — (t1, t2, z), all hex.
    proof_t1        TEXT        NOT NULL,
    proof_t2        TEXT        NOT NULL,
    proof_z         TEXT        NOT NULL,

    -- Set by the tally route after independently re-verifying the proof
    -- (docs §5.2) — never trusted purely because it was accepted at
    -- submission time; re-checked at combination time too, so this column
    -- is a cache/audit trail, not the sole gate.
    verified        BOOLEAN     NOT NULL DEFAULT false,

    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_partial_decryptions_ballot_keyholder
        UNIQUE (election_id, ballot_id, keyholder_index)
);

CREATE INDEX idx_partial_decryptions_ballot
    ON partial_decryptions (election_id, ballot_id);

ALTER TABLE partial_decryptions ENABLE ROW LEVEL SECURITY;

-- ── Election setup commitment: candidate/constituency integrity (§8.2) ──
-- One row per election, written once, before voting opens. Mirrors the
-- write-once semantics of the on-chain ElectionSetupCommitment contract —
-- this table is the off-chain record of what was anchored, not a second
-- source of truth; GET routes re-derive from candidates/constituencies and
-- compare against the ON-CHAIN commitment, not this row, for anything
-- security-relevant (this row is bookkeeping/convenience only).
CREATE TABLE election_setup_commitments (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id             TEXT        NOT NULL UNIQUE,
    commitment              CHAR(66)    NOT NULL
                            CONSTRAINT ck_election_setup_commitment_hex
                                CHECK (commitment ~ '^0x[a-fA-F0-9]{64}$'),
    candidates_root         CHAR(66)    NOT NULL,
    constituencies_root     CHAR(66)    NOT NULL,
    contract_address        VARCHAR(42),
    tx_hash                 VARCHAR(66),
    anchored_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE election_setup_commitments ENABLE ROW LEVEL SECURITY;

-- ── candidates/constituencies immutability, GATED on a commitment existing ──
-- Unlike votes (always immutable), candidates/constituencies are mutable
-- during election SETUP but must freeze the instant a commitment is
-- anchored — otherwise the on-chain commitment stays truthful about the
-- past while the live system silently drifts underneath it (docs §8.2.4's
-- "live DB drift" adversarial case, found by reading this file directly —
-- neither table had ANY immutability guard before this migration).
--
-- This system currently models a single global candidate list (no
-- per-election election_id column on candidates/constituencies) — the gate
-- is therefore global: ANY anchored commitment freezes both tables. This
-- matches the system's existing single-election assumption; a multi-election
-- deployment would need to scope both the gate and the tables themselves.
CREATE OR REPLACE FUNCTION fn_candidates_immutable_after_commitment()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM election_setup_commitments) THEN
        RAISE EXCEPTION 'candidates are immutable once an election setup commitment has been anchored';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidates_immutable_after_commitment
    BEFORE UPDATE OR DELETE ON candidates
    FOR EACH ROW EXECUTE FUNCTION fn_candidates_immutable_after_commitment();

CREATE OR REPLACE FUNCTION fn_constituencies_immutable_after_commitment()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM election_setup_commitments) THEN
        RAISE EXCEPTION 'constituencies are immutable once an election setup commitment has been anchored';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_constituencies_immutable_after_commitment
    BEFORE UPDATE OR DELETE ON constituencies
    FOR EACH ROW EXECUTE FUNCTION fn_constituencies_immutable_after_commitment();

-- =============================================================
-- Notes for future implementation:
--   • setup-shamir-zq.ts (ceremony script) inserts election_key_ceremony's
--     one row; NEVER writes x_i anywhere backend-reachable (docs §7.1)
--   • POST /keyshares/submit-partial inserts partial_decryptions rows
--     (client-side-computed d_i + proof only, per ballot)
--   • POST /keyshares/tally (rewritten) verifies partial_decryptions rows
--     via dleq.ts, combines >=3 per ballot, never reconstructs the key
--   • scripts/deploy-election-setup.ts anchors ElectionSetupCommitment.sol
--     and inserts the election_setup_commitments row
-- =============================================================


-- =============================================================
-- E-Voting Simulation — Multi-Election Isolation Migration
-- (threat_model.md §10; closes the documented "single global election"
-- non-goal for real, per the methodology-audit follow-up plan)
--
-- Adds a real `elections` registry and scopes every previously-global
-- table (constituencies, voters, votes, candidates, merkle_batches,
-- smt_batches) by election_id, so multiple elections' data can coexist
-- in the same database without leaking into each other.
--
-- Idempotent — every statement is safe to re-run (IF NOT EXISTS / DROP
-- CONSTRAINT IF EXISTS / ON CONFLICT DO NOTHING throughout), matching
-- this file's existing migration-appending convention (see the
-- "Verifiable Tally Schema" section above).
--
-- IMPORTANT: this project has no automated migration runner —
-- run-schema.ts only initializes a FRESH database and intentionally
-- no-ops once `voters` already exists (see its own source). Run this
-- section manually via the Supabase SQL Editor, exactly like every
-- other schema change in this project's history.
--
-- Existing rows are backfilled to 'NATIONAL-2026-001' — the election
-- this project's frozen evidence snapshot (docs/evidence/) already
-- documents — so already-anchored batches keep their original,
-- correct election attribution rather than becoming orphaned.
-- =============================================================

-- ── 1. Elections registry ──
CREATE TABLE IF NOT EXISTS elections (
    election_id                     TEXT        PRIMARY KEY,
    name                            TEXT        NOT NULL,
    -- Replaces identity.ts's previously-hardcoded mod-8 constituency
    -- derivation — each election can now declare its own shape.
    constituency_count              INTEGER     NOT NULL DEFAULT 8
                                     CONSTRAINT ck_elections_constituency_count_positive
                                         CHECK (constituency_count > 0),
    status                          TEXT        NOT NULL DEFAULT 'setup'
                                     CONSTRAINT ck_elections_status
                                         CHECK (status IN ('setup', 'voting', 'tallying', 'closed')),
    -- Per-election deployed contract addresses (Phase 2: MerkleRootStorage
    -- becomes election-scoped internally via one shared deployment with a
    -- mapping key, so this column is the SAME address for every election on
    -- a given deployment; election_setup_contract_address differs per
    -- election, since ElectionSetupCommitment deploys one instance each).
    merkle_contract_address         VARCHAR(42),
    election_setup_contract_address VARCHAR(42),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE elections ENABLE ROW LEVEL SECURITY;

INSERT INTO elections (election_id, name, constituency_count, status, merkle_contract_address, election_setup_contract_address)
VALUES ('NATIONAL-2026-001', 'National Election 2026', 8, 'tallying',
        '0x4b5C381c62876d34bBDDefDe02e872E5a93401b6',
        '0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C')
ON CONFLICT (election_id) DO NOTHING;

-- ── 2. constituencies: add election_id, re-key PK as (election_id, code) ──
-- The backfill UPDATE below trips the (correct, working-as-designed)
-- immutability trigger on any project that has already anchored a setup
-- commitment — found live: it's not a bug in the trigger, this backfill
-- is a legitimate schema migration, not a data mutation, so the trigger
-- is disabled for just this one statement and re-enabled immediately after.
ALTER TABLE constituencies ADD COLUMN IF NOT EXISTS election_id TEXT;
ALTER TABLE constituencies DISABLE TRIGGER trg_constituencies_immutable_after_commitment;
UPDATE constituencies SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE constituencies ENABLE TRIGGER trg_constituencies_immutable_after_commitment;
ALTER TABLE constituencies ALTER COLUMN election_id SET NOT NULL;

-- Drop dependent FKs before re-keying the referenced PK (Postgres requires this).
ALTER TABLE voters     DROP CONSTRAINT IF EXISTS fk_voters_constituency;
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS fk_candidates_constituency;
ALTER TABLE votes      DROP CONSTRAINT IF EXISTS fk_votes_constituency;

ALTER TABLE constituencies DROP CONSTRAINT IF EXISTS constituencies_pkey;
ALTER TABLE constituencies ADD CONSTRAINT pk_constituencies PRIMARY KEY (election_id, code);
ALTER TABLE constituencies DROP CONSTRAINT IF EXISTS fk_constituencies_election;
ALTER TABLE constituencies ADD CONSTRAINT fk_constituencies_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);

-- ── 3. voters: election_id + composite constituency FK + composite nid_hash uniqueness ──
ALTER TABLE voters ADD COLUMN IF NOT EXISTS election_id TEXT;
UPDATE voters SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE voters ALTER COLUMN election_id SET NOT NULL;

ALTER TABLE voters DROP CONSTRAINT IF EXISTS uq_voters_nid_hash;
ALTER TABLE voters DROP CONSTRAINT IF EXISTS uq_voters_election_nid_hash;
ALTER TABLE voters ADD CONSTRAINT uq_voters_election_nid_hash UNIQUE (election_id, nid_hash);
ALTER TABLE voters DROP CONSTRAINT IF EXISTS fk_voters_election;
ALTER TABLE voters ADD CONSTRAINT fk_voters_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);
ALTER TABLE voters ADD CONSTRAINT fk_voters_constituency
    FOREIGN KEY (election_id, constituency_code) REFERENCES constituencies (election_id, code);

DROP INDEX IF EXISTS idx_voters_eligible_not_voted;
CREATE INDEX IF NOT EXISTS idx_voters_election_eligible_not_voted
    ON voters (election_id, nid_hash)
    WHERE is_eligible = true AND has_voted = false;

-- ── 4. votes: election_id + composite constituency FK + composite nullifier uniqueness ──
ALTER TABLE votes ADD COLUMN IF NOT EXISTS election_id TEXT;
UPDATE votes SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE votes ALTER COLUMN election_id SET NOT NULL;

ALTER TABLE votes DROP CONSTRAINT IF EXISTS uq_votes_nullifier_hash;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS uq_votes_election_nullifier_hash;
ALTER TABLE votes ADD CONSTRAINT uq_votes_election_nullifier_hash UNIQUE (election_id, nullifier_hash);
ALTER TABLE votes DROP CONSTRAINT IF EXISTS fk_votes_election;
ALTER TABLE votes ADD CONSTRAINT fk_votes_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);
ALTER TABLE votes ADD CONSTRAINT fk_votes_constituency
    FOREIGN KEY (election_id, constituency_code) REFERENCES constituencies (election_id, code);

-- votes.election_id joins the immutable-after-insertion field set, same
-- discipline as nullifier_hash/constituency_code/encrypted_vote/created_at.
CREATE OR REPLACE FUNCTION fn_votes_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.nullifier_hash IS DISTINCT FROM NEW.nullifier_hash THEN
        RAISE EXCEPTION 'nullifier_hash is immutable after insertion';
    END IF;
    IF OLD.constituency_code IS DISTINCT FROM NEW.constituency_code THEN
        RAISE EXCEPTION 'constituency_code is immutable after insertion';
    END IF;
    IF OLD.election_id IS DISTINCT FROM NEW.election_id THEN
        RAISE EXCEPTION 'election_id is immutable after insertion';
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

-- ── 5. candidates: election_id + composite constituency FK + composite uniqueness ──
-- Same trigger-disable-around-backfill fix as constituencies above.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS election_id TEXT;
ALTER TABLE candidates DISABLE TRIGGER trg_candidates_immutable_after_commitment;
UPDATE candidates SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE candidates ENABLE TRIGGER trg_candidates_immutable_after_commitment;
ALTER TABLE candidates ALTER COLUMN election_id SET NOT NULL;

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS uq_candidate_per_constituency;
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS uq_candidate_per_election_constituency;
ALTER TABLE candidates ADD CONSTRAINT uq_candidate_per_election_constituency
    UNIQUE (election_id, name, constituency_code);
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS fk_candidates_election;
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);
ALTER TABLE candidates ADD CONSTRAINT fk_candidates_constituency
    FOREIGN KEY (election_id, constituency_code) REFERENCES constituencies (election_id, code);

DROP INDEX IF EXISTS idx_candidates_constituency_code;
CREATE INDEX IF NOT EXISTS idx_candidates_election_constituency
    ON candidates (election_id, constituency_code);

-- ── 6. merkle_batches / smt_batches: election_id + composite batch-id uniqueness ──
ALTER TABLE merkle_batches ADD COLUMN IF NOT EXISTS election_id TEXT;
UPDATE merkle_batches SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE merkle_batches ALTER COLUMN election_id SET NOT NULL;
ALTER TABLE merkle_batches DROP CONSTRAINT IF EXISTS merkle_batches_batch_id_key;
ALTER TABLE merkle_batches DROP CONSTRAINT IF EXISTS uq_merkle_batches_election_batch_id;
ALTER TABLE merkle_batches ADD CONSTRAINT uq_merkle_batches_election_batch_id UNIQUE (election_id, batch_id);
ALTER TABLE merkle_batches DROP CONSTRAINT IF EXISTS fk_merkle_batches_election;
ALTER TABLE merkle_batches ADD CONSTRAINT fk_merkle_batches_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);

DROP INDEX IF EXISTS idx_merkle_batches_batch_id;
CREATE INDEX IF NOT EXISTS idx_merkle_batches_election_batch_id ON merkle_batches (election_id, batch_id);

ALTER TABLE smt_batches ADD COLUMN IF NOT EXISTS election_id TEXT;
UPDATE smt_batches SET election_id = 'NATIONAL-2026-001' WHERE election_id IS NULL;
ALTER TABLE smt_batches ALTER COLUMN election_id SET NOT NULL;
ALTER TABLE smt_batches DROP CONSTRAINT IF EXISTS smt_batches_smt_batch_id_key;
ALTER TABLE smt_batches DROP CONSTRAINT IF EXISTS uq_smt_batches_election_smt_batch_id;
ALTER TABLE smt_batches ADD CONSTRAINT uq_smt_batches_election_smt_batch_id UNIQUE (election_id, smt_batch_id);
ALTER TABLE smt_batches DROP CONSTRAINT IF EXISTS fk_smt_batches_election;
ALTER TABLE smt_batches ADD CONSTRAINT fk_smt_batches_election
    FOREIGN KEY (election_id) REFERENCES elections (election_id);

DROP INDEX IF EXISTS idx_smt_batches_smt_batch_id;
CREATE INDEX IF NOT EXISTS idx_smt_batches_election_smt_batch_id ON smt_batches (election_id, smt_batch_id);

-- ── 7. fn_cast_vote: election-scoped voter lookup + vote insert ──
-- Breaking signature change (new leading p_election_id param) — every
-- caller (backend/src/routes/vote.ts) is updated in the same change.
CREATE OR REPLACE FUNCTION fn_cast_vote(
    p_election_id       TEXT,
    p_voter_nid_hash    CHAR(64),
    p_nullifier_hash    CHAR(64),
    p_constituency_code VARCHAR(10),
    p_encrypted_vote    JSONB,
    p_zkp_proof         JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vote_id UUID;
    v_voter   RECORD;
BEGIN
    SELECT id, is_eligible, has_voted
    INTO v_voter
    FROM voters
    WHERE election_id = p_election_id AND nid_hash = p_voter_nid_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Voter not registered for this election (nid_hash not found)'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_voter.is_eligible THEN
        RAISE EXCEPTION 'Voter is not eligible to vote'
            USING ERRCODE = 'P0003';
    END IF;

    IF v_voter.has_voted THEN
        RAISE EXCEPTION 'Voter has already cast a vote'
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO votes (election_id, nullifier_hash, constituency_code, encrypted_vote, zkp_proof)
    VALUES (p_election_id, p_nullifier_hash, p_constituency_code, p_encrypted_vote, p_zkp_proof)
    RETURNING id INTO v_vote_id;

    UPDATE voters
    SET has_voted = true
    WHERE election_id = p_election_id AND nid_hash = p_voter_nid_hash;

    RETURN v_vote_id;
END;
$$;

-- ── 8. Fix immutability-gate triggers to be per-election, not global ──
-- Real bug found while planning this migration: the previous version did
-- `IF EXISTS (SELECT 1 FROM election_setup_commitments)` — UNSCOPED, so
-- anchoring election A's commitment silently froze election B's
-- still-in-setup candidates/constituencies too. Fixed to check only the
-- row's own election_id.
CREATE OR REPLACE FUNCTION fn_candidates_immutable_after_commitment()
RETURNS TRIGGER AS $$
DECLARE
    v_election_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_election_id := OLD.election_id;
    ELSE
        v_election_id := NEW.election_id;
    END IF;

    IF EXISTS (SELECT 1 FROM election_setup_commitments WHERE election_id = v_election_id) THEN
        RAISE EXCEPTION 'candidates are immutable once an election setup commitment has been anchored for this election';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_constituencies_immutable_after_commitment()
RETURNS TRIGGER AS $$
DECLARE
    v_election_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_election_id := OLD.election_id;
    ELSE
        v_election_id := NEW.election_id;
    END IF;

    IF EXISTS (SELECT 1 FROM election_setup_commitments WHERE election_id = v_election_id) THEN
        RAISE EXCEPTION 'constituencies are immutable once an election setup commitment has been anchored for this election';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 9. Keyholder identity/config — moved from static code (config/keyholders.ts)
-- to per-election DB rows. Two concurrent elections previously collided on
-- keyholder identity (KH-001..004 was a single global map with no election
-- dimension) — this table is what makes "a different election can have a
-- disjoint set of 4 keyholders" actually expressible.
CREATE TABLE IF NOT EXISTS keyholders (
    election_id     TEXT        NOT NULL REFERENCES elections (election_id),
    keyholder_id    TEXT        NOT NULL,
    role            TEXT        NOT NULL,
    share_index     INTEGER     NOT NULL CHECK (share_index BETWEEN 1 AND 4),
    -- Salted SHA-256 hash, same scheme as the previous static-config
    -- passphrases (config/keyholders.ts's verifyKeyholderPassphrase),
    -- ported into DB rows rather than changed.
    passphrase_hash TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (election_id, keyholder_id),
    CONSTRAINT uq_keyholders_election_share_index UNIQUE (election_id, share_index)
);

ALTER TABLE keyholders ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • Run this entire migration section manually in the Supabase SQL
--     Editor against the live project (no automated runner — see the
--     section header above).
--   • backend/src/scripts/seed-keyholders.ts (new) seeds this table per
--     election, replacing config/keyholders.ts's static DEMO_PASSPHRASES.
--   • POST /elections (new route) inserts the elections row for a new
--     election before any candidates/constituencies/voters can reference it
--     (FK-enforced — every scoped table now requires an existing election_id).
-- =============================================================


-- =============================================================
-- E-Voting Simulation — Distributed Key Generation (DKG) Ceremony
--
-- Replaces the trusted-dealer key ceremony (setup-shamir-zq.ts, which
-- momentarily holds the FULL private key x in one process before
-- splitting it) with a real 4-party Pedersen DKG run through the web
-- portal — each keyholder generates their own share entirely client-side
-- (frontend/src/pages/KeyCeremony.tsx); the server only ever relays
-- public commitments and end-to-end-encrypted sub-shares it cannot read.
--
-- Feldman VSS commitments are additively homomorphic, so the COMBINED
-- commitment vector (elementwise product of the 4 dealers' vectors,
-- backend/src/crypto/dkg.ts's combineFeldmanCommitments) has exactly the
-- same shape as today's single-dealer election_key_ceremony row — every
-- downstream route (keyshares.ts's /commitments, /submit-partial,
-- /tally, /verification-bundle) needs ZERO changes.
--
-- Idempotent, same convention as every other migration block in this file.
-- Run manually via the Supabase SQL Editor (no automated runner).
-- =============================================================

-- ── 1. Ceremony status — extends the existing per-election row rather
-- than adding a new table, since it's 1:1 with election_key_ceremony.
-- feldman_commitments stays NULL until status reaches 'qualified'.
ALTER TABLE election_key_ceremony
    ALTER COLUMN feldman_commitments DROP NOT NULL;

ALTER TABLE election_key_ceremony
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT ck_election_key_ceremony_status
            CHECK (status IN ('pending', 'round1', 'round2', 'qualified'));

-- ── 2. Round 1 — each keyholder's own Feldman commitments + ceremony
-- ECDH public key (P-256, for round-2 sub-share encryption). Public data
-- only; no secret ever stored here.
CREATE TABLE IF NOT EXISTS dkg_participants (
    election_id     TEXT        NOT NULL REFERENCES elections (election_id),
    keyholder_index INTEGER     NOT NULL CHECK (keyholder_index BETWEEN 1 AND 4),
    keyholder_id    TEXT        NOT NULL,
    -- This keyholder's own Feldman commitments to their locally-generated
    -- polynomial f_i(z), t=3: [C_i0, C_i1, C_i2], hex-encoded.
    commitments     JSONB       NOT NULL,
    ecdh_pubkey     TEXT        NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (election_id, keyholder_index)
);

ALTER TABLE dkg_participants ENABLE ROW LEVEL SECURITY;

-- ── 3. Round 2 — encrypted sub-share relay. ciphertext is AES-GCM under
-- an ECDH-derived key between the two browsers involved; the server
-- stores and forwards it but cannot decrypt it (no private key material
-- ever reaches the backend).
CREATE TABLE IF NOT EXISTS dkg_shares (
    election_id     TEXT        NOT NULL REFERENCES elections (election_id),
    from_index      INTEGER     NOT NULL CHECK (from_index BETWEEN 1 AND 4),
    to_index        INTEGER     NOT NULL CHECK (to_index BETWEEN 1 AND 4),
    ciphertext      TEXT        NOT NULL,
    iv              TEXT        NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (election_id, from_index, to_index)
);

ALTER TABLE dkg_shares ENABLE ROW LEVEL SECURITY;

-- ── 4. Round 3 — liveness/confirmation only. A keyholder posts this
-- after locally decrypting all 4 incoming sub-shares, Feldman-verifying
-- each against its sender's round-1 commitments, and summing them into
-- their own final share s_j. No secret in this row either.
CREATE TABLE IF NOT EXISTS dkg_confirmations (
    election_id     TEXT        NOT NULL REFERENCES elections (election_id),
    keyholder_index INTEGER     NOT NULL CHECK (keyholder_index BETWEEN 1 AND 4),
    confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (election_id, keyholder_index)
);

ALTER TABLE dkg_confirmations ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Notes for future implementation:
--   • POST /dkg/round1, /dkg/round2, /dkg/round3, GET /dkg/status (new
--     routes, backend/src/routes/dkg.ts) drive the ceremony.
--   • On the 4th /dkg/round3 confirmation, the route server-combines the
--     4 public commitment vectors (combineFeldmanCommitments) and writes
--     the result into election_key_ceremony.feldman_commitments +
--     status='qualified', and derives each key_shares.public_commitment
--     via the existing deriveShareCommitment (shamirZq.ts) — at that
--     point the ceremony output is byte-for-byte interchangeable with
--     the old single-dealer script's output.
--   • setup-shamir-zq.ts remains as a dev/simulation-only shortcut, not
--     the documented production ceremony path anymore.
-- =============================================================


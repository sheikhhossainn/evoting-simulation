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


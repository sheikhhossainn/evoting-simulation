# Research Methodology & Goal

## Goal

Prove — empirically, not just by assertion — that this system detects tampering with cast votes, both during an election and after tallying. Most published blockchain-voting work claims "immutable/tamper-proof" without testing that claim. Our contribution is a reproducible adversarial testing methodology that validates (and, where it fails, honestly bounds) that claim, using this system as the testbed.

## Why this angle

The field (300+ studies as of 2026) is saturated with new blockchain-voting architectures. Reviewers have seen the pattern. What's missing is not another design — it's proof that a design's tamper-evidence claim actually holds under attack, on a live public chain, with recorded results, including the cases where it *doesn't* hold and how they are mitigated. That's a publishable gap: methodology + evidence, not novelty of construction.

## Adversary model

The strength of every claim below depends on stating exactly what the attacker can and cannot do. We assume:

**Attacker capabilities:**
- Full read/write access to the application database (Supabase): can `INSERT`, `UPDATE`, `DELETE` any row, and can drop DB triggers.
- Can submit arbitrary requests to the public backend API.
- Knows all public parameters (ElGamal public key, election id, contract addresses).

**Attacker limitations (trust assumptions):**
- Cannot write to the anchoring chain contracts — `anchorRoot()` and `anchorSmtRoot()` in `MerkleRootStorage.sol` are `Ownable`, and `ElectionSetupCommitment.sol` is write-once. The `ANCHOR_PRIVATE_KEY` is not in the attacker's control. The attacker cannot forge or rewrite on-chain commitments.
- Cannot recompute a voter's nullifier — `NULLIFIER_SECRET` is server-side only.
- Cannot suppress or corrupt the **verifier**. Detection requires an honest auditor who re-fetches vote/batch data, recomputes roots, and compares them to on-chain values via `GET /anchor/verify/:voteId` or the standalone independent verifier (`backend/src/scripts/independent-verify-tally.ts`). The chain is the trust anchor; the auditor is the trusted process that reads it. If both DB and verifier are attacker-controlled, no scheme detects tampering — this is out of scope and stated as such.

Under this model, DB-layer defenses (triggers, RLS) are **defense-in-depth**, not the core claim — a DB admin can bypass them. The core claim rests entirely on the independent on-chain roots plus an honest verifier.

## What we are proving

**Claim**: any modification to a cast vote, any unauthorized deletion of a ballot, or any falsification of a finalized tally is detectable by an honest verifier, because:
1. The Merkle root of each anchored vote batch is committed to Ethereum Sepolia.
2. A Sparse Merkle Tree (SMT) commits the complete set of valid nullifiers to the blockchain, enabling cryptographic non-membership proofs against deletion.
3. Candidate and constituency configurations are permanently pinned via an on-chain setup commitment.
4. Final tallying relies on Chaum-Pedersen DLEQ proofs over partial decryptions, ensuring no single party can forge or reconstruct the private key.

## Scope of the tamper-evidence guarantee

Boundaries must be stated honestly, because cryptographic primitives prove specific properties:

- **Pre-anchor window**: a vote is tamper-evident on-chain only *after* `POST /anchor/batch` commits its batch root on-chain. A vote edited between casting and anchoring leaves no on-chain trace. The system's guarantee is therefore parameterised by the **anchoring cadence** (e.g. batching cadence or time window). We test this window explicitly.
- **Deletion vs. edit (Dual Merkle Architecture)**:
  - Editing a leaf breaks the dense Merkle tree root (detected).
  - Deleting an anchored vote is caught via two mechanisms:
    1. The on-chain `voteCount` committed per batch in `MerkleRootStorage.sol`.
    2. The **Sparse Merkle Tree (SMT)**: an auditor holding a voter's nullifier can request a non-membership proof. If a previously anchored nullifier is deleted from the tree, the SMT root changes, diverging from the on-chain SMT root commitment.

## How we prove it

Adversarial, property-based testing — not formal cryptographic proof. For each property: state the claim, attempt the attack under the adversary model above, record the observed result as **detected / not detected / mitigated**.

| # | Property | Attack | Expected / observed result |
|---|---|---|---|
| 1 | Double-vote prevention | Concurrent duplicate `POST /vote` for same voter | Exactly one succeeds (nullifier + atomic `fn_cast_vote` row-lock) |
| 2 | Ballot secrecy | Join `votes` to `voters` via any available column | Impossible — no voter identity FK or raw hash exists on `votes` |
| 3 | Nullifier unlinkability | Recompute a voter's nullifier from public info | Impossible — `NULLIFIER_SECRET` is held server-side |
| 4 | Vote immutability (DB, defense-in-depth) | Direct SQL `UPDATE` or `DELETE` on a vote row | Rejected by triggers (`trg_votes_immutable`, `trg_votes_no_delete`); bypassable only via explicit `SECURITY DEFINER fn_admin_delete_vote()` |
| 5 | Tamper detection — edit (chain) | Edit `encrypted_vote` or batch `vote_ids` in Supabase, then re-verify | Detected — `409 Conflict`, recomputed root ≠ on-chain root |
| 6 | Tamper detection — deletion (chain) | Delete an anchored vote row and re-verify | Detected — batch count mismatch in `MerkleRootStorage`, dense tree recomputation fails, and SMT root diverges |
| 7 | Pre-anchor window | Edit a vote *before* its batch is anchored | **Reported honestly**: not detectable on-chain until anchored; bounded by anchoring cadence |
| 8 | Candidate set integrity | Substitute or alter candidates/constituencies post-deployment | Detected — TLV hash differs from on-chain `ElectionSetupCommitment` |
| 9 | Threshold partial decryption & tally correctness | Submit forged partial decryption or tally with <3 shares | Detected & rejected — Chaum-Pedersen DLEQ proof fails; key is never reconstructed anywhere |

Each row is backed by real transaction hashes on Sepolia Etherscan, test suites, and captured run artifacts.

## Why this is sufficient for publication

- Detection of tampering is an empirical property: something either gets caught or it doesn't. It does not require a game-based cryptographic reduction.
- Reporting the boundaries (pre-anchor window, single-dealer vs. DKG nuances) *strengthens* the research — reviewers trust an evaluation that names its failure modes and mitigations over an unverified all-green claim.
- The cryptographic primitives we rely on (ElGamal, Feldman VSS, Chaum-Pedersen DLEQ, Sparse Merkle Trees, keccak256) are established literature — we cite, not re-derive.
- What's novel here is running the full attack-and-observe cycle end-to-end on a live public testnet (Ethereum Sepolia), publishing an explicit adversary model, and publishing the methodology and independent verifier so other blockchain-voting projects can reproduce it.

## Target venue

E-Vote-ID or an IEEE/ACM systems/security-track venue — audiences that want system implementation + adversarial evaluation, not a pure theory paper.

## Scope boundary

Not attempting: formal reduction proofs or production-grade key sizes (e.g. 2048-bit). Also out of scope: an attacker who simultaneously controls both the database *and* the independent verifier (no system survives a compromised verifier). Ballot validity is enforced via non-interactive Chaum-Pedersen OR-proofs (`zkp.ts`), and tally correctness via verifiable partial decryptions (`dleq.ts`). The paper's strength is the evaluation methodology and its empirical results — including honest boundaries — backed by public blockchain evidence.


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
- Knows all public parameters (ElGamal public key, election id, contract address).

**Attacker limitations (trust assumptions):**
- Cannot write to the anchoring chain contract — `anchorRoot()` is `Ownable`, and the `ANCHOR_PRIVATE_KEY` is not in the attacker's control. The attacker cannot forge or rewrite an on-chain Merkle root.
- Cannot recompute a voter's nullifier — `NULLIFIER_SECRET` is server-side only.
- Cannot suppress or corrupt the **verifier**. Detection requires an honest auditor who re-fetches vote/batch data, recomputes the Merkle root, and compares it to the on-chain value via `GET /anchor/verify/:voteId`. The chain is the trust anchor; the auditor is the trusted process that reads it. If both DB and verifier are attacker-controlled, no scheme detects tampering — this is out of scope and stated as such.

Under this model, DB-layer defenses (triggers, RLS) are **defense-in-depth**, not the core claim — a DB admin can bypass them. The core claim rests entirely on the independent on-chain root plus an honest verifier.

## What we are proving

**Claim**: any modification to a cast vote or a finalized tally — whether during the voting window or after — is detectable by an honest verifier, because the Merkle root of each anchored vote batch is committed to a public chain (Ethereum Sepolia) independent of our own database.

Split into two properties, matching the two attack windows:
1. **During-vote integrity** — double-vote prevention, ballot immutability, nullifier unlinkability (voter identity cannot be tied back to a decrypted vote).
2. **Post-tally integrity** — any edit to an *anchored* vote or batch record is caught by recomputing the Merkle root and comparing to the on-chain value.

## Scope of the tamper-evidence guarantee

Two boundaries must be stated honestly, because a Merkle root proves **inclusion**, not **completeness or timing**:

- **Pre-anchor window**: a vote is tamper-evident only *after* `POST /anchor/batch` commits its batch root on-chain. A vote edited between casting and anchoring leaves no on-chain trace. The system's guarantee is therefore parameterised by the **anchoring cadence** — the maximum time a vote sits unanchored. We test this window explicitly rather than hide it.
- **Deletion vs. edit**: a Merkle root anchors the *contents* of the leaves that were included. Editing a leaf breaks the recomputed root (detected). Deleting a whole anchored vote *and* its `merkle_batches.vote_ids` entry can leave a self-consistent smaller tree — inclusion proofs for surviving votes still pass. Completeness is only detectable if the batch also commits a **vote/leaf count** on-chain that the auditor checks. We test deletion and report the result honestly (detected / not detected / mitigated by count commitment).

## How we prove it

Adversarial, property-based testing — not formal cryptographic proof. For each property: state the claim, attempt the attack under the adversary model above, record the observed result as **detected / not detected / mitigated**.

| # | Property | Attack | Expected / observed result |
|---|---|---|---|
| 1 | Double-vote prevention | Concurrent duplicate `POST /vote` for same voter | Exactly one succeeds (nullifier + atomic `fn_cast_vote`) |
| 2 | Ballot secrecy | Join `votes` to `voters` via any available column | Impossible — no `voter_nid_hash` column exists on `votes` |
| 3 | Nullifier unlinkability | Recompute a voter's nullifier from public info | Impossible — `NULLIFIER_SECRET` server-side only |
| 4 | Vote immutability (DB, defense-in-depth) | Direct SQL `UPDATE` on a vote row | Rejected by trigger — but noted as bypassable by a DB admin who drops the trigger; real guarantee is row 5 |
| 5 | Tamper detection — edit (chain) | Edit `encrypted_vote` or a batch's `vote_ids` in Supabase, then re-verify | Detected — `409`, recomputed root ≠ on-chain root |
| 6 | Tamper detection — deletion (chain) | Delete an anchored vote row **and** its `vote_ids` entry, re-verify | **Reported honestly**: inclusion proofs for survivors still pass; completeness caught only if batch commits a leaf-count on-chain. Result stated as detected / not-detected + mitigation |
| 7 | Pre-anchor window | Edit a vote *before* its batch is anchored | **Reported honestly**: not detectable on-chain until anchored; bounds the guarantee by anchoring cadence |
| 8 | Threshold decryption | Attempt tally with <3 of 4 key shares | Rejected, zero key material exposed |

Each row is one entry in the evaluation table: property claimed → attack attempted → observed result. Rows 6 and 7 may be negative or partial results; we report them as-is with mitigations, not as failures to hide. This table, backed by real transaction hashes on Sepolia Etherscan and screenshots, is the paper's evidence — not a security proof by reduction.

## Why this is sufficient for publication

- Detection of tampering is an empirical property: something either gets caught or it doesn't. It does not require a game-based cryptographic proof.
- Reporting the boundaries (pre-anchor window, deletion/completeness) *strengthens* the paper — reviewers trust an evaluation that names its failure modes and mitigations over an all-green table.
- The cryptographic primitives we rely on (ElGamal, Shamir, Merkle/keccak256) are already proof-validated by their own established literature — we cite, not re-derive.
- What's novel here is running the full attack-and-observe cycle end-to-end on a real public testnet, not a simulated chain, publishing an explicit adversary model, and publishing the methodology so other blockchain-voting projects can reuse it.

## Target venue

E-Vote-ID or an IEEE/ACM systems-track venue — audiences that want system + adversarial evaluation, not a pure theory paper.

## Scope boundary

Not attempting: formal reduction proofs, zk-SNARK vote-validity proofs, or production-grade cryptographic parameters. Also out of scope: an attacker who controls both the database *and* the verifier (no scheme survives that). These are documented as scoped-out (see `context.md` → Not Yet Implemented, `LEFTWORK.md` Task 6). The paper's strength is the evaluation methodology and its results — including honest boundaries — not novel cryptography.

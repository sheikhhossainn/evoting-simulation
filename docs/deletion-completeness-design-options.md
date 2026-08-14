# Deletion-Completeness: Design Options (Analysis Only — Not Implemented)

Companion to [threat_model.md §5](./threat_model.md#5-deletion-completeness-gap-detail). This
document compares three architectures for closing the deletion-completeness gap. **No
implementation decision is made here** — this is the comparison to review before committing to one.

## 0. Precise statement of the gap

Today's guarantee (`GET /anchor/verify/:voteId`, tested in
[evaluation_writeup.md §1](./evaluation_writeup.md#1-tamper-detection--on-chain-anchoring-task-1)):
*"if this ballot is claimed to be in batch B, and batch B was anchored with root R, then any edit to
that ballot's row is detected."* This is a per-leaf, per-batch guarantee.

What it does **not** cover: a ballot that is deleted (or simply never inserted into a batch) before
batching happens leaves **no trace at all** — no proof was ever generated for it, so there is nothing
to invalidate. `merkle_batches.vote_ids` (schema.sql:577) is an off-chain, attacker-reachable list —
the same Supabase service-role credential that can edit a `votes` row can edit which ids a batch
claims to cover. On-chain, `anchorRoot` only stores `root`, `voteCount`, `timestamp`
([MerkleRootStorage.sol:14-18](../blockchain/contracts/MerkleRootStorage.sol)) — three opaque words
per batch, with nothing that independently pins down *which* ballots or *how many total across the
election* should exist. The question this needs to answer is:

> Can an outside observer verify that the union of all anchored batches equals the complete set of
> ballots actually cast — not merely that each anchored ballot, individually, wasn't later edited?

## 1. Option A — Append-only log + periodic commitment

**Mechanism:** Every vote insertion (not just batch anchoring) is written, in order, to a
hash-chained log: `entry_i.hash = H(entry_{i-1}.hash ‖ vote_i)`. Periodically (same batch cadence as
today, or more often), the current chain tip is signed and/or anchored on-chain alongside the
existing Merkle root.

**Attack coverage:**

| Attack | Detected? | Why |
|---|---|---|
| Deletion (of an already-chained entry) | **Yes** | Removing entry *i* breaks every subsequent hash link; the next signed tip won't recompute |
| Deletion (before it's ever chained) | **No** | If the attacker deletes the DB row before the chaining process runs over it, no entry was ever appended — same blind spot as today, just moved one step earlier |
| Insertion (forged ballot spliced in) | **Yes**, if inserted between existing entries (breaks the chain); **not caught** if appended at the current tip with a plausible-looking next hash — nothing external pins what the "true" next entry should have been |
| Duplication | Partially — a duplicate nullifier is already rejected by the DB unique constraint (existing mechanism, unrelated to this design) |
| Reordering | **Yes** — the chain encodes order; reordering changes every downstream hash |
| Non-membership proof (positive proof a ballot does NOT exist) | **No** — a hash chain only proves inclusion/order of what's in it, not the completeness of the universe of what should be in it |

**New trust assumptions:** The chaining process itself (who computes `entry_i.hash` and when) is
still backend-controlled. If the backend/DB attacker controls both the vote table and the chaining
job, they can delete-then-chain consistently — the log documents a *self-consistent* history, not
necessarily the *true* history. This design raises the bar (attacker must now compromise the
chaining job, not just the DB) but does not remove the single-trusted-writer assumption.

**Storage/compute:** Cheap. One extra hash column per vote row, or a small sidecar table. Chaining
cost is O(1) per insert. No new on-chain structure needed beyond what exists — the periodic
"commitment" can just be an additional `bytes32` (the chain tip) passed into the existing
`anchorRoot` call, or a parallel `anchorLogTip` call.

**Integration with existing anchoring:** Trivial. Reuses `MerkleRootStorage.anchorRoot` cadence;
add one field. No contract redesign, no new gas structure — same flat ~98,076 gas per anchor
(per [anchoring-cost-analysis.md](./anchoring-cost-analysis.md)), just slightly larger calldata.

**Research contribution:** Weak. This is the well-known Certificate-Transparency-style log pattern
(RFC 6962) applied without CT's actual novel piece — CT's real completeness guarantee comes from
independent *monitors* continuously re-fetching and cross-checking the log, and *gossip* between
verifiers to catch split-views (a malicious log server showing different histories to different
clients). Implementing only the hash-chain, without monitors/gossip, gets the "sounds like Certificate
Transparency" framing without the property that actually makes CT hard to cheat. A paper reviewer
familiar with CT will ask "where are your monitors?" — a fair question this design alone doesn't answer.

**Verdict:** Simplest to build, genuinely raises attacker cost, but **does not solve deletion
completeness** in the sense of catching "this ballot was deleted before it entered the log at all."
It moves the trust boundary rather than removing it.

---

## 2. Option B — Authenticated complete-set commitment

**Mechanism:** At each anchoring point, commit to the **entire** current ballot set as a single
value that is a function of *count and content together*, not just a root over whatever the backend
chooses to include. Concretely: extend `merkle_batches`/`anchorRoot` so each anchor commits to
`(sorted_leaf_root, total_vote_count_to_date, previous_commitment_hash)` — i.e. every anchor
references the previous one, and a monotonically increasing global counter (backed by a DB sequence
or the `nullifiers` table's row count, which already exists and is append-only-by-constraint at the
uniqueness level) is committed alongside the tree.

**Attack coverage:**

| Attack | Detected? | Why |
|---|---|---|
| Deletion (before or after chaining) | **Yes, if it changes the count** — a deleted ballot makes `total_vote_count_to_date` at the next anchor inconsistent with the previous anchor's count plus newly-queued votes in between (an external auditor can independently count `nullifiers` rows created since the last anchor and compare) | Requires the count itself to come from an append-only source the DB admin can't quietly edit (see below) |
| Insertion (forged ballot) | **Yes** — total count increases without a corresponding real registration/nullifier event |
| Duplication | Already caught by nullifier uniqueness; commitment adds no new coverage here |
| Reordering | **Yes** — `sorted_leaf_root` uses a canonical sort (e.g. by nullifier_hash), so reordering the underlying rows doesn't change the root, which is the point: reordering *shouldn't* matter, but *set membership and count* must match exactly |
| Non-membership proof | **Partially** — proves the *count* is inconsistent with expectation, but doesn't hand an observer a cryptographic proof that "ballot X specifically is missing," only that "the set is short by N" |

**New trust assumptions:** The count source (`nullifiers` table row count, or a dedicated append-only
counter) must itself be tamper-evident, or a DB admin who can delete a `votes` row can just as easily
delete the corresponding `nullifiers` row and the count stays "consistent" with the smaller set —
this is the same problem restated one table over. To actually close this, the counter needs to live
somewhere the DB admin can't unilaterally rewrite — e.g. incremented on-chain per vote (defeats the
batching cost savings this system relies on, see
[batching-vs-per-vote.md](./batching-vs-per-vote.md)), or via a separate signing service that
countersigns every `POST /vote` success independently of the DB (a second, narrower trust root, but
a real one — not free).

**Storage/compute:** Moderate. Canonical sort adds `O(N log N)` at batch-build time (already doing
`O(N log N)`-ish work building the Merkle tree, so marginal). The running counter is cheap. The real
cost is wherever the tamper-evident counter is anchored — if on-chain per vote, this reintroduces the
N× gas cost batching was built to avoid; if via a separate signing service, that service is new
infrastructure with its own uptime/compromise story.

**Integration with existing anchoring:** Moderate. `MerkleRootStorage.anchorRoot(bytes32 root,
uint256 voteCount)` **already takes `voteCount`** — the contract has half of this today. Extending it
to also store `previousCommitmentHash` (chaining batches together, closing the "batch N's set could
have silently shrunk relative to batch N-1" gap noted in
[FUTURE_WORK.md §5.2](../FUTURE_WORK.md#52-blockchain--batch-visualizer-new), which independently
flags wanting `previous_batch_hash` for the visualizer) is a natural, additive contract change — no
redesign, one new `bytes32` field and one new `require` linking batches.

**Research contribution:** Moderate-to-strong, **if** the counter's tamper-evidence problem is solved
credibly rather than asserted. This is the more interesting half of the analysis: chaining batches
together (already half-built via `voteCount`) closes the "shrinking set across batches" gap cleanly.
But it only fully solves completeness if paired with a counter source independent of the DB admin's
write access — worth stating explicitly as the mechanism's real dependency, not glossing over it.

**Verdict:** Meaningfully stronger than Option A, integrates cleanly with what's already half-present
in the contract (`voteCount`, sequential `batchId`), but its completeness guarantee is only as strong
as the tamper-evidence of the underlying vote counter — which needs its own design decision (on-chain
per-vote counter vs. separate signer) that this option doesn't resolve on its own.

---

## 3. Option C — Sparse Merkle tree / authenticated set (membership + non-membership)

**Mechanism:** Replace (or supplement) the dense Merkle tree over "whatever ballots happen to be in
this batch" with a sparse Merkle tree (SMT) or comparable authenticated set (e.g. a Merkle Patricia
Trie, or an RSA/class-group accumulator) keyed by `nullifier_hash` over the *entire fixed key space*
(every possible nullifier is either present or provably absent). Anchoring publishes the SMT root.

**Attack coverage:**

| Attack | Detected? | Why |
|---|---|---|
| Deletion | **Yes** — deleting a leaf changes its position from "present" to "absent," and a *non-membership proof* can be requested and will now succeed for a nullifier that should have a membership proof; anyone holding the voter's old proof (or the voter themselves, via their retained nullifier) can produce contradictory evidence |
| Insertion (forged ballot) | **Yes** — standard SMT membership-proof soundness, same as a dense Merkle tree |
| Duplication | Already caught by nullifier uniqueness at the DB layer; SMT adds a second, cryptographic enforcement — a nullifier key can only be "present" once by construction, closing the gap even if the DB constraint were somehow bypassed |
| Reordering | N/A — SMT is keyed by content (nullifier_hash), not insertion order, so "reordering" isn't a meaningful attack against it |
| Non-membership | **Yes — this is the design's whole point.** Any observer can request "prove nullifier X is NOT in the tree" and get a cryptographic answer, in `O(log(key space))` (typically 256 for a SHA-256-keyed SMT), regardless of how many real votes exist |

**New trust assumptions:** Fewer than Option B, in one specific sense — completeness no longer
depends on trusting an external counter, because non-membership is provable directly from the tree
itself. But the SMT must still be built from the *true* set of votes by *someone* — the construction
step is still backend-controlled, so a DB admin who deletes a vote row before SMT construction
produces a "valid" SMT that's honestly missing that ballot, same blind spot as Option A/B's
pre-commitment window (see [threat_model.md §6](./threat_model.md#6-pre-anchor-integrity-window-detail)
— this is a fundamentally separate problem from deletion-*after*-commitment, and no design in this
doc solves the pre-commitment window on its own).

**Storage/compute:** Highest of the three. A naive SMT over a 256-bit key space needs `O(log2(256)) =
256`-deep proofs (vs. `ceil(log2 N)` ≈ 10–14 for the current dense tree at realistic N per
[anchoring-cost-analysis.md §4.1](./anchoring-cost-analysis.md#41-off-chain-merkle-build--proof-measured)).
Practical SMT implementations (e.g. the "compressed" / default-hash-caching style used in
Libra/Diem's JMT, or Ethereum's own state trie) avoid a literal 256-deep walk for sparse trees via
default-node caching, bringing real proof size back down close to `O(log2 N)` in practice — but this
needs a real implementation (not a novel algorithm — well-trodden, but new code and new tests for
this codebase, not a drop-in reuse of the existing `merkleTree.ts` dense-tree module) and its own
performance validation before the numbers in anchoring-cost-analysis.md could be trusted for it.

**Integration with existing anchoring:** Largest lift of the three. `MerkleRootStorage.sol`'s
`verify()` currently calls OpenZeppelin's standard dense `MerkleProof.verify` — an SMT needs a
different verification circuit (still cheap on-chain, SMT verification is also just repeated
hashing, but it's different code, not a parameter tweak to the existing contract). The
`backend/src/merkle/merkleTree.ts` module (dense tree, `buildMerkleTree`/`getProof`/`verifyProof`)
would need a parallel or replacement SMT module. This is a genuine architectural change, not additive
like Option B's `voteCount` extension.

**Research contribution:** Strongest of the three, and the most defensible framing for a journal
paper: "membership *and* non-membership, so an independent observer can audit the complete ballot set,
not merely spot-check individual ballots" is a real, citable property (SMTs/authenticated dictionaries
are established in the literature — e.g. CONIKS, Google's Key Transparency — applying that to
e-voting ballot-set completeness is a legitimate, nameable contribution, not just "we added a hash
chain"). It also directly answers the reviewer question flagged in
[threat_model.md §9](./threat_model.md#1-must-fix) about why blockchain-anchoring is necessary versus
a signed bulletin board — non-membership proofs are much harder to fake with a simple signed log,
strengthening that argument too.

**Verdict:** Highest research payoff, highest implementation cost, and — same caveat as A and B —
does not by itself solve the pre-commitment window (§6 of the threat model); that needs its own
mechanism regardless of which of these three is chosen for post-commitment completeness.

---

## 4. Cross-cutting finding: none of the three solves the pre-commitment window alone

All three options assume the "commit" step is performed honestly. A DB/backend attacker who deletes
a vote row *before* it is ever chained, counted, or inserted into the SMT is invisible to all three
— this is threat_model.md §6 (pre-anchor integrity), a distinct problem from §5 (deletion
completeness after commitment). Closing §6 needs either much more frequent commitment (shrinking the
window) or a commitment step that doesn't trust the backend alone (e.g. voters or a third party
co-signing at insertion time) — worth scoping as a related but separate follow-up regardless of which
option is chosen here.

## 5. Summary comparison

| Dimension | A: Append-only log | B: Complete-set commitment | C: Sparse Merkle / authenticated set |
|---|---|---|---|
| Solves deletion-after-commitment | Partially (raises cost, doesn't remove trust) | Yes, if paired with a tamper-evident counter | Yes, directly |
| Non-membership proofs | No | No (only aggregate count mismatch) | Yes — the core feature |
| Pre-commitment window (§6) | Not solved | Not solved | Not solved |
| New trust assumptions introduced | Chaining-job integrity | Tamper-evident vote counter (needs its own design) | SMT construction-time integrity (same class as A/B) |
| Contract change | Additive (one field) | Additive (`voteCount` already exists; add `previousCommitmentHash`) | Structural (new verify path) |
| Backend change | Small (sidecar hash chain) | Moderate (canonical sort + counter source) | Large (new SMT module, parallel to `merkleTree.ts`) |
| Gas | Unchanged (flat, ~98,076/batch) | Unchanged (flat) | Unchanged per-anchor, but proof *retrieval/verification* cost off-chain is higher |
| Research contribution strength | Weak (CT-pattern without CT's monitors) | Moderate (real, but leans on an unsolved sub-problem) | Strong (established authenticated-dictionary literature, novel application here) |

## 6. Recommendation

**Option C (sparse Merkle tree / authenticated set), with Option B's chained-batch-commitment
folded in rather than treated as a separate alternative.**

Reasoning: the research question worth answering — *"can an observer verify the committed ballot set
has not been silently altered, not just that individual ballots weren't edited"* — is exactly what
non-membership proofs answer and dense trees structurally cannot. Option A is real but not enough on
its own to claim the completeness property; a reviewer who knows RFC 6962 will immediately ask about
monitors/gossip, which this system doesn't have and adding them is a bigger project than the SMT
itself. Option B is a genuine partial win and cheap to add (the contract already carries `voteCount`,
so chaining batches via a `previousCommitmentHash` is close to free) — but folding it into C rather
than picking one instead of the other gets both properties: chained batches (catches a shrinking set
across anchors, cheaply) *and* non-membership proofs within each batch (catches an omission the
attacker never let reach any batch at all, to the extent §6's pre-commitment window allows).

The honest cost: Option C is a real engineering lift (new SMT module, new contract verify path, new
test suite mirroring the existing 19+11 assertion coverage in
[evaluation_writeup.md §8](./evaluation_writeup.md#8-merkle-tree-integrity)) — this is not a
small-diff change like #2 was. Recommend scoping it as its own implementation phase with a design
doc for the SMT construction specifically (default-hash caching strategy, key space, canonical
nullifier-hash keying) before writing code, given the complexity.

**Deliberately not recommending Option A alone** — it is the "easiest to integrate" path the original
five-option list flagged as a risk of defaulting to, and per the analysis above it does not close the
gap the research question is actually asking about.

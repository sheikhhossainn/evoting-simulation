# Sparse Merkle Tree (SMT) Construction — Design Document

Follows the recommendation in
[deletion-completeness-design-options.md §6](./deletion-completeness-design-options.md#6-recommendation)
(Option C + Option B's batch-chaining folded in). **Design only — no production code is touched by
this document.** Implementation is a separate phase once this is reviewed.

## 1. Scope and relationship to the existing dense tree

The existing per-batch dense Merkle tree
([merkleTree.ts](../backend/src/merkle/merkleTree.ts)) is **not replaced**. It continues to answer
"was this specific ballot in this specific anchored batch, unmodified?" — that guarantee, and its
test coverage (19 off-chain + 11 on-chain assertions per
[evaluation_writeup.md §8](./evaluation_writeup.md#8-merkle-tree-integrity)), stays as-is.

The SMT is a **second, additive structure**: one global, election-scoped authenticated set, keyed by
`nullifier_hash`, updated incrementally at every batch anchor. It answers the question the dense tree
structurally cannot: "is this nullifier a member of the complete ballot set as of this anchor, or
can I get a proof that it is NOT?" Both trees are anchored together at each batch (§8).

## 2. Canonical key construction

**Key = the raw 32-byte `nullifier_hash` value, used as-is.**

`nullifier_hash` is already `SHA-256(nid + election_id + NULLIFIER_SECRET)`
([identity.ts:33-38](../backend/src/crypto/identity.ts#L33-L38)) — a uniformly distributed 256-bit
value, stored as `CHAR(64)` hex in the `votes` table
([schema.sql:141-143](../backend/src/schema.sql#L141-L143)), unique per vote by DB constraint. It is
exactly the value that must be provable "in the set" or "not in the set," so no re-derivation or
re-hashing into a different key is needed — decode the existing hex string to 32 bytes and use it
directly as the SMT path.

**No additional secret or PII is introduced.** The nullifier is already the system's chosen
non-identifying handle for "one ballot" (§ballot secrecy in [README.md](../README.md)); reusing it
as the SMT key doesn't create a new deanonymization surface beyond what the nullifier already is.

## 3. Key space

**256 bits** (`2^256` possible keys), matching the 256-bit SHA-256 output space of `nullifier_hash`
and the 256-bit word size Solidity/keccak256 operate on natively — no truncation, no re-encoding
across hash families at the tree-path level.

The tree therefore has a **fixed depth of 256** — every key's path from root to leaf is exactly 256
levels, determined bit-by-bit (MSB-first, i.e. bit 255 of the key selects the branch at the root,
bit 0 selects the branch just above the leaf). Fixed depth is what makes non-membership provable in
constant proof shape: every key, present or absent, has a well-defined unique path, so "prove key K
is absent" is not a special case — it's the same walk as membership, terminating in the canonical
empty-leaf marker instead of a real leaf.

## 4. Default hashes (empty-subtree hashes)

Precompute a fixed table `H[0..256]`, representing the root hash of an *entire empty subtree* of a
given height — independent of which key would eventually occupy it:

```
H[0]   = keccak256(0x00)                      // canonical "empty leaf" marker
H[i]   = hashPair(H[i-1], H[i-1])   for i = 1..256
```

`hashPair` is the same commutative-sorted pairing already used by the dense tree
([merkleTree.ts:39-42](../backend/src/merkle/merkleTree.ts#L39-L42)) — reuse it verbatim, do not
introduce a second pairing convention.

`H[0]` uses a single fixed input byte (`0x00`), never a key — because it represents "no leaf exists
here," which must hash identically regardless of position, so the same 256 precomputed values work
for every path in the tree. This is the standard technique for making sparse trees tractable (per
[deletion-completeness-design-options.md §3](./deletion-completeness-design-options.md#3-option-c--sparse-merkle-tree--authenticated-set),
citing the Dahlberg/Pulls/Peeters construction and its use in CONIKS/Key Transparency-style systems).

`H[256]` is therefore the **root of the fully empty tree** — the canonical starting root before any
vote has ever been anchored (§7).

## 5. Leaf structure

For an **occupied** key (a real, anchored vote):

```
leaf_hash(key, voteLeafHash) = keccak256(0x01 ‖ key ‖ voteLeafHash)
```

Where `voteLeafHash` is the **existing** dense-tree leaf hash,
`hashVoteLeaf({voteId, c1, c2, createdAt})`
([merkleTree.ts:30-36](../backend/src/merkle/merkleTree.ts#L30-L36)) — reused unchanged. This means
the SMT leaf commits to exactly the same immutable vote fields the dense tree already commits to, so
a single vote's content-integrity guarantee doesn't fork into two different definitions of "what does
this leaf mean." The `0x01` prefix domain-separates SMT leaves from the `0x00` empty-leaf marker and
from internal-node hashes (§6), so no value can be crafted to collide across leaf/internal-node/empty
roles (standard second-preimage defense, same rationale as the dense tree's own double-hash comment
at [merkleTree.ts:13-14](../backend/src/merkle/merkleTree.ts#L13-L14)).

For an **unoccupied** key: no leaf hash is computed per-key at all. Its position resolves to `H[0]`
by definition (§4) — there is nothing to hash, which is precisely what makes non-membership proofs
possible without per-key bookkeeping for the whole `2^256` space.

## 6. Internal node hashing

```
node_hash(left, right) = keccak256(left ‖ right)   // NOT sorted — position-aware
```

**This is deliberately different from the dense tree's commutative `hashPair` — see §6.1.** Every
other hashing choice in this document (leaf structure §5, default-hash table §4) is shared with or
mirrors the dense tree; this is the one place the two trees diverge, and the divergence is load-bearing,
not stylistic.

### 6.1. Why not the dense tree's commutative hashPair (found via adversarial testing)

The original version of this document specified `node_hash(left, right) = hashPair(left, right)`
(the dense tree's commutative, sorted pairing), with the root-calculation algorithm (§11) computing
`current = hashPair(current, sibling)` at every level regardless of which side `current` was
conceptually on, on the reasoning that "hashPair is commutative-sorted, so left/right assignment
doesn't affect the hash." That reasoning is correct as a statement about `hashPair` — but it has a
consequence that was missed until implementation testing: it means the verification algorithm never
actually uses the claimed key to determine anything about how the siblings combine. The key was used
to compute the *leaf* value (`leafHash(key, value)` for membership), but for **non-membership**, the
leaf value is a universal constant (`H[0]`, the same for every possible key) — so a non-membership
proof's `(bitmap, siblings)` carried **no cryptographic dependency on the claimed key at all**.

**Concretely:** a genuine non-membership proof honestly generated for key K1 could be resubmitted
with the `key` field simply relabeled to a different key K2, and it would still verify — because
verification never checked that K2's own bit-path actually produced that specific sibling sequence.
Reproduced directly against the reference implementation before the fix:

```
proof for absentKey verifies: true
SAME bitmap+siblings, DIFFERENT key, still verifies as non-member: true
reusing an absence proof's bitmap/siblings to falsely claim a REAL MEMBER's key is absent: true
```

That third line is the serious one: an attacker holding any one honest absence proof could relabel
it to falsely "prove" a completely unrelated key — including a key that is an actual anchored
member — is absent. This directly undermines §8's deletion-detection mechanism, which depends on
non-membership proofs being trustworthy evidence about the *specific* key being checked.

**The fix:** switch internal-node hashing, for the SMT only, from commutative (`hashPair`) to
position-aware (`keccak256(left‖right)`, unsorted), and use the claimed key's bit at each level to
decide which side `current` occupies. Reusing another key's siblings now only reconstructs the
target root if that key's bit-path agrees with the original key at every single level — which,
for two genuinely different keys, is cryptographically infeasible to arrange (would require a
keccak256 collision), and is the exact mechanism that already makes *membership* proofs safe
(their leaf value is key-bound, so this class of relabeling was never possible for them).

**What this changes and what it doesn't:** default hashes `H[0..256]` (§4) are numerically
**unchanged** — every default-table hashPair call combines a value with an identical copy of
itself, and order never affects the output of a two-identical-operand hash regardless of sorting
convention, so `GENESIS_ROOT`/`EMPTY_TREE_ROOT` did not need to be recomputed. Key construction (§2),
key space (§3), leaf structure (§5), proof format (§10), batch chaining (§9), and the dense tree
(unaffected — it has no non-membership proofs and its leaves are already content-bound, so it never
had this exposure) are all unchanged. This is a fix to one hashing convention within the SMT module,
not an architectural redesign.

A regression test proving K1's absence proof cannot be relabeled as K2 — including the
real-member case — is required in the test plan (§13) and must never be weakened or removed.

## 7. Empty-tree behavior

Before any vote exists, the SMT root is the constant `H[256]` (§4) — computable once, at compile
time / deploy time, never recomputed at runtime. This is the **genesis root**, the required
`previousRoot` value for the very first `anchorSmtRoot` call (§8).

## 8. Insertion and deletion semantics

**Insertion** (a vote is confirmed and enters the next batch): walk the key's 256-bit path from the
current root; at the leaf position, replace `H[0]` (or, in a correctly-functioning system, there is
never a prior non-empty value at a key — nullifier uniqueness is enforced by the DB constraint before
a vote ever reaches batching) with `leaf_hash(key, voteLeafHash)`; recompute the 256 ancestor hashes
up to the new root. This touches exactly `O(256)` nodes regardless of how many keys already exist in
the tree — sparse-tree updates are always path-local.

**Deletion** (a vote row is removed from the DB, honestly or maliciously, before or after its key was
ever inserted): if the key had never been inserted, nothing changes — deletion of a never-anchored
row is the pre-commitment-window gap already scoped out in
[deletion-completeness-design-options.md §4](./deletion-completeness-design-options.md#4-cross-cutting-finding-none-of-the-three-solves-the-pre-commitment-window-alone)
and is **not** solved by this design (needs its own follow-up). If the key **had** already been
inserted at a prior anchor and is now removed, the SMT rebuild for the next batch resets that leaf
position back to `H[0]` and recomputes the root — producing a new root under which that key is
provably **absent**.

**This is the core detection mechanism, not an incidental property:** the key's *membership* proof
against the **older, already-anchored** root remains valid forever (old roots don't change — they're
immutable on-chain history) while a *non-membership* proof against the **newer** root is now also
obtainable. Anyone holding — or able to regenerate — the older membership proof, compared against the
newer non-membership proof for the same key, has a direct, self-contained cryptographic
contradiction: this key cannot honestly be both a real 2026 election member and a removed one. No
external counter or trusted auditor is required to notice this for a *specific* key someone is
already watching (e.g. a voter checking their own nullifier); §9 covers how a *general* audit finds
this without knowing which key to check in advance.

In an honestly-run election, **every key transition is monotonic: `H[0]` (absent) → occupied, never
occupied → `H[0]`.** This monotonicity is the property a watchdog audit checks (§9), and it is the
precise, checkable form of "deletion completeness" this design delivers — **scoped strictly to keys
that have already been anchored at least once.** Deletion of a vote row before its key is ever
inserted into the SMT (the pre-commitment-window gap, §8 above) is invisible to this mechanism and
to every other option compared in
[deletion-completeness-design-options.md](./deletion-completeness-design-options.md). The SMT does
not deliver global deletion completeness on its own; it delivers non-membership-provable completeness
for the already-anchored set, which is a narrower and precisely bounded claim.

## 9. Batch chaining (folding in Option B)

Each batch anchor extends the *same* global SMT (not a fresh tree per batch, unlike the dense tree).
The on-chain record for batch `i` stores:

```
smtRoot_i            — the SMT root after applying batch i's insertions
previousSmtRoot_i     — must equal smtRoot_{i-1} (or H[256] for i = 0)
newKeysThisBatch_i    — count of keys inserted in this batch (never keys removed —
                        removal is not a legitimate operation this contract accepts, see §8)
totalKeysAnchored_i   — running total, must equal totalKeysAnchored_{i-1} + newKeysThisBatch_i
```

The chain-continuity check (`previousSmtRoot_i == smtRoot_{i-1}`) is what closes the
"batch N's set could have silently shrunk relative to batch N-1" gap flagged in
[FUTURE_WORK.md §5.2](../FUTURE_WORK.md#52-blockchain--batch-visualizer-new) — an attacker cannot
submit a batch `i` whose SMT root reflects a smaller set than batch `i-1` committed to, because that
would require a *different* `previousSmtRoot_i` than what's on-chain, which the `require` rejects.
This is the same chaining idea Option B proposed, now anchored to a structure (the SMT) that also
gives non-membership proofs, rather than living as a bolt-on hash chain with no independent
completeness signal of its own.

A general audit ("did this election quietly lose any votes?") works by **any watchdog periodically
sampling random nullifier keys they have independent knowledge should exist** — e.g. every voter who
kept their own nullifier can, at any time, re-request a membership proof for their own key against
the *latest* anchored root and confirm it still verifies. A system where a meaningful fraction of
voters (or a public "verify my vote" UI reusing this exact mechanism — the same shape as the receipt
idea already sketched in [FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation))
periodically re-checks their own membership proof turns "did anyone get silently deleted" from an
unanswerable global question into a distributed, ongoing check with no single point of failure.
**This is detection coverage, not proof.** It raises the probability a deletion is caught and lowers
the number of voters an attacker could safely target, but it is not a mathematical guarantee that no
unknown ballot was deleted — a key nobody happens to re-check is a key nobody catches. Full global
completeness would require either universal re-checking (unrealistic) or a separate, exhaustive
audit mechanism outside this design's scope. Present this in the paper as distributed detection
coverage, explicitly not as complete election-set verification.

## 10. Proof format

**Membership proof** (key K is present with value V):

```ts
interface SmtMembershipProof {
  key: string;        // 32-byte hex, the nullifier_hash
  value: string;       // 32-byte hex, the voteLeafHash committed at this key
  bitmap: string;      // 32-byte hex (256 bits) — bit i = 1 iff level i's sibling is non-default
  siblings: string[];  // only the non-default sibling hashes, in level order (bottom-up),
                        // length == popcount(bitmap)
}
```

**Non-membership proof** (key K is absent):

```ts
interface SmtNonMembershipProof {
  key: string;
  bitmap: string;
  siblings: string[];
  // no `value` field — absence is proven by the leaf resolving to the fixed H[0] marker,
  // which the verifier can always recompute without being told it
}
```

The **bitmap + sparse-siblings** encoding (rather than always shipping all 256 sibling hashes) is the
proof-size optimization this design adopts: at any realistic election scale, the overwhelming
majority of a given key's 256 ancestor siblings are still whole-empty-subtree defaults (`H[i]` for
various `i`), which the verifier can regenerate from the precomputed table (§4) without the prover
sending them. Only siblings that differ from the default — i.e. subtrees that actually contain at
least one other real vote — need to be transmitted. **Hypothesis, not yet measured:** proof size in
practice should be close to `O(log N)` in the number of *actually inserted* keys (not `O(256)`), the
same order as the dense tree's `ceil(log2 N)` proofs measured in
[anchoring-cost-analysis.md §4.1](./anchoring-cost-analysis.md#41-off-chain-merkle-build--proof-measured).
This claim stays a hypothesis until test P1 (§13) produces actual sibling-count numbers at 100, 1,000,
and 10,000 keys — cite measured numbers in the paper, not this projection.

**Measured** (backend/src/merkle/sparseMerkleTree.test.ts, "proof-size measurement", 50-key sample,
uniformly random 256-bit keys, fixed seed 42): avg/max non-default siblings — N=100: 6.8 / 9
(log2(100) ≈ 6.6); N=1,000: 10.2 / 13 (log2(1,000) ≈ 10.0); N=10,000: 13.4 / 15 (log2(10,000) ≈ 13.3).
Averages track `log2(N)` closely at every scale tested, consistent with the hypothesis — cite these
numbers (not the earlier projection) in the paper, and re-measure if the key-distribution assumption
(uniform, from SHA-256 nullifiers) is ever revisited.

This is a plain fixed-depth SMT with a bandwidth optimization, **not** a path-compressed structure
like a Jellyfish/Patricia-style tree — deliberately, to keep exactly one non-membership case (§8) and
avoid the added complexity (and added things-to-get-wrong) of internal path compression, which a
journal-paper implementation doesn't need to take on for a research-scale system.

## 11. Root calculation (verification algorithm)

Given a claimed root `R`, a proof (membership or non-membership), and the key `K`:

```
level = 0
current = value_hash            // leaf_hash(K, value) for membership,
                                  // H[0] for non-membership
sibling_idx = 0

for level in 0..255:                       // bottom-up: level 0 = leaf's immediate sibling
  bit = bit_at(K, level)                    // 0 = current is left child, 1 = current is right
  if bitmap[level] == 1:
    sibling = siblings[sibling_idx]; sibling_idx += 1
  else:
    sibling = H[level]                      // default for an empty subtree of this height
  current = bit == 0
    ? node_hash(current, sibling)
    : node_hash(sibling, current)
  // node_hash is POSITION-AWARE (§6/§6.1), unlike the dense tree's commutative
  // hashPair — bit really does determine which side `current` is on, and that
  // matters: it's what forces the sibling sequence to correspond to K's own
  // bit-path, closing the relabeling forgery described in §6.1.

return current == R
```

Both the off-chain TypeScript verifier and the on-chain Solidity verifier (§12) implement this exact
algorithm — same reasoning as the existing dense tree's single canonical implementation
([merkleTree.ts](../backend/src/merkle/merkleTree.ts) header comment) — to guarantee they can never
drift apart.

## 12. Contract verification changes

**Additive, not replacing.** `MerkleRootStorage.sol`'s existing `anchorRoot`/`verify`/`getBatch`
stay exactly as they are — the dense per-batch tree keeps working unchanged, and the 11 existing
Hardhat assertions ([evaluation_writeup.md §8](./evaluation_writeup.md#8-merkle-tree-integrity))
keep passing untouched.

New additions (illustrative signatures, not final Solidity — a implementation-phase task):

```solidity
struct SmtBatch {
    bytes32 smtRoot;
    bytes32 previousSmtRoot;
    uint256 newKeysThisBatch;
    uint256 totalKeysAnchored;
    uint256 timestamp;
}

mapping(uint256 => SmtBatch) public smtBatches;
uint256 public smtBatchCount;
bytes32 public constant EMPTY_TREE_ROOT = /* precomputed H[256] constant, §4/§7 */;

function anchorSmtRoot(
    bytes32 newRoot,
    bytes32 previousRoot,
    uint256 newKeysThisBatch,
    uint256 totalKeysAnchored
) external onlyOwner returns (uint256 batchId) {
    bytes32 expectedPrevious = smtBatchCount == 0
        ? EMPTY_TREE_ROOT
        : smtBatches[smtBatchCount - 1].smtRoot;
    require(previousRoot == expectedPrevious, "SMT: chain continuity broken");
    require(newRoot != bytes32(0), "SMT: root cannot be zero");
    uint256 expectedTotal = smtBatchCount == 0 ? 0 : smtBatches[smtBatchCount - 1].totalKeysAnchored;
    require(totalKeysAnchored == expectedTotal + newKeysThisBatch, "SMT: totalKeysAnchored mismatch");
    // ... store, increment, emit SmtBatchAnchored — mirrors anchorRoot's existing shape
}

function verifySmtMembership(
    bytes32 root,
    bytes32 key,
    bytes32 value,
    bytes32 bitmap,
    bytes32[] calldata siblings
) external pure returns (bool);

function verifySmtNonMembership(
    bytes32 root,
    bytes32 key,
    bytes32 bitmap,
    bytes32[] calldata siblings
) external pure returns (bool);
```

Internally, both functions and the shared default-hash table use the position-aware `node_hash`
from §6/§6.1, not the dense tree's commutative `hashPair` — this is the one place the SMT's Solidity
diverges from a naive port of the dense tree's on-chain verifier, and it's load-bearing (§6.1).

`verifySmtMembership`/`verifySmtNonMembership` are `pure` (not `view`) — they take the root as a
parameter rather than reading `smtBatches` internally, so a caller can check a proof against *any*
previously-anchored root (including old ones, which is exactly what §8's contradiction-detection
needs — an old root must stay checkable forever, not just the latest one). Both are read-only calls
from outside a transaction, so — same as the existing `verify()` today — checking a proof costs no
gas for an off-chain caller; gas is only spent on the `anchorSmtRoot` write, which is O(1) storage
words per batch, same flat-cost shape as today's `anchorRoot`
([anchoring-cost-analysis.md §2.2](./anchoring-cost-analysis.md#22-anchorroot-gas-per-batch-size)).

## 13. Complete test plan

### Off-chain SMT module (new `backend/src/merkle/sparseMerkleTree.ts`, unit tests, no DB)

1. **Genesis root** — empty tree's computed root equals the precomputed `H[256]` constant; recompute
   `H[0..256]` two independent ways (iterative vs. recursive) and confirm they agree.
2. **Single insertion** — insert one key, confirm the resulting root is deterministic and
   reproducible from a from-scratch rebuild.
3. **Membership proof round-trip** — insert key K, generate a membership proof, verify it against
   the resulting root; must return true.
4. **Non-membership proof for never-inserted key** — on a tree with N keys inserted, generate a
   non-membership proof for an untouched key K'; must return true.
5. **Deletion contradiction (the core property, §8)** — insert K at root R1; delete K (reset to
   `H[0]`), producing root R2; confirm (a) K's membership proof still verifies against R1, (b) K's
   non-membership proof verifies against R2, (c) K's membership proof does **not** verify against
   R2, (d) K's non-membership proof does **not** verify against R1. All four are the specific,
   named assertions that demonstrate deletion is provably visible.
5.1. **Non-membership proof cannot be relabeled to a different key (§6.1 regression)** — generate a
   genuine non-membership proof for K1, relabel its `key` field as an unrelated absent key K2 →
   rejected; relabel it as an actual anchored member's key → rejected (with a sanity check that the
   member's own real membership proof still verifies). This is the regression test for the soundness
   bug found and fixed during implementation (§6.1) and must never be weakened or removed.
6. **Forgery rejection** — for a valid membership proof: flip one bitmap bit → rejected; swap one
   sibling hash → rejected; alter the claimed value → rejected; alter the key → rejected (mirrors
   the forgery coverage already proven for the dense tree in
   [evaluation_writeup.md §8](./evaluation_writeup.md#8-merkle-tree-integrity), applied to the new
   structure).
7. **Order independence** — insert the same set of keys in several different orders; final root
   must be identical every time (a key-addressed structure has no "leaf position" dependent on
   insertion order, unlike the dense tree's array-index leaves — this test is the concrete evidence
   for the "reordering is a non-issue" claim in
   [deletion-completeness-design-options.md](./deletion-completeness-design-options.md)).
8. **Incremental vs. from-scratch equivalence** — property test (fast-check, matching the existing
   style in [elgamal.test.ts](../backend/src/crypto/elgamal.test.ts)): for randomized sequences of
   insert/delete operations, the root produced by incremental path-local updates must equal the root
   produced by rebuilding the whole tree from the final key/value set, at every step in the sequence.
9. **Leaf/internal/empty domain separation** — no randomized input across `10^6`+ trials produces a
   collision between a `0x00`-prefixed empty marker, a `0x01`-prefixed leaf hash, and an
   unprefixed internal-node hash (smoke test for the domain-separation argument in §5, not a formal
   proof of collision-resistance — that reduces to keccak256's own security, not new claims here).
10. **Proof-size measurement** — mirrors the methodology of
    [anchoring-cost-analysis.md](./anchoring-cost-analysis.md): measure actual compact-proof
    `siblings.length` distribution at N = 100 / 1,000 / 10,000 realistically-distributed keys, to
    validate or correct the `O(log N)`-in-practice claim in §10 with real numbers before it's cited
    anywhere as a result.

### Contract (Hardhat, new tests alongside the existing 11 in `blockchain/test/`)

11. **Genesis anchor** — first `anchorSmtRoot` call requires `previousRoot == EMPTY_TREE_ROOT`;
    correct value accepted, wrong value reverts.
12. **Chain continuity enforced** — a second anchor with any `previousRoot` other than the first
    batch's stored `smtRoot` reverts with the continuity error.
13. **Membership verification on-chain** — `verifySmtMembership` accepts a valid off-chain-generated
    proof against an anchored root; the on-chain and off-chain (§13.3) verifiers must agree on every
    case in the shared test-vector set (same "one canonical implementation" discipline as the dense
    tree today).
14. **Non-membership verification on-chain** — same, for `verifySmtNonMembership`.
15. **On-chain forgery rejection** — repeat test 6's forgery cases through the deployed contract, not
    just the TS module, to confirm the Solidity implementation independently rejects each one (not
    just the TS one — this is the check that would have caught a TS/Solidity implementation drift).
    Also repeats test 5.1's relabeling regression on-chain — this is exactly the check that caught
    the §6.1 bug in the first place (as an on-chain Hardhat assertion, not the TS module).
16. **Historical-root check** — verify a proof against a *non-latest* anchored root (batch 2's root,
    with batch 5 already anchored); must still succeed, confirming §12's "old roots stay checkable
    forever" design requirement actually holds against the deployed contract, not just in theory.
17. **Gas measurement** — extend
    [measure-anchoring-cost.ts](../blockchain/scripts/measure-anchoring-cost.ts) with an
    `anchorSmtRoot` measurement (should remain flat per batch, same shape as §2.2's existing table)
    and a note that `verifySmtMembership`/`verifySmtNonMembership` cost is $0 for off-chain callers
    (view-style `pure` call), consistent with §12.

### Integration (new tests, needs live backend + seeded DB — later phase, mirrors `vote.test.ts`)

18. **End-to-end membership** — cast a real vote, run the batch-anchor process, fetch a membership
    proof via a new endpoint (e.g. `GET /anchor/verify-smt/:voteId`, symmetric to today's
    `GET /anchor/verify/:voteId`), confirm it verifies against the just-anchored SMT root.
19. **Simulated deletion detection** — reuse the existing dev-only tamper machinery
    (`POST /anchor/tamper/ballot`, per [README.md's anchoring section](../README.md#end-to-end-integrity-merkle-anchoring))
    extended to delete a confirmed, already-SMT-anchored vote row; confirm the next batch's SMT
    rebuild produces a non-membership proof for that key, while the previously-issued membership
    proof against the earlier anchored root still verifies — the same contradiction as unit test 5,
    now demonstrated through the real API surface, as the SMT counterpart to the existing
    `TamperVisualizer.tsx` demo flow.
20. **Concurrent batch anchoring** — two `anchorSmtRoot` calls racing against the same
    `previousRoot` must serialize (second one reverts with the continuity error, does not silently
    overwrite), the contract-level analogue of the existing DB-level concurrency test in
    [evaluation_writeup.md §4](./evaluation_writeup.md#4-double-vote-prevention).
21. **Backfill migration check** — for the existing pre-SMT anchored votes (already committed via
    the dense tree before this feature existed), a one-time backfill batch inserts all of them into
    the SMT; confirm `totalKeysAnchored` after backfill equals the actual count of confirmed vote
    rows in the DB at that point, independently cross-checked.

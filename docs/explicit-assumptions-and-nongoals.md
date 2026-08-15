# Explicit Assumptions and Non-Goals (paper-ready)

**Purpose.** These two items were flagged in the methodology-audit follow-up plan as the ones to
leave **undissolved rather than implemented** — real, load-bearing gaps that are cheaper and more
honest to state precisely than to half-solve. Both are already analyzed piecemeal across
[threat_model.md](threat_model.md), [tally-verifiability-design.md](tally-verifiability-design.md),
and [FUTURE_WORK.md](../FUTURE_WORK.md); this document consolidates each into a single, citable
statement — assumption, justification, bounded mitigation (if any), and what removing the gap would
require — in the form a paper's Limitations/Assumptions section would use directly.

A limitations section that names its gaps precisely is stronger reviewer-facing evidence than one
that implies fewer gaps exist. Both items below follow the same discipline already applied
throughout this project's design docs (see [formal-security-definitions.md §5.1](formal-security-definitions.md#51-why-this-section-is-deliberately-narrow)).

---

## 1. Assumption: ballot-set completeness is bounded, not cryptographically proven, before first anchor

### 1.1 Precise statement

This system's anchoring machinery (dense Merkle tree + Sparse Merkle Tree, per
[smt-design.md](smt-design.md)) proves two things about a ballot set **once it has been anchored at
least once**: (a) no silent post-anchor tampering, and (b) any deletion of an already-anchored key
is provably detectable via the contradiction between an old membership proof and a later
non-membership proof. **It proves nothing about ballots omitted before their first anchor.** If the
batch-construction step simply never includes a legitimately-cast ballot, no root — dense or SMT —
reflects the omission, because a Merkle root only ever commits to whatever set was handed to it. A
verifier recomputing a root from a *claimed* list can confirm "if this is the true list, the root is
consistent with it," but cannot independently discover that the list is short.

This is stated identically, and independently arrived at, in three places in this codebase's design
history — [smt-design.md §8](smt-design.md#8-what-the-smt-does-and-does-not-prove-about-deletion),
[threat_model.md §6](threat_model.md#6-pre-anchor-integrity-window-detail), and
[tally-verifiability-design.md §8.1](tally-verifiability-design.md#81-what-anchoring-proves-about-completeness-precisely--and-the-honest-limit) —
which is itself evidence this is a structural property of Merkle-anchoring-based systems in general,
not an implementation oversight specific to this one.

### 1.2 Why this is assumed rather than closed

Fully closing this gap requires one of two categories of mechanism, both explicitly out of scope for
this project:

1. **Voter-side verifiability** (a Benaloh-style cast-or-audit challenge, or the lighter
   cast-as-intended receipt sketched in
   [FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation)) —
   lets each voter independently confirm their own ballot exists in *some* anchored set, which in
   aggregate bounds omission. This is a genuinely different mechanism from tally verifiability (this
   project's actual contribution, per [related-work-positioning.md §2](related-work-positioning.md)):
   tally verifiability answers "was the *recorded* set decrypted correctly," voter-side
   verifiability answers "was *my* ballot recorded at all." The two compose but neither substitutes
   for the other.
2. **A real-time, append-only public bulletin board** that every observer (not just the backend)
   writes to or independently monitors as ballots are cast — removing the backend's ability to be
   the sole party deciding what enters the pre-anchor window in the first place. This is a larger
   infrastructural undertaking than an academic-simulation-scale project can absorb without
   materially changing the architecture.

### 1.3 Bounded mitigation actually in place today

`independently_observed_vote_count` (from `GET /public/stats`'s `total_voted`, populated
independently of the anchoring pipeline via `voters.has_voted`) is included in the public
verification bundle and cross-checked by the independent verifier against `total_keys_anchored`
([tally-verifiability-design.md §8.1](tally-verifiability-design.md#81-what-anchoring-proves-about-completeness-precisely--and-the-honest-limit),
§9 step 3). This makes a **gross** omission (a meaningful fraction of ballots missing) statistically
visible — the counts would disagree materially. It does **not** make a **small, targeted** omission
(a handful of ballots, within ordinary reporting noise) cryptographically detectable. This
distinction is deliberately preserved as a named limitation rather than folded into "solved by the
count check," and is exercised as an explicit test case (a bundle missing exactly one ballot out of
many must still pass the count cross-check) —
[tally-verifiability-design.md §13, test 16](tally-verifiability-design.md#off-chain-unit-tests-new-backendsrccryptoshamirzqtestts-backendsrccryptodleqtestts).

### 1.4 Suggested paper wording

> "This system provides tamper-evidence and provable deletion-detection for ballots once anchored,
> and a statistical (non-cryptographic) completeness signal via an independently-tracked vote
> counter. It does not provide a cryptographic guarantee that every legitimately cast ballot was
> included in its batch's first anchor — closing that gap requires voter-side cast verifiability or
> a real-time public bulletin board, both left as future work (§X)."

---

## 2. Non-goal: coercion-resistance / receipt-freeness

### 2.1 Precise statement

This system does **not** attempt coercion-resistance or receipt-freeness. A voter today receives a
confirmation screen on successful cast, but the design deliberately does not give the voter any
stronger, independently-checkable proof of "how I voted" or even "that I voted for candidate X" tied
to their identity — because any receipt strong enough for an honest voter to *prove* their choice to
themselves is, by the same construction, strong enough for a coercer to *demand* as proof of
compliance. This tension is named explicitly, once, as a system boundary in
[threat_model.md §8](threat_model.md#8-explicit-boundary-voter-verifiable-cast-confirmation) and
carried as security property 7 in [threat_model.md §3](threat_model.md#3-security-properties-claimed):
*"a voter should be able to gain some assurance their ballot was recorded as cast, without gaining a
receipt that lets a coercer verify how they voted"* — stated as an explicitly unsolved tension, not
a property this system claims to satisfy.

### 2.2 Why this is a non-goal rather than a partial mechanism

The project's actual contribution (SMT-based ballot-set completeness/deletion-detection and DLEQ-based
tally verifiability, per [related-work-positioning.md §2](related-work-positioning.md)) is orthogonal
to coercion-resistance: it strengthens confidence that *the recorded set was tallied honestly*, and
says nothing about *how a ballot got recorded* or what a voter can prove about their own choice
afterward. Shipping a partial receipt mechanism (e.g. letting a voter look up "yes, a ballot with
this ID is anchored" without binding it to their identity or choice) is possible and even sketched
as a low-cost future addition
([FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation),
carefully scoped to never leak the plaintext choice) — but a coercion-resistant scheme proper
(dummy-vote/fake-credential schemes à la JCJ/Civitas, or re-voting-based coercion mitigation) is a
structurally different protocol family, out of scope for this project's threat model and
contribution, and explicitly flagged in
[related-work-positioning.md §5](related-work-positioning.md) as a comparison this project should
**not** attempt against Civitas/JCJ or Selene, both of which are purpose-built for exactly this
property and would make any partial claim here look weak by direct comparison rather than simply
out-of-scope.

### 2.3 What partial mitigation is sketched, not implemented

The cast-as-intended receipt in
[FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation) —
a receipt code derived from the nullifier and ciphertext, never the plaintext choice, letting a
voter later confirm "a vote with this receipt is included in anchored batch #N" via the existing
`GET /anchor/verify/:voteId` machinery — is a lightweight subset of individual verifiability that
stays deliberately on the safe side of the coercion line (it proves *a* ballot was cast and anchored,
never *which candidate* it was for). Status: **design sketch only, not implemented.** It would
address the "voter-side verifiability" half of §1's gap above as a side effect, without addressing
coercion-resistance itself.

### 2.4 Suggested paper wording

> "This system is explicitly not coercion-resistant: it does not provide receipt-freeness, and a
> voter has no mechanism to prove their specific choice to a third party (which is a deliberate
> design choice, not an oversight — such a mechanism would equally enable coercion). Coercion-
> resistant e-voting (e.g. JCJ/Civitas-style fake-credential schemes) is a structurally different
> protocol family and is out of scope for this work."

---

## References / cross-links

- [threat_model.md §3, §6, §8](threat_model.md) — property claims and both boundaries, as originally stated.
- [tally-verifiability-design.md §8.1](tally-verifiability-design.md#81-what-anchoring-proves-about-completeness-precisely--and-the-honest-limit) — completeness gap, full derivation.
- [smt-design.md §8](smt-design.md#8-what-the-smt-does-and-does-not-prove-about-deletion) — deletion-detection vs. omission distinction.
- [FUTURE_WORK.md §7](../FUTURE_WORK.md#7-recommended-addition-voter-verifiable-cast-confirmation) — cast-as-intended receipt sketch (unimplemented).
- [related-work-positioning.md §2, §5](related-work-positioning.md) — why coercion-resistance comparison against Civitas/JCJ/Selene should not be attempted.
- [formal-security-definitions.md §5](formal-security-definitions.md#5-definition--ballot-privacy-and-the-honest-limits-of-this-claim) — the same "does-not-prove" discipline applied to the cryptographic core.

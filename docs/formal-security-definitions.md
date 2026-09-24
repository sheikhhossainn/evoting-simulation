# Formal Security Definitions

**Scope, and what this document is not.** This is a *light* formal-security section: standard
game-based definitions (ballot privacy, ballot validity soundness, universal verifiability), each
followed by an explicit statement of which existing, canonical proof this system's construction
reduces to. **No new theorems or novel security proofs are claimed here.** Every reduction below is
a direct instantiation of a well-known result (Chaum-Pedersen DLEQ soundness, CDS94 OR-proof
soundness, Schnorr special-soundness) applied to this specific construction — the mathematical work
is Chaum, Pedersen, Cramer, Damgård, and Schoenmakers's; this document's job is only to state
precisely *which* claim about *this* codebase each of their results licenses, and — just as
important — which claims it does not license. §5 is the load-bearing section for reviewer trust:
it says explicitly what is out of scope.

**Citation policy for this document, distinct from [related-work-positioning.md](related-work-positioning.md):**
that document restricts citations to comparable *systems* published 2020-2026. This document cites
the *original definitional and proof-technique* papers the constructions are textbook instances of
(Chaum & Pedersen 1992, Cramer/Damgård/Schoenmakers 1994, Schnorr 1991) — the standard, expected
practice for a Preliminaries/Definitions section, same as citing Euclid for a GCD algorithm. Where a
modern restatement of a definition is used (e.g. the verifiability framework in §3), a citation to
that restatement is given as well.

---

## 1. Preliminaries and notation

Fixed once per election, matching [elgamal.ts](../backend/src/crypto/elgamal.ts) and
[tally-verifiability-design.md §1.1](./tally-verifiability-design.md#11-elgamal-group-and-keys):

- `p`: a 256-bit safe prime, `p = 2q + 1`, `q` prime.
- `g`: a generator of the order-`q` subgroup of `Z*_p`.
- ElGamal keypair: `x ∈ Z_q` (reduced, §1.1 of the design doc), `y = g^x mod p`.
- Ciphertext of message `m`: `(c1, c2) = (g^k, m·y^k) mod p`, fresh `k ← Z_q` per encryption.
- `x` is `(3,4)`-Shamir-shared over `Z_q` ([shamirZq.ts](../backend/src/crypto/shamirZq.ts)), with
  Feldman public commitments `y_i = g^(x_i) mod p` for each keyholder `i ∈ {1,2,3,4}`
  ([tally-verifiability-design.md §2.1](./tally-verifiability-design.md#21-public-commitments-feldman-vss--recommended-not-optional)).
- **Hardness assumption used throughout:** the discrete-log (DL) / decisional Diffie-Hellman (DDH)
  assumption on the order-`q` subgroup of `Z*_p`. Every reduction below is DL- or DDH-based, no
  stronger assumption is introduced anywhere in this system.
- **Random oracle model.** Both proof systems below are made non-interactive via Fiat-Shamir
  (SHA-256). All soundness/zero-knowledge statements are therefore in the random-oracle model
  (ROM), the standard setting for this proof technique — this is stated explicitly because it is a
  real, standard modeling assumption, not a silent one.

---

## 2. Definition — Ballot validity soundness (the OR-proof, `zkp.ts`)

**Informal property:** a submitted ciphertext, once accepted, provably encrypts a real candidate
from the voter's constituency — not an arbitrary plaintext (e.g. a large integer encoding
"+1000 votes" under a homomorphic scheme, or a UUID belonging to a candidate from a different
constituency).

**Construction:** the disjunctive Chaum-Pedersen Σ-protocol (Cramer, Damgård & Schoenmakers,
*Proofs of Partial Knowledge and Simplified Design of Witness Hiding Protocols*, CRYPTO 1994 — the
"CDS94" OR-composition), made non-interactive via Fiat-Shamir. Implementation:
[zkp.ts:108-265](../backend/src/crypto/zkp.ts#L108-L265).

**Game (soundness):**

```
Game Soundness_ZKP(A):
  (p, g, y, candidateIds) ← setup()
  (c1, c2, π) ← A(p, g, y, candidateIds)          // adversary picks ciphertext + proof
  return 1 if verifyBallotValidity(c1, c2, pubKey, candidateIds, π) == true
         AND (c1, c2) does not encrypt any m ∈ {encodeCandidateId(id) : id ∈ candidateIds}
```

**Claim:** `Adv_Soundness_ZKP(A) ≤ negl(λ)` for any PPT `A`, under the DL assumption in the ROM.

**Proof sketch (not new — CDS94's standard argument, restated for this instantiation):** each
non-chosen branch `j` of the disjunction is a simulated Schnorr transcript with a *freely chosen*
challenge `e_j`; the real branch's challenge is forced to `e_t = e - Σ_{j≠t} e_j mod q` by the
Fiat-Shamir hash `e`, which the adversary cannot predict before committing to all `(a_j, b_j)`
(ROM). An adversary who can produce an accepting proof for a ciphertext not encoding any listed
candidate would need to answer *some* branch's challenge without the corresponding witness — by
Schnorr's special-soundness (two accepting transcripts for the same commitment, different
challenges, yield the discrete log — Schnorr, *Efficient Signature Generation by Smart Cards*,
J. Cryptology 1991), this happens with probability `~1/q` per branch, negligible in the security
parameter. This is exactly the argument [zkp.ts:11-21](../backend/src/crypto/zkp.ts#L11-L21)
already states in comment form; this section is its formal restatement, not a new derivation.

**What this does NOT prove:** soundness of the *candidate set itself* — the OR-proof only proves
membership in whatever `candidateIds` list was passed to the verifier. If the server derives a
wrong or stale `candidateIds` list, a validly-proved ballot can still be validated against the
wrong set. This is why `vote.ts` derives `candidateIds` server-side from the live `candidates` table
rather than trusting client input (closing the *obvious* version of this gap), and why
[tally-verifiability-design.md §8.2](./tally-verifiability-design.md#82-candidate-set-integrity--full-protocol)'s
`ElectionSetupCommitment` exists to pin that list against drift — a separate mechanism, not covered
by the OR-proof's own soundness.

---

## 3. Definition — Universal verifiability (the independent-recount claim)

**Informal property:** *anyone* — with no secret key material, no admin access, only the public
bundle (§9 of tally-verifiability-design.md) and public chain/RPC access — can check that the
published tally is the correct decryption of the anchored ballot set, and reject if it is not. This
is the standard notion from Cortier, Galindo, Küsters, Müller & Truderung's verifiability framework
(*SoK: Verifiability Notions for E-Voting Protocols*, IEEE S&P 2016 — still the reference taxonomy
this project's own claims are phrased against; a compatible modern restatement appears in Cortier,
Gaudry & Yang's 2022 analysis, already cited in [related-work-positioning.md](related-work-positioning.md)).
That taxonomy separates **individual verifiability** ("my ballot was recorded as I cast it" — this
system's explicit non-goal, [threat_model.md §8](./threat_model.md#8-explicit-boundary-voter-verifiable-cast-confirmation))
from **universal verifiability** ("the tally is a correct function of the recorded ballots" — the
property this section defines) and **eligibility verifiability** (only eligible voters' ballots
counted — this system's `fn_cast_vote` + nullifier-uniqueness mechanism, out of scope for this
crypto-focused section).

**Game:**

```
Game Verifiability(A):
  bundle ← A()                          // adversary constructs an arbitrary public bundle
  (accept, tally) ← IndependentVerify(bundle)     // scripts/independent-verify-tally.ts
  return 1 if accept == true
         AND (tally does not equal the actual correct decryption of the
              ballots genuinely anchored on-chain as of bundle's claimed batch reference)
```

**Claim:** `Adv_Verifiability(A) ≤ negl(λ)`, decomposed across
[independent-verify-tally.ts](../backend/src/scripts/independent-verify-tally.ts)'s checks — each
sub-claim below reduces to a *different* primitive, and the overall claim only holds because **all**
of them are checked (this is a conjunction, not a single reduction):

| Sub-claim | Reduces to | Verifier step |
|---|---|---|
| The referenced on-chain root is genuinely the latest anchored state, not a stale/superseded one | Direct on-chain query (no cryptographic assumption — the chain itself is the source of truth) | Step 1 |
| The `ballots[]` list in the bundle is exactly what was anchored (no substitution) | Collision-resistance of keccak256 (dense-tree root rebuild) | Step 2 |
| The `candidates[]`/`constituencies[]` metadata is exactly what was committed pre-election | Collision-resistance of keccak256 (`electionSetupCommitment` recompute, §8.2.2) | Step 2a |
| Each published partial decryption `d_i` was honestly computed from the keyholder's real share, for this specific ballot | DLEQ soundness (§4 below) | Step 4 |
| The combined plaintext is the correct function of ≥3 valid partials | Lagrange-interpolation correctness (algebraic identity, not a hardness assumption — [tally-verifiability-design.md §4](./tally-verifiability-design.md#4-public-combination-recovering-the-plaintext-without-ever-assembling-x)'s correctness argument) | Step 5 |
| The published totals match the recount | Direct comparison (no cryptography) | Step 6 |

**What this does NOT prove:** completeness of the *original* anchoring — i.e. that every
legitimately cast ballot was included in the first anchor. A verifier can only confirm "the
published bundle is internally consistent and matches on-chain state"; if a ballot was silently
omitted *before* it was ever anchored, no check here or in the anchoring layer detects it. This is
the pre-commitment-window gap, stated identically in
[tally-verifiability-design.md §8.1](./tally-verifiability-design.md#81-what-anchoring-proves-about-completeness-precisely--and-the-honest-limit)
and [threat_model.md §6](./threat_model.md#6-pre-anchor-integrity-window-detail) — repeated here
because a formal verifiability *definition* that silently omitted this caveat would overstate what
the game above actually captures.

---

## 4. Definition — DLEQ soundness (partial-decryption correctness, `dleq.ts`)

**Informal property:** a keyholder's published partial decryption `d_i` for ballot `(c1, c2)` was
genuinely computed as `c1^(x_i) mod p` using the *same* `x_i` consistent with their public
commitment `y_i` — not an arbitrary or forged value.

**Construction:** Chaum-Pedersen equality-of-discrete-logs proof (Chaum & Pedersen, *Wallet
Databases with Observers*, CRYPTO 1992), over two bases `g` and `c1` sharing the witness `x_i`.
Implementation: [dleq.ts](../backend/src/crypto/dleq.ts), specified in
[tally-verifiability-design.md §5](./tally-verifiability-design.md#5-chaum-pedersen-dleq-proof--binding-to-the-specific-keyholder-and-the-specific-ciphertext).

**Game:**

```
Game Soundness_DLEQ(A):
  (p, g, q, y_i) ← setup for keyholder i (y_i = g^(x_i) mod p, x_i unknown to A)
  (c1, d_i, π) ← A(p, g, q, y_i)
  return 1 if verifyDleq(..., c1, d_i, y_i, π, ...) == true
         AND d_i ≠ c1^(x_i) mod p     // x_i is the actual discrete log of y_i base g
```

**Claim:** `Adv_Soundness_DLEQ(A) ≤ negl(λ)`, under the DL assumption in the ROM.

**Proof sketch (Chaum-Pedersen's standard special-soundness argument, restated for this
instantiation, matching [tally-verifiability-design.md §5.4](./tally-verifiability-design.md#54-security-argument)):**
two accepting transcripts `(t1, t2, e, z)` and `(t1, t2, e', z')` for the same commitment
`(t1, t2)` and distinct challenges `e ≠ e'` yield `x_i = (z - z')/(e - e') mod q` by solving the two
verification equations simultaneously across both bases `g` and `c1` — an extractor with rewinding
access to a prover who succeeds with non-negligible probability recovers `x_i` this way, which
(under the DL assumption) can only happen with negligible probability if the prover didn't already
know `x_i`. This is a **binding-per-ballot** proof, not a one-time knowledge-of-`x_i` proof — the
two-base construction is exactly what closes the "reuse a valid proof against a different ballot"
attack described in
[tally-verifiability-design.md §5](./tally-verifiability-design.md#5-chaum-pedersen-dleq-proof--binding-to-the-specific-keyholder-and-the-specific-ciphertext)'s
"what does NOT work" paragraph, and is directly tested by
[dleq.test.ts](../backend/src/crypto/dleq.test.ts)'s binding-regression tests (§5.2 of the design
doc).

**What this does NOT prove:** anything about the key-generation/distribution step. DLEQ soundness
only says "this `d_i` is consistent with `y_i`" — it says nothing about whether `y_i` itself was
honestly generated by the dealer, or whether the dealer retained a copy of `x`. See §5.3 below.

---

## 5. Definition — Ballot privacy (and the honest limits of this claim)

**Informal property:** no party learns a voter's plaintext choice, except via the threshold
decryption path (≥3 keyholders).

This is stated as a definition **with its scope narrowed explicitly**, rather than as a theorem this
system fully achieves, because the standard game-based ballot-privacy definitions in the literature
(e.g. Bernhard, Pereira & Warinschi's treatment in *How Not to Prove Yourself: Pitfalls of the
Fiat-Shamir Heuristic and Applications to Helios*, ASIACRYPT 2012; or the BPRIV-style games used in
subsequent verifiable-voting analyses) typically model a left-or-right IND-CPA-style experiment
*plus* a decryption oracle the adversary may query below threshold, and require the scheme to remain
indistinguishable even given that oracle. Stating that full game honestly requires naming exactly
what this system's construction does and does not defend against:

```
Game Privacy_ElGamal(A):
  (p, g, y) ← setup()
  (m0, m1) ← A(p, g, y)                     // adversary picks two candidate plaintexts
  b ← {0, 1};  c ← Enc(m_b, y)
  b' ← A(c)                                 // adversary has no decryption oracle
  return 1 if b' == b
```

**Claim (base ElGamal IND-CPA):** `|Pr[b'=b] - 1/2| ≤ negl(λ)` under the DDH assumption — standard,
unmodified ElGamal semantic security (ElGamal, *A Public Key Cryptosystem and a Signature Scheme
Based on Discrete Logarithms*, CRYPTO 1984/IEEE Trans. IT 1985). This system's encryption step is
textbook ElGamal ([elgamal.ts:172-199](../backend/src/crypto/elgamal.ts#L172-L199)), so this base
claim transfers directly.

**What is added on top, and what is not:**

- **Threshold decryption does not weaken this** below the 3-of-4 threshold: no coalition of ≤2
  keyholders' shares information-theoretically reveals anything about `x'` (standard Shamir
  privacy over `Z_q`, unchanged from the classical `(t,n)` scheme — [tally-verifiability-design.md §2](./tally-verifiability-design.md#2-shamir-sharing-over-z_q-replacing-secretsjs-grempe)).
- **At or above threshold (≥3 colluding keyholders), privacy is explicitly NOT claimed** — this is
  the accepted trust boundary of any `(t,n)` threshold scheme, stated identically in
  [tally-verifiability-design.md §11](./tally-verifiability-design.md#11-malicious-actor-scenarios)
  and [threat_model.md §2](./threat_model.md#2-actors). A formal privacy game that didn't carve this
  out would be claiming something the system does not provide.
- **The DLEQ and OR-proofs (§2, §4) are honest-verifier zero-knowledge** by the same simulator
  argument CDS94/Chaum-Pedersen provide (pick `z, e` at random, derive `t1, t2` — no witness needed)
  — so producing/verifying these proofs does not itself leak `x_i` or the plaintext beyond what the
  eventual published `d_i`/`m` values already reveal once the tally runs. This is **not load-bearing
  for confidentiality** in the way soundness is: the partial decryptions and final plaintexts are
  published anyway once tallying happens (matching the honest-but-narrower framing already given in
  [tally-verifiability-design.md §5.4](./tally-verifiability-design.md#54-security-argument)).
- **What this document does not attempt:** a full simulation-based / UC-style privacy proof of the
  *composed* system (encryption + ZKP + anchoring + threshold decryption together), receipt-freeness
  or coercion-resistance (explicit non-goal, [threat_model.md §8](./threat_model.md#8-explicit-boundary-voter-verifiable-cast-confirmation)),
  or any property of the *dealer's* honesty at key-generation time — a dealer who retains a copy of
  `x` breaks privacy regardless of every proof system above, and this is a procedural/trust
  assumption this document does not (and, without a DKG protocol, cannot) discharge cryptographically
  ([tally-verifiability-design.md §11](./tally-verifiability-design.md#11-malicious-actor-scenarios)'s
  "malicious dealer" row, [tally-verifiability-design.md §12](./tally-verifiability-design.md#12-non-goals-explicit)).

### 5.1 Why this section is deliberately narrow

A common failure mode in student/thesis-level formal-security sections is stating a strong-sounding
theorem ("the system is IND-CPA secure and universally verifiable") without naming the oracle
access, the adversary's trust position, or the composition gaps — which either overclaims or invites
a reviewer to find the gap themselves and discount the whole section. Every claim above is scoped to
exactly what its cited proof technique establishes, and every subsection ends with an explicit "does
not prove" clause. This mirrors the discipline already applied throughout this codebase's own design
docs (e.g. [smt-design.md §8](./smt-design.md#8-what-the-smt-does-and-does-not-prove-about-deletion),
[tally-verifiability-design.md §8.1](./tally-verifiability-design.md#81-what-anchoring-proves-about-completeness-precisely--and-the-honest-limit)) —
this document applies the same standard to the cryptographic core rather than only to the anchoring
layer.

---

## 6. Summary table — property, game, reduction, residual scope

| Property | §  | Reduces to | Citation | Residual (not proven) |
|---|---|---|---|---|
| Ballot validity soundness | §2 | DL, special-soundness (Schnorr extractor) | Cramer/Damgård/Schoenmakers 1994; Schnorr 1991 | Soundness of the candidate *set* itself (separate mechanism, §8.2 of design doc) |
| Universal verifiability | §3 | keccak256 collision-resistance + DLEQ soundness + on-chain state (conjunction) | Cortier/Galindo/Küsters/Müller/Truderung 2016 (framework) | Pre-anchor completeness (omission before first anchor) |
| Partial-decryption soundness | §4 | DL, special-soundness (Chaum-Pedersen extractor) | Chaum & Pedersen 1992 | Honesty of key generation/distribution (dealer trust, §5.3) |
| Ballot privacy (below threshold) | §5 | DDH (base ElGamal IND-CPA) + Shamir information-theoretic privacy | ElGamal 1985; classical Shamir 1979 | Privacy at/above threshold; dealer retaining `x`; coercion-resistance; full UC composition |

---

## References

1. D. Chaum, T. P. Pedersen, "Wallet Databases with Observers," CRYPTO 1992.
2. R. Cramer, I. Damgård, B. Schoenmakers, "Proofs of Partial Knowledge and Simplified Design of Witness Hiding Protocols," CRYPTO 1994.
3. C. P. Schnorr, "Efficient Signature Generation by Smart Cards," Journal of Cryptology, 1991.
4. T. ElGamal, "A Public Key Cryptosystem and a Signature Scheme Based on Discrete Logarithms," CRYPTO 1984 / IEEE Trans. Information Theory, 1985.
5. A. Shamir, "How to Share a Secret," Communications of the ACM, 1979.
6. D. Bernhard, O. Pereira, B. Warinschi, "How Not to Prove Yourself: Pitfalls of the Fiat-Shamir Heuristic and Applications to Helios," ASIACRYPT 2012.
7. V. Cortier, D. Galindo, R. Küsters, J. Müller, T. Truderung, "SoK: Verifiability Notions for E-Voting Protocols," IEEE Symposium on Security and Privacy 2016.
8. V. Cortier, P. Gaudry, Q. Yang, "Is the JCJ voting system really coercion-resistant?" IACR ePrint 2022/430 (modern restatement of verifiability/coercion-resistance framing; also cited in [related-work-positioning.md](related-work-positioning.md)).
9. A. Fiat and A. Shamir, "How to Prove Yourself: Practical Solutions to Identification and Signature Problems," in Advances in Cryptology — CRYPTO '86, pp. 186–194, 1987.

Companion documents: [tally-verifiability-design.md](tally-verifiability-design.md) (full protocol
spec these definitions formalize), [threat_model.md](threat_model.md) (actor model and non-goals
these definitions are consistent with), [related-work-positioning.md](related-work-positioning.md)
(system-level novelty positioning, separate citation policy — see this document's header).

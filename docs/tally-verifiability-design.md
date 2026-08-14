# Tally Verifiability Design Document

**Design only — no production code is touched by this document.** Implementation is a separate
phase once this is reviewed, mirroring the process followed for
[smt-design.md](./smt-design.md).

## 0. Problem statement

Per [threat_model.md §7](./threat_model.md#7-tally-verifiability-gap-detail): today, tallying
reconstructs the ElGamal private key `x` from 3-of-4 Shamir shares in server memory, decrypts every
ballot directly, and publishes totals. Nothing lets an outside party confirm the published totals are
the correct decryption of the specific anchored ciphertexts. A malicious keyholder submitting a wrong
share, or a compromised backend during the decryption step, produces a wrong result that nothing
catches.

**Goal:** an independent observer — with no admin access, no secret key material, and no cooperation
from the backend beyond published data — can recompute the tally from the anchored ciphertexts and
confirm it matches what was published, or catch it if it doesn't.

**The one architectural decision everything below follows from:** *the private key must never be
reconstructed, anywhere, at any point.* Not transiently, not in memory, not by the trusted backend. If
`x` is ever assembled in one place, that place is a single point that could lie about the decryption
and nothing distinguishes an honest run from a dishonest one. The alternative — used throughout this
design — is that each keyholder computes a **partial decryption** from their own share and proves it
was computed correctly, and anyone can **combine the partial decryptions publicly** without ever
learning `x`.

## 1. Current cryptographic state (as implemented today)

Read directly from [elgamal.ts](../backend/src/crypto/elgamal.ts),
[shamir.ts](../backend/src/crypto/shamir.ts), [zkp.ts](../backend/src/crypto/zkp.ts),
[keyshares.ts](../backend/src/routes/keyshares.ts) — this section is a precise inventory, not a
summary, because the design below depends on exact compatibility (or the exact lack of it) with what
exists.

### 1.1 ElGamal group and keys

- `p`: a 256-bit **safe prime** (`p = 2q + 1`, `q` also prime), generated via
  `crypto.generatePrimeSync(256, { safe: true })` ([elgamal.ts:135-142](../backend/src/crypto/elgamal.ts#L135-L142)).
- `g`: a generator of the **order-`q` subgroup** of `Z*_p` (found by taking a generator `g0` of the
  full group and squaring it — `findGenerator()`,
  [elgamal.ts:111-125](../backend/src/crypto/elgamal.ts#L111-L125)). This is textbook,
  non-hardened, multiplicative ElGamal over a prime-order subgroup — the same setup already relied on
  by the existing ballot-validity ZKP in `zkp.ts`.
- Private key `x`: generated as `randomBigIntInRange(p)` — i.e. a random value in `[2, p-2]`, **not**
  explicitly reduced mod `q` ([elgamal.ts:146](../backend/src/crypto/elgamal.ts#L146)).
- Public key `y = g^x mod p`.
- Ciphertext for message `m`: `(c1, c2) = (g^k mod p, m · y^k mod p)` for fresh random `k` per
  encryption (standard ElGamal, [elgamal.ts:172-199](../backend/src/crypto/elgamal.ts#L172-L199)).
- Candidate plaintext: a 128-bit UUID parsed directly to a `BigInt` (`encodeCandidateId`/
  `decodeCandidateId`, [elgamal.ts:235-247](../backend/src/crypto/elgamal.ts#L235-L247)) — safely
  below the 256-bit `p`.

**Load-bearing subtlety (§2 depends on this):** because `g` has order `q`, `g^x mod p == g^(x mod q)
mod p` for any `x`. Only `x mod q` is ever cryptographically meaningful as the private exponent. The
current code never computes `x mod q` explicitly — it doesn't need to, since it only ever uses `x`
as a single monolithic exponent. The new design **does** need this reduction explicit, because
splitting `x` into Shamir shares only works correctly if the sharing happens over the same field the
exponent arithmetic lives in (`Z_q`), not over `Z_p` or anything else. Define:

```
x' = x mod q
```

`x'` is the value that gets Shamir-shared (§2), and `g^x mod p == g^x' mod p` always — so the existing
public key `y` requires **no change**.

### 1.2 Shamir sharing — incompatible with partial decryption (blocking finding)

`shamir.ts` calls `secrets.js-grempe`'s `share()`/`combine()`
([shamir.ts:29-70](../backend/src/crypto/shamir.ts#L29-L70)) on the **raw hex string** of `x`.
`secrets.js-grempe` implements Shamir's Secret Sharing over `GF(2^8)` — **byte-wise** polynomial
interpolation, treating the secret as an opaque byte string, not as an integer mod a prime.

This is **incompatible** with partial-decryption-based verifiable threshold ElGamal. Partial
decryption requires: `x' ≡ Σ_{i∈S} λ_i · x_i (mod q)` for the Lagrange coefficients `λ_i` computed in
`Z_q` — a property that holds for a polynomial `f` defined **over `Z_q`**, and does not hold (and
isn't even meaningful) for a `GF(2^8)` byte-wise sharing. A `GF(2^8)` share cannot be raised as a
`mod p` exponent and combined via `Z_q` Lagrange interpolation and expect the result to equal
`c1^x'`; the two algebraic structures don't interoperate.

**Consequence: the Shamir layer must be replaced**, not reused. §2 specifies the replacement. This
is not a nice-to-have refactor — attempting to bolt partial-decryption proofs onto the existing
`GF(2^8)` shares would silently produce a scheme that either doesn't reconstruct correctly or
(worse) looks like it works in the demo's specific test vectors while being unsound in general. The
existing `secrets.js-grempe`-based flow keeps working for anyone who doesn't migrate (§11), but the
new verifiable-tally flow cannot use it.

### 1.3 Keyholder identity and current submission flow

- 4 fixed keyholder slots, `KH-001`..`KH-004`, `share_index` 1-4, one role name each (Election
  Commission, Judiciary Observer, Academic Auditor, Civil Society Observer) —
  [keyholders.ts](../backend/src/config/keyholders.ts),
  [keyshares.ts:96-103](../backend/src/routes/keyshares.ts#L96-L103).
- Each keyholder authenticates with a passphrase (`verifyKeyholderPassphrase`, salted SHA-256 hash
  comparison, `timingSafeEqual`).
- **Today, `POST /keyshares/submit` receives the raw Shamir share (`share_value`) in the request
  body** ([keyshares.ts:22-43](../backend/src/routes/keyshares.ts#L22-L43)) — the backend sees every
  keyholder's raw secret share in the clear. §7 explains why this alone defeats the entire point of
  what's being designed here, independent of anything cryptographic.

### 1.4 Existing Fiat-Shamir convention (to stay consistent with)

`zkp.ts`'s ballot-validity OR-proof hashes `g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ a_1 ‖ b_1 ‖ …` as
comma-joined minimal-hex strings through SHA-256, reduced mod `q`
([zkp.ts:71-92](../backend/src/crypto/zkp.ts#L71-L92)). No protocol tag exists today because only one
proof type exists. §5 defines an explicit tag for the new proof type, both as good practice and
because §5 lists a second, structurally-similar-looking protocol that must never be confusable with
the first.

### 1.5 Current tally flow

`POST /keyshares/tally` ([keyshares.ts:270-477](../backend/src/routes/keyshares.ts#L270-L477)):
fetches all submitted shares, calls `reconstructKey()` (assembling `x` in memory), decrypts every row
in `votes` directly with `decryptCandidateId`, groups by constituency/candidate, persists to
`tally_results`. Notably: it reads `select("id, encrypted_vote, constituency_code")` from `votes`
directly — **not** scoped to a specific anchored batch. §8 addresses why the verifiable version must
be scoped to an explicit anchored ballot set, tying this design to the SMT/dense-tree anchoring work
already in place.

## 2. Shamir sharing over `Z_q` (replacing `secrets.js-grempe`)

Standard `(t=3, n=4)` Shamir Secret Sharing, over `Z_q` (same `q` as the ElGamal subgroup order, so
share values are directly usable as ElGamal exponents):

```
secret:       x' = x mod q
polynomial:   f(z) = x' + a_1·z + a_2·z^2   (mod q),  a_1, a_2 chosen uniformly at random in Z_q
shares:       x_i = f(i) mod q,   for i = 1, 2, 3, 4      (i ≠ 0 — index 0 is reserved for the secret)
```

Reconstruction (or, in this design, **combination-without-reconstruction**, §4) for any 3-subset
`S ⊂ {1,2,3,4}, |S| = 3`, uses the standard Lagrange coefficients evaluated at `z = 0`:

```
λ_i = Π_{j ∈ S, j ≠ i}  (0 - j) / (i - j)     (mod q, using modular inverse mod q)

x' = Σ_{i ∈ S} λ_i · x_i     (mod q)     — this is the identity the whole scheme rests on
```

This holds for **any** 3-subset of `{1,2,3,4}` — the security property (any 3 reconstruct, any 2
reveal nothing information-theoretically) is unchanged from the current scheme; only the field the
polynomial lives in changes, from `GF(2^8)` to `Z_q`.

### 2.1 Public commitments (Feldman VSS) — recommended, not optional

Publish, once, at key-ceremony time, alongside the existing public key `y`:

```
C_0 = g^(x')  mod p     (== y, already public)
C_1 = g^(a_1) mod p
C_2 = g^(a_2) mod p
```

and, derived from these, each keyholder's **individual public commitment**:

```
y_i = g^(x_i) mod p  =  Π_{l=0}^{2} C_l^(i^l)  mod p     (Feldman's verification equation)
```

`y_i` is what binds every later partial-decryption proof (§5) to "the share this specific keyholder
was actually given" — without it, a proof of "I know *some* exponent" proves nothing about which
keyholder or whether it matches what the dealer distributed.

This costs three extra group elements published once per election and lets each keyholder
independently verify `y_i` against the public `C_0, C_1, C_2` the moment they receive `x_i` — catching
a cheating dealer at distribution time instead of discovering a bad share only at tally time. Given
this module is being rewritten anyway (§1.2), the marginal cost of Feldman over plain Shamir is
small and the marginal benefit (dealer accountability, not just keyholder accountability) is real
enough to make it the recommendation rather than an optional extra.

**Explicit non-goal:** this does *not* remove the dealer as a trusted party for *key generation* — a
single process still computes `x` and splits it (no distributed key generation / DKG). A fully
malicious dealer could still, at generation time, choose a weak `x` or record it before splitting.
Feldman VSS makes share *distribution* accountable, not key *generation* trustless. DKG is out of
scope for this document — see §12.

## 3. Partial decryption

For a ballot's ciphertext `(c1, c2)`, keyholder `i` computes:

```
d_i = c1^(x_i)  mod p
```

using **only** their own share `x_i` — no communication with other keyholders required to compute
this step (only the later combination step, §4, needs multiple keyholders' outputs, and that
combination requires no secrets at all).

## 4. Public combination (recovering the plaintext without ever assembling `x`)

Given any 3 keyholders' valid `(d_i, proof_i)` for the same ballot (validity defined by §5's proof
verification passing):

```
s = Π_{i ∈ S} d_i^(λ_i)  mod p        (λ_i — the SAME Lagrange coefficients as §2, index-based,
                                        publicly computable by anyone from S alone)

m = c2 · s^(-1)  mod p
```

**Correctness:** `s = Π (c1^(x_i))^(λ_i) = c1^(Σ λ_i·x_i) = c1^(x') mod p` — identical to the shared
secret `c1^x mod p` an ordinary direct decryption would compute (§1.1's `x ≡ x' mod q` reduction
carries through because `c1` has order dividing `q`). So `m` recovers **exactly** the value ordinary
decryption would have produced — this scheme changes *who computes what and what's provable*, not
the plaintext that comes out.

Candidate recovery: `decodeCandidateId(m)`, unchanged from
[elgamal.ts:244-247](../backend/src/crypto/elgamal.ts#L244-L247) — no changes needed downstream of
`m`. The existing `candidate_not_found`/`constituency_mismatch` rejection logic in `keyshares.ts`
also stays unchanged; only *how `m` is obtained* changes.

## 5. Chaum-Pedersen DLEQ proof — binding to the specific keyholder AND the specific ciphertext

This is the section the review flagged as the critical point, so it's worth being explicit about
*why* a naive proof fails before specifying the one that doesn't.

**What does NOT work:** a standalone Schnorr proof of knowledge of *some* `x_i` such that
`y_i = g^(x_i)`, published once, reused for every ballot. That only proves the keyholder knows the
discrete log of their own public commitment — it says nothing about how `d_i` for any particular
ballot was computed. A keyholder (or a compromised backend impersonating one) could publish a
correct knowledge-of-`x_i` proof once and then submit an **arbitrary, wrong** `d_i` for any ballot,
and this weaker proof would not catch it.

**What the design uses:** a **Chaum-Pedersen equality-of-discrete-logs (DLEQ) proof**, over **two
different bases sharing the same exponent** — this is what forces the SAME witness (`x_i`) into both
the public commitment and this specific ballot's partial decryption:

```
Statement:  "I know x_i such that  y_i = g^(x_i) mod p  AND  d_i = c1^(x_i) mod p"
            (same x_i, two different bases: g and THIS ballot's c1)
```

Both `y_i` (the keyholder's ceremony-time public commitment, §2.1) and `c1` (this specific ballot's
first ciphertext component) appear as fixed, public inputs to the statement being proved — this is
precisely what makes the proof unforgeable-per-ballot-and-per-keyholder rather than a generic
"I-know-a-discrete-log" proof: reusing a proof generated for one ballot's `c1` against a different
ballot's `c1'` fails verification (§5.2's regression test makes this concrete, deliberately mirroring
the SMT relabeling regression this codebase already required once for exactly this class of mistake,
[smt-design.md §6.1](./smt-design.md#61-why-not-the-dense-trees-commutative-hashpair-found-via-adversarial-testing)).

### 5.1 Proof generation (by keyholder `i`, holding `x_i`, for ballot `(c1, c2)`)

```
w  ← random in Z_q                          (fresh per proof)
t1 = g^w   mod p
t2 = c1^w  mod p
e  = FiatShamir(tag, election_id, ballot_id, g, y_i, c1, d_i, t1, t2)     (§5.3)
z  = w + e·x_i   mod q

proof = (t1, t2, z)
```

### 5.2 Proof verification (by anyone, given only public values: `g, p, q, y_i, c1, d_i, proof`)

```
e  = FiatShamir(tag, election_id, ballot_id, g, y_i, c1, d_i, t1, t2)     (recomputed, not trusted)

check:  g^z  ≟  t1 · y_i^e   mod p
check:  c1^z ≟  t2 · d_i^e   mod p

accept iff BOTH checks pass
```

**Binding regression test (required, mirrors the SMT relabeling test):** generate a valid proof for
keyholder `i` against ballot `A`'s `(c1_A, d_i_A)`; attempt to verify it against ballot `B`'s
`(c1_B, d_i_B)` (different ballot, same keyholder) — must be rejected. Separately: attempt to verify
keyholder `i`'s proof for ballot `A` using keyholder `j`'s public commitment `y_j` — must be
rejected. Both must be explicit, named tests in §10, not just implied by the math — the SMT bug this
session found existed *despite* the design doc's math looking correct on paper; only an adversarial
test caught it. The same discipline applies here.

### 5.3 Fiat-Shamir challenge construction and domain separation

```
FiatShamir(...) = SHA-256(  "EVOTING-PARTIALDEC-DLEQ-v1" ‖ election_id ‖ ballot_id ‖
                              hex(g) ‖ hex(y_i) ‖ hex(c1) ‖ hex(d_i) ‖ hex(t1) ‖ hex(t2)  )  mod q
```

Two deliberate departures from `zkp.ts`'s existing convention ([§1.4](#14-existing-fiat-shamir-convention-to-stay-consistent-with)):

1. **An explicit leading protocol tag** (`"EVOTING-PARTIALDEC-DLEQ-v1"`). `zkp.ts` didn't need one
   because only one proof type existed when it was written; this design introduces a second proof
   type that operates over the same group and could, in an adversarial setting, be fed
   attacker-chosen inputs shaped to try to produce a colliding transcript across protocols. The tag
   makes the two proof types' hash domains disjoint by construction, not by accident of differing
   input shapes.
2. **`election_id` and `ballot_id` included directly in the hash**, not just implied by which `c1`
   happens to be used. This closes a subtler replay case than the per-ballot binding in §5.2 alone:
   without this, if the *same* `(p, g)` parameters and, hypothetically, the same `c1` ever recurred
   across two different elections (not possible under the current one-keypair-per-deployment setup,
   but not something this proof's soundness should silently depend on either), a proof could be
   replayed across election contexts. Including `election_id`/`ballot_id` explicitly removes that
   dependency rather than relying on `c1`'s practical uniqueness.

`ballot_id` is the vote's `id` (UUID) — already the primary key on `votes`, already unique,
requires no new identifier scheme.

### 5.4 Security argument

Standard Chaum-Pedersen DLEQ, Fiat-Shamir heuristic (random oracle model), same class of argument
`zkp.ts` already documents for its OR-proof:

- **Completeness:** an honest keyholder computing `d_i` and the proof exactly as specified always
  produces a proof that verifies (direct algebraic substitution).
- **Soundness:** a prover who does not know `x_i` consistent with `y_i` can produce a verifying proof
  only with probability `~1/q` (negligible) — this is the standard Schnorr-protocol
  special-soundness argument (two accepting transcripts with the same commitment `(t1, t2)` and
  different challenges `e ≠ e'` let an extractor solve for `x_i` via `(z - z')/(e - e') mod q`),
  applied simultaneously across both bases `g` and `c1`.
- **Zero-knowledge:** the proof reveals nothing about `x_i` beyond what `y_i` (already public) and
  the statement's truth imply — simulatable by picking `z, e` at random and deriving
  `t1 = g^z · y_i^(-e)`, `t2 = c1^z · d_i^(-e)`, exactly as `zkp.ts`'s simulator does for its
  non-chosen OR-branches. (Not load-bearing for *this* system's threat model the way soundness is —
  the partial decryption `d_i` and the final plaintext `m` are published anyway once the tally runs —
  but stated for completeness and because it's a one-line consequence of the same construction.)

This is a standard result (Chaum & Pedersen 1992; the OR-composition technique `zkp.ts` already uses
is a generalization of the same Σ-protocol family). It does not require empirical testing to hold —
it follows from the discrete-log assumption on the prime-order subgroup, same as `zkp.ts`'s own
stated argument. What *does* require testing is that this specific implementation matches this
specific specification exactly (§10) — that is where the SMT session found its bug, not in the math.

## 6. Threshold combination — no changes beyond §2/§4

Once ≥3 keyholders' `(d_i, proof_i)` for a given ballot have been individually verified (§5.2), §4's
combination formula runs using the standard index-based Lagrange coefficients. If exactly 3 valid
partials exist, that specific 3-subset is used; if 4 exist, any qualifying 3-subset produces the same
`x' mod q` (by Lagrange interpolation uniqueness) — for auditability, the design recommends always
using the same deterministic rule (e.g. "lowest 3 indices with valid proofs") rather than an arbitrary
subset, so re-running the combination step is itself deterministic and reproducible by a verifier.

## 7. Where must partial decryption actually be computed? (a required consequence, not a choice)

This follows directly from §0's opening decision, but is easy to lose sight of while focused on the
proof math, so it's stated as its own section: **if a keyholder's raw share `x_i` is ever transmitted
to or held by the backend — even briefly, even only to compute `d_i` "on the keyholder's behalf" —
the entire scheme provides no more assurance than today's design does.** A backend that has seen
every `x_i` could reconstruct `x'` and lie about the tally exactly as it can today; the proofs would
be verifying a computation that a dishonest party was fully capable of forging correctly, because it
had everything needed to forge it.

**Consequence:** `x_i` must be generated and held **client-side** (in the keyholder's browser, or an
offline tool), and partial decryption (`d_i = c1^(x_i)`) plus the DLEQ proof (§5.1) must be **computed
client-side**, using only publicly downloadable inputs (`g, p, q`, the in-scope ballots' `(c1, c2)`,
and the keyholder's own locally-held `x_i`). Only `(d_i, proof_i)` per ballot — never `x_i` — is ever
sent to the backend.

This means `POST /keyshares/submit`'s payload shape changes fundamentally: from "here is my raw
share" (today) to "here are my partial decryptions and proofs for these N in-scope ballots" (§9).
The Key Holder Portal frontend needs an actual client-side crypto step — BigInt modular
exponentiation is the same lightweight arithmetic already used server-side (`modPow` in
`elgamal.ts`), directly portable to browser JS (native `BigInt` supports it without a crypto
library). This is real, non-trivial frontend work, but it is not optional: any design that keeps
computing `d_i` server-side, however the proofs are wired up around it, has not actually solved the
problem in §0 — it has only added an audit trail to the same trust assumption.

This document specifies the wire protocol and data shapes (§9) so that client-side computation is
what they're built for from the start, rather than the portal being wired server-side first and
"fixed" later — that ordering would risk silently reintroducing exactly the vulnerability this
redesign exists to remove. The actual portal UI implementation is scoped as a separate, later
phase (§12); what must be decided *now*, in this document, is that `x_i` never crosses the network
to the backend in the new flow.

### 7.1 Confirmed anti-pattern already present in the codebase — must not be repeated

`setup-shamir.ts` ([lines 111-135](../backend/src/scripts/setup-shamir.ts#L111-L135)), the existing
key-ceremony script, writes **all four** Shamir shares directly into `backend/.env` ("for local
testing"). That file lives on the exact machine the backend process reads its own configuration
from. Regardless of anything this document specifies about client-side computation, if the *new*
ceremony script keeps this habit, the backend ends up holding every `x_i` anyway, and §7's entire
argument is moot — the backend was never prevented from seeing the shares; it just wasn't asked to
use them.

**Concrete requirement for the new ceremony script:** it must never write `x_i` values anywhere the
backend process can read (no `backend/.env`, no backend-reachable file, no table the backend has a
service-role read path to). Shares are handed to each keyholder once, out-of-band (displayed on
screen and manually copied, written to a keyholder-controlled encrypted file, etc.), and the
ceremony script's own working copy of the full polynomial is discarded after distribution (§11's
dealer-backdoor row covers why "discarded" is a procedural claim, not a verifiable one). A
`--write-shares-to-backend-env` style convenience flag, if kept at all for local dev/demo, must
default off and its output must never be treated as a "verifiable" tally source (§14).

## 8. Scoping the tally to a specific, anchored ballot set

Today's tally (`POST /keyshares/tally`, [§1.5](#15-current-tally-flow)) reads `select * from votes`
directly — whatever rows exist at that instant, with no commitment to *which* ballots that was. An
independent verifier recomputing the tally from public data needs the same guarantee the SMT work
already built for a different purpose: a way to confirm the ballot set being tallied is the complete,
correct, anchored set, not an administrator's unverified claim of "these were all the votes."

**The tally must be explicitly scoped to a specific anchored reference**: the latest dense-tree
`merkle_batches.batch_id`/`root` and the corresponding SMT `smt_batches.smt_root`/
`total_keys_anchored` as of the moment tallying begins. Concretely: the tally input is "every vote
whose `id` appears in dense batch `root R_dense`'s `vote_ids`, cross-checked as exactly
`total_keys_anchored` live keys in SMT root `R_smt`" — not a live, unscoped `SELECT`. This directly
reuses `docs/smt-design.md`'s anchoring machinery rather than inventing a second completeness
mechanism; it's the same reasoning as `deletion-completeness`, applied to "prove the tallied set was
the *whole* set," not "prove the tallied set wasn't tampered with."

This is a real, load-bearing tie between the two design docs, not a passing mention: a verifiable
decryption proof over an *unverifiable or unscoped ballot set* only proves "these particular
ciphertexts, whichever they were, decrypted to this." §8.1 is explicit about the narrower thing this
actually establishes, and what it doesn't.

### 8.1 What anchoring proves about completeness, precisely — and the honest limit

Scoping the tally to `R_dense`/`R_smt` (§8) proves two specific things, inherited unchanged from
`smt-design.md §8`, and nothing more:

1. **No post-anchor tampering.** Once a ballot set is anchored, it cannot be silently altered —
   any change to a ballot in the set changes the root, and the root is checkable against the
   deployed contract by anyone.
2. **Deletion, if it ever happens to a key that was already anchored at least once, is provably
   detectable** via the contradiction between an old membership proof and a later non-membership
   proof (`smt-design.md §8`, exercised end-to-end by this session's integration tests).

**What it does NOT prove:** that the *first* anchoring of a ballot set included every ballot that
was legitimately cast. If the batch-construction step (whatever selects "which confirmed votes go
into this anchor") simply omits a ballot before it is ever anchored, no root — dense or SMT —
reflects that omission, because a Merkle root only ever commits to whatever set was fed into it. A
verifier recomputing the root from a *claimed* ballot list can only confirm "IF this is the true
list, the root is consistent with it" — it cannot independently discover that the list is short.
This is the same **pre-commitment-window gap** already named in `smt-design.md §8` and
`threat_model.md §5`/`§6`, recurring here because tally verifiability inherits every limitation of
the anchoring it's scoped to. Overstating this as "closed" would repeat exactly the kind of mistake
`docs/smt-design.md`'s wording corrections (this session, earlier) existed to prevent — it must stay
named as an open gap, not folded into "solved by scoping."

**Bounded mitigation available today, not a full fix:** the codebase already maintains
`voters.has_voted` and a `nullifiers` table, both populated independently of the batch-anchoring
pipeline (via `fn_cast_vote`'s atomic transaction, `schema.sql`), and already exposed
non-identifyingly via `GET /public/stats` (`total_voted`,
[public.ts:56-57](../backend/src/routes/public.ts#L56-L57)). Including this count in the public
bundle (§9) as `independently_observed_vote_count` and requiring the verifier to cross-check it
against `total_keys_anchored` makes a **gross** omission (a meaningful fraction of ballots missing)
statistically visible, even though a **small, targeted** omission (a handful of ballots, within
normal reporting noise) is not cryptographically provable to be absent by anything in this document.
This is a real, useful, cheap addition — and also a real, stated limit, not a closed gap. Genuine
completeness (every legitimately cast ballot provably included, not just "consistent with a
plausible count") needs either voter-side verifiability (Benaloh challenge, already an explicit
non-goal, §12) or a append-only public bulletin board voters/observers check in real time — both
larger undertakings than this document, noted for future work, not attempted here.

### 8.2 Candidate-set integrity — full protocol

`decodeCandidateId(m)` recovers a UUID; the mapping from that UUID to a displayed name/party/
constituency comes today from a live, **unanchored** `candidates` query
(`keyshares.ts`'s `candidateById` lookup). Worse, checked directly against `schema.sql`: **neither
`candidates` nor `constituencies` has an immutability trigger** — unlike `votes`
(`trg_votes_immutable`/`trg_votes_no_delete`), both tables can be freely `UPDATE`d or `DELETE`d at
any time by anything with DB write access, with no guard at all. A backend (correct!) proof that
"ciphertext X decrypts to UUID `Y`" still rides on the separate, currently-unprotected claim "UUID
`Y` is candidate Alice, standing in CON-03." This section specifies the commitment that closes it.

#### 8.2.1 Canonical serialization

Every field that changes what a voter or verifier believes about a candidate or constituency is
included; nothing else is. Encoding uses explicit length-prefixed fields (TLV: type-tag, then a
4-byte big-endian length prefix before every variable-length field), **not** delimiter-joined
strings — a delimiter-joined encoding is exactly the kind of canonicalization bug that would let two
different candidate lists serialize identically if a `name` or `party` field happened to contain the
delimiter character. Length-prefixing removes that ambiguity entirely; there is no byte sequence
that mixed content and length prefixes.

```
CandidateRecord bytes =
    0x01                                          // record-type tag: candidate
    ‖ candidate.id                                // raw UUID, 16 bytes, fixed-width — NOT hex text
    ‖ uint32_BE(len(name_utf8))    ‖ name_utf8
    ‖ uint32_BE(len(party_utf8))   ‖ party_utf8
    ‖ uint32_BE(len(symbol_utf8))  ‖ symbol_utf8
    ‖ uint32_BE(len(constituency_code_ascii)) ‖ constituency_code_ascii

ConstituencyRecord bytes =
    0x02                                          // record-type tag: constituency
    ‖ uint32_BE(len(code_ascii))  ‖ code_ascii
    ‖ uint32_BE(len(name_utf8))   ‖ name_utf8
```

`symbol` is included deliberately, not just `name`/`party`: it's part of what a voter visually
identifies a candidate by on the cast-vote UI, and a symbol swap between two candidates is a
real-world ballot-fraud technique this commitment should also make detectable, not just name/party
relabeling. `candidates.created_at`/`constituencies.created_at` are deliberately **excluded** —
deployment metadata, not election content; including them would make the commitment spuriously
change on things like a DB migration replay that preserves all real fields but re-stamps timestamps.

#### 8.2.2 Hash/commitment construction and domain separation

Reuses the **existing dense Merkle tree** (`merkleTree.ts`'s `buildMerkleTree`/`hashPair`) rather
than inventing a new tree primitive — deliberately. This commitment only ever needs *membership*
proofs (§8.2.5) — "candidate X with these exact fields is in the committed set" — never
*non-membership* ("no candidate has these fields"). The non-membership case is exactly what forced
the SMT's position-aware hashing in `smt-design.md §6.1`; a pure membership structure has no such
exposure (leaves are content-bound, per that section's own closing note), so the dense tree's
existing, already-tested, commutative `hashPair` is the *correct* and simpler tool here — reaching
for the SMT's machinery for a problem it wasn't built for would be over-engineering, not rigor.

```
candidateLeaf_i        = keccak256(CandidateRecord_i bytes)      for each candidate i
constituencyLeaf_j     = keccak256(ConstituencyRecord_j bytes)   for each constituency j

candidatesRoot          = buildMerkleTree( sort(candidateLeaf_i by candidate.id, ascending) ).root
constituenciesRoot      = buildMerkleTree( sort(constituencyLeaf_j by code, ascending) ).root

electionSetupCommitment = keccak256(
    "EVOTING-ELECTION-SETUP-COMMITMENT-v1" ‖ election_id ‖ candidatesRoot ‖ constituenciesRoot
)
```

The leading protocol tag and `election_id` follow the exact same domain-separation reasoning as
§5.3's DLEQ proof tag — disjoint hash domains from every other proof type in this system, and no
dependency on any value's practical uniqueness to prevent cross-context replay (§8.2.4 makes the
cross-election replay case concrete).

**Leaves are sorted by `id`/`code` before tree construction — this commitment is deliberately
order-invariant.** §8.2.4 explains why this is the *correct* answer to "candidate reordering," not
an oversight: this system attaches no legal or positional significance to candidate display order
(`GET /candidates` already just sorts alphabetically for display, per `vote.test.ts`'s own comment on
the server-derived ZKP candidate set) — unlike jurisdictions with a modeled ballot-position effect.
Sorting before hashing means a harmless re-presentation of the *same* set never produces a spurious
commitment mismatch, while any actual change to the set or to any single record's fields still does
(§8.2.4, test 6). **If a future requirement makes display order itself legally meaningful, this
construction needs to change** — from a sorted-leaf-set commitment to an order-sensitive one (e.g. a
Merkle tree built directly in display order, no sorting) — that is a deliberate, flagged escape
hatch, not a silently-made assumption.

#### 8.2.3 What the commitment commits to, and what it does not

**Commits to:** the exact set of `(id, name, party, symbol, constituency_code)` candidate tuples and
`(code, name)` constituency tuples, as finalized at the moment the commitment was computed, for this
specific `election_id`.

**Does not commit to:** display order (§8.2.2, deliberate); *when* relative to the election timeline
the snapshot was taken — that's a freshness property enforced by §8.2.4's write-once anchoring rule,
not by the hash itself; anything about ballots, votes, or the decryption/tally protocol — a
completely separate commitment, published alongside but never mixed into the same hash (mixing them
would make it impossible to audit candidate-set integrity independently of ballot integrity, which
should stay two separately-checkable claims); and — stated because §12/§7.1 already established the
category — **who controls the admin key that submits this commitment on-chain in the first place**.
Anchoring `electionSetupCommitment` faithfully proves "this is what was anchored," not "the entity
anchoring it wasn't itself dishonest at genesis" — the same trusted-setup boundary as the dealer in
§11's backdoor row, not newly introduced here, and not solved here either (per this task's explicit
instruction — this document does not pretend Feldman VSS, or anything in this section, closes that).

#### 8.2.4 Adversarial cases

| Attack | Caught? | Why |
|---|---|---|
| Candidate replacement (swap a candidate's entire row for a different person/UUID after commitment) | **Yes** | Changes `candidatesRoot` — any single differing leaf changes the Merkle root, checked in §8.2.5 |
| Candidate reordering (same exact set and fields, different display/array order) | **No — by design, not a gap** | §8.2.2's leaves are sorted before tree construction; order was never part of what's committed, because this system attaches no meaning to it. Test 6 (§8.2.6) proves this explicitly rather than leaving it implied |
| UUID substitution (same displayed name/party, different underlying `id` — misdirects which ballots count for whom) | **Yes** | `id` is inside the leaf's canonical bytes; changing it changes the leaf hash even with every other field identical |
| Constituency substitution (a candidate's `constituency_code` changed post-commitment, moving them into a different tally group) | **Yes** | `constituency_code` is inside the candidate leaf's canonical bytes |
| Name/party/symbol modification | **Yes** | All three are canonical leaf fields (§8.2.1) |
| Stale commitment replay (an earlier, legitimately-anchored commitment — e.g. before a late-added candidate — presented as current) | **Yes, structurally, not just by convention** | The anchoring contract (§8.2.5) is **write-once with no update function at all** — not "check it's the latest" (which is what §9 needs for the batch roots, because *those* legitimately grow). There is no second commitment to be stale relative to; a genuine pre-election candidate-list change requires a visibly new contract deployment, not a quiet overwrite |
| Commitment replay from a different election | **Yes** | `election_id` is baked into the top-level hash (§8.2.2) — a commitment computed for election A cannot be presented as valid for election B even if the candidate set happens to coincide |
| Live DB drift after commitment (a `candidates`/`constituencies` row edited post-commitment, with no on-chain re-anchor) | **Detectable by re-verification (§8.2.5), NOT prevented at the DB layer today** | Confirmed by reading `schema.sql`: no immutability trigger exists on either table. **Required companion DB change**, mirroring `trg_votes_immutable`/`trg_votes_no_delete`: once a commitment is anchored, lock `candidates`/`constituencies` the same way `votes` is locked. Without this, the live system (specifically `vote.ts`'s server-derived ZKP candidate set, per `vote.test.ts`'s documented convention) could silently start using drifted data for *new* votes even while the old commitment stays correctly anchored and independently verifiable against the *old* snapshot — the commitment would be truthful about the past and silently irrelevant to the present. This is a real, separate finding from the commitment design itself, not covered by hashing alone |

#### 8.2.5 Publication, anchoring, and independent verification

**Timing requirement:** must be computed and anchored **before any ballot can be cast** — a
commitment computed after votes exist could be back-dated to match whatever result is wanted.
Concretely: `POST /vote` should refuse to accept ballots for an `election_id` with no anchored
`electionSetupCommitment` yet (a new precondition check, implementation-phase work, not specified
further here).

**Where anchored — compared, and recommended (answering item 7):**

| | Extend `MerkleRootStorage.sol` | New minimal contract (recommended) |
|---|---|---|
| Shape of the state being added | A single write-once `bytes32`, structurally unlike every existing function (which are append-only sequences with chain-continuity checks) | A single write-once `bytes32` — matches the *entire* contract's purpose, nothing else to reconcile it with |
| Auditability | Buried inside a larger, already-dense contract; harder to review in isolation | A handful of lines — `owner`, one `bytes32`, one write-once setter, one event — trivially auditable standalone |
| What the deployment/anchor transaction itself proves | Mixed in with routine batch-anchoring transactions, no special visibility | The anchor transaction is a distinct, publicly-timestamped event on its own contract — an observer can directly compare its block timestamp against the first dense-tree batch's anchor timestamp to independently confirm the "committed before voting" ordering requirement, not just take this document's word for the intended order |
| Deployment overhead | None (reuses existing contract) | One more contract, one more address to track/fund | 

**Recommendation: separate contract** (`ElectionSetupCommitment.sol`). The write-once semantics are
different enough in kind from the append-only batch pattern that bolting them onto
`MerkleRootStorage.sol` would mean maintaining two incompatible state-transition disciplines in one
contract. The independently-checkable "committed before voting opened" timestamp ordering is a real
verification asset a separate contract gets for free and a shared one doesn't as cleanly.

```solidity
// Illustrative, not final — implementation-phase task.
contract ElectionSetupCommitment is Ownable {
    bytes32 public commitment;   // 0x0 until set; never changes after
    string  public electionId;

    event CommitmentAnchored(string electionId, bytes32 commitment, uint256 timestamp);

    function anchor(string calldata _electionId, bytes32 _commitment) external onlyOwner {
        require(commitment == bytes32(0), "already anchored — deploy a new contract to change candidates");
        require(_commitment != bytes32(0), "commitment cannot be zero");
        electionId = _electionId;
        commitment = _commitment;
        emit CommitmentAnchored(_electionId, _commitment, block.timestamp);
    }
}
```

**Independent verification:** the verifier (i) queries this contract directly (any public RPC, no
backend involvement) for `commitment`, (ii) obtains the full `candidates[]`/`constituencies[]` lists
(from the public bundle, §9), (iii) recomputes `electionSetupCommitment` exactly per §8.2.2, (iv)
compares. A mismatch means the published candidate metadata has been altered since setup — full
stop, no partial credit, no "probably fine." For any single candidate the verifier wants to check in
isolation (without needing the full list), `getProof`/`verifyProof` (already existing in
`merkleTree.ts`) give a standard Merkle inclusion proof against `candidatesRoot` — the same
primitive already used for ballot inclusion, reused here rather than re-invented.

**Connection to the rest of this document:** the tally verification bundle (§9) gains
`election_setup_commitment: hex` and `candidates_root: hex`/`constituencies_root: hex` fields, and
the independent verifier's mandatory steps (§9) gain: recompute and check this commitment, and — for
the ZKP layer specifically — confirm that the candidate set `vote.ts` derived for each ballot's
validity proof (`zkp.ts`'s `candidateIds` parameter) is exactly the committed constituency subset,
not a live, potentially-drifted query result. This is what makes "ciphertext X validly encodes one
of the constituency's candidates" (the ZKP's existing guarantee) and "the constituency's candidates
are exactly this committed set" (this section's guarantee) compose into one claim an outside
verifier can check end to end, instead of two separately-plausible-looking claims with an unverified
seam between them.

#### 8.2.6 Tests required

1. **Canonical serialization determinism** — the same candidate/constituency set, serialized twice,
   produces byte-identical TLV output; independently re-derive by hand for one small fixed example
   and confirm the implementation matches (mirrors the discipline of hand-checking `H[0..256]` in
   `sparseMerkleTree.test.ts`'s genesis-root test).
2. **Root computation matches an independent recursive recomputation** — same style as
   `sparseMerkleTree.test.ts`'s genesis-root test 1, applied to `candidatesRoot`/`constituenciesRoot`.
3. **Single-field mutation changes `candidatesRoot`** — parameterized over `id`, `name`, `party`,
   `symbol`, `constituency_code` individually; each must change the root.
4. **Single-field mutation changes `constituenciesRoot`** — parameterized over `code`, `name`.
5. **Adding or removing one record changes the respective root.**
6. **Reordering-only produces the IDENTICAL commitment** — the explicit, named proof that §8.2.4's
   "not a gap" claim actually holds: shuffle the input array, confirm `electionSetupCommitment` is
   byte-identical. Direct analogue of `sparseMerkleTree.test.ts` test 7 ("order independence"),
   applied here to justify a design decision rather than just to describe one.
7. **Cross-election replay rejected** — identical candidate/constituency sets, different
   `election_id`, produce **different** top-level commitments (domain separation, §8.2.2).
8. **On-chain write-once enforcement** — a second `anchor()` call on an already-anchored contract
   instance reverts; there is no code path that updates `commitment` once set.
9. **Independent-verifier end-to-end** — given only the on-chain `commitment` plus the published
   candidate/constituency lists: correct lists verify; any single tampered field (each case from the
   §8.2.4 table) is detected and reported, not silently passed.
10. **ZKP candidate-set pinning (integration, later phase)** — confirm `vote.ts`'s derived
    `candidateIds` for a constituency matches the committed set exactly; simulate a live-table drift
    (a `candidates` row edited post-commitment — exercising the exact gap §8.2.4's last row names,
    since no DB trigger prevents it today) and confirm it's detectable by re-checking the live-derived
    set against the anchored commitment. Named here so it isn't lost, scoped to implementation, not
    this document's own off-chain unit-test set.

## 9. Public data bundle for independent recount

Everything an outside verifier needs, and nothing else (no secrets, no admin access):

```
{
  election_id: string,
  anchored_batch_ref: {
    dense_batch_id: number, dense_root: hex,           // merkle_batches
    smt_root: hex, total_keys_anchored: number          // smt_batches
  },
  group_params: { p: hex, g: hex, q: hex },              // q = (p-1)/2, derivable, included for convenience
  public_key: hex,                                       // y = g^x mod p (unchanged)
  keyholder_commitments: [ { index: 1..4, y_i: hex } ],   // §2.1, published once per election
  ballots: [
    { ballot_id: uuid, c1: hex, c2: hex, constituency_code: string }
  ],
  partial_decryptions: [
    {
      ballot_id: uuid, keyholder_index: 1..4,
      d_i: hex, proof: { t1: hex, t2: hex, z: hex }
    }
  ],
  candidates: [ { id: uuid, name: string, party: string, symbol: string, constituency_code: string } ],
  constituencies: [ { code: string, name: string } ],
  election_setup_commitment: hex,                          // §8.2.2 — from ElectionSetupCommitment.commitment()
  candidates_root: hex, constituencies_root: hex,           // §8.2.2 — intermediate roots, for per-candidate proofs
  independently_observed_vote_count: number,                // §8.1 — from GET /public/stats' total_voted
  published_results: { ... }                              // the tally_results row being checked
}
```

A standalone verifier script (`scripts/independent-verify-tally.ts`, §10) consumes this bundle — no
database connection, no `ELGAMAL_PRIVATE_KEY`, no admin secret — and must perform **all** of the
following; the first two (now three) are easy to treat as optional (they don't fail if skipped, they
just stop protecting anything) and are exactly the ones the first draft of this document
under-specified:

1. **Query the deployed `MerkleRootStorage` contract directly** (any public Sepolia RPC — not
   through the backend) for `batchCount`/`smtBatchCount` and the corresponding stored roots.
   Confirm `anchored_batch_ref` in the bundle matches the **latest** on-chain state, not merely *a*
   valid past state — otherwise a stale-root replay (presenting an old, superseded root that hides
   later anchors or a later-detected deletion) passes every other check silently.
2. **Rebuild the dense Merkle tree from `ballots[]`** (same leaf order, same `hashVoteLeaf`) and
   confirm it reproduces `anchored_batch_ref.dense_root` exactly — this is what catches ballot
   substitution (a `c1`/`c2` in the bundle that differs from what was actually anchored); without
   this explicit step, a substituted ciphertext would sail through proof verification (the proof
   would just be *for the wrong ballot*, correctly).
2a. **Query `ElectionSetupCommitment` directly** (§8.2.5, its own contract/address) for `commitment`,
    recompute `election_setup_commitment` from `candidates[]`/`constituencies[]` exactly per §8.2.2,
    and confirm both the value matches and (since it's write-once) that this is the only commitment
    that contract has ever anchored — a mismatch here means the candidate/constituency metadata used
    to interpret the tally has been altered since setup.
3. Cross-check `independently_observed_vote_count` against `anchored_batch_ref.total_keys_anchored`
   (§8.1's bounded, non-cryptographic completeness signal — flag, don't silently pass through, a
   material mismatch).
4. Verify every `(ballot_id, keyholder_index)` proof (§5.2).
5. Combine each ballot's plaintext (§4), decode, cross-reference against `candidates` — now backed by
   step 2a rather than a trusted lookup.
6. Recount and diff against `published_results`.

This script **is** the "without trusting a single administrator" deliverable — everything before it
in this document exists to make this script's check meaningful, and steps 1-3 above are exactly the
ones that turn "meaningful for the decryption step" into "meaningful for the whole tally claim."

## 10. Handling missing/invalid keyholder proofs

- **Fewer than 3 valid partials for a ballot:** cannot be decrypted. New rejection reason
  `insufficient_valid_shares`, distinct from today's `decryption_failed` (malformed ciphertext) —
  these are different failure modes and conflating them would hide *why* a ballot didn't count.
- **A submitted `(d_i, proof_i)` fails §5.2 verification:** discard that specific
  `(keyholder, ballot)` pair; if ≥3 other valid partials remain for that ballot, proceed using them.
  **Publish which keyholder/ballot pair failed** — do not silently drop it. This is the actual
  mechanism that closes the `threat_model.md §7` gap ("a malicious keyholder with a valid share could
  submit a wrong decryption and nothing catches it today") — under this design, something does catch
  it, and the catch itself is part of the public record.
- **A keyholder submits nothing:** as long as ≥3 of 4 submit validly, tally proceeds — unchanged
  3-of-4 threshold model.

## 11. Malicious-actor scenarios

| Actor | Action | Outcome under this design |
|---|---|---|
| Malicious keyholder | Submits a `d_i` not derived from their real `x_i` | §5.2 verification fails (soundness, §5.4) — rejected, publicly attributable, doesn't corrupt the tally as long as 3 honest partials exist |
| Malicious keyholder | Refuses to submit | No different from today — 3-of-4 threshold tolerates 1 absence |
| ≥3 colluding keyholders | Pool real shares, reconstruct `x'` directly, decrypt everything off-protocol | **Not prevented** — inherent to any `(t,n)` threshold scheme; this is the same accepted trust assumption already in `threat_model.md §2` ("out of scope to fully prevent"). This design adds *integrity* verifiability of the honest-computation path; it does not change the *confidentiality* trust assumption at/above threshold |
| Malicious/compromised backend | Tries to alter `d_i` values or forge proofs after receiving them | Cannot forge a valid proof without the corresponding `x_i` (§5.4 soundness) — altering `d_i` without altering the proof fails §5.2 |
| Malicious/compromised backend | Substitutes a ballot's `(c1,c2)` in the published bundle, or presents a stale/superseded root | Caught **only if** the verifier performs §9's steps 1-2 (independently query the contract for the latest state; rebuild the dense root from `ballots[]` and confirm it matches) — these are now specified as mandatory verifier steps, not implied by the bundle's existence |
| Malicious/compromised backend | Omits a ballot before it is ever anchored (never included in the batch construction step) | **Not caught by any cryptographic mechanism in this document** — see §8.1. Bounded, non-cryptographic mitigation: `independently_observed_vote_count` cross-check (§8.1, §9 step 3) surfaces gross omission, not a small/targeted one |
| Malicious/compromised backend | Relabels, substitutes, or reorders the `candidates[]`/`constituencies[]` metadata to swap apparent results after correct decryption | **Caught** — §8.2's `ElectionSetupCommitment`, write-once and anchored before voting opens; the independent verifier's step 2a (§9) recomputes and checks it directly against the contract. Reordering alone is explicitly *not* flagged (§8.2.4) — deliberate, not a gap |
| ≥3 colluding keyholders | Pool real shares, reconstruct `x'` directly, decrypt everything off-protocol | **Not prevented** — inherent to any `(t,n)` threshold scheme; this is the same accepted trust assumption already in `threat_model.md §2` ("out of scope to fully prevent"). This design adds *integrity* verifiability of the honest-computation path; it does not change the *confidentiality* trust assumption at/above threshold |
| Malicious dealer (key ceremony) | Distributes an inconsistent share to one keyholder | Feldman commitments (§2.1) let that keyholder verify `y_i` against public `C_0..C_2` immediately — catches this at distribution time, not tally time. A dealer who chooses a weak `x` at generation time, before any splitting, is **not** caught by this — that's a DKG problem, explicitly out of scope (§2.1, §12) |
| Malicious dealer (key ceremony) | Secretly retains a copy of `x'` (or all four `x_i`) after generating the polynomial and distributing shares | **Not detectable by anything in this document.** The dealer, by construction, knows the entire polynomial at generation time — Feldman VSS proves *receivers* got consistent shares, it says nothing about what the dealer kept. A dealer who does this can decrypt every ballot directly, off-protocol, and every DLEQ proof produced during the actual tally is still genuinely valid (computed from the real shares) — there is no observable difference between this attack and full honesty. This is a procedural/physical-security assumption ("the dealer destroyed their working copy"), same category as `threat_model.md`'s "TLS assumed to hold" — not something a protocol description can close. §7.1's requirement (shares never reach the backend) limits *where* a leak could persist after distribution; it does nothing about the dealer's own copy before distribution ever happens |

## 12. Non-goals (explicit)

- **Distributed key generation (DKG).** A single dealer still generates `x` and splits it. Removing
  the dealer as a trust point for key *generation* (as opposed to *distribution*, which Feldman
  VSS does address) requires a DKG protocol (e.g. Pedersen DKG) — a separate, larger piece of work,
  not bundled into this document.
- **Homomorphic/mix-net tallying.** This system decrypts each ballot individually (already true
  today); this design doesn't change that architecture, only how the decryption step is proven.
- **Voter-side verifiability (Benaloh challenge).** Still an explicit, separate gap
  (`threat_model.md §4`) — a voter confirming their *own* ballot was encoded as cast is a different
  problem from confirming the *tally* was derived correctly from whatever ballots exist. Unaffected
  by this document.
- **Batched/aggregated DLEQ proofs.** At this system's scale (34 ballots as of this session — see
  the SMT backfill result), one proof per `(ballot, keyholder)` pair is computationally trivial
  (§13 note). Aggregating many ballots into a single randomized-combination proof per keyholder is a
  standard optimization for large-scale elections but adds real subtlety (the combination
  coefficients need their own careful Fiat-Shamir binding) that isn't justified at this scale. Left
  as documented future work, not attempted here.

## 13. Test plan

Mirrors the rigor `smt-design.md §13` applied — unit tests first, adversarial/binding tests
explicitly named (not left implicit in "the math should imply this"), then an end-to-end
independent-recount test as the actual deliverable this document exists to enable.

### Off-chain unit tests (new `backend/src/crypto/shamirZq.test.ts`, `backend/src/crypto/dleq.test.ts`)

1. **Shamir-over-`Z_q` round trip** — split `x'`, reconstruct from all 4 of the `C(4,3)=4` possible
   3-subsets, confirm every one recovers `x'` exactly (mirrors `setup-shamir.ts`'s existing
   "verify all 4 combinations" check, §2).
2. **2-of-4 does not reconstruct** — the same security check `setup-shamir.ts` already performs for
   the old scheme, repeated for the new one.
3. **Feldman commitment consistency** — for each `i`, confirm `y_i == Π C_l^(i^l) mod p` (§2.1).
4. **Partial decryption correctness** — for a random ballot and random `x'`, confirm §4's combined
   `m` equals direct decryption (`decrypt`/`decryptCandidateId`) of the same ciphertext with the
   same `x'` — the identity §4 states, checked computationally, not just algebraically.
5. **DLEQ proof round-trip** — generate a proof for a real `(x_i, y_i, c1, d_i)`, verify it — must
   return true.
6. **DLEQ forgery rejection** — mirrors `zkp.ts`'s existing forgery-rejection style: tamper `t1`,
   `t2`, `z`, `d_i`, or `y_i` individually — each must cause verification to fail.
7. **Binding regression test (required, §5.2)** — the two named cases: a proof valid for
   `(keyholder i, ballot A)` must NOT verify against `(keyholder i, ballot B)`; must NOT verify
   against `(keyholder j, ballot A)` for `j ≠ i`. This is the direct analogue of the SMT relabeling
   regression (`sparseMerkleTree.test.ts`'s "K1's absence proof cannot be relabeled as K2") — same
   failure shape (a proof that's supposed to be bound to specific context but isn't), same reason
   it must be an explicit test rather than inferred from the math being correct on paper.
8. **Threshold-subset determinism** — combining any two different valid 3-subsets of 4 available
   partials for the same ballot produces the same `m` (Lagrange interpolation uniqueness, checked
   computationally).
9. **Insufficient-shares handling** — combining only 2 valid partials must not silently produce a
   wrong `m`; the combination function must refuse to run below threshold.

### Integration tests (needs a seeded DB, mirrors the SMT integration tests' live-infra caveats)

10. **End-to-end tally via the new flow** — seed a small set of real ballots, have 3 simulated
    keyholders (test-only, holding real `x_i` values from a real §2 split) compute `d_i` + proofs
    client-side-equivalent (i.e. in the test itself, not via the server), submit via the new
    `POST /keyshares/submit` shape, run the tally, confirm results match a direct-decryption
    reference computation on the same ballots.
11. **Malicious keyholder submission rejected without corrupting the tally** — a ballot needs **≥3
    valid** partial decryptions (§4/§10); it is never combined from fewer. Set up 4 keyholders, have
    one submit a forged `d_i` for a ballot. With only the remaining 2 (of the original 3 submitters)
    valid, confirm the ballot is correctly flagged `insufficient_valid_shares` (§10), NOT silently
    tallied on 2. Then have the 4th keyholder submit a valid partial too; confirm the ballot now
    tallies correctly from the 3 valid partials, and that the forged submission is recorded/
    attributable in the output, not silently dropped in either case.
12. **Independent recount matches the server's published tally** — the actual capstone test: export
    the public bundle (§9) after a real tally run, then run `scripts/independent-verify-tally.ts`
    (§9) as a **completely separate process** with no DB/admin access, confirm its recomputed totals
    match `published_results` exactly. This is the test that directly answers the question this
    document exists to answer.
13. **Anchored-scope enforcement (§8)** — attempt to tally with a ballot set that doesn't match the
    referenced `dense_root`/`smt_root`/`total_keys_anchored` (e.g. one ballot added after the batch
    was anchored) — must be rejected or flagged, not silently included.
14. **Verifier rejects a stale root (§9 step 1)** — construct a bundle referencing a real but
    non-latest anchored root (a later batch has since been anchored, on-chain); confirm the
    independent verifier flags this rather than accepting the bundle as current.
15. **Verifier rejects a substituted ballot (§9 step 2)** — construct a bundle where one ballot's
    `(c1, c2)` has been altered from what was actually anchored (the recomputed dense root no longer
    matches on-chain); confirm the verifier rejects the whole bundle rather than silently tallying
    the substituted value.
16. **Completeness cross-check flags a gross mismatch (§8.1, §9 step 3)** — construct a bundle where
    `total_keys_anchored` is materially lower than `independently_observed_vote_count`; confirm the
    verifier flags this. Explicitly also test the negative case this mechanism cannot catch: a
    bundle missing exactly one ballot out of many, with counts otherwise plausible — confirm (and
    document in the test's own comment, mirroring `sparseMerkleTree.test.ts`'s proof-size test's
    "this is a hypothesis check, not a completeness proof" framing) that this passes the cross-check
    silently, because it is not what this mechanism can detect (§8.1) — the test exists to keep the
    limitation honest and visible in the test suite itself, not just in prose.

## 14. Migration / backward compatibility

- **Not backward compatible with existing shares.** The existing `SHAMIR_SHARE_1..4` (`.env`) and
  any `key_shares.share_value` rows are `GF(2^8)`-based (§1.2) and cannot be reused. A fresh key
  ceremony is required: re-split the **existing** `x` (no need to generate a new ElGamal keypair —
  `y` is unaffected, §1.1) using the new `Z_q` scheme (§2), and redistribute new `x_i` values plus
  each keyholder's `y_i` commitment to the 4 keyholders. This is a real, disruptive operational step
  — the same coordination cost any key ceremony re-run carries — not something to route around.
- **`key_shares` schema changes needed:** the table's role shifts from "holds submitted raw shares"
  to "holds submitted partial-decryption proofs" — needs columns for `public_commitment` (`y_i`,
  non-secret, published at split time) and, per submission, the ballot-scoped `(d_i, proof)` data
  (likely a separate table, `partial_decryptions`, one row per `(ballot_id, keyholder_index)`, rather
  than cramming a whole election's worth of partials into `key_shares`).
- **`POST /keyshares/submit` payload changes** from `{ share_value }` to a batch of
  `{ ballot_id, d_i, proof }` entries (§7, §9) — a breaking API change, gated behind the Key Holder
  Portal's client-side crypto work (§7), which is scoped as a separate implementation phase.
- **Old `reconstructKey()`/direct-decrypt tally path**: recommend deprecating once the new flow is
  live, rather than keeping both indefinitely — keeping a "trusted mode" fallback available would be
  an easy way for the verifiable path to silently get bypassed under operational pressure ("the
  portal's down, just reconstruct the key like before"). If a non-verifiable fallback is wanted for
  demo/dev convenience, it should be explicitly labeled as such in its own response field
  (`verifiable: false`), never silently indistinguishable from a verified tally.
- **Deploy `ElectionSetupCommitment.sol` (§8.2.5) and anchor it before the next election's first
  vote is accepted.** For the current already-running demo election, the candidate set was never
  committed at setup — anchoring a commitment now would only be truthful about "the set as of
  today," not "the set as of when voting began," and should be labeled as such if done retroactively
  for demo purposes (same "don't silently imply a stronger guarantee than what actually happened"
  discipline as the `verifiable: false` labeling above).
- **Add `trg_candidates_immutable`/`trg_constituencies_immutable`-style guards** (mirroring
  `trg_votes_immutable`) to `candidates`/`constituencies`, gated to activate once a commitment is
  anchored for their election — required per §8.2.4's last adversarial-case row, otherwise the new
  on-chain commitment coexists with a live DB that can still drift underneath it.

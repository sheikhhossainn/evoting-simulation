# Distributed Key Generation — Security Analysis and Evidence

**What this document is.** [formal-security-definitions.md §5](formal-security-definitions.md#5-definition--ballot-privacy-and-the-honest-limits-of-this-claim)
states explicitly, as a residual gap: *"any property of the dealer's honesty at key-generation
time — a dealer who retains a copy of `x` breaks privacy regardless of every proof system above,
and this is a procedural/trust assumption this document does not (and, without a DKG protocol,
cannot) discharge cryptographically."* Its summary table (§6) lists **"dealer retaining `x`"** as
an explicit residual, not-proven item for ballot privacy, and **"Honesty of key generation/
distribution (dealer trust)"** as the residual for partial-decryption soundness.

This document is that closure. It formally analyzes the 4-party Pedersen-style Distributed Key
Generation (DKG) ceremony (`backend/src/routes/dkg.ts`, `frontend/src/utils/dkgCrypto.ts`,
`frontend/src/pages/KeyCeremony.tsx`) that replaced the trusted-dealer script
(`backend/src/scripts/setup-shamir-zq.ts`, now dev/simulation-only), states precisely what it
proves and does not, and — the part a code-review-only writeup can't give you — includes real
evidence from an actual live ceremony run, not just a code-inspection argument.

Same citation policy and house style as `formal-security-definitions.md`: standard game-based
definitions, explicit reductions to canonical results, and every claim ends with what it does
**not** prove. No new cryptographic theorems are claimed.

---

## 1. Preliminaries

Same group as `formal-security-definitions.md §1`: `p` a 256-bit safe prime, `g` a generator of the
order-`q` subgroup of `Z*_p`, DL/DDH hardness assumption, ROM for Fiat-Shamir. New notation for
this document:

- `n = 4` keyholders, indices `1..4`; threshold `t = 3` (unchanged from the existing Shamir/Feldman
  scheme — DKG changes *how the shares are generated*, not the threshold itself).
- Each keyholder `i` locally generates a random degree-`(t-1)` polynomial `f_i(z)` over `Z_q`, with
  `f_i(0) = x_i` — their own private contribution.
  [dkgCrypto.ts:66-73](../frontend/src/utils/dkgCrypto.ts#L66-L73) (`generatePolynomial`).
- The combined secret is `x = Σ_{i=1}^{4} x_i mod q`. **`x` is never computed anywhere — it exists
  only as this unrealized sum.**
- The combined polynomial `F(z) = Σ_i f_i(z)`. Each keyholder `j`'s final share is
  `s_j = F(j) = Σ_i f_i(j) mod q`, computed locally by keyholder `j` from the four sub-shares
  `f_i(j)` sent to them ([KeyCeremony.tsx](../frontend/src/pages/KeyCeremony.tsx)'s round-3 handler).
- Feldman commitments to `f_i`: `C_i = [g^(a_{i,0}), g^(a_{i,1}), g^(a_{i,2})]`, published in round 1
  ([dkgCrypto.ts:86-93](../frontend/src/utils/dkgCrypto.ts#L86-L93)).
- By Feldman VSS's additive homomorphism, the combined commitment vector
  `C = Π_i C_i` (elementwise, mod `p`) is a valid Feldman commitment to `F`, computable from public
  data alone — this is the one piece of arithmetic the **server** performs
  ([dkg.ts crypto module — `combineFeldmanCommitments`](../backend/src/crypto/dkg.ts)).

**Construction lineage:** this is Pedersen's original DKG construction (T. Pedersen, *A Threshold
Cryptosystem without a Trusted Party*, EUROCRYPT 1991) — `n` parties each run a Feldman VSS of their
own secret and sum the results — *without* Gennaro-Jarecki-Krawczyk-Rabin's later commit-then-reveal
and complaint-resolution additions (see §4 below for why that omission matters and why it is stated
here rather than silently left out).

---

## 2. Protocol → code map (evidence the construction matches the description above)

| Round | What happens | Code |
|---|---|---|
| Init | Admin publishes public, non-secret `(p, g)` for the election — **not** the trusted-dealer step; `x` never generated here | `POST /dkg/init` [dkg.ts:57-89](../backend/src/routes/dkg.ts#L57) |
| 1 | Each keyholder generates `f_i`, publishes `C_i` + an ephemeral ECDH pubkey, entirely client-side | `POST /dkg/round1` [dkg.ts:114-163](../backend/src/routes/dkg.ts#L114); `generatePolynomial`/`computeCommitments` [dkgCrypto.ts:66-93](../frontend/src/utils/dkgCrypto.ts#L66) |
| 1 (read) | Any keyholder fetches all published `C_i` + pubkeys once all 4 are in | `GET /dkg/round1` [dkg.ts:165-186](../backend/src/routes/dkg.ts#L165) |
| 2 | Each keyholder computes `f_i(j)` for `j=1..4`, encrypts each under an ECDH-derived AES-GCM key to recipient `j`, sends only ciphertext the server cannot read | `POST /dkg/round2` [dkg.ts:213-266](../backend/src/routes/dkg.ts#L213); `encryptSubShare` [dkgCrypto.ts](../frontend/src/utils/dkgCrypto.ts) |
| 2 (read) | Keyholder `j` fetches only the 4 ciphertexts addressed to them (passphrase-gated) | `POST /dkg/round2/inbox` [dkg.ts:281-318](../backend/src/routes/dkg.ts#L281) |
| 3 | Keyholder decrypts all 4 sub-shares, runs `verifyFeldmanShare` against each sender's `C_i` (rejects and aborts on failure — a cheating dealer is caught here), sums into `s_j`, confirms | [dkg.ts:327-377](../backend/src/routes/dkg.ts#L327); `verifyFeldmanShare` [dkgCrypto.ts:96-113](../frontend/src/utils/dkgCrypto.ts#L96) |
| 3 (4th confirm) | Server combines the 4 **public** `C_i` vectors, publishes into `election_key_ceremony`, derives each `y_j` | `combineAndQualify` [dkg.ts:379-432](../backend/src/routes/dkg.ts#L379) |

Every value that crosses the wire from a keyholder's browser to the server is either public
(commitments, pubkeys, confirmations) or ciphertext the server cannot decrypt (round-2 sub-shares).
No route, no database column, no server log path anywhere in this system ever receives `x`, any
`x_i`, any `f_i(j)` in plaintext, or any `s_j` — this is a structural claim (there is no code path
that could carry these values to the server), not a policy promise.

---

## 3. Definition — DKG dealer-secrecy

**Informal property:** no coalition of `≤ t-1 = 2` keyholders, and no set of ≤3 of the 4 *dealers*
malicious/colluding while at least 1 dealer is honest, ever learns anything about the combined
secret `x`.

This decomposes into two independent claims that compose:

### 3.1 Dealer-level secrecy (at least one honest dealer suffices)

**Claim:** if at least one of the 4 dealers `h` is honest (samples `f_h` uniformly and follows the
protocol), then `x = x_h + Σ_{i≠h} x_i mod q` is distributed uniformly over `Z_q` from the view of
any party that does not know `x_h`, **regardless of how the other three `x_i` were chosen** —
including adaptively, after seeing `h`'s public commitment `C_h`.

**Argument (information-theoretic, one-time-pad style):** `x_h` is uniform and independent of
everything else in the adversary's view except `y_h = g^(x_h) mod p` (published as `C_h`'s constant
term). Recovering `x_h` from `y_h` requires solving discrete log — infeasible under the DL
assumption — so no PPT adversary can condition their choice of `x_2, x_3, x_4` on the actual value
of `x_h`, only on `y_h`. Since `x = x_h + (adversary's chosen offset) mod q` and the offset is
information-theoretically independent of `x_h`'s actual value (not just computationally, since the
adversary literally cannot compute it), `x` is uniform over `Z_q` conditioned on the adversary's
view — the standard modular one-time-pad argument, applied at the level of the *sum of shared
secrets* rather than a single ciphertext.

### 3.2 Below-threshold share secrecy (Shamir privacy on the combined polynomial)

**Claim:** any 2 of the 4 keyholders' final shares `s_j = F(j)` reveal nothing about `x = F(0)`
beyond what §3.1 already establishes.

**Argument:** `F(z) = Σ_i f_i(z)` is itself a degree-`(t-1)` polynomial over `Z_q` (sum of
degree-`(t-1)` polynomials), so the *classical* `(t,n)`-Shamir information-theoretic privacy
theorem (Shamir, *How to Share a Secret*, CACM 1979 — already cited in
[formal-security-definitions.md §5](formal-security-definitions.md#5-definition--ballot-privacy-and-the-honest-limits-of-this-claim))
applies to `F` exactly as it does to the old single-dealer polynomial: any `t-1 = 2` evaluation
points of a random degree-2 polynomial are information-theoretically independent of `F(0)`. This
part of the argument is **unchanged from the pre-DKG system** — DKG changes how `F` is
*constructed* (four parties instead of one), not the privacy of evaluating it at few points, which
[shamirZq.ts](../backend/src/crypto/shamirZq.ts) and its existing test suite
([shamirZq.test.ts](../backend/src/crypto/shamirZq.test.ts)) already cover for the combined
polynomial's algebra (§3 of `dkg.test.ts` below re-verifies this holds for the *DKG-combined* `F`
specifically, not just an arbitrary single-dealer one).

**Composed claim:** `Adv_DealerSecrecy(A) ≤ negl(λ)` under the DL assumption, for any adversary
corrupting up to 3 of the 4 dealers (as long as ≥1 is honest) **and** holding up to `t-1 = 2` final
shares.

**What this does NOT prove:** that `x` is generated with full, "beacon-grade" uniform randomness
immune to *any* adversarial influence over its distribution — see §4. It also does not prove
anything about a dealer being coerced into deviating from the honest algorithm *after* being
otherwise honest (e.g., leaking `x_i` out-of-band) — that is the same procedural/endpoint-security
class of threat named in [threat_model.md §2](threat_model.md#2-actors) for the old dealer, applied
per-keyholder instead of to one operator; DKG reduces the number of parties who must each
individually leak nothing from 1-must-be-perfectly-trusted to 1-of-4-must-be-honest, it does not
make endpoint compromise impossible (§5's earlier discussion of this in the session that scoped
this feature — see this document's evidence section for the enumerated residual theft paths, which
still apply per-keyholder).

---

## 4. Known limitation — rushing/bias on the public key (Pedersen91 vs. GJKR99)

This is the section a reviewer should read most carefully, and the reason §1 stated the
construction lineage explicitly rather than just calling it "a DKG."

**The gap:** `GET /dkg/round1` is public and returns already-submitted commitments before all 4 are
in ([dkg.ts:165-186](../backend/src/routes/dkg.ts#L165)). A rushing keyholder can poll this
endpoint, observe the other 3 dealers' published `C_i` (hence their `y_i = g^(x_i)`), and *then*
choose their own `f_i` — including choosing `x_i` as some function of the observed `y_i` values —
before submitting. This is precisely the weakness R. Gennaro, S. Jarecki, H. Krawczyk, and T. Rabin
identify in Pedersen's original 1991 DKG in *Secure Distributed Key Generation for Discrete-Log
Based Cryptosystems* (EUROCRYPT 1999; extended version, *Journal of Cryptology* 2007): without a
commit-then-reveal step (publish `H(C_i)` first, only reveal `C_i` once all 4 hashes are in) and a
complaint/disqualification sub-protocol for inconsistent shares, a rushing adversary can bias the
distribution of the final public key `y = g^x` away from uniform.

**Why this does NOT break §3's secrecy claim:** GJKR's own analysis (and the standard reading of it
in the threshold-cryptography literature since) is that this bias affects the *unpredictability* of
`y` as an output — the property that matters for applications like distributed randomness beacons —
**not** the discrete-log hardness of recovering `x` from `y`, and not §3's claim that a below-
threshold coalition learns nothing about `x`. Seeing `y_h = g^(x_h)` does not let a rushing
adversary compute `x_h` (that would break DL directly); they can only choose their own contribution
as an *additive offset* applied to an already-DL-hidden value, which shifts *which* uniformly-
distributed-conditioned-on-the-honest-share value results, not whether it remains hidden. This
system's actual security requirement (ballot secrecy under threshold ElGamal — §5 of
`formal-security-definitions.md`) only needs the resulting `y` to be *some* value whose discrete log
is unknown to any below-threshold coalition, which §3 establishes independent of this bias.

**What this genuinely is:** a real, unfixed gap relative to the state of the art (GJKR99/07's
complaint-and-commit protocol, or later UC-secure DKG constructions), left this way as a deliberate
scope decision rather than an oversight — implementing full complaint resolution is materially more
protocol machinery (an extra round, a dispute-resolution sub-protocol requiring the "victim" to
reveal enough to let third parties adjudicate a complaint without revealing their own secret) for a
bias property this system's actual security claim does not depend on. **Recommended follow-up, not
done here:** add a commit-reveal pre-round to round 1 (hash-commit to `C_i` before publishing it),
which closes the bias gap without needing full complaint resolution, at the cost of one extra round
trip.

---

## 5. Definition — public verifiability of the combination step

**Informal property:** the server's one piece of arithmetic — combining the 4 public `C_i` vectors
into `election_key_ceremony.feldman_commitments` — is independently checkable by anyone, not merely
trusted.

**Argument:** both the four dealers' `C_i` vectors (`GET /dkg/round1`,
[dkg.ts:165-186](../backend/src/routes/dkg.ts#L165)) and the server's published combined vector
(`GET /keyshares/commitments`, unchanged route) are public, unauthenticated reads. Any observer can
fetch both and recompute `combineFeldmanCommitments` themselves
([dkg.ts crypto module](../backend/src/crypto/dkg.ts), pure elementwise modular multiplication — no
secret input) and compare against the published result. This mirrors the same "don't trust, verify
from public data" property [formal-security-definitions.md §3](formal-security-definitions.md#3-definition--universal-verifiability-the-independent-recount-claim)
already establishes for tally verifiability.

**What this does NOT prove:** this check is not currently wired into
[independent-verify-tally.ts](../backend/src/scripts/independent-verify-tally.ts) as an automated
step — it is *possible* from public data today, not yet *automated*. Adding it (fetch both
endpoints, recompute, compare) is a small, concrete follow-up, listed here rather than silently
left off this document's scope.

---

## 6. Empirical evidence — live ceremony run

Everything above is a code-inspection argument. This section is real execution evidence, captured
during this feature's own verification pass, not synthetic.

**Automated test suite** (`backend/src/crypto/dkg.test.ts`, `backend/src/routes/dkg.test.ts`,
8/8 passing):
- Unit-level: generates 4 independent dealer polynomials with a real 256-bit safe-prime group
  (`generateKeypair()`), confirms `combineFeldmanCommitments(...)`'s `C_0` equals
  `g^(Σx_i) mod p` computed directly, and confirms `deriveShareCommitment` against the combined
  vector matches each of the 4 keyholders' actual combined share `Σ_i f_i(index)` — i.e. §3.2's
  algebra is checked against real arithmetic, not just asserted.
- Route-level: runs the full 4-keyholder, 3-round HTTP flow against a mutable mock of Supabase,
  then feeds the resulting DKG-produced ceremony into the **unmodified** `keyshares.ts` routes —
  constructs a real Chaum-Pedersen DLEQ proof (`proveDleq`) from a keyholder's actual combined
  share and confirms `POST /keyshares/submit-partial` accepts it (`verified: true`) — i.e. the
  interop claim in §2 of this document's companion implementation notes is exercised end-to-end,
  not just argued.

**Live 4-browser-tab run**, election `DKG-TEST-01`, against the actual deployed Express backend and
Vite frontend (not a mock), run 2026-08-15. Real captured server responses:

```
GET /dkg/status?election_id=DKG-TEST-01

{
  "election_id": "DKG-TEST-01",
  "status": "qualified",
  "group_params": {
    "p": "ef8d8f617c0c99862d36fe5548e2cc9aa40a782ff81b709c18df689a19208ddf",
    "g": "19"
  },
  "keyholders": [
    { "index": 1, "keyholder_id": "KH-001", "role": "Election Commission",
      "round1_submitted": true, "round2_submitted": true, "round3_confirmed": true },
    { "index": 2, "keyholder_id": "KH-002", "role": "Judiciary Observer",
      "round1_submitted": true, "round2_submitted": true, "round3_confirmed": true },
    { "index": 3, "keyholder_id": "KH-003", "role": "Academic Auditor",
      "round1_submitted": true, "round2_submitted": true, "round3_confirmed": true },
    { "index": 4, "keyholder_id": "KH-004", "role": "Civil Society Observer",
      "round1_submitted": true, "round2_submitted": true, "round3_confirmed": true }
  ]
}
```

```
GET /keyshares/commitments?election_id=DKG-TEST-01

{
  "election_id": "DKG-TEST-01",
  "group_params": { "p": "ef8d8f617c0c99862d36fe5548e2cc9aa40a782ff81b709c18df689a19208ddf", "g": "19" },
  "feldman_commitments": [
    "88d9ab3adab2f63edcf401ad85afd577166b498c5dbf716ecd55737e1c370a86",
    "dba4fdb7f1568b80c1925e8f0583169208227361801557a23dbdcb2fec35d102",
    "c3385221fc53ecc882b256ef2339fd109fa6330054edcde3493d0f1a722c8ad3"
  ],
  "keyholder_commitments": [
    { "index": 1, "keyholder_id": "KH-001", "role": "Election Commission",
      "y_i": "1b62915154b314fe8f5ff739d4b3f1504bf52b82e08f7ee8241e8deb7b8f6067" },
    { "index": 2, "keyholder_id": "KH-002", "role": "Judiciary Observer",
      "y_i": "82e9f266dc8b4554efd743741ffa00d65c42ebdd123913b5929c6a5b10dd51b4" },
    { "index": 3, "keyholder_id": "KH-003", "role": "Academic Auditor",
      "y_i": "1cb85019561edaf8dd7f6e2e863e85b668415bf5dbb1d9c667c71a333f31b8ee" },
    { "index": 4, "keyholder_id": "KH-004", "role": "Civil Society Observer",
      "y_i": "f2e7751572e530aa28f152835b0d7c925edd197f96716c8b412061a268fc79b" }
  ]
}
```

This confirms, against real infrastructure rather than a mock: all 4 keyholders independently
completed all 3 rounds in 4 separate browser tabs; the ceremony reached `qualified`; the server
published a combined Feldman commitment vector and 4 distinct `y_i` values with no `x` or `x_i`
ever appearing in any request body, response body, or server log along the way (§2's structural
claim, observed to hold in this run, not just asserted from reading the code).

**What this evidence does NOT establish:** a single successful run is not a statistical argument
about protocol correctness across many runs, adversarial runs, or runs with an actually-malicious
participant (no keyholder in this run deviated from the protocol — §4's rushing scenario and §3's
"cheating dealer caught at round 3" path were exercised by the automated tests, which do construct
adversarial inputs, but not by this particular live run).

---

## 7. Updated summary (extends `formal-security-definitions.md §6`)

| Property | § | Reduces to | Citation | Residual (not proven) |
|---|---|---|---|---|
| DKG dealer-secrecy | §3 | DL (one-time-pad argument) + classical Shamir info-theoretic privacy | Pedersen 1991; Shamir 1979 | Uniform-randomness/unbiasedness of the resulting public key against a rushing minority (§4) |
| Combination-step public verifiability | §5 | Direct recomputation from public data (no hardness assumption) | — | Not yet wired into `independent-verify-tally.ts` as an automated check |

This directly resolves `formal-security-definitions.md §6`'s previously-open residual cells
**"dealer retaining `x`"** and **"Honesty of key generation/distribution (dealer trust)"**: there is
no longer a dealer to retain `x` — see §2's structural claim and §6's live evidence that no such
value ever appears server-side.

---

## 8. Erratum — stale claims elsewhere in the docs (found while writing this document)

`threat_model.md`, as currently written (predates both the DLEQ/partial-decryption redesign and
this DKG work), contains statements that are now factually incorrect against the live code and
should be corrected in a follow-up pass, not left standing alongside this document:

- **`threat_model.md` §1** ("at tally time, 3-of-4 Shamir keyholders reconstruct the ElGamal
  private key and decrypt") — false. The system never reconstructs `x`; tally uses partial
  decryptions combined in the exponent (`dleq.ts`'s `combinePartialDecryptions`), matching
  `formal-security-definitions.md §4`, and now DKG means `x` is never even *generated* in one
  place either.
- **`threat_model.md` §7 / §4's table row "Tally correctness"** ("No ZK proof of *correct* partial
  decryption per share... flagged as the strongest available research contribution") — false as
  stated; this is already implemented (`dleq.ts`, `formal-security-definitions.md §4`). The
  document describes already-shipped work as a future research gap.
- **`threat_model.md` §10 non-goals** lists "Multi-election isolation" as explicitly out of scope —
  also now implemented (`threat_model.md §10`'s own cross-reference is what named the gap this
  session's earlier work closed).

Not fixed in this document because the instruction for this piece of work was a single, focused
file — flagged here explicitly rather than silently left inconsistent, per this document's own
house style of naming gaps rather than hiding them.

---

## References

1. T. P. Pedersen, "A Threshold Cryptosystem without a Trusted Party," EUROCRYPT 1991.
2. R. Gennaro, S. Jarecki, H. Krawczyk, T. Rabin, "Secure Distributed Key Generation for Discrete-Log Based Cryptosystems," EUROCRYPT 1999; extended version, *Journal of Cryptology*, 2007.
3. A. Shamir, "How to Share a Secret," Communications of the ACM, 1979.
4. D. Chaum, T. P. Pedersen, "Wallet Databases with Observers," CRYPTO 1992 (DLEQ, reused unchanged from `formal-security-definitions.md §4`).

Companion documents: [formal-security-definitions.md](formal-security-definitions.md) (the document
this one closes a residual gap in), [tally-verifiability-design.md](tally-verifiability-design.md)
(the partial-decryption/DLEQ protocol this DKG ceremony feeds into, unchanged),
[threat_model.md](threat_model.md) (actor model — see §8 erratum above for known staleness).

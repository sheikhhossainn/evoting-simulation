# Related Work and Novelty Positioning

Companion to [`tally-verifiability-design.md`](./tally-verifiability-design.md), [`smt-design.md`](./smt-design.md),
and [`threat_model.md`](./threat_model.md). Written to answer the question a reviewer asks first:
*what here is actually new, versus a competent integration of known techniques?* The honest answer
has two parts — one real, nameable contribution, and one place where this system is currently
**behind** established prior art, not ahead of it. Both are stated precisely below rather than
blurred together, per this project's standing discipline of not overstating what's closed.

## 1. The comparison set

Restricted to 2020–2026 publications — foundational primitives (Chaum-Pedersen DLEQ proofs,
Pedersen DKG, the base Helios/Civitas/Selene/CONIKS constructions) are older and are named only as
concepts; every citation backing a claim below is from the 2020–2026 window.

| System | Verifiability mechanism | Threshold decryption | Ballot-set completeness | Candidate-set integrity |
|---|---|---|---|---|
| **Helios / Belenios family**, re-analyzed | Baloglu, Bursuc, Mauw & Pang (CSF 2021) give automated (Tamarin-checked) proofs *and new attacks* on deployed Helios/Belenios verifiability; a companion paper the same year, "Provably Improving Election Verifiability in Belenios" (IACR ePrint 2021/1201), fixes some of them | Belenios: **Pedersen DKG**, genuinely distributed — confirmed still current in "Features and usage of Belenios in 2022" (Cortier, Gaudry & Glondu, E-Vote-ID 2022) and the 2023/2024 "Belenios with Cast as Intended" extension | Dragan et al., "Machine-checked proofs of privacy against malicious boards for Selene & co." (CSF 2022), formally treats a **misbehaving bulletin board** for Selene-family systems — but the fix is a privacy proof under a malicious-board threat model, not a cryptographic non-membership mechanism for detecting post-hoc ballot removal | Fixed configuration, not separately anchored/committed |
| **Civitas / JCJ**, re-analyzed | Cortier, Gaudry & Yang, "Is the JCJ voting system really coercion-resistant?" (IACR ePrint 2022/430) shows the pre-tally ballot-cleansing phase itself leaks information, weakening the coercion-resistance claim, and propose a fix ("CHide") | Distributed registration/tabulation tellers (unchanged design) | N/A — completeness subsumed by credential-matching tally, quadratic in ballot count (a known, still-cited scalability limitation) | N/A |
| **Selene**, follow-up work | Gjøsteen, Haines & Solberg, "Coercion Mitigation for Voting Systems with Trackers: A Selene Case Study" (IACR ePrint 2023/1102), formally defines and proves Selene's coercion-mitigation property | Standard threshold ElGamal | Malicious-board privacy proof (Dragan et al. 2022, above) — same gap as Helios/Belenios family: no non-membership mechanism | Not separately anchored |
| **Microsoft ElectionGuard** | Benaloh et al., "ElectionGuard: a Cryptographic Toolkit to Enable Verifiable Elections" (USENIX Security 2024 / IACR ePrint 2024/955); Chaum-Pedersen proofs of correct encryption/decryption per ballot, homomorphically combined; "guardians" hold shares | **DKG-based**, actively being reworked — "REACTIVE: Rethinking Effective Approaches Concerning Trustees in Verifiable Elections" (IACR ePrint 2024/915) proposes a new trustee/guardian protocol for ElectionGuard | Relies on device/bulletin-board tracking, not an authenticated non-membership structure | Fixed configuration |
| **AmarVote** (BUET, NSysS 2025) — closest recent prior art combining ElectionGuard + blockchain | ElectionGuard's existing mechanism, plus a prototype blockchain layer (Ganache) for tamper-evident ballot tracking, plus post-quantum guardian-key protection | Inherited from ElectionGuard (DKG) | Blockchain anchoring only — no reported sparse-Merkle-tree or non-membership-proof mechanism | Not separately anchored |
| **CONIKS-family authenticated dictionaries** | Mollakuqe, Dag & Dimitrova, "Mathematical Foundations and Implementation of CONIKS Key Transparency" (MDPI Applied Sciences, 2024), re-derives and formalizes the sparse-Merkle-tree membership/non-membership construction and benchmarks it | N/A | This is where the non-membership technique this project uses actually comes from — applied to key-binding transparency in messaging, not e-voting | N/A |
| **Blockchain e-voting, general** | Vladucu, Dong, Medina & Rojas-Cessa, "E-Voting Meets Blockchain: A Survey" (IEEE Access, 2023); a 2025 Springer systematic literature review, "Articulation of blockchain enabled e-voting systems," surveys 60+ papers — neither identifies a deployed or proposed system using SMT-style non-membership proofs for ballot-set completeness | Varies by surveyed system | Overwhelmingly plain Merkle-root anchoring (membership only) across the surveyed literature — this is the specific gap this project's SMT closes | Not separately anchored, in the surveyed systems |
| **This project** | DLEQ (Chaum-Pedersen) partial-decryption proofs, structurally identical to ElectionGuard's approach | **Feldman VSS + single dealer — not DKG.** Weaker than Belenios and ElectionGuard/REACTIVE here today. See §3. | **Dual-anchored dense tree + sparse Merkle tree**, position-aware hashing, non-membership proofs for deletion-after-anchor detection | **Write-once on-chain commitment** (`ElectionSetupCommitment.sol`) to the exact candidate/constituency set, composed with the ballot-validity ZKP |

## 2. What is genuinely novel here

**Applying CONIKS/Key-Transparency-style authenticated-dictionary non-membership proofs to the
ballot-set-completeness problem in e-voting.** None of Helios, Belenios, Civitas, Selene, or
ElectionGuard — nor AmarVote, the closest 2025 system combining ElectionGuard with a blockchain
layer — use a sparse Merkle tree or any non-membership-proof mechanism for detecting ballot
removal after anchoring. They rely on an *append-only bulletin-board assumption* (Helios/Belenios/
Selene) or *device/prototype-blockchain tracking* (ElectionGuard, AmarVote) — none of these let an
outside observer request a cryptographic proof that a specific, previously-anchored ballot is now
provably absent. This project's SMT (`smt-design.md`), keyed by nullifier hash, chained batch-to-
batch and anchored alongside the dense per-batch tree, gives exactly that: an old membership proof
and a new non-membership proof for the same key are a direct, self-contained contradiction — no
external monitor or trusted auditor needs to have been watching in advance. This is a genuine,
nameable cross-domain application (transparency-log technique → e-voting deletion-completeness) not
found in the voting literature surveyed here.

Framing for the paper: **"non-membership-provable ballot-set completeness via an authenticated
dictionary, composed with per-batch anchoring — closing the gap that append-only bulletin-board
assumptions leave open in Helios-family systems."** This is the sentence to build the abstract
around, not "we built threshold decryption" (§3 explains why that framing would backfire).

**Secondary, smaller contribution: on-chain, write-once candidate/constituency commitment,
composed explicitly with the ballot-validity ZKP.** Every system surveyed treats the candidate list
as fixed deployment configuration. None separately anchor it as its own tamper-evident artifact with
an adversarial-case analysis (substitution, reordering, UUID swap, stale/cross-election replay —
`tally-verifiability-design.md §8.2.4`). This project's `ElectionSetupCommitment.sol` plus the TLV
canonical serialization closes a real gap: "ciphertext X decrypts to UUID Y" (the ZKP's guarantee)
and "UUID Y is genuinely candidate Alice, standing in CON-03" (the commitment's guarantee) compose
into one end-to-end-checkable claim instead of two separately-plausible, unverifiably-linked ones.
Worth a subsection, not the headline.

## 3. What is NOT novel — and one place this project is currently behind, not ahead

**Threshold ElGamal + Chaum-Pedersen-style partial-decryption proofs is exactly ElectionGuard's
approach**, and DLEQ-based threshold decryption more broadly is textbook (Chaum & Pedersen, 1992;
Pedersen, 1991). Do not frame this as a contribution — a reviewer who knows ElectionGuard will read
"we added DLEQ proofs to threshold decryption" as "we reimplemented ElectionGuard's core mechanism."

**More important:** this project's current key-generation trust model — a single dealer runs
`generateKeypair()`, then splits `x` via Feldman VSS — is a **strictly weaker** trust assumption
than what Belenios (Pedersen DKG, deployed in 200+ real elections) and ElectionGuard (guardian-based
DKG, actively researched as of 2024) already provide. Feldman VSS proves share *distribution* was
consistent; it does nothing about the dealer's *generation*-time knowledge of the whole key — a gap
both Belenios and ElectionGuard already close via genuine multi-party DKG. **This is precisely why
DKG is the top-priority fix from the earlier gap analysis**, not a nice-to-have: without it, the
paper's "no single trusted authority" claim is behind established prior art on the exact axis a
knowledgeable reviewer will check first. Closing it doesn't create novelty — it removes a real,
citable weakness relative to systems already in the comparison table.

## 4. The one-sentence contribution statement to build the paper around

> This work closes the ballot-set-completeness gap that append-only bulletin-board assumptions
> leave open in Helios-family verifiable voting systems, by adapting CONIKS/Key-Transparency-style
> authenticated-dictionary non-membership proofs to per-election ballot anchoring — composed with a
> write-once on-chain candidate-set commitment and (once DKG lands) a distributed-trust threshold-
> decryption pipeline structurally aligned with, rather than weaker than, ElectionGuard and Belenios.

## 5. Immediate implications for the paper's structure

1. **Abstract/intro** should lead with the SMT/non-membership contribution (§2), not threshold
   decryption — that's the actual novel axis.
2. **Related work section** should explicitly name Helios, Belenios, Civitas/JCJ, Selene,
   ElectionGuard, and AmarVote, with the completeness-mechanism comparison from §1's table as the
   centerpiece — this is the single strongest evidence of positioning, cite it directly.
3. **Threat model / limitations section** should state the Feldman-VSS-vs-DKG gap explicitly and
   cite Belenios/ElectionGuard as the bar to clear (already partially done in
   `tally-verifiability-design.md §2.1/§11` and `threat_model.md`) — reframe as "matching, not yet
   exceeding, established trust models on this axis" rather than an open research question.
4. Do **not** claim coercion-resistance comparison against Civitas/Selene — this project's explicit
   non-goal (`threat_model.md §8`) is correctly scoped as a stated boundary; citing Selene's
   deniable-tracker mechanism as "future work we deliberately didn't attempt, and why" is honest and
   sufficient, not a gap to close for this paper.

## Sources consulted

All 2020–2026, per the scope of this document.

- Benaloh et al., [ElectionGuard: a Cryptographic Toolkit to Enable Verifiable Elections](https://eprint.iacr.org/2024/955.pdf) (USENIX Security 2024 / IACR ePrint 2024/955)
- [REACTIVE: Rethinking Effective Approaches Concerning Trustees in Verifiable Elections](https://eprint.iacr.org/2024/915.pdf) (IACR ePrint 2024/915)
- Baloglu, Bursuc, Mauw & Pang, [Election Verifiability Revisited: Automated Security Proofs and Attacks on Helios and Belenios](https://eprint.iacr.org/2020/982) (IEEE CSF 2021)
- Baloglu, Bursuc, Mauw & Pang, [Provably Improving Election Verifiability in Belenios](https://eprint.iacr.org/2021/1201) (IACR ePrint 2021/1201)
- Cortier, Gaudry & Glondu, "Features and usage of Belenios in 2022" (E-Vote-ID 2022)
- ["Belenios with Cast as Intended"](https://link.springer.com/chapter/10.1007/978-3-031-48806-1_1) (2023/2024)
- Drăgan, Dupressoir, Estaji, Gjøsteen, Haines, Ryan, Rønne & Solberg, [Machine-Checked Proofs of Privacy Against Malicious Boards for Selene & Co](https://eprint.iacr.org/2022/1182) (IEEE CSF 2022)
- Gjøsteen, Haines & Solberg, [Coercion Mitigation for Voting Systems with Trackers: A Selene Case Study](https://eprint.iacr.org/2023/1102.pdf) (IACR ePrint 2023/1102)
- Cortier, Gaudry & Yang, [Is the JCJ voting system really coercion-resistant?](https://eprint.iacr.org/2022/430.pdf) (IACR ePrint 2022/430)
- [AmarVote: A Web-Based ElectionGuard System with Post-Quantum Guardian Key Protection and Blockchain Auditing](https://dl.acm.org/doi/10.1145/3777555.3777570) (NSysS 2025)
- Vladucu, Dong, Medina & Rojas-Cessa, "E-Voting Meets Blockchain: A Survey," IEEE Access 11 (2023), pp. 23293–23308
- "Articulation of blockchain enabled e-voting systems: a systematic literature review," Peer-to-Peer Networking and Applications (Springer, 2025)
- Mollakuqe, Dag & Dimitrova, [Mathematical Foundations and Implementation of CONIKS Key Transparency](https://www.mdpi.com/2076-3417/14/21/9725), Applied Sciences 14(21):9725 (MDPI, 2024)

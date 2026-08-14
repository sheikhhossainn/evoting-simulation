# Reproducible Experiment Snapshot — 2026-08-14

Frozen evidence from the first fully clean, end-to-end run of the verifiable-tally system
against a fresh batch, after the methodology-audit fixes (C1/C2, M1–M3, m1–m3) described in
[tally-verifiability-implementation-report.md](../tally-verifiability-implementation-report.md).
Companion to that report — this directory holds the raw artifacts, not prose.

## What this proves

An independent observer, given only [`verification-bundle-batch3-2026-08-14.json`](./verification-bundle-batch3-2026-08-14.json)
and public Sepolia RPC access, can reproduce [`verifier-output-batch3-2026-08-14.txt`](./verifier-output-batch3-2026-08-14.txt)
exactly — `ALL CHECKS PASSED`, all 11 checks, no admin access, no secret key material, no
cooperation from the backend beyond the published bundle.

## Live parameters

| | |
|---|---|
| Election | `NATIONAL-2026-001` |
| Dense batch | `batch_id=3`, root `0xe4172130e3bdb08f6f9cad7644b6ad99e027bd96ca8f02debec5632407e0883e` |
| SMT batch | `smt_batch_id=4`, root `0x883ff73a246abfe64b4a8fe2c56f4baf0e1497318bb4f5adb0180f8e6e89908f`, `total_keys_anchored=38` |
| `MerkleRootStorage.sol` | `0x4b5C381c62876d34bBDDefDe02e872E5a93401b6` (Sepolia) |
| `ElectionSetupCommitment.sol` | `0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C` (Sepolia) |
| Election setup commitment | `0x5650d923b8308d482cd3d7de0ddc3c164525a5e087049b8272bc314b224affa8` |
| Keyholders submitting | KH-001 (Election Commission), KH-002 (Judiciary Observer), KH-003 (Academic Auditor) — real shares, submitted client-side via the Key Holder Portal |
| Ballots | 3 real votes, cast through the live frontend (NIDs `10001234567`/`10091234567`/`10101234567`, CON-01/02/03) |

## Published tally result (`POST /keyshares/tally`)

```json
{
  "total_votes": 3, "valid_votes": 3, "invalid_votes": 0,
  "results": [
    { "constituency_code": "CON-01", "candidates": [{ "name": "Mahmudul Hasan", "party": "Civic Coalition", "votes": 1 }] },
    { "constituency_code": "CON-02", "candidates": [{ "name": "Arif Islam", "party": "Unity Front", "votes": 1 }] },
    { "constituency_code": "CON-03", "candidates": [{ "name": "Sajeda Chowdhury", "party": "Unity Front", "votes": 1 }] }
  ]
}
```

## Independent verifier result

```
[PASS] 1. on-chain batch existence + root check
[PASS] 1b. on-chain SMT batch root + total_keys_anchored check
[PASS] 1c. per-ballot SMT membership proof verification — 3 valid, 0 invalid/missing
[PASS] 2. dense root rebuild
[PASS] 2a. candidate/constituency commitment (recomputed vs bundle)
[PASS] 2a. candidate/constituency commitment (recomputed vs on-chain)
[PASS] 3. completeness cross-check — total_keys_anchored=38, independently_observed_vote_count=39
[PASS] 4. DLEQ proof verification — 9 valid, 0 invalid
[PASS] 5. independent recount — 3 valid, 0 rejections
[PASS] 6. diff vs published_results — recounted 3 vs published 3
ALL CHECKS PASSED
```

Steps 1b and 1c are new this session (methodology-audit finding M1's follow-up) — this is the
first bundle/run that exercises them for real, not just in unit tests.

## Reproducing this independently

```
npx ts-node --transpile-only src/scripts/independent-verify-tally.ts \
  docs/evidence/verification-bundle-batch3-2026-08-14.json \
  --merkle-address 0x4b5C381c62876d34bBDDefDe02e872E5a93401b6 \
  --setup-address 0xf6354205CB4FCE5b80DF01FaC650FDA29a94079C \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

No `backend/.env`, no database, no admin secret required — only the bundle file and a public RPC.

## What this run does NOT establish

Same limitations as stated throughout the design docs, unaffected by this run:
- Pre-anchor omission (docs §8.1) — bounded, non-cryptographic completeness check only.
- Dealer trust for key generation (Feldman VSS ≠ DKG) — explicit, undissolved assumption.
- Batch 2 (32 votes, ~80% test/fixture contamination) remains untouched and unusable for a real
  tally, exactly as decided earlier this session — this evidence snapshot uses batch 0 (2 votes,
  original real tally) and batch 3 (3 votes, this run) only.

## Test suite state at this snapshot

Full backend suite: 164 passed, 2 skipped (the 2 skipped files require a separate `.env.test`
Supabase project that has not yet been provisioned — fails closed by design, does not touch
production). Full Hardhat suite unaffected (no contract changes this session).

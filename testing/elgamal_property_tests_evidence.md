# ElGamal Property-Based Test Evidence (Task 8A)

Run at: 2026-07-25T01:22:07Z

Command: `npm test --prefix backend` (vitest 4.1.10 + fast-check 4.9.0)

## Summary

| Category | Test | Iterations | Status |
|---|---|---|---|
| Smoke test (Commit 1) | round-trips a candidate UUID through encryptCandidateId/decryptCandidateId | 1 | ✅ PASS |
| Homomorphism | decrypt(enc(a) · enc(b)) == (a * b) mod p | 10,000 | ✅ PASS |
| Round-trip | round-trips random candidate UUIDs | 10,000 | ✅ PASS |
| Round-trip (edge case) | round-trips the minimum candidate id (all-zero UUID) | 1 | ✅ PASS |
| Round-trip (edge case) | round-trips the maximum candidate id (all-f UUID) | 1 | ✅ PASS |
| Re-encryption uniqueness | 10k encryptions of the same candidate id never collide | 10,000 | ✅ PASS |
| Robustness fuzz | never hangs or throws an unhandled crash on arbitrary garbage ciphertext strings | 10,000 | ✅ PASS |
| Robustness (edge case) | handles c1 ≡ 0 mod p without throwing | 1 | ✅ PASS |
| Robustness (edge case) | handles an out-of-range c2 (> p) without throwing | 1 | ✅ PASS |

**9/9 tests passed. Total duration: 25.04s.**

## Notes on deviations from the original spec (agreed with reviewer before implementation)

- **Homomorphism is multiplicative, not additive.** `elgamal.ts` implements textbook ElGamal (no exponential/`g^m` encoding), so combining two ciphertexts component-wise yields `decrypt(enc(a)·enc(b)) == a*b mod p`, not `a+b`. Verified against the real property instead of the originally-specified (incorrect for this scheme) additive one. The production tally flow (`POST /keyshares/tally`) decrypts every vote individually rather than combining ciphertexts, so this property — while real — isn't something the current system relies on operationally.
- **Category 4 reframed as no-crash robustness fuzzing.** `decrypt`/`decryptCandidateId` perform no range or group-membership validation, so nothing is actually "rejected" by the code. The fuzz test instead asserts every malformed input either throws a catchable `Error` or returns a string, never hanging or producing an unhandled crash. Two fixed cases document current degenerate behavior: `c1 ≡ 0 mod p` and oversized `c2 > p` both return silently without throwing (no group-membership or range check exists in this implementation) — noted for the crypto owner (Nabiha), not something this test commit changes.

## Raw output

```
> backend@1.0.0 test
> vitest run


 RUN  v4.1.10 D:/From The C drive/Capstone_project/evoting-simulation/backend


 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  01:22:07
   Duration  25.04s (transform 52ms, setup 0ms, import 105ms, tests 24.63s, environment 0ms)
```

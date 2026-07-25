# ElGamal Property-Based Test Evidence (Task 8A)

## Run History

### Run 2 (fix commit) — 2026-07-25T15:05:43Z

Command: `npx vitest run --reporter=verbose` (vitest 4.1.10 + fast-check 4.9.0)

| Category | Test | Iterations | Status |
|---|---|---|---|
| Smoke test | round-trips a candidate UUID through encryptCandidateId/decryptCandidateId | 1 | ✅ PASS |
| Homomorphism | decrypt(enc(a) · enc(b)) == (a * b) mod p | 10,000 | ✅ PASS |
| Round-trip | round-trips random candidate UUIDs | 10,000 | ✅ PASS |
| Round-trip (edge) | round-trips the minimum candidate id (all-zero UUID) | 1 | ✅ PASS |
| Round-trip (edge) | round-trips the maximum candidate id (all-f UUID) | 1 | ✅ PASS |
| Re-encryption uniqueness | 10k encryptions of the same candidate id never collide | 10,000 | ✅ PASS |
| **Rejection** | **rejects non-hex garbage in c1 or c2** | **10,000** | **✅ PASS** |
| **Rejection** | **rejects c1 ≡ 0 (not in Z\*\_p)** | **1** | **✅ PASS** |
| **Rejection** | **rejects out-of-range c2 (≥ p)** | **1** | **✅ PASS** |
| **Rejection** | **rejects non-quadratic-residue c1 (subgroup check)** | **1** | **✅ PASS** |
| **Rejection** | **rejects empty string c1** | **1** | **✅ PASS** |

**11/11 tests passed. Total duration: 24.01s.**

#### Changes from Run 1

1. **`findGenerator` now returns a subgroup generator.** Previously returned a generator of the full Z\*\_p (order p-1); now squares it to get a generator of the prime-order subgroup (order q, quadratic residues only). This ensures `c1 = g^k mod p` is always a QR and passes the subgroup membership check on decryption.

2. **`decryptCandidateId` now validates ciphertext inputs:**
   - Rejects non-hex strings (garbage c1/c2)
   - Rejects c1 = 0 or c1 ≥ p (out of Z\*\_p)
   - Rejects c2 ≥ p (out of range)
   - Rejects c1 that is not a quadratic residue mod p (non-subgroup member)

3. **c2 = 0 allowed.** Encrypting `m = 0` (all-zero UUID) legitimately produces `c2 = 0 · y^k mod p = 0`. Validation allows `c2 ∈ [0, p-1]`.

4. **Tests updated from "robustness fuzzing" to proper rejection assertions.** Previous tests only checked that garbage inputs don't crash; now they assert `Error` is thrown with descriptive messages.

#### Raw output (Run 2)

```
 RUN  v4.1.10 D:/Coding/evoting-simulation/backend

 ✓ src/crypto/elgamal.test.ts > elgamal > round-trips a candidate UUID through encryptCandidateId/decryptCandidateId 8ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > homomorphism > decrypt(enc(a) · enc(b)) == (a * b) mod p, over 10k random pairs 9245ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > encrypt -> decrypt round-trip > round-trips random candidate UUIDs 9346ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > encrypt -> decrypt round-trip > round-trips the minimum candidate id (all-zero UUID) 1ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > encrypt -> decrypt round-trip > round-trips the maximum candidate id (all-f UUID) 2ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > re-encryption uniqueness > 10k encryptions of the same candidate id never collide 4065ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > malformed/out-of-group ciphertext rejection > rejects non-hex garbage in c1 or c2 (10k random string pairs) 1031ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > malformed/out-of-group ciphertext rejection > rejects c1 ≡ 0 (not in Z*_p) 1ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > malformed/out-of-group ciphertext rejection > rejects out-of-range c2 (≥ p) 1ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > malformed/out-of-group ciphertext rejection > rejects non-quadratic-residue c1 (not in prime-order subgroup) 3ms
 ✓ src/crypto/elgamal.test.ts > elgamal property-based tests > malformed/out-of-group ciphertext rejection > rejects empty string c1 0ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  21:05:43
   Duration  24.01s (transform 43ms, setup 0ms, import 85ms, tests 23.74s, environment 0ms)
```

---

### Run 1 (original) — 2026-07-25T01:22:07Z

Command: `npm test --prefix backend` (vitest 4.1.10 + fast-check 4.9.0)

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

#### Notes on deviations from the original spec (agreed with reviewer before implementation)

- **Homomorphism is multiplicative, not additive.** `elgamal.ts` implements textbook ElGamal (no exponential/`g^m` encoding), so combining two ciphertexts component-wise yields `decrypt(enc(a)·enc(b)) == a*b mod p`, not `a+b`. Verified against the real property instead of the originally-specified (incorrect for this scheme) additive one. The production tally flow (`POST /keyshares/tally`) decrypts every vote individually rather than combining ciphertexts, so this property — while real — isn't something the current system relies on operationally.
- **Category 4 reframed as no-crash robustness fuzzing.** `decrypt`/`decryptCandidateId` perform no range or group-membership validation, so nothing is actually "rejected" by the code. The fuzz test instead asserts every malformed input either throws a catchable `Error` or returns a string, never hanging or producing an unhandled crash. Two fixed cases document current degenerate behavior: `c1 ≡ 0 mod p` and oversized `c2 > p` both return silently without throwing (no group-membership or range check exists in this implementation) — noted for the crypto owner (Nabiha), not something this test commit changes.

#### Raw output (Run 1)

```
> backend@1.0.0 test
> vitest run


 RUN  v4.1.10 D:/From The C drive/Capstone_project/evoting-simulation/backend


 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  01:22:07
   Duration  25.04s (transform 52ms, setup 0ms, import 105ms, tests 24.63s, environment 0ms)
```

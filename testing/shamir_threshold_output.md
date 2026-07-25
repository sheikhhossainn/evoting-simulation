# Shamir Threshold Matrix + Concurrency Stress + TC-KEY-002 — Run Output

Branch: `feature/shamir-threshold-matrix` (off `dev`)
Framework: vitest 4.1.10

## 1. Shamir Threshold Matrix (`backend/src/crypto/shamir.test.ts`)

Command: `npx vitest run src/crypto/shamir.test.ts`

**Result: Test Files 1 passed (1) — Tests 27 passed (27)**

### Coverage
- **Full combinatorial** — all C(4,3)=4 valid three-share triples reconstruct the
  SAME secret (each triple asserted individually + `new Set(results).size === 1`).
- **Zero key material below threshold** — all C(4,2)=6 two-share subsets:
  - `reconstructKey()` throws (guard is real), AND
  - raw `secrets.combine(pair)` never equals the original secret
    (asserted at the math level, not just "API returns 400").
- **Corrupted share fails loud** — a tampered share (last 4 hex chars flipped)
  never silently yields the correct secret (throws OR returns a wrong value).
- **Order independence** — 5 distinct orderings + all 6 permutations of one
  triple all reconstruct the identical secret.

## 2. Concurrency Stress (`backend/src/routes/vote.test.ts`)

Deepened the double-cast test from 2 racing requests to **N=50 simultaneous
casts** for the same voter, repeated over **3 trials**. Each trial asserts:
- exactly `1` request returns 201 (success),
- exactly `N-1` (49) requests are rejected with 403/409,
- exactly `1` DB row exists for the nullifier.

Per-trial evidence is written to `testing/concurrency_stress_output.json` when the
suite runs against a live server + Supabase.

## 3. TC-KEY-002 Fix (`backend/src/routes/keyshares.ts`)

Tightened the `share_value` Zod schema:

```
- share_value: z.string().min(1, "share_value is required"),
+ share_value: z
+   .string()
+   .min(64, "share_value is required")
+   .regex(/^[0-9a-f]+$/, "share_value must be a lowercase hex share string"),
```

Direct schema verification:

| input        | result  |
|--------------|---------|
| valid share  | ACCEPT  |
| `"!!!!"`     | REJECT  |
| `"hello"`    | REJECT  |
| `"ABCDEF"`   | REJECT  |
| `""`         | REJECT  |
| `"abc"`      | REJECT  |

Garbage now returns **400** at the schema boundary instead of 201/500.

## Build

`npx tsc --noEmit` — clean, no errors.

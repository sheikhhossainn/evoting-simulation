# @evoting/core-crypto (P4)

Pure-TypeScript client-side ballot crypto for the mobile app, ported from the
web client (`frontend/src/utils/elgamal.ts`) so the app can build
**byte-identical** ballots.

## What this provides

| Export | Purpose |
|---|---|
| `createClientElGamal(primitives)` | Factory: inject the platform primitives, get the client prover |
| `encryptCandidateId` | Cast path without a proof (parity with the web client) |
| `encryptCandidateIdForAudit` | Benaloh cast-or-audit: returns ciphertext **and** the revealed randomness |
| `verifyEncryptedCandidateId` | Benaloh audit verification from `(candidate, r, pubkey)` |
| `encryptCandidateIdWithProof` | Cast path: ElGamal encryption + Chaum–Pedersen disjunctive OR-proof (CDS94 + Fiat–Shamir), in one call |
| `fiatShamirPreimage` | The exact transcript builder, exported so tests assert the literal string |
| `modPow`, `modInverse`, `encodeCandidateId`, `hexToBigInt`, `bigIntToHex`, `bytesToHex` | Ported helpers |

## Design decision: platform primitives are injected, not re-implemented

`ClientCryptoPrimitives` is the only platform dependency:

```ts
interface ClientCryptoPrimitives {
  randomBytes(length: number): Uint8Array;   // OS/hardware CSPRNG
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
}
```

Rationale (recorded, not implicit): the web client used `crypto.getRandomValues`
and `crypto.subtle.digest`. Rather than hand-rolling SHA-256 — which would add
implementation risk for zero benefit — the mobile app supplies an audited,
OS-backed primitive (expo-crypto adapter, P5 task). **What must stay
byte-for-byte identical is the transcript** built by `fiatShamirPreimage()`
(minimal lowercase hex, comma-joined, order `g ‖ y ‖ c1 ‖ c2 ‖ a_0 ‖ b_0 ‖ …`),
because the backend recomputes it in `backend/src/crypto/zkp.ts`. That is what
the tests assert.

`src/index.ts` deliberately exports **no adapter**, so `node:crypto` can never
reach the mobile bundle. Tests import `src/adapters/node.ts` directly.

## Tests

13 tests, all passing (`src/elgamal.test.ts`):

- SHA-256 adapter vs the FIPS 180-4 `"abc"` vector.
- The transcript's literal string, and minimal-hex (no padding / `0x`) behaviour.
- **Port equivalence:** proofs from this prover are accepted by the *unchanged*
  backend verifier (`verifyBallotValidity`) for **every candidate position**,
  under **two independently generated keypairs**, and for a deterministic-RNG
  run — plus request-shape checks (array lengths, lowercase hex).
- **Negative parity:** the backend rejects a tampered response and a set that
  excludes the encrypted candidate.
- Determinism (same seed ⇒ identical proof) and fresh-randomness behaviour
  (50 encryptions never repeat).
- Benaloh: audited ballot verifies; audited ciphertext ≠ fresh cast ciphertext;
  wrong randomness rejected.

## Running the tests

This package is an npm **workspace** of the repository root
(`"workspaces": ["packages/*"]` in the root `package.json`), so a fresh clone
needs exactly one install at the root — no per-package install, no manual
linking:

```bash
npm install                                  # from the repository root
npm test --workspace=packages/core-crypto    # or: npm test -w @evoting/core-crypto
```

This is the same pair of commands the `core-crypto` CI job runs, so the local
and CI paths cannot drift. The committed root `package-lock.json` pins the
workspace's dev dependencies (vitest, typescript, @types/node); the root
`node_modules` — including npm's own link for the workspace member — is
gitignored.

The suite deliberately runs the **backend** verifier in-process (it imports
`backend/src/crypto/{elgamal,zkp}.ts` by relative path, the same convention
`blockchain/test` uses for `backend/src/merkle/merkleTree.ts`), so it needs no
database, no chain and no backend dependency install.

## Not yet done (P5)

- Expo adapter (`expo-crypto`) implementing `ClientCryptoPrimitives`.
- Wiring into the mobile app's ballot screen and the `core-api` client.

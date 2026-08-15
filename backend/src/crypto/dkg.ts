/**
 * dkg.ts — Server-side combination step for the distributed key generation
 * (DKG) ceremony (docs/tally-verifiability-design.md-style companion to
 * shamirZq.ts).
 *
 * Each of the 4 keyholders generates their own random polynomial and
 * publishes Feldman commitments to it entirely client-side
 * (frontend/src/pages/KeyCeremony.tsx, frontend/src/utils/dkgCrypto.ts) —
 * the server never sees any private coefficient or share.
 *
 * The ONE thing the server computes is this file's single function:
 * combining the 4 PUBLIC commitment vectors into one combined vector, using
 * the fact that Feldman VSS commitments are additively homomorphic — if
 * F(z) = f_1(z) + f_2(z) + f_3(z) + f_4(z), then F's commitment to
 * coefficient l is the product of each f_i's commitment to coefficient l.
 * This combined vector is exactly what election_key_ceremony.feldman_commitments
 * already stores for the old single-dealer flow — every downstream route
 * (keyshares.ts) consumes it identically either way.
 */

import { modPow } from "./elgamal";
import type { FeldmanCommitments } from "./shamirZq";

/**
 * Combine n dealers' Feldman commitment vectors (all of the same degree t)
 * into the commitment vector for their summed polynomial, elementwise
 * product mod p: combined[l] = Π_i vectors[i][l] mod p.
 */
export function combineFeldmanCommitments(
  vectors: FeldmanCommitments[],
  p: bigint
): FeldmanCommitments {
  if (vectors.length === 0) {
    throw new Error("combineFeldmanCommitments: need at least one commitment vector");
  }
  const degree = vectors[0].length;
  for (const v of vectors) {
    if (v.length !== degree) {
      throw new Error("combineFeldmanCommitments: all commitment vectors must have the same length");
    }
  }

  const combined: bigint[] = [];
  for (let l = 0; l < degree; l++) {
    let product = 1n;
    for (const v of vectors) {
      product = (product * v[l]) % p;
    }
    combined.push(product);
  }
  return combined;
}

/** modPow re-exported for callers that only need this file's combination math. */
export { modPow };

/**
 * shamir.ts — Shamir's Secret Sharing (3-of-4) implementation
 *
 * Uses secrets.js-grempe for the polynomial arithmetic.
 * The ElGamal private key (hex string from .env) is split into 4 shares.
 * Any 3 of the 4 shares can reconstruct the original key.
 *
 * Usage:
 *   splitPrivateKey(hexKey) → string[4]   (the 4 shares)
 *   reconstructKey(shares)  → string      (original hex key)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secrets = require("secrets.js-grempe");

export interface ShamirShares {
  share1: string;
  share2: string;
  share3: string;
  share4: string;
}

/**
 * Split an ElGamal private key into 4 shares (3-of-4 threshold).
 *
 * @param hexKey — The private key as a hex string (from ELGAMAL_PRIVATE_KEY)
 * @returns      — Object with share1..share4
 */
export function splitPrivateKey(hexKey: string): ShamirShares {
  if (!hexKey || hexKey.length === 0) {
    throw new Error("Private key must be a non-empty hex string");
  }

  // secrets.js-grempe expects hex input
  // share(secret, numShares, threshold)
  const shares: string[] = secrets.share(hexKey, 4, 3);

  if (shares.length !== 4) {
    throw new Error(`Expected 4 shares, got ${shares.length}`);
  }

  return {
    share1: shares[0],
    share2: shares[1],
    share3: shares[2],
    share4: shares[3],
  };
}

/**
 * Reconstruct the private key from any 3 (or more) shares.
 *
 * @param shares — Array of 3 or 4 share strings
 * @returns      — The reconstructed private key (hex string)
 */
export function reconstructKey(shares: string[]): string {
  if (shares.length < 3) {
    throw new Error(
      `Need at least 3 shares to reconstruct. Got ${shares.length}`
    );
  }

  const reconstructed: string = secrets.combine(shares);

  if (!reconstructed || reconstructed.length === 0) {
    throw new Error("Reconstruction failed — shares may be invalid or mismatched");
  }

  return reconstructed;
}

/**
 * Verify that reconstruction works correctly.
 * Used in the setup script to confirm the split is valid.
 *
 * @param originalKey — The original hex private key
 * @param shares      — The 4 shares generated from splitPrivateKey
 * @returns           — true if reconstruction matches original
 */
export function verifyReconstruction(
  originalKey: string,
  shares: ShamirShares
): boolean {
  const shareArray = [
    shares.share1,
    shares.share2,
    shares.share3,
    shares.share4,
  ];

  // Test all 4 possible combinations of 3-of-4
  const combinations = [
    [shareArray[0], shareArray[1], shareArray[2]], // shares 1+2+3
    [shareArray[0], shareArray[1], shareArray[3]], // shares 1+2+4
    [shareArray[0], shareArray[2], shareArray[3]], // shares 1+3+4
    [shareArray[1], shareArray[2], shareArray[3]], // shares 2+3+4
  ];

  for (const combo of combinations) {
    const result = reconstructKey(combo);
    if (result !== originalKey) {
      return false;
    }
  }

  return true;
}

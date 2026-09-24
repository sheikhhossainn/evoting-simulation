/**
 * @evoting/core-crypto — portable client-side ballot crypto.
 *
 * This entry point deliberately exports NO adapter: it must stay free of
 * `node:crypto` (and of any other platform import) so the mobile bundle can
 * never accidentally pull one in. Consumers construct the client with their
 * own primitives:
 *
 *   import { createClientElGamal } from "@evoting/core-crypto";
 *   const crypto = createClientElGamal({ randomBytes, sha256 }); // Expo: expo-crypto
 *
 * Tests and CI scripts import the Node adapter directly from
 * "./adapters/node" instead.
 */
export * from "./elgamal";

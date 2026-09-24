/**
 * adapters/node.ts — Node/CI implementation of the injected primitives.
 *
 * NOT exported from the package index (see index.ts): importing this file
 * pulls in `node:crypto`, which must never reach the mobile bundle. Tests and
 * CI scripts import it explicitly.
 *
 * The mobile app supplies the equivalent from expo-crypto in Phase 5
 * (P5 task); the algorithm code in ../elgamal.ts is identical either way.
 */
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import type { ClientCryptoPrimitives } from "../elgamal";

export const nodeCryptoPrimitives: ClientCryptoPrimitives = {
  randomBytes(length: number): Uint8Array {
    return new Uint8Array(nodeRandomBytes(length));
  },
  async sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(createHash("sha256").update(bytes).digest());
  },
};

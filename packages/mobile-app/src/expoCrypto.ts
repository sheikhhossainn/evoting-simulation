import * as Crypto from "expo-crypto";
import type { ClientCryptoPrimitives } from "@evoting/core-crypto";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Expo adapter: the pure crypto package never imports a platform module. */
export const expoCryptoPrimitives: ClientCryptoPrimitives = {
  randomBytes(length) {
    return Crypto.getRandomBytes(length);
  },
  async sha256(bytes) {
    // The P4 transcript is ASCII. Passing the same byte values as a string
    // preserves the web's UTF-8 digest input without a JS SHA-256 fallback.
    const ascii = String.fromCharCode(...bytes);
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      ascii,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
    return hexToBytes(digest);
  },
};

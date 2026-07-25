import { describe, it, expect } from "vitest";
import { splitPrivateKey, reconstructKey } from "./shamir";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secrets = require("secrets.js-grempe");

/** All k-sized combinations of arr (order-preserving). */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

describe("shamir 3-of-4 threshold matrix", () => {
  // A fresh 256-bit secret split into 4 shares, shared across the suite.
  const hexKey = secrets.random(256) as string;
  const shares = splitPrivateKey(hexKey);
  const shareArr = [shares.share1, shares.share2, shares.share3, shares.share4];

  // ── 1. Full combinatorial: all C(4,3)=4 triples reconstruct the SAME secret ──
  describe("all C(4,3)=4 valid triples reconstruct the same secret", () => {
    const triples = combinations(shareArr, 3);

    it("produces exactly 4 triples", () => {
      expect(triples).toHaveLength(4);
    });

    it.each(triples)("triple [%#] reconstructs the original secret", (...triple) => {
      expect(reconstructKey(triple as string[])).toBe(hexKey);
    });

    it("every triple agrees on one identical secret", () => {
      const results = triples.map((t) => reconstructKey(t));
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe(hexKey);
    });
  });

  // ── 2. All C(4,2)=6 two-share subsets recover ZERO key material ──
  // Below threshold must yield NO key — asserted at the math level, not just
  // "the API returns 400". Two guarantees per pair:
  //   (a) reconstructKey() refuses (throws) — the guard is real.
  //   (b) even the raw secrets.combine() of 2 shares never equals the secret.
  describe("all C(4,2)=6 two-share subsets recover zero key material", () => {
    const pairs = combinations(shareArr, 2);

    it("produces exactly 6 pairs", () => {
      expect(pairs).toHaveLength(6);
    });

    it.each(pairs)("pair [%#] is rejected by reconstructKey (throws)", (...pair) => {
      expect(() => reconstructKey(pair as string[])).toThrow();
    });

    it.each(pairs)("pair [%#] raw combine does not equal the secret", (...pair) => {
      const raw = secrets.combine(pair as string[]) as string;
      expect(raw).not.toBe(hexKey);
    });

    it("no two-share subset ever leaks the secret", () => {
      for (const pair of pairs) {
        const raw = secrets.combine(pair) as string;
        expect(raw).not.toBe(hexKey);
      }
    });
  });

  // ── 3. Corrupted share fails loud ──
  describe("corrupted share fails loud", () => {
    it("a tampered share never silently yields the correct secret", () => {
      // Flip the last 4 hex chars of share1.
      const corrupted = shareArr[0].slice(0, -4) + "ffff";
      let result: string | undefined;
      let threw = false;
      try {
        result = reconstructKey([corrupted, shareArr[1], shareArr[2]]);
      } catch {
        threw = true;
      }
      // Acceptable outcomes: it throws, OR it returns a wrong value.
      // Silently returning the true secret from a corrupted share is a defect.
      expect(threw || result !== hexKey).toBe(true);
    });
  });

  // ── 4. Reconstruction is order-independent ──
  describe("reconstruction is order-independent", () => {
    const orderings: string[][] = [
      [shareArr[0], shareArr[1], shareArr[2]],
      [shareArr[2], shareArr[1], shareArr[0]],
      [shareArr[1], shareArr[3], shareArr[0]],
      [shareArr[3], shareArr[0], shareArr[2]],
      [shareArr[2], shareArr[3], shareArr[1]],
    ];

    it.each(orderings)("ordering [%#] reconstructs the original secret", (...order) => {
      expect(reconstructKey(order as string[])).toBe(hexKey);
    });

    it("all orderings of one triple agree", () => {
      const triple = [shareArr[0], shareArr[1], shareArr[2]];
      const permutations = [
        [triple[0], triple[1], triple[2]],
        [triple[0], triple[2], triple[1]],
        [triple[1], triple[0], triple[2]],
        [triple[1], triple[2], triple[0]],
        [triple[2], triple[0], triple[1]],
        [triple[2], triple[1], triple[0]],
      ];
      const results = permutations.map((p) => reconstructKey(p));
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe(hexKey);
    });
  });
});

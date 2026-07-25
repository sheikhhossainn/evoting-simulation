# Shamir Threshold Matrix + Adversarial Tests
Run at: 2026-07-25T08:55:17.000Z

## 1. Threshold Matrix — all C(4,3)=4 triples
  Triple [1,2,3]: ✅ matches
  Triple [1,2,4]: ✅ matches
  Triple [1,3,4]: ✅ matches
  Triple [2,3,4]: ✅ matches
✅ PASS — All 4 triples reconstruct identical secret

## 2. Two-Share Subsets — all C(4,2)=6 pairs
  Pair [1,2]: threw ✅, raw combine ≠ key ✅
  Pair [1,3]: threw ✅, raw combine ≠ key ✅
  Pair [1,4]: threw ✅, raw combine ≠ key ✅
  Pair [2,3]: threw ✅, raw combine ≠ key ✅
  Pair [2,4]: threw ✅, raw combine ≠ key ✅
  Pair [3,4]: threw ✅, raw combine ≠ key ✅
✅ PASS — All 6 pairs: guard threw + no key material in raw combine

## 3. Corrupted Share
  Corrupted share returned wrong value (did not throw) ✅
✅ PASS — Corrupted share fails loud

## 4. Order Independence
  Order [1,2,3]: ✅ matches
  Order [3,2,1]: ✅ matches
  Order [2,4,1]: ✅ matches
  Order [4,1,3]: ✅ matches
  Order [3,4,2]: ✅ matches
✅ PASS — All orderings reconstruct identical secret

---
Total: 4 passed, 0 failed

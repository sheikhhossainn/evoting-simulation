/**
 * sparseMerkleTree.ts — Sparse Merkle Tree (SMT) for the global, election-scoped
 * authenticated set of nullifier_hash keys.
 *
 * Design reference: docs/smt-design.md. This is a second, ADDITIVE structure —
 * it does not replace the per-batch dense tree in merkleTree.ts, which keeps
 * answering "was this ballot in this batch, unmodified?" This module answers
 * "is this nullifier a member of the complete ballot set as of this anchor,
 * or can I get a proof that it is NOT?"
 *
 * Key space: 256 bits (raw nullifier_hash, used as-is, no re-derivation).
 * Fixed depth: 256. Path convention: MSB-first — bit 255 branches at the
 * root, bit 0 branches into the leaf (docs/smt-design.md §3).
 *
 * Internal-node hashing is POSITION-AWARE (keccak256(left‖right), no sorting)
 * — deliberately NOT the dense tree's commutative hashPair(). This was found
 * necessary during adversarial testing (docs/smt-design.md §6.1): with
 * commutative pairing, a non-membership proof's (bitmap, siblings) never
 * actually depends on the claimed key, so a real absence proof for one key
 * could be relabeled as "proof" that a completely different key — including
 * an actual member — is absent. Position-aware pairing forces the sibling
 * sequence to match the claimed key's specific bit-path, closing that gap.
 * See regression test "K1's absence proof cannot be relabeled as K2" in
 * sparseMerkleTree.test.ts.
 *
 * leaf-content hashing (hashVoteLeaf) is still reused unchanged from
 * merkleTree.ts (docs/smt-design.md §5).
 *
 * IMPORTANT (see docs/smt-design.md §8): this structure detects deletion of a
 * key ONLY after that key has been anchored at least once. Deletion of a vote
 * row before its key ever enters the SMT (the pre-commitment-window gap) is
 * NOT covered by this module or by any mechanism in this codebase.
 */

import { ethers } from "ethers";

interface Leaf {
  key: bigint;
  keyHex: string;
  value: string;
}

/**
 * Position-aware internal-node hash: keccak256(left ‖ right), NOT sorted.
 * Used only within the SMT (the dense tree keeps its own commutative
 * hashPair unchanged) — see the module-level comment for why this must be
 * order-sensitive rather than reusing merkleTree.ts's hashPair.
 */
function smtNodeHash(left: string, right: string): string {
  return ethers.keccak256(ethers.concat([left, right]));
}

/** bit `levelFromLeaf` of key: 0 = bit nearest the leaf, 255 = bit nearest the root */
function bitAt(key: bigint, levelFromLeaf: number): 0 | 1 {
  return Number((key >> BigInt(levelFromLeaf)) & 1n) as 0 | 1;
}

/** Normalize a hex string to a lowercase, 0x-prefixed, exactly-32-byte value */
function normalizeHex32(hex: string): string {
  const prefixed = hex.startsWith("0x") || hex.startsWith("0X") ? hex : `0x${hex}`;
  const bytes = ethers.getBytes(prefixed);
  if (bytes.length !== 32) {
    throw new Error(`SMT expects a 32-byte value, got ${bytes.length} bytes`);
  }
  return ethers.hexlify(bytes).toLowerCase();
}

/**
 * Default (empty-subtree) hash table, H[0..256].
 * H[0]   = keccak256(0x00)                    — canonical empty-leaf marker
 * H[i]   = smtNodeHash(H[i-1], H[i-1])         for i = 1..256
 * H[256] = root of the fully empty tree (the genesis root)
 *
 * Numerically identical to the values a commutative pairing would have
 * produced (both operands are equal at every level, so order never mattered
 * here) — the position-aware fix (see module comment) only changes results
 * when the two operands DIFFER, which never happens while building this
 * table, so GENESIS_ROOT / EMPTY_TREE_ROOT did not need to change.
 */
export const DEFAULT_HASHES: readonly string[] = (() => {
  const table: string[] = new Array(257);
  table[0] = ethers.keccak256("0x00");
  for (let i = 1; i <= 256; i++) {
    table[i] = smtNodeHash(table[i - 1], table[i - 1]);
  }
  return table;
})();

/** Root of the empty SMT — required `previousRoot` for the first anchored batch */
export const GENESIS_ROOT = DEFAULT_HASHES[256];

/**
 * Occupied-leaf hash: keccak256(0x01 ‖ key ‖ value).
 * `value` is expected to already be a content hash (e.g. the dense tree's
 * hashVoteLeaf output) — this function does not compute vote content hashing
 * itself, it only binds a key to whatever value hash the caller supplies.
 * The 0x01 prefix domain-separates leaves from the 0x00 empty marker and
 * from unprefixed internal-node hashes.
 */
export function leafHash(keyHex: string, valueHex: string): string {
  const key = normalizeHex32(keyHex);
  const value = normalizeHex32(valueHex);
  return ethers.keccak256(ethers.concat(["0x01", key, value]));
}

function bitmapBitsToHex(bits: (0 | 1)[]): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 256; i++) {
    if (bits[i]) bytes[Math.floor(i / 8)] |= 1 << i % 8;
  }
  return ethers.hexlify(bytes);
}

function hexToBitmapBits(hex: string): (0 | 1)[] {
  const bytes = ethers.getBytes(normalizeHex32(hex));
  const bits: (0 | 1)[] = new Array(256).fill(0);
  for (let i = 0; i < 256; i++) {
    bits[i] = ((bytes[Math.floor(i / 8)] >> i % 8) & 1) as 0 | 1;
  }
  return bits;
}

export interface SmtMembershipProof {
  key: string;
  value: string;
  bitmap: string;
  siblings: string[];
}

export interface SmtNonMembershipProof {
  key: string;
  bitmap: string;
  siblings: string[];
}

/** Verification algorithm from docs/smt-design.md §11 — shared by membership and non-membership. */
function verifyAgainstRoot(
  root: string,
  keyHex: string,
  value: string | null,
  bitmapHex: string,
  siblings: string[]
): boolean {
  let keyBig: bigint;
  let bitmapBits: (0 | 1)[];
  try {
    keyBig = BigInt(normalizeHex32(keyHex));
    bitmapBits = hexToBitmapBits(bitmapHex);
  } catch {
    return false;
  }

  let current = value !== null ? leafHash(keyHex, value) : DEFAULT_HASHES[0];
  let siblingIdx = 0;

  for (let level = 0; level <= 255; level++) {
    let sibling: string;
    if (bitmapBits[level] === 1) {
      if (siblingIdx >= siblings.length) return false;
      sibling = siblings[siblingIdx++];
    } else {
      sibling = DEFAULT_HASHES[level];
    }
    // Position-aware: `current` is the left child if this key's bit is 0,
    // the right child if 1 — this is what binds the sibling sequence to the
    // SPECIFIC claimed key (see module comment / docs/smt-design.md §6.1).
    const bit = bitAt(keyBig, level);
    current = bit === 0 ? smtNodeHash(current, sibling) : smtNodeHash(sibling, current);
  }

  if (siblingIdx !== siblings.length) return false; // reject proofs with extra, unused siblings
  return current.toLowerCase() === root.toLowerCase();
}

export function verifySmtMembershipProof(root: string, proof: SmtMembershipProof): boolean {
  return verifyAgainstRoot(root, proof.key, proof.value, proof.bitmap, proof.siblings);
}

export function verifySmtNonMembershipProof(root: string, proof: SmtNonMembershipProof): boolean {
  return verifyAgainstRoot(root, proof.key, null, proof.bitmap, proof.siblings);
}

/**
 * In-memory Sparse Merkle Tree over the current set of occupied keys.
 *
 * Internally keyed by a sparse node cache — `nodeCache["<depth>:<prefixHex>"]`
 * holds the hash of the (non-default) subtree rooted at `depth` levels below
 * the root, for the ancestor-prefix `prefix` of some occupied key. `depth`
 * runs 0 (root) .. 255 (the level directly above the leaves); the leaf level
 * itself (depth 256) is derived on the fly from `leaves`, not cached.
 *
 * insert()/delete() walk exactly one 256-level path bottom-up, recomputing
 * and re-caching every ancestor hash along that path — this is the O(256)
 * path-local update docs/smt-design.md §8 specifies, not a full rebuild.
 * root()/getMembershipProof()/getNonMembershipProof() are then O(256) reads
 * from the cache, independent of how many keys are in the tree.
 */
export class SparseMerkleTree {
  private leaves = new Map<string, Leaf>();
  private nodeCache = new Map<string, string>();
  private rootHash: string = GENESIS_ROOT;

  private nodeKey(depth: number, prefix: bigint): string {
    return `${depth}:${prefix.toString(16)}`;
  }

  /** Hash of the subtree rooted `depth` levels below the tree root, for ancestor-prefix `prefix` */
  private getNode(depth: number, prefix: bigint): string {
    return this.nodeCache.get(this.nodeKey(depth, prefix)) ?? DEFAULT_HASHES[256 - depth];
  }

  private setNode(depth: number, prefix: bigint, hash: string): void {
    const key = this.nodeKey(depth, prefix);
    if (hash === DEFAULT_HASHES[256 - depth]) {
      this.nodeCache.delete(key); // keep the cache sparse; also cleans up after deletion
    } else {
      this.nodeCache.set(key, hash);
    }
  }

  /** Recompute and re-cache every ancestor hash on keyBig's path, given the new leaf-level hash */
  private recomputePathToRoot(keyBig: bigint, newLeafHash: string): void {
    let current = newLeafHash;
    for (let depth = 255; depth >= 0; depth--) {
      const childPrefix = keyBig >> BigInt(256 - (depth + 1)); // this key's ancestor-prefix at depth+1
      const siblingPrefix = childPrefix ^ 1n; // the other child of the same parent
      const siblingHash = this.getNode(depth + 1, siblingPrefix);
      const levelFromLeaf = 255 - depth;
      const bit = bitAt(keyBig, levelFromLeaf); // 0 = current is the left child, 1 = right child
      current = bit === 0 ? smtNodeHash(current, siblingHash) : smtNodeHash(siblingHash, current);
      const parentPrefix = childPrefix >> 1n; // == this key's ancestor-prefix at `depth`
      this.setNode(depth, parentPrefix, current);
    }
    this.rootHash = current;
  }

  insert(keyHex: string, valueHex: string): void {
    const norm = normalizeHex32(keyHex);
    const value = normalizeHex32(valueHex);
    const keyBig = BigInt(norm);
    this.leaves.set(norm, { key: keyBig, keyHex: norm, value });
    this.recomputePathToRoot(keyBig, leafHash(norm, value));
  }

  delete(keyHex: string): void {
    const norm = normalizeHex32(keyHex);
    if (!this.leaves.has(norm)) return;
    const keyBig = BigInt(norm);
    this.leaves.delete(norm);
    this.recomputePathToRoot(keyBig, DEFAULT_HASHES[0]);
  }

  has(keyHex: string): boolean {
    return this.leaves.has(normalizeHex32(keyHex));
  }

  size(): number {
    return this.leaves.size;
  }

  root(): string {
    return this.rootHash;
  }

  /** Bottom-up bitmap + non-default siblings along keyBig's path — shared by both proof types */
  private buildProofBits(keyBig: bigint): { bitmap: string; siblings: string[] } {
    const bitmapBits: (0 | 1)[] = new Array(256).fill(0);
    const siblings: string[] = [];
    for (let depth = 255; depth >= 0; depth--) {
      const childPrefix = keyBig >> BigInt(256 - (depth + 1));
      const siblingPrefix = childPrefix ^ 1n;
      const siblingHash = this.getNode(depth + 1, siblingPrefix);
      const levelFromLeaf = 255 - depth; // depth=255 (nearest leaf) -> levelFromLeaf=0
      const isDefault = siblingHash === DEFAULT_HASHES[256 - (depth + 1)];
      bitmapBits[levelFromLeaf] = isDefault ? 0 : 1;
      if (!isDefault) siblings.push(siblingHash);
    }
    return { bitmap: bitmapBitsToHex(bitmapBits), siblings };
  }

  getMembershipProof(keyHex: string): SmtMembershipProof {
    const norm = normalizeHex32(keyHex);
    const leaf = this.leaves.get(norm);
    if (!leaf) {
      throw new Error("SMT: key is not present — use getNonMembershipProof");
    }
    const { bitmap, siblings } = this.buildProofBits(leaf.key);
    return { key: norm, value: leaf.value, bitmap, siblings };
  }

  getNonMembershipProof(keyHex: string): SmtNonMembershipProof {
    const norm = normalizeHex32(keyHex);
    if (this.leaves.has(norm)) {
      throw new Error("SMT: key is present — use getMembershipProof");
    }
    const keyBig = BigInt(norm);
    const { bitmap, siblings } = this.buildProofBits(keyBig);
    return { key: norm, bitmap, siblings };
  }
}

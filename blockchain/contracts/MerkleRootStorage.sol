// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title MerkleRootStorage
/// @notice Anchors the Merkle root of each confirmed-vote batch on-chain.
/// The backend computes the root off-chain (see backend/src/merkle) from a
/// batch of encrypted, immutable vote rows and submits it here. Anyone can
/// later prove a specific vote was included in an anchored batch via
/// `verify`, without ever revealing the vote's plaintext content.
contract MerkleRootStorage is Ownable {
    struct Batch {
        bytes32 root;
        uint256 voteCount;
        uint256 timestamp;
    }

    /// @dev electionId => batchId => Batch. batchId is assigned sequentially
    /// starting at 0, INDEPENDENTLY per electionId — each election has its
    /// own batch counter, so two elections anchoring concurrently never
    /// collide or interleave. Multi-election isolation (threat_model.md §10):
    /// electionId is caller-supplied and not validated against any registry
    /// here (this contract has no concept of "known elections") — the
    /// backend's `elections` table is the source of truth for which
    /// electionId strings are legitimate; this contract only guarantees that
    /// whatever electionId is used, its batches/roots never mix with any
    /// other electionId's.
    mapping(string => mapping(uint256 => Batch)) public batches;

    /// @notice Total number of batches anchored so far, per election.
    mapping(string => uint256) public batchCount;

    event BatchAnchored(
        string indexed electionId,
        uint256 indexed batchId,
        bytes32 indexed root,
        uint256 voteCount,
        uint256 timestamp
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Anchor a new batch's Merkle root for a specific election. Only
    /// the Election Commission's backend service (the contract owner) may
    /// anchor — anchoring is a write operation that must come from the
    /// trusted tallying pipeline, but verification below is fully public.
    /// @param electionId The election this batch belongs to.
    /// @param root The Merkle root computed off-chain over the batch's vote leaves.
    /// @param voteCount Number of votes included in this batch (for auditability).
    /// @return batchId The sequential id assigned to this batch, scoped to `electionId`.
    function anchorRoot(string calldata electionId, bytes32 root, uint256 voteCount)
        external
        onlyOwner
        returns (uint256 batchId)
    {
        require(bytes(electionId).length > 0, "MerkleRootStorage: electionId cannot be empty");
        require(root != bytes32(0), "MerkleRootStorage: root cannot be zero");
        require(voteCount > 0, "MerkleRootStorage: voteCount must be > 0");

        batchId = batchCount[electionId];
        batches[electionId][batchId] = Batch({
            root: root,
            voteCount: voteCount,
            timestamp: block.timestamp
        });
        batchCount[electionId] += 1;

        emit BatchAnchored(electionId, batchId, root, voteCount, block.timestamp);
    }

    /// @notice Verify that `leaf` was included in the batch identified by
    /// `(electionId, batchId)`.
    /// @param electionId The election the batch belongs to.
    /// @param batchId The batch to check against.
    /// @param leaf The vote's leaf hash (see backend/src/merkle/merkleTree.ts:hashVoteLeaf).
    /// @param proof The Merkle proof (sibling hashes) for `leaf`.
    function verify(
        string calldata electionId,
        uint256 batchId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        require(batchId < batchCount[electionId], "MerkleRootStorage: unknown batchId");
        return MerkleProof.verify(proof, batches[electionId][batchId].root, leaf);
    }

    /// @notice Fetch a batch's stored root, vote count, and anchor timestamp.
    function getBatch(string calldata electionId, uint256 batchId)
        external
        view
        returns (bytes32 root, uint256 voteCount, uint256 timestamp)
    {
        require(batchId < batchCount[electionId], "MerkleRootStorage: unknown batchId");
        Batch storage b = batches[electionId][batchId];
        return (b.root, b.voteCount, b.timestamp);
    }

    // =========================================================================
    // Sparse Merkle Tree (SMT) — cumulative authenticated set of nullifier_hash
    // keys, anchored alongside (not replacing) the per-batch dense tree above.
    // See docs/smt-design.md. Additive only: everything above this line is
    // unchanged from the original dense-tree contract.
    // =========================================================================

    struct SmtBatch {
        bytes32 smtRoot;
        bytes32 previousSmtRoot;
        uint256 newKeysThisBatch;
        uint256 totalKeysAnchored;
        uint256 timestamp;
    }

    /// @dev electionId => smtBatchId => SmtBatch. Sequential per electionId,
    /// starting at 0, independent of `batchId` above and independent across
    /// elections — same multi-election isolation rationale as `batches`.
    mapping(string => mapping(uint256 => SmtBatch)) public smtBatches;

    /// @notice Total number of SMT batches anchored so far, per election.
    mapping(string => uint256) public smtBatchCount;

    /// @notice Root of the fully empty 256-level SMT (docs/smt-design.md §4/§7).
    /// H[0] = keccak256(0x00); H[i] = hashPair(H[i-1], H[i-1]) for i = 1..256.
    /// Precomputed off-chain once — see backend/src/merkle/sparseMerkleTree.ts's
    /// GENESIS_ROOT export, which this constant must always match byte-for-byte.
    bytes32 public constant EMPTY_TREE_ROOT =
        0x42234dc3a0fdc4bd8bcd57d6a3d333c2ff2ca3965feb82e12b68ed0b110787fd;

    event SmtBatchAnchored(
        string indexed electionId,
        uint256 indexed smtBatchId,
        bytes32 indexed smtRoot,
        bytes32 previousSmtRoot,
        uint256 newKeysThisBatch,
        uint256 totalKeysAnchored,
        uint256 timestamp
    );

    /// @notice Anchor the SMT's new cumulative root for a specific election.
    /// Chain-continuity is enforced PER ELECTION: `previousRoot` must equal
    /// the last anchored `smtRoot` for THIS `electionId` (or `EMPTY_TREE_ROOT`
    /// for that election's first call) — one election's chain can never be
    /// extended using another election's previous root. `newKeysThisBatch`
    /// may be 0 (e.g. re-anchoring after a detected deletion, docs/smt-design.md
    /// §9) — this contract does not itself validate that `newRoot` is the
    /// correct result of adding exactly `newKeysThisBatch` keys to
    /// `previousRoot`; that check happens off-chain against the shared
    /// hashing implementation (same trust boundary as `anchorRoot` above).
    /// @param electionId The election this SMT batch belongs to.
    /// @param newRoot The new SMT root computed off-chain.
    /// @param previousRoot Must equal this election's previous SmtBatch's `smtRoot`.
    /// @param newKeysThisBatch Count of genuinely new keys inserted this batch.
    /// @param totalKeysAnchored Running total; must equal the previous batch's
    ///   `totalKeysAnchored` + `newKeysThisBatch`.
    /// @return smtBatchId The sequential id assigned to this SMT batch, scoped to `electionId`.
    function anchorSmtRoot(
        string calldata electionId,
        bytes32 newRoot,
        bytes32 previousRoot,
        uint256 newKeysThisBatch,
        uint256 totalKeysAnchored
    ) external onlyOwner returns (uint256 smtBatchId) {
        require(bytes(electionId).length > 0, "MerkleRootStorage: electionId cannot be empty");

        uint256 count = smtBatchCount[electionId];
        bytes32 expectedPrevious = count == 0
            ? EMPTY_TREE_ROOT
            : smtBatches[electionId][count - 1].smtRoot;
        require(previousRoot == expectedPrevious, "MerkleRootStorage: SMT chain continuity broken");
        require(newRoot != bytes32(0), "MerkleRootStorage: SMT root cannot be zero");

        uint256 expectedTotal = count == 0
            ? 0
            : smtBatches[electionId][count - 1].totalKeysAnchored;
        require(
            totalKeysAnchored == expectedTotal + newKeysThisBatch,
            "MerkleRootStorage: SMT totalKeysAnchored mismatch"
        );

        smtBatchId = count;
        smtBatches[electionId][smtBatchId] = SmtBatch({
            smtRoot: newRoot,
            previousSmtRoot: previousRoot,
            newKeysThisBatch: newKeysThisBatch,
            totalKeysAnchored: totalKeysAnchored,
            timestamp: block.timestamp
        });
        smtBatchCount[electionId] += 1;

        emit SmtBatchAnchored(electionId, smtBatchId, newRoot, previousRoot, newKeysThisBatch, totalKeysAnchored, block.timestamp);
    }

    /// @dev Position-aware internal-node hash: keccak256(left ‖ right), NOT
    /// sorted/commutative — deliberately different from the dense tree's
    /// commutative hashPair() (merkleTree.ts). Adversarial testing found that
    /// commutative pairing makes a non-membership proof's (bitmap, siblings)
    /// independent of the claimed key (the leaf-level value for "absent" is a
    /// universal constant with no key mixed in), so a real absence proof for
    /// one key could be relabeled as "proof" that a different key — including
    /// an actual member — is absent. Position-aware pairing forces the
    /// sibling sequence to match the claimed key's exact bit-path: reusing
    /// another key's siblings only reconstructs `root` if that key agrees
    /// with the claimed key at every level. See docs/smt-design.md §6.1 and
    /// sparseMerkleTree.ts's matching comment / regression test.
    function _smtNodeHash(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(left, right));
    }

    /// @dev Default (empty-subtree) hash table H[0..256], recomputed once per
    /// call — identical formula to DEFAULT_HASHES in sparseMerkleTree.ts.
    /// Both operands are equal at every level, so position-awareness doesn't
    /// change these values versus a commutative pairing would have produced.
    /// This is O(256) keccak256 calls; verifySmtMembership/verifySmtNonMembership
    /// are `pure`, so this only costs compute time for an off-chain caller, no
    /// on-chain gas (docs/smt-design.md §12).
    function _defaultHashes() private pure returns (bytes32[257] memory table) {
        table[0] = keccak256(abi.encodePacked(bytes1(0x00)));
        for (uint256 i = 1; i <= 256; i++) {
            table[i] = _smtNodeHash(table[i - 1], table[i - 1]);
        }
    }

    /// @dev bit `level` (0 = leaf's immediate sibling) of a 256-bit bitmap,
    /// where bit i lives in byte i/8 (bitmap[0] = most-significant byte) —
    /// identical layout to bitmapBitsToHex()/hexToBitmapBits() in sparseMerkleTree.ts.
    function _bitmapBit(bytes32 bitmap, uint256 level) private pure returns (bool) {
        uint8 byteVal = uint8(bitmap[level / 8]);
        return (byteVal >> (level % 8)) & 1 == 1;
    }

    /// @dev bit `level` of `key` (0 = bit nearest the leaf, 255 = bit nearest
    /// the root) — identical convention to bitAt() in sparseMerkleTree.ts.
    function _keyBit(bytes32 key, uint256 level) private pure returns (uint256) {
        return (uint256(key) >> level) & 1;
    }

    /// @dev Shared root-reconstruction algorithm (docs/smt-design.md §11) for
    /// both membership and non-membership: walk 256 levels bottom-up from
    /// `leafValue`, using `siblings` where the bitmap marks a non-default
    /// sibling and the precomputed default otherwise. `key`'s bit at each
    /// level decides which side `current` occupies — this is what binds the
    /// proof to the specific claimed key (see _smtNodeHash comment above).
    function _verifySmt(
        bytes32 root,
        bytes32 key,
        bytes32 leafValue,
        bytes32 bitmap,
        bytes32[] calldata siblings
    ) private pure returns (bool) {
        bytes32[257] memory defaults = _defaultHashes();
        bytes32 current = leafValue;
        uint256 siblingIdx = 0;

        for (uint256 level = 0; level <= 255; level++) {
            bytes32 sibling;
            if (_bitmapBit(bitmap, level)) {
                if (siblingIdx >= siblings.length) return false;
                sibling = siblings[siblingIdx];
                siblingIdx += 1;
            } else {
                sibling = defaults[level];
            }
            current = _keyBit(key, level) == 0
                ? _smtNodeHash(current, sibling)
                : _smtNodeHash(sibling, current);
        }

        if (siblingIdx != siblings.length) return false;
        return current == root;
    }

    /// @notice Verify that `key` is a member of the SMT with value `value`,
    /// against `root` (any historically anchored `smtRoot`, not just the
    /// latest — old roots stay checkable forever, which is what lets a
    /// deletion be caught: an old membership proof must keep verifying
    /// against its original root even after a later root shows non-membership).
    /// `pure`, not `view` — costs no gas for an off-chain caller.
    function verifySmtMembership(
        bytes32 root,
        bytes32 key,
        bytes32 value,
        bytes32 bitmap,
        bytes32[] calldata siblings
    ) external pure returns (bool) {
        bytes32 leafHash = keccak256(abi.encodePacked(bytes1(0x01), key, value));
        return _verifySmt(root, key, leafHash, bitmap, siblings);
    }

    /// @notice Verify that `key` is absent from the SMT, against `root`.
    /// `pure`, not `view` — same historical-root and zero-gas properties as
    /// `verifySmtMembership` above.
    function verifySmtNonMembership(
        bytes32 root,
        bytes32 key,
        bytes32 bitmap,
        bytes32[] calldata siblings
    ) external pure returns (bool) {
        bytes32 emptyLeaf = keccak256(abi.encodePacked(bytes1(0x00)));
        return _verifySmt(root, key, emptyLeaf, bitmap, siblings);
    }
}

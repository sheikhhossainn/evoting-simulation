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

    /// @dev batchId => Batch. batchId is assigned sequentially starting at 0.
    mapping(uint256 => Batch) public batches;

    /// @notice Total number of batches anchored so far.
    uint256 public batchCount;

    event BatchAnchored(
        uint256 indexed batchId,
        bytes32 indexed root,
        uint256 voteCount,
        uint256 timestamp
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Anchor a new batch's Merkle root. Only the Election
    /// Commission's backend service (the contract owner) may anchor —
    /// anchoring is a write operation that must come from the trusted
    /// tallying pipeline, but verification below is fully public.
    /// @param root The Merkle root computed off-chain over the batch's vote leaves.
    /// @param voteCount Number of votes included in this batch (for auditability).
    /// @return batchId The sequential id assigned to this batch.
    function anchorRoot(bytes32 root, uint256 voteCount)
        external
        onlyOwner
        returns (uint256 batchId)
    {
        require(root != bytes32(0), "MerkleRootStorage: root cannot be zero");
        require(voteCount > 0, "MerkleRootStorage: voteCount must be > 0");

        batchId = batchCount;
        batches[batchId] = Batch({
            root: root,
            voteCount: voteCount,
            timestamp: block.timestamp
        });
        batchCount += 1;

        emit BatchAnchored(batchId, root, voteCount, block.timestamp);
    }

    /// @notice Verify that `leaf` was included in the batch identified by `batchId`.
    /// @param batchId The batch to check against.
    /// @param leaf The vote's leaf hash (see backend/src/merkle/merkleTree.ts:hashVoteLeaf).
    /// @param proof The Merkle proof (sibling hashes) for `leaf`.
    function verify(
        uint256 batchId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        require(batchId < batchCount, "MerkleRootStorage: unknown batchId");
        return MerkleProof.verify(proof, batches[batchId].root, leaf);
    }

    /// @notice Fetch a batch's stored root, vote count, and anchor timestamp.
    function getBatch(uint256 batchId)
        external
        view
        returns (bytes32 root, uint256 voteCount, uint256 timestamp)
    {
        require(batchId < batchCount, "MerkleRootStorage: unknown batchId");
        Batch storage b = batches[batchId];
        return (b.root, b.voteCount, b.timestamp);
    }
}

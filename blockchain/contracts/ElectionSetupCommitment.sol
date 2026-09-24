// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ElectionSetupCommitment
/// @notice Write-once, per-election commitment to the exact candidate and
/// constituency set (docs/tally-verifiability-design.md §8.2). Deployed as
/// its own contract, separate from MerkleRootStorage, because its
/// write-once semantics are structurally different from that contract's
/// append-only batch-anchoring pattern (§8.2.5) — a single deployment
/// anchors exactly one election's setup, and its deployment/anchor
/// transaction timestamp is itself independently checkable evidence that
/// candidates were locked in before the first ballot batch was anchored.
///
/// commitment = keccak256(
///     "EVOTING-ELECTION-SETUP-COMMITMENT-v1" || election_id ||
///     candidatesRoot || constituenciesRoot
/// )
/// — see backend/src/crypto/candidateCommitment.ts for the exact canonical
/// serialization and tree construction this value must match.
contract ElectionSetupCommitment is Ownable {
    /// @notice The anchored commitment. Zero until `anchor()` is called;
    /// never changes after — there is no update function at all, by
    /// design (docs §8.2.4: a genuine pre-election candidate-list change
    /// requires a new, visibly distinct contract deployment, not a quiet
    /// overwrite of this one).
    bytes32 public commitment;

    /// @notice The election this commitment was anchored for.
    string public electionId;

    event CommitmentAnchored(string electionId, bytes32 commitment, uint256 timestamp);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Anchor the election setup commitment. Callable exactly once
    /// per contract instance.
    /// @param _electionId The election this commitment covers.
    /// @param _commitment The commitment value (see contract-level comment
    ///   for its exact construction).
    function anchor(string calldata _electionId, bytes32 _commitment) external onlyOwner {
        require(commitment == bytes32(0), "ElectionSetupCommitment: already anchored");
        require(_commitment != bytes32(0), "ElectionSetupCommitment: commitment cannot be zero");
        require(bytes(_electionId).length > 0, "ElectionSetupCommitment: electionId cannot be empty");

        electionId = _electionId;
        commitment = _commitment;

        emit CommitmentAnchored(_electionId, _commitment, block.timestamp);
    }
}

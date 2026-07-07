/**
 * merkleContract.ts — ethers.js bindings for MerkleRootStorage
 *
 * See blockchain/contracts/MerkleRootStorage.sol for the deployed contract.
 * Configured via backend/.env: AMOY_RPC_URL, MERKLE_CONTRACT_ADDRESS,
 * ANCHOR_PRIVATE_KEY (write access only — verification is read-only and
 * needs no key).
 */

import { ethers } from "ethers";

const MERKLE_ROOT_STORAGE_ABI = [
  "function anchorRoot(bytes32 root, uint256 voteCount) external returns (uint256 batchId)",
  "function getBatch(uint256 batchId) external view returns (bytes32 root, uint256 voteCount, uint256 timestamp)",
  "function verify(uint256 batchId, bytes32 leaf, bytes32[] calldata proof) external view returns (bool)",
  "function batchCount() external view returns (uint256)",
  "event BatchAnchored(uint256 indexed batchId, bytes32 indexed root, uint256 voteCount, uint256 timestamp)",
];

interface MerkleContractConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey?: string;
}

function loadConfig(): MerkleContractConfig | null {
  const rpcUrl = process.env.AMOY_RPC_URL;
  const contractAddress = process.env.MERKLE_CONTRACT_ADDRESS;
  if (!rpcUrl || !contractAddress) return null;
  return { rpcUrl, contractAddress, privateKey: process.env.ANCHOR_PRIVATE_KEY };
}

/** Read-write contract instance for anchoring. Null if not configured. */
export function getWritableMerkleContract(): ethers.Contract | null {
  const config = loadConfig();
  if (!config || !config.privateKey) return null;
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  return new ethers.Contract(config.contractAddress, MERKLE_ROOT_STORAGE_ABI, wallet);
}

/** Read-only contract instance for public verification. Null if not configured. */
export function getReadOnlyMerkleContract(): ethers.Contract | null {
  const config = loadConfig();
  if (!config) return null;
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  return new ethers.Contract(config.contractAddress, MERKLE_ROOT_STORAGE_ABI, provider);
}

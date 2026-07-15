# Contract Deployment

## What was deployed
`MerkleRootStorage.sol` — a Solidity smart contract that stores cryptographic proofs (Merkle roots) of vote batches on a public blockchain so no one can silently alter the vote records.

## Where
**Network:** Ethereum Sepolia (free testnet — no real money)  
**Address:** `0x312621075076Eb379fbE81760A76B5a8E56b95a7`  
**Explorer:** https://sepolia.etherscan.io/address/0x312621075076Eb379fbE81760A76B5a8E56b95a7  
**Deployed:** 2026-07-15 by wallet `0x03A56C16Ce34976a35b22E55b39fE3D1744A04E0`

## Why Sepolia instead of Polygon Amoy
The project originally targeted Polygon Amoy, but every Amoy faucet now requires a real mainnet ETH balance to prevent abuse. Ethereum Sepolia faucets (e.g. Google Cloud's) are still freely available with just a Google account. The contract code is identical — only the network changed.

## What changed in the codebase
| File | Change |
|------|--------|
| `blockchain/hardhat.config.ts` | Added `sepolia` network config |
| `blockchain/package.json` | Added `deploy:sepolia` script |
| `package.json` | Added `contracts:deploy:sepolia` root script |
| `blockchain/.env` | Added `SEPOLIA_RPC_URL` |
| `backend/.env` | Set `AMOY_RPC_URL`, `MERKLE_CONTRACT_ADDRESS`, `ANCHOR_PRIVATE_KEY` |

## How anchoring now works
1. Admin calls `POST /anchor/batch` (with `x-admin-secret` header)
2. Backend builds a Merkle tree from unanchored votes
3. Merkle root is written to this contract on Sepolia
4. Votes are flipped to `confirmed` in Supabase
5. Anyone can verify a vote's inclusion via `GET /anchor/verify/:voteId`

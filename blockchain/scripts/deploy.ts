/**
 * deploy.ts — Deploy MerkleRootStorage
 *
 * Local (in-memory Hardhat network):
 *   npm run deploy:local --workspace blockchain
 *
 * Polygon Amoy testnet (requires blockchain/.env — see .env.example):
 *   npm run deploy:amoy --workspace blockchain
 */

import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying MerkleRootStorage`);
  console.log(`  Network:  ${network.name}`);
  console.log(`  Deployer: ${deployer.address}`);

  const factory = await ethers.getContractFactory("MerkleRootStorage");
  const contract = await factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ MerkleRootStorage deployed to: ${address}`);
  console.log(`\n📋 Add this to backend/.env:`);
  console.log(`   MERKLE_CONTRACT_ADDRESS=${address}`);
  console.log(`   AMOY_RPC_URL=<same RPC URL used to deploy>`);
  console.log(`   ANCHOR_PRIVATE_KEY=<the deployer's private key>`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

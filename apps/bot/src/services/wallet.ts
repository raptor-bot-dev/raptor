import { ethers } from 'ethers';
import { getOrCreateBalance, updateBalance, getChainConfig } from '@raptor/shared';

// In production, this would use HD wallet derivation
// For now, we generate deterministic addresses based on user ID
const MASTER_SEED = process.env.EXECUTOR_PRIVATE_KEY || '';

export async function getOrCreateDepositAddress(
  tgId: number,
  chain: 'bsc' | 'base'
): Promise<string> {
  // Generate deterministic wallet from user ID
  // In production, use proper HD wallet derivation
  const wallet = generateUserWallet(tgId, chain);

  // Store in database
  await getOrCreateBalance(tgId, chain, wallet.address);

  return wallet.address;
}

export async function processWithdrawal(
  tgId: number,
  chain: 'bsc' | 'base',
  amount: string
): Promise<{ hash: string }> {
  const config = getChainConfig(chain);

  // Get user's deposit address (to send back to)
  const userWallet = generateUserWallet(tgId, chain);

  // Create provider and executor wallet
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const executorWallet = new ethers.Wallet(MASTER_SEED, provider);

  // Send withdrawal
  const tx = await executorWallet.sendTransaction({
    to: userWallet.address,
    value: ethers.parseEther(amount),
  });

  // Update balance
  await updateBalance(tgId, chain, {
    current_value: '0', // Simplified - should subtract amount
  });

  return { hash: tx.hash };
}

function generateUserWallet(tgId: number, chain: 'bsc' | 'base'): ethers.Wallet {
  // Generate deterministic private key from user ID and chain
  // WARNING: This is simplified. Production should use HD wallet derivation
  const seed = `${MASTER_SEED}:${tgId}:${chain}`;
  const hash = ethers.keccak256(ethers.toUtf8Bytes(seed));
  return new ethers.Wallet(hash);
}

export async function getDepositAddress(
  tgId: number,
  chain: 'bsc' | 'base'
): Promise<string> {
  const wallet = generateUserWallet(tgId, chain);
  return wallet.address;
}

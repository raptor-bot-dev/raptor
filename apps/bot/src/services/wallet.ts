/**
 * Self-Custodial Wallet Service for RAPTOR v2.3
 *
 * Users generate their own keypairs. Private keys are encrypted
 * and stored in the database. Users can export keys for backup.
 */

import {
  getOrCreateBalance,
  updateBalance,
  getUserWallet,
  createUserWallet,
  getOrCreateUserWallet,
  type Chain,
  type TradingMode,
  type UserWallet,
  generateSolanaKeypair,
  generateEvmKeypair,
  type EncryptedData,
} from '@raptor/shared';
import { depositMonitor } from './depositMonitor.js';

/**
 * Initialize user wallet - generates keypairs if new user
 * @returns Wallet addresses and whether this is a new wallet
 */
export async function initializeUserWallet(tgId: number): Promise<{
  solana: { address: string };
  evm: { address: string };
  isNew: boolean;
}> {
  const { wallet, isNew } = await getOrCreateUserWallet(tgId, () => ({
    solana: generateSolanaKeypair(),
    evm: generateEvmKeypair(),
  }));

  return {
    solana: { address: wallet.solana_address },
    evm: { address: wallet.evm_address },
    isNew,
  };
}

/**
 * Get deposit address for a specific chain
 * Creates wallet if it doesn't exist
 */
export async function getOrCreateDepositAddress(
  tgId: number,
  chain: Chain,
  mode: TradingMode = 'snipe'
): Promise<string> {
  // Ensure user wallet exists
  const { wallet } = await getOrCreateUserWallet(tgId, () => ({
    solana: generateSolanaKeypair(),
    evm: generateEvmKeypair(),
  }));

  // Get the appropriate address for chain
  const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;

  // Store in balances table for deposit monitoring
  await getOrCreateBalance(tgId, chain, address, mode);

  // Start watching for deposits
  await depositMonitor.watchAddress(tgId, chain, address);
  console.log(`[Wallet] User ${tgId} deposit address on ${chain}: ${address}`);

  return address;
}

/**
 * Get existing deposit address without creating
 */
export async function getDepositAddress(
  tgId: number,
  chain: Chain
): Promise<string | null> {
  const wallet = await getUserWallet(tgId);
  if (!wallet) return null;

  return chain === 'sol' ? wallet.solana_address : wallet.evm_address;
}

/**
 * Get user's full wallet info
 */
export async function getUserWalletInfo(tgId: number): Promise<{
  solana: string;
  evm: string;
  createdAt: string;
  hasBackup: boolean;
} | null> {
  const wallet = await getUserWallet(tgId);
  if (!wallet) return null;

  return {
    solana: wallet.solana_address,
    evm: wallet.evm_address,
    createdAt: wallet.created_at,
    hasBackup: wallet.backup_exported_at !== null,
  };
}

/**
 * Check if user has a wallet
 */
export async function hasWallet(tgId: number): Promise<boolean> {
  const wallet = await getUserWallet(tgId);
  return wallet !== null;
}

/**
 * Process withdrawal from user's wallet
 * In self-custodial mode, we sign the transaction with user's key
 */
export async function processWithdrawal(
  tgId: number,
  chain: Chain,
  amount: string,
  toAddress: string,
  mode: TradingMode = 'snipe'
): Promise<{ hash: string }> {
  // Get user's wallet
  const wallet = await getUserWallet(tgId);
  if (!wallet) {
    throw new Error('User wallet not found');
  }

  if (chain === 'sol') {
    // Solana withdrawal
    return await processSolanaWithdrawal(wallet, amount, toAddress);
  } else {
    // EVM withdrawal (BSC, Base, ETH)
    return await processEvmWithdrawal(wallet, chain, amount, toAddress);
  }
}

/**
 * Process Solana withdrawal
 */
async function processSolanaWithdrawal(
  wallet: UserWallet,
  amount: string,
  toAddress: string
): Promise<{ hash: string }> {
  // Import dynamically to avoid loading Solana deps when not needed
  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
  const { loadSolanaKeypair } = await import('@raptor/shared');

  // Load user's keypair
  const keypair = loadSolanaKeypair(wallet.solana_private_key_encrypted as EncryptedData);

  // Connect to Solana
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Build transfer transaction
  const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports,
    })
  );

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;

  // Sign and send
  tx.sign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize());

  // Confirm
  await connection.confirmTransaction(signature, 'confirmed');

  return { hash: signature };
}

/**
 * Process EVM withdrawal (BSC, Base, ETH)
 */
async function processEvmWithdrawal(
  wallet: UserWallet,
  chain: Chain,
  amount: string,
  toAddress: string
): Promise<{ hash: string }> {
  const { ethers } = await import('ethers');
  const { loadEvmWallet, getChainConfig } = await import('@raptor/shared');

  // Get chain config
  const config = getChainConfig(chain as 'bsc' | 'base' | 'eth');

  // Create provider
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Load user's wallet
  const userWallet = loadEvmWallet(
    wallet.evm_private_key_encrypted as EncryptedData,
    provider
  );

  // Send transaction
  const tx = await userWallet.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amount),
  });

  // Wait for confirmation
  await tx.wait();

  return { hash: tx.hash };
}

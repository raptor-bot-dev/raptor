/**
 * Self-Custodial Wallet Service for RAPTOR v2.3
 *
 * Users generate their own keypairs. Private keys are encrypted
 * and stored in the database. Users can export keys for backup.
 *
 * SECURITY: v2.3.1 - Added comprehensive withdrawal validation
 */

import {
  getOrCreateBalance,
  updateBalance,
  getUserWallet,
  createUserWallet,
  getOrCreateUserWallet,
  getUserBalance,
  type Chain,
  type TradingMode,
  type UserWallet,
  generateSolanaKeypair,
  generateEvmKeypair,
  type EncryptedData,
  createLogger,
  maskAddress,
} from '@raptor/shared';
import { depositMonitor } from './depositMonitor.js';
// v2.3.1 Security imports
import {
  validateWithdrawal,
  checkWithdrawalRateLimit,
  recordWithdrawal,
} from '../utils/withdrawalValidation.js';

const logger = createLogger('Wallet');

/**
 * Initialize user wallet - generates keypairs if new user
 * @returns Wallet addresses and whether this is a new wallet
 */
export async function initializeUserWallet(tgId: number): Promise<{
  solana: { address: string };
  evm: { address: string };
  isNew: boolean;
}> {
  // Pass tgId to enable per-user key derivation (v2 encryption)
  const { wallet, isNew } = await getOrCreateUserWallet(tgId, () => ({
    solana: generateSolanaKeypair(tgId),
    evm: generateEvmKeypair(tgId),
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
  // Ensure user wallet exists - pass tgId for v2 encryption
  const { wallet } = await getOrCreateUserWallet(tgId, () => ({
    solana: generateSolanaKeypair(tgId),
    evm: generateEvmKeypair(tgId),
  }));

  // Get the appropriate address for chain
  const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;

  // Store in balances table for deposit monitoring
  await getOrCreateBalance(tgId, chain, address, mode);

  // Start watching for deposits
  await depositMonitor.watchAddress(tgId, chain, address);
  logger.info('Deposit address generated', { userId: tgId, chain, address });

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
 *
 * SECURITY: v2.3.1 - Added comprehensive validation
 */
export async function processWithdrawal(
  tgId: number,
  chain: Chain,
  walletIndex: number,
  amount: string,
  toAddress: string,
  mode: TradingMode = 'snipe'
): Promise<{ hash: string }> {
  // Get user's specific wallet (multi-wallet v2.3)
  const { getWalletByIndex } = await import('@raptor/shared');
  const wallet = await getWalletByIndex(tgId, chain, walletIndex);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Fetch current balance from blockchain for validation
  let availableBalance = 0;
  try {
    if (chain === 'sol') {
      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      const balance = await connection.getBalance(new PublicKey(wallet.solana_address), 'finalized');
      availableBalance = balance / LAMPORTS_PER_SOL;
    } else {
      const { ethers } = await import('ethers');
      const { getChainConfig } = await import('@raptor/shared');
      const config = getChainConfig(chain as 'bsc' | 'base' | 'eth');
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const balance = await provider.getBalance(wallet.evm_address);
      availableBalance = Number(ethers.formatEther(balance));
    }
  } catch (error) {
    logger.error('Failed to fetch balance for withdrawal validation:', error);
    throw new Error('Unable to verify balance. Please try again.');
  }

  // SECURITY: H-007 - Validate withdrawal parameters
  const validation = validateWithdrawal(chain, amount, toAddress, availableBalance);
  if (!validation.valid) {
    throw new Error(validation.error || 'Withdrawal validation failed');
  }

  // Log warnings if any
  if (validation.warnings) {
    logger.warn('Withdrawal warnings', { userId: tgId, warnings: validation.warnings.join(', ') });
  }

  // SECURITY: Check withdrawal rate limit (estimate $100 per unit for rate limit)
  const estimatedUsd = parseFloat(amount) * 100; // Rough estimate
  const rateLimit = checkWithdrawalRateLimit(tgId, estimatedUsd);
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.error || 'Withdrawal rate limit exceeded');
  }

  // Use sanitized values
  const sanitizedAmount = validation.sanitizedAmount || amount;
  const sanitizedAddress = validation.sanitizedAddress || toAddress;

  let result: { hash: string };

  if (chain === 'sol') {
    // Solana withdrawal
    result = await processSolanaWithdrawal(wallet, sanitizedAmount, sanitizedAddress);
  } else {
    // EVM withdrawal (BSC, Base, ETH)
    result = await processEvmWithdrawal(wallet, chain, sanitizedAmount, sanitizedAddress);
  }

  // SECURITY: Record withdrawal for rate limiting
  recordWithdrawal(tgId, estimatedUsd);

  return result;
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

  // Load user's keypair with tgId for v2 decryption
  const keypair = loadSolanaKeypair(wallet.solana_private_key_encrypted as EncryptedData, wallet.tg_id);

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

  // Load user's wallet with tgId for v2 decryption
  const userWallet = loadEvmWallet(
    wallet.evm_private_key_encrypted as EncryptedData,
    wallet.tg_id,
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

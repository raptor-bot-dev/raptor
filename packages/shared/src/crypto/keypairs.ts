/**
 * Keypair Generation for RAPTOR Self-Custodial Wallets
 *
 * Generates and loads:
 * - Solana: ED25519 keypairs
 * - EVM: Secp256k1 keypairs (works for BSC, Base, ETH)
 */

import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  type EncryptedData,
  secureClear,
} from './encryption.js';

export interface GeneratedWallet {
  publicKey: string;
  privateKeyEncrypted: EncryptedData;
}

export interface UserWalletKeys {
  solana: GeneratedWallet;
  evm: GeneratedWallet;
}

/**
 * Generate a new Solana keypair (ED25519)
 * @returns Public key (base58) and encrypted private key
 */
export function generateSolanaKeypair(): GeneratedWallet {
  // Generate new random keypair
  const keypair = Keypair.generate();

  // Convert secret key to base58 for storage
  const privateKeyBase58 = bs58.encode(keypair.secretKey);

  // Encrypt the private key
  const privateKeyEncrypted = encryptPrivateKey(privateKeyBase58);

  // Clear sensitive data
  secureClear(privateKeyBase58);

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKeyEncrypted,
  };
}

/**
 * Generate a new EVM keypair (Secp256k1)
 * Works for BSC, Base, Ethereum - same address on all chains
 * @returns Address and encrypted private key
 */
export function generateEvmKeypair(): GeneratedWallet {
  // Generate new random wallet
  const wallet = ethers.Wallet.createRandom();

  // Encrypt the private key (hex format)
  const privateKeyEncrypted = encryptPrivateKey(wallet.privateKey);

  return {
    publicKey: wallet.address,
    privateKeyEncrypted,
  };
}

/**
 * Generate both Solana and EVM keypairs for a new user
 * @returns Both keypairs
 */
export function generateUserWallets(): UserWalletKeys {
  return {
    solana: generateSolanaKeypair(),
    evm: generateEvmKeypair(),
  };
}

/**
 * Load a Solana keypair from encrypted storage
 * @param encrypted - The encrypted private key data
 * @returns Solana Keypair ready for signing
 */
export function loadSolanaKeypair(encrypted: EncryptedData): Keypair {
  // Decrypt the private key
  const privateKeyBase58 = decryptPrivateKey(encrypted);

  // Decode from base58 to Uint8Array
  const secretKey = bs58.decode(privateKeyBase58);

  // Create keypair from secret key
  const keypair = Keypair.fromSecretKey(secretKey);

  // Clear sensitive data
  secureClear(privateKeyBase58);

  return keypair;
}

/**
 * Load an EVM wallet from encrypted storage
 * @param encrypted - The encrypted private key data
 * @param provider - Optional ethers provider for connected wallet (uses unknown to avoid ESM/CJS type conflicts)
 * @returns ethers Wallet ready for signing
 */
export function loadEvmWallet(
  encrypted: EncryptedData,
  provider?: unknown
): ethers.Wallet {
  // Decrypt the private key
  const privateKeyHex = decryptPrivateKey(encrypted);

  // Create wallet from private key
  const wallet = provider
    ? new ethers.Wallet(privateKeyHex, provider as ethers.Provider)
    : new ethers.Wallet(privateKeyHex);

  // Clear sensitive data
  secureClear(privateKeyHex);

  return wallet;
}

/**
 * Get the public key (address) from an encrypted EVM wallet
 * Without decrypting the private key
 */
export function getEvmAddressFromEncrypted(encrypted: EncryptedData): string {
  const wallet = loadEvmWallet(encrypted);
  return wallet.address;
}

/**
 * Validate an EVM address format
 */
export function isValidEvmAddress(address: string): boolean {
  return ethers.isAddress(address);
}

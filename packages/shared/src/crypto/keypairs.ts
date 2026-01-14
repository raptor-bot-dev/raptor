/**
 * Keypair Generation for RAPTOR Self-Custodial Wallets
 *
 * Generates and loads:
 * - Solana: ED25519 keypairs
 *
 * SECURITY: v2.3.1 - Per-user key derivation requires tgId
 */

import { Keypair } from '@solana/web3.js';
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

/**
 * Generate a new Solana keypair (ED25519)
 * @param tgId - Telegram user ID for per-user encryption (required for v2)
 * @returns Public key (base58) and encrypted private key
 */
export function generateSolanaKeypair(tgId?: number): GeneratedWallet {
  // Generate new random keypair
  const keypair = Keypair.generate();

  // Convert secret key to base58 for storage
  const privateKeyBase58 = bs58.encode(keypair.secretKey);

  // Encrypt the private key with per-user key derivation
  const privateKeyEncrypted = encryptPrivateKey(privateKeyBase58, tgId);

  // Clear sensitive data
  secureClear(privateKeyBase58);

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKeyEncrypted,
  };
}

/**
 * Load a Solana keypair from encrypted storage
 *
 * SECURITY: C-1 fix - Ensures private key is cleared from memory before
 * any error is thrown to prevent key leakage in stack traces/logs.
 *
 * v3.3.2: Added optional expectedPubkey parameter for wallet integrity validation.
 * This catches encryption key mismatches early with a clear error message.
 *
 * @param encrypted - The encrypted private key data
 * @param tgId - Telegram user ID for v2 decryption (optional for legacy v1 data)
 * @param expectedPubkey - Optional expected public key to validate against
 * @returns Solana Keypair ready for signing
 * @throws Error if decryption or key parsing fails (sanitized, no key in message)
 */
export function loadSolanaKeypair(
  encrypted: EncryptedData,
  tgId?: number,
  expectedPubkey?: string
): Keypair {
  let privateKeyBase58: string | null = null;
  let secretKey: Uint8Array | null = null;

  try {
    // Decrypt the private key
    privateKeyBase58 = decryptPrivateKey(encrypted, tgId);

    // Decode from base58 to Uint8Array
    secretKey = bs58.decode(privateKeyBase58);

    // v3.3.2: Validate secret key length (must be 64 bytes for ED25519)
    if (secretKey.length !== 64) {
      console.error(`[Keypair] Invalid secret key length: ${secretKey.length}, expected 64`);
      throw new Error('Invalid wallet secret key length');
    }

    // Create keypair from secret key
    const keypair = Keypair.fromSecretKey(secretKey);

    // v3.3.2: Validate derived pubkey matches expected (catches encryption key mismatch)
    if (expectedPubkey) {
      const derivedPubkey = keypair.publicKey.toBase58();
      if (derivedPubkey !== expectedPubkey) {
        console.error(`[Keypair] WALLET MISMATCH - tgId: ${tgId}, expected: ${expectedPubkey}, derived: ${derivedPubkey}`);
        throw new Error(`Wallet keypair mismatch. Expected ${expectedPubkey.slice(0, 8)}... but derived ${derivedPubkey.slice(0, 8)}...`);
      }
    }

    return keypair;
  } catch (error) {
    // Sanitized error - never include key material in error message
    const safeMessage = error instanceof Error
      ? error.message.replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, '[REDACTED]')
      : 'Unknown error';
    throw new Error(`Failed to load Solana keypair: ${safeMessage}`);
  } finally {
    // Clear the base58 string (safe to clear)
    if (privateKeyBase58) {
      secureClear(privateKeyBase58);
    }
    // NOTE: Cannot clear secretKey here - Keypair.fromSecretKey() stores a reference
    // to the same Uint8Array. Clearing it would zero the keypair's internal secretKey,
    // causing all signatures to fail. The buffer will be GC'd when keypair is released.
  }
}

/**
 * Import a Solana wallet from a private key
 * @param privateKeyBase58 - The private key in base58 format
 * @param tgId - Telegram user ID for per-user encryption
 * @returns Public key and encrypted private key
 */
export function importSolanaKeypair(
  privateKeyBase58: string,
  tgId: number
): GeneratedWallet {
  try {
    // Decode base58 private key
    const secretKey = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(secretKey);

    // Encrypt the private key
    const encrypted = encryptPrivateKey(privateKeyBase58, tgId);

    // Clear sensitive data
    secureClear(privateKeyBase58);

    return {
      publicKey: keypair.publicKey.toBase58(),
      privateKeyEncrypted: encrypted,
    };
  } catch (error) {
    throw new Error('Invalid Solana private key format');
  }
}

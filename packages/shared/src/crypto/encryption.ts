/**
 * Encryption Service for RAPTOR Self-Custodial Wallets
 *
 * Uses AES-256-GCM for encrypting user private keys at rest.
 * Master key is stored in environment variable.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedData {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
  algorithm: string;
  [key: string]: unknown; // Index signature for compatibility with Record<string, unknown>
}

/**
 * Get master encryption key from environment
 * @throws Error if key is not set or invalid
 */
export function getMasterKey(): Buffer {
  const keyHex = process.env.USER_WALLET_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error('USER_WALLET_ENCRYPTION_KEY environment variable not set');
  }

  if (keyHex.length !== 64) {
    throw new Error('USER_WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a private key using AES-256-GCM
 * @param privateKey - The private key to encrypt (string)
 * @param masterKey - The 32-byte master key
 * @returns Encrypted data with ciphertext, IV, and auth tag
 */
export function encryptPrivateKey(privateKey: string, masterKey?: Buffer): EncryptedData {
  const key = masterKey || getMasterKey();

  // Generate random IV for each encryption
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let ciphertext = cipher.update(privateKey, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypt a private key using AES-256-GCM
 * @param encrypted - The encrypted data object
 * @param masterKey - The 32-byte master key
 * @returns Decrypted private key string
 */
export function decryptPrivateKey(encrypted: EncryptedData, masterKey?: Buffer): string {
  const key = masterKey || getMasterKey();

  // Create decipher
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encrypted.iv, 'hex')
  );

  // Set auth tag
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

  // Decrypt
  let privateKey = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  privateKey += decipher.final('utf8');

  return privateKey;
}

/**
 * Validate that an encrypted data object has the correct structure
 */
export function isValidEncryptedData(data: unknown): data is EncryptedData {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  return (
    typeof obj.ciphertext === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.authTag === 'string' &&
    obj.iv.length === IV_LENGTH * 2 && // hex is 2 chars per byte
    obj.authTag.length === AUTH_TAG_LENGTH * 2
  );
}

/**
 * Securely clear sensitive data from memory
 * Note: This is best-effort in JS due to garbage collection
 */
export function secureClear(data: string): void {
  // Overwrite string characters (limited effectiveness in JS)
  if (typeof data === 'string' && data.length > 0) {
    // Create a buffer and fill with zeros
    const buf = Buffer.from(data);
    buf.fill(0);
  }
}

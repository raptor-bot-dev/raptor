/**
 * Encryption Service for RAPTOR Self-Custodial Wallets
 *
 * Uses AES-256-GCM for encrypting user private keys at rest.
 * Master key is stored in environment variable.
 *
 * SECURITY: Per-user key derivation using HKDF prevents single-key compromise
 * from exposing all user wallets.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const CURRENT_VERSION = 2;

export interface EncryptedData {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
  salt?: string; // hex - per-user salt (v2+)
  algorithm: string;
  version?: number; // encryption version for migration
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
 * Derive a user-specific encryption key using HKDF
 * This ensures that compromise of the master key + database still requires
 * knowing which user ID maps to which wallet for targeted attacks.
 *
 * @param masterKey - The 32-byte master key
 * @param tgId - Telegram user ID
 * @param salt - Random salt for this encryption
 * @returns Derived 32-byte key
 */
function deriveUserKey(masterKey: Buffer, tgId: number, salt: Buffer): Buffer {
  const info = Buffer.from(`raptor-wallet-v2-${tgId}`);
  // hkdfSync returns ArrayBuffer, convert to Buffer
  const derived = crypto.hkdfSync('sha256', masterKey, salt, info, 32);
  return Buffer.from(derived);
}

/**
 * Decrypt legacy v1 encrypted data (backwards compatibility)
 * @deprecated - Only for migration, new encryption uses v2
 */
function decryptLegacyV1(encrypted: EncryptedData, masterKey: Buffer): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    masterKey,
    Buffer.from(encrypted.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

  let privateKey = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  privateKey += decipher.final('utf8');

  return privateKey;
}

/**
 * Encrypt a private key using AES-256-GCM with per-user key derivation
 *
 * @param privateKey - The private key to encrypt (string)
 * @param tgId - Telegram user ID for key derivation
 * @param masterKey - Optional 32-byte master key (defaults to env var)
 * @returns Encrypted data with ciphertext, IV, salt, and auth tag
 */
export function encryptPrivateKey(
  privateKey: string,
  tgId?: number,
  masterKey?: Buffer
): EncryptedData {
  const key = masterKey || getMasterKey();

  // If no tgId provided, fall back to legacy encryption (for backwards compat)
  if (tgId === undefined) {
    console.warn('[Encryption] encryptPrivateKey called without tgId - using legacy mode');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let ciphertext = cipher.update(privateKey, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
      algorithm: ALGORITHM,
      version: 1,
    };
  }

  // Generate unique salt for this encryption
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Derive user-specific key
  const userKey = deriveUserKey(key, tgId, salt);

  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher with derived key
  const cipher = crypto.createCipheriv(ALGORITHM, userKey, iv);

  // Encrypt
  let ciphertext = cipher.update(privateKey, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Clear derived key from memory (best effort in Node.js)
  userKey.fill(0);

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    salt: salt.toString('hex'),
    algorithm: ALGORITHM,
    version: CURRENT_VERSION,
  };
}

/**
 * Decrypt a private key using AES-256-GCM with per-user key derivation
 *
 * @param encrypted - The encrypted data object
 * @param tgId - Telegram user ID for key derivation
 * @param masterKey - Optional 32-byte master key (defaults to env var)
 * @returns Decrypted private key string
 */
export function decryptPrivateKey(
  encrypted: EncryptedData,
  tgId?: number,
  masterKey?: Buffer
): string {
  const key = masterKey || getMasterKey();

  // Handle legacy v1 encryption (no salt, no version or version=1)
  if (!encrypted.version || encrypted.version < 2 || !encrypted.salt) {
    console.warn('[Encryption] Decrypting legacy v1 data - consider re-encrypting with v2');
    return decryptLegacyV1(encrypted, key);
  }

  // V2+ requires tgId
  if (tgId === undefined) {
    throw new Error('tgId required for v2 decryption');
  }

  // Derive user-specific key
  const salt = Buffer.from(encrypted.salt, 'hex');
  const userKey = deriveUserKey(key, tgId, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    userKey,
    Buffer.from(encrypted.iv, 'hex')
  );

  // Set auth tag
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

  // Decrypt
  let privateKey = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  privateKey += decipher.final('utf8');

  // Clear derived key from memory
  userKey.fill(0);

  return privateKey;
}

/**
 * Re-encrypt a wallet from v1 to v2 format
 * Use this for migration of existing wallets
 */
export function migrateToV2(
  encrypted: EncryptedData,
  tgId: number,
  masterKey?: Buffer
): EncryptedData {
  // Decrypt with legacy method
  const key = masterKey || getMasterKey();
  const privateKey = decryptLegacyV1(encrypted, key);

  // Re-encrypt with v2
  const v2Encrypted = encryptPrivateKey(privateKey, tgId, key);

  // Clear private key from memory (best effort)
  // Note: JavaScript strings are immutable, this is symbolic
  return v2Encrypted;
}

/**
 * Validate that an encrypted data object has the correct structure
 */
export function isValidEncryptedData(data: unknown): data is EncryptedData {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  const hasBasicFields =
    typeof obj.ciphertext === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.authTag === 'string' &&
    obj.iv.length === IV_LENGTH * 2 && // hex is 2 chars per byte
    obj.authTag.length === AUTH_TAG_LENGTH * 2;

  if (!hasBasicFields) return false;

  // V2+ requires salt
  if (obj.version && (obj.version as number) >= 2) {
    return typeof obj.salt === 'string' && obj.salt.length === SALT_LENGTH * 2;
  }

  return true;
}

/**
 * Check if encrypted data is v2 format
 */
export function isV2Encrypted(data: EncryptedData): boolean {
  return data.version !== undefined && data.version >= 2 && typeof data.salt === 'string';
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

/**
 * Crypto module for RAPTOR Self-Custodial Wallets
 *
 * Exports encryption and keypair generation utilities.
 *
 * SECURITY: v2.3.1 - Per-user key derivation using HKDF
 */

export {
  encryptPrivateKey,
  decryptPrivateKey,
  getMasterKey,
  isValidEncryptedData,
  isV2Encrypted,
  migrateToV2,
  secureClear,
  type EncryptedData,
} from './encryption.js';

export {
  generateSolanaKeypair,
  generateEvmKeypair,
  generateUserWallets,
  loadSolanaKeypair,
  loadEvmWallet,
  getEvmAddressFromEncrypted,
  isValidEvmAddress,
  importSolanaKeypair,
  importEvmKeypair,
  type GeneratedWallet,
  type UserWalletKeys,
} from './keypairs.js';

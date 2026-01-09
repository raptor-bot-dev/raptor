/**
 * Crypto module for RAPTOR Self-Custodial Wallets
 *
 * Exports encryption and keypair generation utilities.
 */

export {
  encryptPrivateKey,
  decryptPrivateKey,
  getMasterKey,
  isValidEncryptedData,
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
  type GeneratedWallet,
  type UserWalletKeys,
} from './keypairs.js';

-- RAPTOR v2.3 - Self-Custodial Wallets Migration
-- Adds user_wallets table for storing encrypted keypairs

-- ============================================================================
-- Step 1: Create user_wallets table
-- ============================================================================
-- One row per user, stores both Solana and EVM keypairs
CREATE TABLE IF NOT EXISTS user_wallets (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL UNIQUE REFERENCES users(tg_id) ON DELETE CASCADE,

  -- Solana (ED25519)
  solana_address TEXT NOT NULL,
  solana_private_key_encrypted JSONB NOT NULL,

  -- EVM (Secp256k1) - same address for BSC/Base/ETH
  evm_address TEXT NOT NULL,
  evm_private_key_encrypted JSONB NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  backup_exported_at TIMESTAMPTZ,

  -- Ensure unique addresses (no two users share same address)
  UNIQUE(solana_address),
  UNIQUE(evm_address)
);

-- ============================================================================
-- Step 2: Create indexes for fast lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_wallets_tg_id ON user_wallets(tg_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_solana_address ON user_wallets(solana_address);
CREATE INDEX IF NOT EXISTS idx_user_wallets_evm_address ON user_wallets(evm_address);

-- ============================================================================
-- Step 3: Enable Row Level Security
-- ============================================================================
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

-- Service role (bot/executor) has full access
CREATE POLICY "Service role has full access to user_wallets"
  ON user_wallets FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Step 4: Add wallet_id reference to user_balances (optional)
-- ============================================================================
-- This links balances to the wallet that generated them
-- The deposit_address column already exists and will now store the user's actual address
ALTER TABLE user_balances ADD COLUMN IF NOT EXISTS wallet_id INTEGER REFERENCES user_wallets(id);

-- ============================================================================
-- Done
-- ============================================================================

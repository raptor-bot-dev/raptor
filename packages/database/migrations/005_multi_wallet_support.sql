-- RAPTOR v2.3 - Multi-Wallet Support Migration
-- Allows up to 5 wallets per chain per user (20 wallets total)

-- ============================================================================
-- Step 1: Add new columns to existing user_wallets table
-- ============================================================================

-- Add chain column (sol, bsc, base, eth)
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add wallet_index column (1-5)
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS wallet_index INTEGER DEFAULT 1;

-- Add wallet_label column (optional user-friendly name)
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS wallet_label TEXT;

-- Add is_active flag for default wallet per chain
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- ============================================================================
-- Step 2: Migrate existing data - split into chain-specific rows
-- ============================================================================

-- First, update existing rows to be Solana wallets
UPDATE user_wallets
SET chain = 'sol', wallet_label = 'Wallet #1'
WHERE chain IS NULL;

-- Create EVM wallet rows from existing Solana+EVM combined rows
-- For users who have both addresses, create separate EVM wallet entries
INSERT INTO user_wallets (
  tg_id,
  chain,
  wallet_index,
  wallet_label,
  is_active,
  solana_address,
  solana_private_key_encrypted,
  evm_address,
  evm_private_key_encrypted,
  created_at,
  backup_exported_at
)
SELECT
  tg_id,
  unnest(ARRAY['bsc', 'base', 'eth']) as chain,
  1 as wallet_index,
  'Wallet #1' as wallet_label,
  TRUE as is_active,
  '' as solana_address,  -- EVM wallets don't have Solana address
  '{}'::jsonb as solana_private_key_encrypted,
  evm_address,
  evm_private_key_encrypted,
  created_at,
  backup_exported_at
FROM user_wallets
WHERE chain = 'sol' AND evm_address != ''
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Step 3: Modify constraints for multi-wallet support
-- ============================================================================

-- Drop the old unique constraint on tg_id (one wallet per user)
ALTER TABLE user_wallets DROP CONSTRAINT IF EXISTS user_wallets_tg_id_key;

-- Drop old address uniqueness constraints (addresses can now be reused across chains)
ALTER TABLE user_wallets DROP CONSTRAINT IF EXISTS user_wallets_solana_address_key;
ALTER TABLE user_wallets DROP CONSTRAINT IF EXISTS user_wallets_evm_address_key;

-- Add new composite unique constraint: one wallet per user + chain + index
ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_unique_per_chain_index
  UNIQUE(tg_id, chain, wallet_index);

-- Add constraint for valid chain values
ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_chain_check
  CHECK (chain IN ('sol', 'bsc', 'base', 'eth'));

-- Add constraint for wallet index range (1-5)
ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_index_check
  CHECK (wallet_index >= 1 AND wallet_index <= 5);

-- ============================================================================
-- Step 4: Create new indexes for efficient queries
-- ============================================================================

-- Index for finding all wallets for a user
CREATE INDEX IF NOT EXISTS idx_user_wallets_tg_chain
  ON user_wallets(tg_id, chain);

-- Index for finding active wallet per chain
CREATE INDEX IF NOT EXISTS idx_user_wallets_active
  ON user_wallets(tg_id, chain, is_active)
  WHERE is_active = TRUE;

-- ============================================================================
-- Step 5: Create helper function for wallet count validation
-- ============================================================================

-- Function to check if user can create more wallets on a chain
CREATE OR REPLACE FUNCTION check_wallet_limit()
RETURNS TRIGGER AS $$
DECLARE
  wallet_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO wallet_count
  FROM user_wallets
  WHERE tg_id = NEW.tg_id AND chain = NEW.chain;

  IF wallet_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 wallets per chain reached for this user';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce wallet limit
DROP TRIGGER IF EXISTS enforce_wallet_limit ON user_wallets;
CREATE TRIGGER enforce_wallet_limit
  BEFORE INSERT ON user_wallets
  FOR EACH ROW
  EXECUTE FUNCTION check_wallet_limit();

-- ============================================================================
-- Step 6: Create view for easy wallet queries
-- ============================================================================

CREATE OR REPLACE VIEW user_wallet_summary AS
SELECT
  tg_id,
  chain,
  COUNT(*) as wallet_count,
  array_agg(wallet_label ORDER BY wallet_index) as wallet_labels,
  SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_count
FROM user_wallets
GROUP BY tg_id, chain;

-- ============================================================================
-- Step 7: Add custom_strategy columns for full strategy customization
-- ============================================================================

-- Custom strategy configuration stored as JSONB
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS custom_strategy JSONB DEFAULT '{
  "enabled": false,
  "takeProfitPercent": 50,
  "stopLossPercent": 30,
  "maxHoldMinutes": 240,
  "trailingEnabled": false,
  "trailingActivationPercent": 30,
  "trailingDistancePercent": 20,
  "dcaLadderEnabled": false,
  "dcaExitLevels": [],
  "moonBagPercent": 0,
  "minLiquidityUSD": 10000,
  "maxMarketCapUSD": 10000000,
  "minScore": 23,
  "maxBuyTaxPercent": 5,
  "maxSellTaxPercent": 5,
  "antiRug": true,
  "antiMEV": true,
  "autoApprove": false,
  "slippagePercent": 15,
  "gasPriority": "medium",
  "retryFailed": true,
  "notifyEntry": true,
  "notifyExit": true,
  "notifyTpSl": true
}'::jsonb;

-- ============================================================================
-- Done
-- ============================================================================

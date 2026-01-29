-- ============================================================================
-- RAPTOR Phase-X: Wallet custody columns (Solana-only)
-- ============================================================================
-- Phase-0 created a minimal wallets table. The revamp runtime uses server-side
-- encrypted key custody for signing, plus multi-wallet indexing for the bot UI.
-- ============================================================================

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol')),
  ADD COLUMN IF NOT EXISTS wallet_index INTEGER,
  ADD COLUMN IF NOT EXISTS solana_private_key_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS backup_exported_at TIMESTAMPTZ;

-- Default index for existing rows
UPDATE wallets
SET wallet_index = 1
WHERE wallet_index IS NULL;

ALTER TABLE wallets
  ALTER COLUMN wallet_index SET NOT NULL;

ALTER TABLE wallets
  ADD CONSTRAINT wallets_wallet_index_check
    CHECK (wallet_index >= 1 AND wallet_index <= 5);

-- One wallet slot per user per chain
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_chain_index
  ON wallets(user_id, chain, wallet_index);


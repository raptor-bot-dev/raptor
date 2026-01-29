-- =============================================================================
-- RAPTOR Phase-X: chain_settings (per-chain manual defaults; Solana-only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chain_settings (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(telegram_chat_id) ON DELETE CASCADE,
  chain VARCHAR(10) NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol')),

  buy_slippage_bps INTEGER NOT NULL DEFAULT 1000,
  sell_slippage_bps INTEGER NOT NULL DEFAULT 800,
  gas_gwei NUMERIC(10, 2),
  priority_sol NUMERIC(10, 6) DEFAULT 0.0001,
  anti_mev_enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, chain)
);

CREATE INDEX IF NOT EXISTS idx_chain_settings_user_chain ON chain_settings(user_id, chain);


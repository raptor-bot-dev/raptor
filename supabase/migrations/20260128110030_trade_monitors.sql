-- =============================================================================
-- RAPTOR Phase-X: trade_monitors (real-time PnL UI)
-- =============================================================================
-- Solana-only trade monitor messages. Used by bot to refresh monitor panels.
-- =============================================================================

CREATE TABLE IF NOT EXISTS trade_monitors (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(telegram_chat_id) ON DELETE CASCADE,
  chain TEXT NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol')),
  mint TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  position_id UUID,

  -- Entry snapshot
  entry_price_sol NUMERIC(20, 12),
  entry_amount_sol NUMERIC(20, 9),
  entry_tokens NUMERIC(30, 9),
  route_label TEXT,
  entry_market_cap_usd NUMERIC(20, 2),

  -- Current snapshot
  current_price_sol NUMERIC(20, 12),
  current_tokens NUMERIC(30, 9),
  current_value_sol NUMERIC(20, 9),
  pnl_sol NUMERIC(20, 9),
  pnl_percent NUMERIC(10, 4),
  market_cap_usd NUMERIC(20, 2),
  liquidity_usd NUMERIC(20, 2),
  volume_24h_usd NUMERIC(20, 2),

  -- Status & timing
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'CLOSED')),
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_count INTEGER NOT NULL DEFAULT 0,

  -- View state (v3.2 fix)
  current_view TEXT NOT NULL DEFAULT 'MONITOR' CHECK (current_view IN ('MONITOR', 'SELL', 'TOKEN')),
  view_changed_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trade_monitors_unique_active UNIQUE (user_id, mint, status)
);

CREATE INDEX IF NOT EXISTS idx_trade_monitors_user_id ON trade_monitors(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_status ON trade_monitors(status);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_expires_at ON trade_monitors(expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_trade_monitors_user_status ON trade_monitors(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_refresh ON trade_monitors(status, last_refreshed_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_trade_monitors_view_state ON trade_monitors(user_id, mint, current_view) WHERE status = 'ACTIVE';


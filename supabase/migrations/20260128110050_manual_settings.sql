-- =============================================================================
-- RAPTOR Phase-X: manual_settings (manual buy/sell UI defaults)
-- =============================================================================

CREATE TABLE IF NOT EXISTS manual_settings (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(telegram_chat_id) ON DELETE CASCADE,

  default_slippage_bps INTEGER NOT NULL DEFAULT 500,
  default_priority_sol NUMERIC(10, 6) NOT NULL DEFAULT 0.0001,
  quick_buy_amounts JSONB NOT NULL DEFAULT '[0.1, 0.25, 0.5, 1, 2]'::jsonb,
  quick_sell_percents JSONB NOT NULL DEFAULT '[10, 25, 50, 75, 100]'::jsonb,

  show_usd_values BOOLEAN NOT NULL DEFAULT true,
  confirm_large_trades BOOLEAN NOT NULL DEFAULT true,
  large_trade_threshold_sol NUMERIC(10, 4) NOT NULL DEFAULT 1.0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_settings_user_id ON manual_settings(user_id);


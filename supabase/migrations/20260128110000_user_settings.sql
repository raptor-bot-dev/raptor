-- ============================================================================
-- RAPTOR Phase-X: user_settings (Bot persistence)
-- ============================================================================
-- Purpose:
-- - Persist bot UI settings (hunt/gas/slippage/strategy JSON blobs)
-- - Keyed by Telegram chat id (tg_id) to match bot identity model
--
-- NOTE: Phase-0 "settings" table remains the canonical revamp risk controls table.
-- This table exists for backwards-compatible bot UI persistence.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_settings (
  tg_id BIGINT PRIMARY KEY REFERENCES users(telegram_chat_id) ON DELETE CASCADE,
  hunt_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  gas_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  slippage_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  strategy_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_tg_id ON user_settings(tg_id);


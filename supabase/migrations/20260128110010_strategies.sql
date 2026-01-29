-- ============================================================================
-- RAPTOR Phase-X: strategies (AUTO/MANUAL execution configuration)
-- ============================================================================
-- Purpose:
-- - Store per-user strategies used by CandidateConsumerLoop and bot panels
-- - Solana-only (chain='sol')
-- - BAGS-only enforcement via allowed_launchpads constraint
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  user_id BIGINT NOT NULL REFERENCES users(telegram_chat_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('MANUAL', 'AUTO')),
  name TEXT NOT NULL,

  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_execute BOOLEAN NOT NULL DEFAULT FALSE,
  chain TEXT NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol')),
  risk_profile TEXT NOT NULL DEFAULT 'BALANCED' CHECK (risk_profile IN ('SAFE', 'BALANCED', 'DEGEN')),

  -- Position limits
  max_positions INTEGER NOT NULL DEFAULT 2 CHECK (max_positions >= 0),
  max_per_trade_sol NUMERIC(20, 9) NOT NULL DEFAULT 0.1 CHECK (max_per_trade_sol >= 0),
  max_daily_sol NUMERIC(20, 9) NOT NULL DEFAULT 0.3 CHECK (max_daily_sol >= 0),
  max_open_exposure_sol NUMERIC(20, 9) NOT NULL DEFAULT 0.2 CHECK (max_open_exposure_sol >= 0),

  -- Execution params
  slippage_bps INTEGER NOT NULL DEFAULT 1500 CHECK (slippage_bps >= 0),
  priority_fee_lamports BIGINT,

  -- Exit strategy
  take_profit_percent NUMERIC(10, 4) NOT NULL DEFAULT 50,
  stop_loss_percent NUMERIC(10, 4) NOT NULL DEFAULT 30,
  max_hold_minutes INTEGER NOT NULL DEFAULT 240,

  -- Trailing stop
  trailing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trailing_activation_percent NUMERIC(10, 4),
  trailing_distance_percent NUMERIC(10, 4),

  -- DCA
  dca_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dca_levels JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Moon bag
  moon_bag_percent NUMERIC(10, 4) NOT NULL DEFAULT 25,

  -- Filters
  min_score INTEGER NOT NULL DEFAULT 30,
  min_liquidity_sol NUMERIC(20, 9) NOT NULL DEFAULT 0,

  -- Revamp: BAGS-only discovery/execution.
  allowed_launchpads TEXT[] NOT NULL DEFAULT ARRAY['bags']::text[],
  CONSTRAINT strategies_allowed_launchpads_bags_only CHECK (allowed_launchpads <@ ARRAY['bags']::text[]),

  -- Cooldown
  cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),

  -- Blocklists
  token_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  token_denylist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  deployer_denylist TEXT[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Modes
  snipe_mode TEXT NOT NULL DEFAULT 'balanced' CHECK (snipe_mode IN ('speed', 'balanced', 'quality')),
  filter_mode TEXT NOT NULL DEFAULT 'moderate' CHECK (filter_mode IN ('strict', 'moderate', 'light')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, kind, chain)
);

CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_kind_chain_enabled ON strategies(kind, chain, enabled) WHERE enabled = TRUE;


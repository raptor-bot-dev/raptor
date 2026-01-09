-- RAPTOR v2.2 Upgrade Migration
-- Adds: Trading strategies, per-chain settings, blacklists, position tracking enhancements

-- ============================================================================
-- Step 1: Add strategy columns to user_settings
-- ============================================================================
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'STANDARD';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS custom_tp INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS custom_sl INTEGER;

-- Add strategy constraint
ALTER TABLE user_settings ADD CONSTRAINT user_settings_strategy_check
  CHECK (strategy IN ('MICRO_SCALP', 'STANDARD', 'MOON_BAG', 'DCA_EXIT', 'TRAILING'));

-- ============================================================================
-- Step 2: Add per-chain gas and slippage settings
-- ============================================================================
-- Gas settings: { chain: { autoTip: bool, tipSpeed: 'slow'|'normal'|'fast'|'turbo', maxTipUSD: number }}
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gas_settings JSONB DEFAULT '{
  "sol": {"autoTip": true, "tipSpeed": "normal", "maxTipUSD": 5},
  "bsc": {"autoTip": true, "tipSpeed": "normal", "maxTipUSD": 2},
  "base": {"autoTip": true, "tipSpeed": "normal", "maxTipUSD": 3},
  "eth": {"autoTip": true, "tipSpeed": "normal", "maxTipUSD": 10}
}'::jsonb;

-- Slippage settings in basis points: { chain: number }
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS slippage JSONB DEFAULT '{
  "sol": 1500,
  "bsc": 1500,
  "base": 1000,
  "eth": 500
}'::jsonb;

-- ============================================================================
-- Step 3: Add position sizing and chain enablement
-- ============================================================================
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS max_position_percent INTEGER DEFAULT 20;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS chains_enabled TEXT[] DEFAULT ARRAY['sol', 'bsc', 'base', 'eth'];

-- ============================================================================
-- Step 4: Add notification preferences
-- ============================================================================
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notifications JSONB DEFAULT '{
  "enabled": true,
  "onEntry": true,
  "onExit": true,
  "onGraduation": true,
  "onHoneypot": true,
  "dailySummary": true
}'::jsonb;

-- ============================================================================
-- Step 5: Create blacklisted_tokens table
-- ============================================================================
CREATE TABLE IF NOT EXISTS blacklisted_tokens (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  reason TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  added_by TEXT, -- 'system' or user tg_id
  UNIQUE(address, chain)
);

CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_chain ON blacklisted_tokens(chain);
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_address ON blacklisted_tokens(address);

ALTER TABLE blacklisted_tokens ADD CONSTRAINT blacklisted_tokens_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- ============================================================================
-- Step 6: Create blacklisted_deployers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS blacklisted_deployers (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  reason TEXT,
  rug_count INTEGER DEFAULT 1,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address, chain)
);

CREATE INDEX IF NOT EXISTS idx_blacklisted_deployers_chain ON blacklisted_deployers(chain);
CREATE INDEX IF NOT EXISTS idx_blacklisted_deployers_address ON blacklisted_deployers(address);

ALTER TABLE blacklisted_deployers ADD CONSTRAINT blacklisted_deployers_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- ============================================================================
-- Step 7: Add position tracking enhancements for strategies
-- ============================================================================
-- Peak price for trailing stop
ALTER TABLE positions ADD COLUMN IF NOT EXISTS peak_price NUMERIC(36, 18);

-- Active trailing stop price (calculated from peak)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_stop_price NUMERIC(36, 18);

-- Track partial exits for DCA_EXIT strategy
ALTER TABLE positions ADD COLUMN IF NOT EXISTS partial_exit_taken BOOLEAN DEFAULT FALSE;

-- Track exit levels hit (for DCA_EXIT ladder)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_levels_hit INTEGER DEFAULT 0;

-- Track moon bag amount kept (for MOON_BAG strategy)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS moon_bag_amount NUMERIC(36, 18);

-- Store strategy used for this position
ALTER TABLE positions ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'STANDARD';

ALTER TABLE positions ADD CONSTRAINT positions_strategy_check
  CHECK (strategy IN ('MICRO_SCALP', 'STANDARD', 'MOON_BAG', 'DCA_EXIT', 'TRAILING'));

-- ============================================================================
-- Step 8: Create token_scores table for caching analysis results
-- ============================================================================
CREATE TABLE IF NOT EXISTS token_scores (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  deployer TEXT,
  score INTEGER NOT NULL,
  sellability INTEGER DEFAULT 0,
  supply_integrity INTEGER DEFAULT 0,
  liquidity_control INTEGER DEFAULT 0,
  distribution INTEGER DEFAULT 0,
  deployer_provenance INTEGER DEFAULT 0,
  post_launch_controls INTEGER DEFAULT 0,
  execution_risk INTEGER DEFAULT 0,
  hard_stop_triggered BOOLEAN DEFAULT FALSE,
  hard_stop_reason TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address, chain)
);

CREATE INDEX IF NOT EXISTS idx_token_scores_chain ON token_scores(chain);
CREATE INDEX IF NOT EXISTS idx_token_scores_address ON token_scores(address);
CREATE INDEX IF NOT EXISTS idx_token_scores_score ON token_scores(score);
CREATE INDEX IF NOT EXISTS idx_token_scores_analyzed_at ON token_scores(analyzed_at);

ALTER TABLE token_scores ADD CONSTRAINT token_scores_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- ============================================================================
-- Step 9: Add deployer tracking to positions
-- ============================================================================
ALTER TABLE positions ADD COLUMN IF NOT EXISTS deployer_address TEXT;

-- ============================================================================
-- Step 10: Create hunt_settings table for auto-hunt per chain
-- ============================================================================
CREATE TABLE IF NOT EXISTS hunt_settings (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  chain TEXT NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  min_score INTEGER DEFAULT 23,
  max_position_size NUMERIC(36, 18),
  launchpads TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tg_id, chain)
);

CREATE INDEX IF NOT EXISTS idx_hunt_settings_tg_id ON hunt_settings(tg_id);
CREATE INDEX IF NOT EXISTS idx_hunt_settings_chain_enabled ON hunt_settings(chain, enabled);

ALTER TABLE hunt_settings ADD CONSTRAINT hunt_settings_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- ============================================================================
-- Step 11: Add RLS policies for new tables
-- ============================================================================
ALTER TABLE blacklisted_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklisted_deployers ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to blacklisted_tokens"
  ON blacklisted_tokens FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to blacklisted_deployers"
  ON blacklisted_deployers FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to token_scores"
  ON token_scores FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to hunt_settings"
  ON hunt_settings FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Step 12: Add index for faster position lookups by strategy
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_positions_strategy ON positions(strategy);
CREATE INDEX IF NOT EXISTS idx_positions_tg_id_strategy ON positions(tg_id, strategy);

-- ============================================================================
-- Done
-- ============================================================================

-- =============================================================================
-- RAPTOR v3.1 Trade Monitors Migration
-- Tracks active trade monitor messages for real-time PnL updates
-- =============================================================================

-- Trade Monitors table
-- Stores message references for updating trade monitors in-place
CREATE TABLE IF NOT EXISTS trade_monitors (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,                    -- Telegram user ID
  chain TEXT NOT NULL DEFAULT 'sol',          -- Chain (sol, eth, base, bsc)
  mint TEXT NOT NULL,                         -- Token mint/contract address
  token_symbol TEXT,                          -- Cached token symbol
  token_name TEXT,                            -- Cached token name
  chat_id BIGINT NOT NULL,                    -- Telegram chat ID for message
  message_id BIGINT NOT NULL,                 -- Telegram message ID to edit
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,

  -- Entry data (snapshot at buy time)
  entry_price_sol DECIMAL(20, 12),            -- Entry price in SOL
  entry_amount_sol DECIMAL(20, 9),            -- SOL spent on entry
  entry_tokens DECIMAL(30, 9),                -- Tokens received
  route_label TEXT,                           -- 'pump.fun' or 'Jupiter (Raydium)' etc

  -- Current data (updated on refresh)
  current_price_sol DECIMAL(20, 12),          -- Current price
  current_tokens DECIMAL(30, 9),              -- Current token balance
  current_value_sol DECIMAL(20, 9),           -- Current position value in SOL
  pnl_sol DECIMAL(20, 9),                     -- Unrealized PnL in SOL
  pnl_percent DECIMAL(10, 4),                 -- Unrealized PnL %
  market_cap_usd DECIMAL(20, 2),              -- Market cap if available
  liquidity_usd DECIMAL(20, 2),               -- Liquidity if available
  volume_24h_usd DECIMAL(20, 2),              -- 24h volume if available

  -- Status and timing
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'CLOSED')),
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,            -- Monitor expires after TTL
  refresh_count INTEGER DEFAULT 0,            -- Track refresh cycles

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_user_mint_monitor UNIQUE (user_id, mint, status)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_trade_monitors_user_id ON trade_monitors(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_status ON trade_monitors(status);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_expires_at ON trade_monitors(expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_trade_monitors_user_status ON trade_monitors(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_monitors_refresh ON trade_monitors(status, last_refreshed_at) WHERE status = 'ACTIVE';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_trade_monitors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trade_monitors_updated_at ON trade_monitors;
CREATE TRIGGER trade_monitors_updated_at
  BEFORE UPDATE ON trade_monitors
  FOR EACH ROW
  EXECUTE FUNCTION update_trade_monitors_updated_at();

-- =============================================================================
-- RPC Functions for Trade Monitors
-- =============================================================================

-- Create or update a trade monitor
CREATE OR REPLACE FUNCTION upsert_trade_monitor(
  p_user_id BIGINT,
  p_chain TEXT,
  p_mint TEXT,
  p_token_symbol TEXT,
  p_token_name TEXT,
  p_chat_id BIGINT,
  p_message_id BIGINT,
  p_position_id INTEGER,
  p_entry_price_sol DECIMAL,
  p_entry_amount_sol DECIMAL,
  p_entry_tokens DECIMAL,
  p_route_label TEXT,
  p_ttl_hours INTEGER DEFAULT 24
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_expires_at := NOW() + (p_ttl_hours || ' hours')::INTERVAL;

  -- Try to find existing active monitor for this user+mint
  SELECT * INTO v_monitor
  FROM trade_monitors
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  FOR UPDATE;

  IF FOUND THEN
    -- Update existing monitor with new message
    UPDATE trade_monitors
    SET chat_id = p_chat_id,
        message_id = p_message_id,
        position_id = COALESCE(p_position_id, position_id),
        entry_price_sol = COALESCE(p_entry_price_sol, entry_price_sol),
        entry_amount_sol = COALESCE(p_entry_amount_sol, entry_amount_sol),
        entry_tokens = COALESCE(p_entry_tokens, entry_tokens),
        route_label = COALESCE(p_route_label, route_label),
        token_symbol = COALESCE(p_token_symbol, token_symbol),
        token_name = COALESCE(p_token_name, token_name),
        expires_at = v_expires_at,
        last_refreshed_at = NOW()
    WHERE id = v_monitor.id
    RETURNING * INTO v_monitor;
  ELSE
    -- Create new monitor
    INSERT INTO trade_monitors (
      user_id, chain, mint, token_symbol, token_name,
      chat_id, message_id, position_id,
      entry_price_sol, entry_amount_sol, entry_tokens, route_label,
      expires_at
    ) VALUES (
      p_user_id, p_chain, p_mint, p_token_symbol, p_token_name,
      p_chat_id, p_message_id, p_position_id,
      p_entry_price_sol, p_entry_amount_sol, p_entry_tokens, p_route_label,
      v_expires_at
    )
    RETURNING * INTO v_monitor;
  END IF;

  RETURN v_monitor;
END;
$$;

-- Get active monitors that need refresh
CREATE OR REPLACE FUNCTION get_monitors_for_refresh(
  p_batch_size INTEGER DEFAULT 20,
  p_min_age_seconds INTEGER DEFAULT 15
)
RETURNS SETOF trade_monitors
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM trade_monitors
  WHERE status = 'ACTIVE'
    AND expires_at > NOW()
    AND last_refreshed_at < NOW() - (p_min_age_seconds || ' seconds')::INTERVAL
  ORDER BY last_refreshed_at ASC
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- Update monitor with fresh data
CREATE OR REPLACE FUNCTION update_monitor_data(
  p_monitor_id INTEGER,
  p_current_price_sol DECIMAL,
  p_current_tokens DECIMAL,
  p_current_value_sol DECIMAL,
  p_pnl_sol DECIMAL,
  p_pnl_percent DECIMAL,
  p_market_cap_usd DECIMAL DEFAULT NULL,
  p_liquidity_usd DECIMAL DEFAULT NULL,
  p_volume_24h_usd DECIMAL DEFAULT NULL
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  UPDATE trade_monitors
  SET current_price_sol = p_current_price_sol,
      current_tokens = p_current_tokens,
      current_value_sol = p_current_value_sol,
      pnl_sol = p_pnl_sol,
      pnl_percent = p_pnl_percent,
      market_cap_usd = COALESCE(p_market_cap_usd, market_cap_usd),
      liquidity_usd = COALESCE(p_liquidity_usd, liquidity_usd),
      volume_24h_usd = COALESCE(p_volume_24h_usd, volume_24h_usd),
      last_refreshed_at = NOW(),
      refresh_count = refresh_count + 1
  WHERE id = p_monitor_id
  RETURNING * INTO v_monitor;

  RETURN v_monitor;
END;
$$;

-- Reset monitor TTL (on manual refresh)
CREATE OR REPLACE FUNCTION reset_monitor_ttl(
  p_monitor_id INTEGER,
  p_ttl_hours INTEGER DEFAULT 24
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  UPDATE trade_monitors
  SET expires_at = NOW() + (p_ttl_hours || ' hours')::INTERVAL,
      last_refreshed_at = NOW()
  WHERE id = p_monitor_id
    AND status = 'ACTIVE'
  RETURNING * INTO v_monitor;

  RETURN v_monitor;
END;
$$;

-- Close monitor (after sell or manual close)
CREATE OR REPLACE FUNCTION close_monitor(
  p_user_id BIGINT,
  p_mint TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trade_monitors
  SET status = 'CLOSED'
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE';
END;
$$;

-- Expire old monitors
CREATE OR REPLACE FUNCTION expire_old_monitors()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE trade_monitors
  SET status = 'EXPIRED'
  WHERE status = 'ACTIVE'
    AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Get user's active monitor for a mint
CREATE OR REPLACE FUNCTION get_user_monitor(
  p_user_id BIGINT,
  p_mint TEXT
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  SELECT * INTO v_monitor
  FROM trade_monitors
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  LIMIT 1;

  RETURN v_monitor;
END;
$$;

-- Get user's recent positions (last 24h) for /positions command
CREATE OR REPLACE FUNCTION get_recent_positions(
  p_user_id BIGINT,
  p_hours INTEGER DEFAULT 24,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id INTEGER,
  token_address TEXT,
  token_symbol TEXT,
  chain TEXT,
  status TEXT,
  entry_price DECIMAL,
  amount_in DECIMAL,
  tokens_held DECIMAL,
  unrealized_pnl_percent DECIMAL,
  created_at TIMESTAMPTZ,
  has_monitor BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.token_address,
    p.token_symbol,
    p.chain,
    p.status,
    p.entry_price,
    p.amount_in,
    p.tokens_held,
    p.unrealized_pnl_percent,
    p.created_at,
    EXISTS (
      SELECT 1 FROM trade_monitors m
      WHERE m.user_id = p_user_id
        AND m.mint = p.token_address
        AND m.status = 'ACTIVE'
    ) as has_monitor
  FROM positions p
  WHERE p.tg_id = p_user_id
    AND p.created_at > NOW() - (p_hours || ' hours')::INTERVAL
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Count user's recent positions for pagination
CREATE OR REPLACE FUNCTION count_recent_positions(
  p_user_id BIGINT,
  p_hours INTEGER DEFAULT 24
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM positions
  WHERE tg_id = p_user_id
    AND created_at > NOW() - (p_hours || ' hours')::INTERVAL;

  RETURN v_count;
END;
$$;

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT ALL ON trade_monitors TO service_role;
GRANT SELECT, INSERT, UPDATE ON trade_monitors TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE trade_monitors_id_seq TO authenticated;

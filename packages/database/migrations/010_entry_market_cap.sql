-- =============================================================================
-- RAPTOR v3.4.1 Entry Market Cap Migration
-- Adds entry_market_cap_usd column for market cap based PnL tracking
-- =============================================================================

-- Add entry_market_cap_usd column to trade_monitors
ALTER TABLE trade_monitors
ADD COLUMN IF NOT EXISTS entry_market_cap_usd DECIMAL(20, 2);

-- Comment for documentation
COMMENT ON COLUMN trade_monitors.entry_market_cap_usd IS 'Market cap at entry time for PnL calculation';

-- =============================================================================
-- Update upsert_trade_monitor to accept entry_market_cap_usd
-- =============================================================================
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
  p_ttl_hours INTEGER DEFAULT 24,
  p_entry_market_cap_usd DECIMAL DEFAULT NULL  -- v3.4.1: Entry market cap
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
        entry_market_cap_usd = COALESCE(p_entry_market_cap_usd, entry_market_cap_usd),
        market_cap_usd = COALESCE(p_entry_market_cap_usd, market_cap_usd),  -- Set current MCap to entry on create
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
      entry_market_cap_usd, market_cap_usd,
      expires_at
    ) VALUES (
      p_user_id, p_chain, p_mint, p_token_symbol, p_token_name,
      p_chat_id, p_message_id, p_position_id,
      p_entry_price_sol, p_entry_amount_sol, p_entry_tokens, p_route_label,
      p_entry_market_cap_usd, p_entry_market_cap_usd,  -- Set both entry and current to same value initially
      v_expires_at
    )
    RETURNING * INTO v_monitor;
  END IF;

  RETURN v_monitor;
END;
$$;

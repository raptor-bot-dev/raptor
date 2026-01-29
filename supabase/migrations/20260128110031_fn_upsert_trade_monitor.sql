CREATE OR REPLACE FUNCTION upsert_trade_monitor(
  p_user_id BIGINT,
  p_chain TEXT,
  p_mint TEXT,
  p_token_symbol TEXT,
  p_token_name TEXT,
  p_chat_id BIGINT,
  p_message_id BIGINT,
  p_position_id UUID,
  p_entry_price_sol NUMERIC,
  p_entry_amount_sol NUMERIC,
  p_entry_tokens NUMERIC,
  p_route_label TEXT,
  p_ttl_hours INTEGER DEFAULT 24,
  p_entry_market_cap_usd NUMERIC DEFAULT NULL
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_expires_at := NOW() + (p_ttl_hours || ' hours')::INTERVAL;

  SELECT * INTO v_monitor
  FROM trade_monitors
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  FOR UPDATE;

  IF FOUND THEN
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
        expires_at = v_expires_at,
        last_refreshed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_monitor.id
    RETURNING * INTO v_monitor;
  ELSE
    INSERT INTO trade_monitors (
      user_id, chain, mint, token_symbol, token_name,
      chat_id, message_id, position_id,
      entry_price_sol, entry_amount_sol, entry_tokens, route_label,
      entry_market_cap_usd,
      expires_at
    ) VALUES (
      p_user_id, p_chain, p_mint, p_token_symbol, p_token_name,
      p_chat_id, p_message_id, p_position_id,
      p_entry_price_sol, p_entry_amount_sol, p_entry_tokens, p_route_label,
      p_entry_market_cap_usd,
      v_expires_at
    )
    RETURNING * INTO v_monitor;
  END IF;

  RETURN v_monitor;
END;
$$;


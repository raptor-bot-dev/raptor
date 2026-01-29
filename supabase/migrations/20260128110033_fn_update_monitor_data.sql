CREATE OR REPLACE FUNCTION update_monitor_data(
  p_monitor_id INTEGER,
  p_current_price_sol NUMERIC,
  p_current_tokens NUMERIC,
  p_current_value_sol NUMERIC,
  p_pnl_sol NUMERIC,
  p_pnl_percent NUMERIC,
  p_market_cap_usd NUMERIC DEFAULT NULL,
  p_liquidity_usd NUMERIC DEFAULT NULL,
  p_volume_24h_usd NUMERIC DEFAULT NULL
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
      refresh_count = refresh_count + 1,
      updated_at = NOW()
  WHERE id = p_monitor_id
  RETURNING * INTO v_monitor;

  RETURN v_monitor;
END;
$$;


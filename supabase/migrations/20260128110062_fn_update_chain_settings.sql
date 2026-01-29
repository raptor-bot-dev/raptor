CREATE OR REPLACE FUNCTION update_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10),
  p_buy_slippage_bps INTEGER DEFAULT NULL,
  p_sell_slippage_bps INTEGER DEFAULT NULL,
  p_gas_gwei NUMERIC(10,2) DEFAULT NULL,
  p_priority_sol NUMERIC(10,6) DEFAULT NULL,
  p_anti_mev_enabled BOOLEAN DEFAULT NULL
)
RETURNS chain_settings
LANGUAGE plpgsql
AS $$
DECLARE
  result chain_settings;
BEGIN
  PERFORM get_or_create_chain_settings(p_user_id, p_chain);

  UPDATE chain_settings
  SET buy_slippage_bps = COALESCE(p_buy_slippage_bps, buy_slippage_bps),
      sell_slippage_bps = COALESCE(p_sell_slippage_bps, sell_slippage_bps),
      gas_gwei = COALESCE(p_gas_gwei, gas_gwei),
      priority_sol = COALESCE(p_priority_sol, priority_sol),
      anti_mev_enabled = COALESCE(p_anti_mev_enabled, anti_mev_enabled),
      updated_at = NOW()
  WHERE user_id = p_user_id AND chain = p_chain
  RETURNING * INTO result;

  RETURN result;
END;
$$;


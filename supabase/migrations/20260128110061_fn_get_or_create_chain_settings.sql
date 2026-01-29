CREATE OR REPLACE FUNCTION get_or_create_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10)
)
RETURNS chain_settings
LANGUAGE plpgsql
AS $$
DECLARE
  result chain_settings;
  default_buy_slip INTEGER;
  default_sell_slip INTEGER;
  default_priority NUMERIC(10, 6);
BEGIN
  -- Solana-only defaults
  default_buy_slip := 1000;
  default_sell_slip := 800;
  default_priority := 0.0001;

  INSERT INTO chain_settings (user_id, chain, buy_slippage_bps, sell_slippage_bps, priority_sol)
  VALUES (p_user_id, p_chain, default_buy_slip, default_sell_slip, default_priority)
  ON CONFLICT (user_id, chain) DO NOTHING;

  SELECT * INTO result FROM chain_settings WHERE user_id = p_user_id AND chain = p_chain;
  RETURN result;
END;
$$;


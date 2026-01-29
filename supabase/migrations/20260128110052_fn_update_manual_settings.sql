CREATE OR REPLACE FUNCTION update_manual_settings(
  p_user_id BIGINT,
  p_slippage_bps INTEGER DEFAULT NULL,
  p_priority_sol NUMERIC DEFAULT NULL,
  p_quick_buy_amounts JSONB DEFAULT NULL,
  p_quick_sell_percents JSONB DEFAULT NULL
)
RETURNS manual_settings
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings manual_settings;
BEGIN
  PERFORM get_or_create_manual_settings(p_user_id);

  UPDATE manual_settings
  SET default_slippage_bps = COALESCE(p_slippage_bps, default_slippage_bps),
      default_priority_sol = COALESCE(p_priority_sol, default_priority_sol),
      quick_buy_amounts = COALESCE(p_quick_buy_amounts, quick_buy_amounts),
      quick_sell_percents = COALESCE(p_quick_sell_percents, quick_sell_percents),
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO v_settings;

  RETURN v_settings;
END;
$$;


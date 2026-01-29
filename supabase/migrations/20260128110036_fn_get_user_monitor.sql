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


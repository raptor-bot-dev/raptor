CREATE OR REPLACE FUNCTION set_monitor_view(
  p_user_id BIGINT,
  p_mint TEXT,
  p_view TEXT
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  UPDATE trade_monitors
  SET current_view = p_view,
      view_changed_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  RETURNING * INTO v_monitor;

  RETURN v_monitor;
END;
$$;


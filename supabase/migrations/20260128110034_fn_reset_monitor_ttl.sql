CREATE OR REPLACE FUNCTION reset_monitor_ttl(
  p_monitor_id INTEGER,
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

  UPDATE trade_monitors
  SET expires_at = v_expires_at,
      updated_at = NOW()
  WHERE id = p_monitor_id
  RETURNING * INTO v_monitor;

  RETURN v_monitor;
END;
$$;


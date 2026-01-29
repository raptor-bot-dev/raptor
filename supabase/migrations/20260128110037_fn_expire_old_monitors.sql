CREATE OR REPLACE FUNCTION expire_old_monitors()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE trade_monitors
  SET status = 'EXPIRED',
      updated_at = NOW()
  WHERE status = 'ACTIVE'
    AND expires_at <= NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


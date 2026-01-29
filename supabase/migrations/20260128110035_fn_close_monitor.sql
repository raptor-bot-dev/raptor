CREATE OR REPLACE FUNCTION close_monitor(
  p_user_id BIGINT,
  p_mint TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE trade_monitors
  SET status = 'CLOSED',
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE';
END;
$$;


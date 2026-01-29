CREATE OR REPLACE FUNCTION get_monitors_for_refresh(
  p_batch_size INTEGER DEFAULT 20,
  p_min_age_seconds INTEGER DEFAULT 15
)
RETURNS SETOF trade_monitors
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM trade_monitors
  WHERE status = 'ACTIVE'
    AND expires_at > NOW()
    AND last_refreshed_at < NOW() - (p_min_age_seconds || ' seconds')::INTERVAL
    AND current_view = 'MONITOR'
  ORDER BY last_refreshed_at ASC
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED;
END;
$$;


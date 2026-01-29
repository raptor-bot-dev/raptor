CREATE OR REPLACE FUNCTION count_recent_positions(
  p_user_id BIGINT,
  p_hours INTEGER DEFAULT 24
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_uuid UUID;
  v_count INTEGER;
BEGIN
  SELECT u.id INTO v_user_uuid
  FROM users u
  WHERE u.telegram_chat_id = p_user_id;

  IF v_user_uuid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM positions p
  WHERE p.user_id = v_user_uuid
    AND p.opened_at > NOW() - (p_hours || ' hours')::INTERVAL;

  RETURN v_count;
END;
$$;


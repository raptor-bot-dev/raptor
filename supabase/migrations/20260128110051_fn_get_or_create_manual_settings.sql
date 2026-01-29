CREATE OR REPLACE FUNCTION get_or_create_manual_settings(
  p_user_id BIGINT
)
RETURNS manual_settings
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings manual_settings;
BEGIN
  SELECT * INTO v_settings
  FROM manual_settings
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO manual_settings (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_settings;
  END IF;

  RETURN v_settings;
END;
$$;


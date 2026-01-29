CREATE OR REPLACE FUNCTION reset_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10)
)
RETURNS chain_settings
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM chain_settings WHERE user_id = p_user_id AND chain = p_chain;
  RETURN get_or_create_chain_settings(p_user_id, p_chain);
END;
$$;


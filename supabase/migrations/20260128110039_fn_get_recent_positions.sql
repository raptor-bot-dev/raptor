CREATE OR REPLACE FUNCTION get_recent_positions(
  p_user_id BIGINT,
  p_hours INTEGER DEFAULT 24,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  token_address TEXT,
  token_symbol TEXT,
  chain TEXT,
  status TEXT,
  entry_price NUMERIC,
  amount_in NUMERIC,
  tokens_held NUMERIC,
  unrealized_pnl_percent NUMERIC,
  created_at TIMESTAMPTZ,
  has_monitor BOOLEAN,
  source TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_uuid UUID;
BEGIN
  SELECT u.id INTO v_user_uuid
  FROM users u
  WHERE u.telegram_chat_id = p_user_id;

  IF v_user_uuid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.mint AS token_address,
    COALESCE(p.symbol, 'UNKNOWN') AS token_symbol,
    'sol'::text AS chain,
    CASE WHEN p.lifecycle_state = 'CLOSED' THEN 'CLOSED' ELSE 'ACTIVE' END AS status,
    p.entry_price,
    p.entry_cost_sol AS amount_in,
    p.size_tokens AS tokens_held,
    CASE
      WHEN p.entry_cost_sol > 0 AND p.current_value_sol IS NOT NULL
        THEN ((p.current_value_sol - p.entry_cost_sol) / p.entry_cost_sol) * 100
      ELSE 0
    END AS unrealized_pnl_percent,
    p.opened_at AS created_at,
    EXISTS (
      SELECT 1 FROM trade_monitors m
      WHERE m.user_id = p_user_id
        AND m.mint = p.mint
        AND m.status = 'ACTIVE'
    ) AS has_monitor,
    COALESCE(p.metadata->>'source', 'trade') AS source
  FROM positions p
  WHERE p.user_id = v_user_uuid
    AND p.opened_at > NOW() - (p_hours || ' hours')::INTERVAL
  ORDER BY p.opened_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


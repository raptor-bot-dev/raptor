-- Migration: Add source field to get_recent_positions for filtering manual vs hunt trades
-- v5.0: UX redesign - positions filtering

-- Drop existing function first (required when changing return type)
DROP FUNCTION IF EXISTS get_recent_positions(bigint, integer, integer, integer);

-- Recreate the function with source field included
CREATE OR REPLACE FUNCTION get_recent_positions(
  p_user_id BIGINT,
  p_hours INTEGER DEFAULT 24,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id INTEGER,
  token_address TEXT,
  token_symbol TEXT,
  chain TEXT,
  status TEXT,
  entry_price DECIMAL,
  amount_in DECIMAL,
  tokens_held DECIMAL,
  unrealized_pnl_percent DECIMAL,
  created_at TIMESTAMPTZ,
  has_monitor BOOLEAN,
  source TEXT  -- NEW: Added for manual vs hunt filtering
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.token_address,
    p.token_symbol,
    p.chain,
    p.status,
    p.entry_price,
    p.amount_in,
    p.tokens_held,
    p.unrealized_pnl_percent,
    p.created_at,
    EXISTS (
      SELECT 1 FROM trade_monitors m
      WHERE m.user_id = p_user_id
        AND m.mint = p.token_address
        AND m.status = 'ACTIVE'
    ) as has_monitor,
    p.source  -- NEW: Include source field
  FROM positions p
  WHERE p.tg_id = p_user_id
    AND p.created_at > NOW() - (p_hours || ' hours')::INTERVAL
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

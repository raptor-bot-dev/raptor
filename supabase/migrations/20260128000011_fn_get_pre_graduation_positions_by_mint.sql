-- ============================================================================
-- RAPTOR Phase 3: Function - get_pre_graduation_positions_by_mint
-- ============================================================================
CREATE OR REPLACE FUNCTION get_pre_graduation_positions_by_mint(p_mint TEXT)
RETURNS SETOF positions
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM positions
    WHERE mint = p_mint
      AND lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state IN ('MONITORING', 'TRIGGERED')
    ORDER BY opened_at;
$$;

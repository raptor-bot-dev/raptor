-- ============================================================================
-- RAPTOR Phase 3: Function - get_graduation_monitoring_mints
-- ============================================================================
CREATE OR REPLACE FUNCTION get_graduation_monitoring_mints()
RETURNS TABLE(mint TEXT, position_count BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT mint, COUNT(*) as position_count
    FROM positions
    WHERE lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state IN ('MONITORING', 'TRIGGERED')
    GROUP BY mint
    ORDER BY position_count DESC;
$$;

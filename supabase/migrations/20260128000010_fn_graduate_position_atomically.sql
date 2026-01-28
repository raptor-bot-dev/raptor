-- ============================================================================
-- RAPTOR Phase 3: Function - graduate_position_atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION graduate_position_atomically(
    p_position_id UUID,
    p_pool_address TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE positions
    SET
        lifecycle_state = 'POST_GRADUATION',
        pricing_source = 'AMM_POOL',
        graduated_at = NOW(),
        pool_address = p_pool_address
    WHERE id = p_position_id
      AND lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state != 'COMPLETED';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

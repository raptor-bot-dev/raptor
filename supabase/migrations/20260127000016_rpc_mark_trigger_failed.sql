-- ============================================================================
-- RAPTOR Phase 0: RPC - mark_trigger_failed
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_trigger_failed(
    p_position_id UUID,
    p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE positions
    SET trigger_state = 'FAILED',
        trigger_error = COALESCE(p_error, 'Unknown error')
    WHERE id = p_position_id AND trigger_state = 'EXECUTING';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

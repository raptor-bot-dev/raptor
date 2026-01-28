-- ============================================================================
-- RAPTOR Phase 0: RPC - mark_trigger_completed
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_trigger_completed(p_position_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE positions
    SET trigger_state = 'COMPLETED',
        lifecycle_state = 'CLOSED',
        closed_at = NOW()
    WHERE id = p_position_id AND trigger_state = 'EXECUTING';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- ============================================================================
-- RAPTOR Phase 0: RPC - mark_position_executing
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_position_executing(p_position_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE positions
    SET trigger_state = 'EXECUTING'
    WHERE id = p_position_id AND trigger_state = 'TRIGGERED';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- ============================================================================
-- RAPTOR Phase 0: RPC - trigger_exit_atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_exit_atomically(
    p_position_id UUID,
    p_trigger TEXT,
    p_trigger_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_state TEXT;
    v_lifecycle_state TEXT;
BEGIN
    -- Lock the position row
    SELECT trigger_state, lifecycle_state INTO v_current_state, v_lifecycle_state
    FROM positions
    WHERE id = p_position_id
    FOR UPDATE;

    -- Validate state
    IF v_lifecycle_state = 'CLOSED' THEN
        RETURN jsonb_build_object('triggered', false, 'reason', 'position_closed');
    END IF;

    IF v_current_state != 'MONITORING' THEN
        RETURN jsonb_build_object(
            'triggered', false,
            'reason', 'already_triggered',
            'current_state', v_current_state
        );
    END IF;

    -- Atomically update to TRIGGERED
    UPDATE positions
    SET trigger_state = 'TRIGGERED',
        exit_trigger = p_trigger,
        exit_price = p_trigger_price
    WHERE id = p_position_id;

    RETURN jsonb_build_object(
        'triggered', true,
        'position_id', p_position_id,
        'trigger', p_trigger
    );
END;
$$;

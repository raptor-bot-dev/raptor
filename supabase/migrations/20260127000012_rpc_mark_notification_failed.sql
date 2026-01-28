-- ============================================================================
-- RAPTOR Phase 0: RPC - mark_notification_failed
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_notification_failed(
    p_notification_id UUID,
    p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_attempts INTEGER;
    v_max_attempts INTEGER;
BEGIN
    SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
    FROM notifications_outbox WHERE id = p_notification_id;

    IF v_attempts >= v_max_attempts THEN
        UPDATE notifications_outbox
        SET status = 'failed', last_error = p_error, sending_expires_at = NULL, worker_id = NULL
        WHERE id = p_notification_id;
    ELSE
        UPDATE notifications_outbox
        SET status = 'pending', last_error = p_error, sending_expires_at = NULL, worker_id = NULL
        WHERE id = p_notification_id;
    END IF;
END;
$$;

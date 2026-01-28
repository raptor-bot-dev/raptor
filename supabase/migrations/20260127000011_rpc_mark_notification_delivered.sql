-- ============================================================================
-- RAPTOR Phase 0: RPC - mark_notification_delivered
-- ============================================================================
CREATE OR REPLACE FUNCTION mark_notification_delivered(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE notifications_outbox
    SET status = 'sent', sent_at = NOW(), sending_expires_at = NULL, worker_id = NULL
    WHERE id = p_notification_id;
END;
$$;

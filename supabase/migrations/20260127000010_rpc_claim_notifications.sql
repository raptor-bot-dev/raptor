-- ============================================================================
-- RAPTOR Phase 0: RPC - claim_notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_notifications(
    p_worker_id TEXT,
    p_limit INTEGER DEFAULT 20,
    p_lease_seconds INTEGER DEFAULT 30
)
RETURNS SETOF notifications_outbox
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE notifications_outbox
    SET
        status = 'sending',
        sending_expires_at = NOW() + (p_lease_seconds || ' seconds')::INTERVAL,
        worker_id = p_worker_id,
        attempts = attempts + 1
    WHERE id IN (
        SELECT id FROM notifications_outbox
        WHERE (status = 'pending' OR (status = 'sending' AND sending_expires_at < NOW()))
          AND attempts < max_attempts
        ORDER BY created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$;

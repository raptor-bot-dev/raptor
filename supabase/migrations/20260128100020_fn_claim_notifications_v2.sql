-- ============================================================================
-- RPC: claim_notifications (v2 - includes telegram_chat_id)
-- ============================================================================
-- Replaces v1 to include telegram_chat_id from users table JOIN.
-- Returns JSONB array so poller can send directly to Telegram.
-- ============================================================================

-- Drop v1 (returns SETOF notifications_outbox)
DROP FUNCTION IF EXISTS claim_notifications(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION claim_notifications(
    p_worker_id TEXT,
    p_limit INTEGER DEFAULT 20,
    p_lease_seconds INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH claimed AS (
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
        RETURNING *
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'telegram_chat_id', u.telegram_chat_id,
            'type', c.type,
            'payload', c.payload,
            'status', c.status,
            'attempts', c.attempts,
            'max_attempts', c.max_attempts,
            'last_error', c.last_error,
            'created_at', c.created_at
        )
    ), '[]'::JSONB)
    INTO v_result
    FROM claimed c
    JOIN users u ON u.id = c.user_id;

    RETURN v_result;
END;
$$;

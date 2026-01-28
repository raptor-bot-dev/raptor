-- ============================================================================
-- RPC: extend_lease
-- ============================================================================
-- Extends the lease on a job (heartbeat). Only the lease owner can extend.
-- Prevents stale takeover while worker is still processing.
-- ============================================================================

CREATE OR REPLACE FUNCTION extend_lease(
    p_job_id UUID,
    p_worker_id TEXT,
    p_extension_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE trade_jobs
    SET lease_expires_at = NOW() + (p_extension_seconds || ' seconds')::INTERVAL,
        updated_at = NOW()
    WHERE id = p_job_id
      AND lease_owner = p_worker_id
      AND status IN ('LEASED', 'RUNNING');

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

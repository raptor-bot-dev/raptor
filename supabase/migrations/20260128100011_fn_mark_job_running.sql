-- ============================================================================
-- RPC: mark_job_running
-- ============================================================================
-- Transitions a LEASED job to RUNNING, increments attempts.
-- Only the lease owner can mark it running.
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_job_running(
    p_job_id UUID,
    p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE trade_jobs
    SET status = 'RUNNING',
        attempts = attempts + 1,
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE id = p_job_id
      AND lease_owner = p_worker_id
      AND status = 'LEASED';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

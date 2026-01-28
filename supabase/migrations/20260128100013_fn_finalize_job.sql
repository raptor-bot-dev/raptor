-- ============================================================================
-- RPC: finalize_job
-- ============================================================================
-- Completes a job with terminal status (DONE, FAILED, CANCELED).
-- For retryable failures, resets to QUEUED with exponential backoff.
-- Only the lease owner can finalize.
-- ============================================================================

CREATE OR REPLACE FUNCTION finalize_job(
    p_job_id UUID,
    p_worker_id TEXT,
    p_status TEXT,
    p_retryable BOOLEAN DEFAULT FALSE,
    p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_job trade_jobs%ROWTYPE;
    v_result JSONB;
    v_backoff_seconds INTEGER;
BEGIN
    -- Validate status
    IF p_status NOT IN ('DONE', 'FAILED', 'CANCELED') THEN
        RAISE EXCEPTION 'Invalid terminal status: %', p_status;
    END IF;

    -- Fetch current job state
    SELECT * INTO v_job
    FROM trade_jobs
    WHERE id = p_job_id AND lease_owner = p_worker_id
    FOR UPDATE;

    IF v_job IS NULL THEN
        RETURN NULL;
    END IF;

    -- If failed and retryable and under max_attempts, reset to QUEUED with backoff
    IF p_status = 'FAILED' AND p_retryable AND v_job.attempts < v_job.max_attempts THEN
        -- Exponential backoff: 5s, 10s, 20s, 40s...
        v_backoff_seconds := 5 * POWER(2, v_job.attempts - 1);

        UPDATE trade_jobs
        SET status = 'QUEUED',
            lease_owner = NULL,
            lease_expires_at = NULL,
            run_after = NOW() + (v_backoff_seconds || ' seconds')::INTERVAL,
            last_error = p_error,
            updated_at = NOW()
        WHERE id = p_job_id;
    ELSE
        -- Terminal state
        UPDATE trade_jobs
        SET status = p_status,
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = NOW(),
            last_error = CASE WHEN p_status = 'DONE' THEN NULL ELSE p_error END,
            updated_at = NOW()
        WHERE id = p_job_id;
    END IF;

    -- Return updated job
    SELECT row_to_json(t)::JSONB INTO v_result
    FROM trade_jobs t
    WHERE t.id = p_job_id;

    RETURN v_result;
END;
$$;

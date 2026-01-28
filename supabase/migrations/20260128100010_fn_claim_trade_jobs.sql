-- ============================================================================
-- RPC: claim_trade_jobs
-- ============================================================================
-- Atomically claim up to p_limit jobs for a worker using SKIP LOCKED.
-- Also reclaims stale leases (expired lease_expires_at).
-- Returns claimed jobs as JSONB array.
-- ============================================================================

CREATE OR REPLACE FUNCTION claim_trade_jobs(
    p_worker_id TEXT,
    p_limit INTEGER DEFAULT 5,
    p_lease_seconds INTEGER DEFAULT 30,
    p_chain TEXT DEFAULT 'sol'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_lease_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
    v_result JSONB;
BEGIN
    -- Claim available jobs: QUEUED or stale-leased or retryable FAILED
    -- Uses CTE + UPDATE with RETURNING to atomically claim and return
    WITH claimable AS (
        SELECT id
        FROM trade_jobs
        WHERE chain = p_chain
          AND run_after <= v_now
          AND (
              -- Fresh jobs
              status = 'QUEUED'
              -- Stale leases (worker crashed)
              OR (status = 'LEASED' AND lease_expires_at < v_now)
              -- Retryable failures (under max_attempts)
              OR (status = 'FAILED' AND attempts < max_attempts)
          )
        ORDER BY priority DESC, created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE trade_jobs
        SET status = 'LEASED',
            lease_owner = p_worker_id,
            lease_expires_at = v_lease_until,
            updated_at = v_now
        FROM claimable
        WHERE trade_jobs.id = claimable.id
        RETURNING trade_jobs.*
    )
    SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::JSONB)
    INTO v_result
    FROM claimed c;

    RETURN v_result;
END;
$$;

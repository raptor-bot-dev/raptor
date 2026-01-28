-- ============================================================================
-- RAPTOR Phase-X: Durable Trade Job Queue
-- ============================================================================
-- Creates the trade_jobs table and RPC functions for distributed job processing.
-- Uses SKIP LOCKED leasing for crash-safe, concurrent job claiming.
--
-- Job lifecycle: QUEUED -> LEASED -> RUNNING -> DONE | FAILED | CANCELED
-- ============================================================================

-- ============================================================================
-- trade_jobs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job identity
    strategy_id TEXT NOT NULL,
    user_id BIGINT NOT NULL,                    -- Telegram chat ID
    opportunity_id TEXT,
    chain TEXT NOT NULL DEFAULT 'sol',
    action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
    idempotency_key TEXT UNIQUE NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 100,

    -- Status machine
    status TEXT NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'LEASED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED')),

    -- Lease management (for distributed workers)
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,

    -- Retry management
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,

    -- Timestamps
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: claim pending jobs ordered by priority + creation time
CREATE INDEX IF NOT EXISTS idx_trade_jobs_claimable
    ON trade_jobs(priority DESC, created_at ASC)
    WHERE status IN ('QUEUED', 'FAILED');

-- Lookup by idempotency key
CREATE INDEX IF NOT EXISTS idx_trade_jobs_idempotency ON trade_jobs(idempotency_key);

-- Lookup by user
CREATE INDEX IF NOT EXISTS idx_trade_jobs_user_id ON trade_jobs(user_id);

-- Find stale leases for takeover
CREATE INDEX IF NOT EXISTS idx_trade_jobs_stale_leases
    ON trade_jobs(lease_expires_at)
    WHERE status = 'LEASED';

COMMENT ON TABLE trade_jobs IS 'Durable job queue for trade execution. SKIP LOCKED leasing for distributed workers.';

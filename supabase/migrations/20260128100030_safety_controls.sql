-- ============================================================================
-- RAPTOR: Safety Controls Table (F-008)
-- Global and per-user safety controls for trading automation
-- ============================================================================

CREATE TABLE IF NOT EXISTS safety_controls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope: 'GLOBAL' for system-wide, or user_id UUID string for per-user
    scope TEXT NOT NULL DEFAULT 'GLOBAL',

    -- Trading controls
    trading_paused BOOLEAN NOT NULL DEFAULT FALSE,
    auto_execute_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    manual_trading_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- Circuit breaker
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_breaker_threshold INTEGER NOT NULL DEFAULT 5,
    circuit_open_until TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Only one row per scope
    UNIQUE(scope)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_safety_controls_scope ON safety_controls(scope);

-- Insert default GLOBAL row
INSERT INTO safety_controls (scope)
VALUES ('GLOBAL')
ON CONFLICT (scope) DO NOTHING;

COMMENT ON TABLE safety_controls IS 'Global and per-user safety controls for trading automation.';

-- ============================================================================
-- RAPTOR Phase 3: Lifecycle & Pricing
-- ============================================================================
-- This migration adds graduation tracking columns and the atomic graduation
-- function for transitioning positions from PRE_GRADUATION to POST_GRADUATION.
-- ============================================================================

-- ============================================================================
-- 1. Add graduation tracking columns to positions
-- ============================================================================
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pool_address TEXT;

COMMENT ON COLUMN positions.graduated_at IS 'Timestamp when token graduated from bonding curve to AMM';
COMMENT ON COLUMN positions.pool_address IS 'AMM pool address after graduation (Raydium/Meteora)';

-- ============================================================================
-- 2. Index for graduation monitoring queries
-- ============================================================================
-- Efficiently find OPEN positions that need graduation monitoring
CREATE INDEX IF NOT EXISTS idx_positions_graduation_monitoring
ON positions (lifecycle_state, trigger_state)
WHERE lifecycle_state = 'PRE_GRADUATION' AND trigger_state IN ('MONITORING', 'TRIGGERED');

-- ============================================================================
-- 3. Atomic graduation function
-- ============================================================================
-- Transitions a position from PRE_GRADUATION to POST_GRADUATION atomically.
-- Returns TRUE if transition occurred, FALSE if already graduated or closed.
-- Uses row-level locking to prevent race conditions.
CREATE OR REPLACE FUNCTION graduate_position_atomically(
    p_position_id UUID,
    p_pool_address TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    -- Atomically update only if currently PRE_GRADUATION and not CLOSED
    UPDATE positions
    SET
        lifecycle_state = 'POST_GRADUATION',
        pricing_source = 'AMM_POOL',
        graduated_at = NOW(),
        pool_address = p_pool_address
    WHERE id = p_position_id
      AND lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state != 'COMPLETED';  -- Don't graduate already-closed positions

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION graduate_position_atomically IS 'Atomically transition position to POST_GRADUATION on token graduation';

-- ============================================================================
-- 4. Helper function to get pre-graduation positions by mint
-- ============================================================================
-- Returns positions that need graduation checking for a specific mint
CREATE OR REPLACE FUNCTION get_pre_graduation_positions_by_mint(p_mint TEXT)
RETURNS SETOF positions
LANGUAGE sql
STABLE
AS $$
    SELECT *
    FROM positions
    WHERE mint = p_mint
      AND lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state IN ('MONITORING', 'TRIGGERED')
    ORDER BY opened_at;
$$;

COMMENT ON FUNCTION get_pre_graduation_positions_by_mint IS 'Get open positions for a mint that need graduation monitoring';

-- ============================================================================
-- 5. Helper function to get all unique mints needing graduation monitoring
-- ============================================================================
CREATE OR REPLACE FUNCTION get_graduation_monitoring_mints()
RETURNS TABLE(mint TEXT, position_count BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT mint, COUNT(*) as position_count
    FROM positions
    WHERE lifecycle_state = 'PRE_GRADUATION'
      AND trigger_state IN ('MONITORING', 'TRIGGERED')
    GROUP BY mint
    ORDER BY position_count DESC;
$$;

COMMENT ON FUNCTION get_graduation_monitoring_mints IS 'Get unique mints with open pre-graduation positions';

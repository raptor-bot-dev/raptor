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
-- NOTE: Database functions are split into separate migrations because the
-- Supabase CLI migration runner cannot reliably parse multiple statements when
-- PL/pgSQL/$$ bodies are present in the same file.

-- ============================================================================
-- RAPTOR Phase-X: positions compatibility fields for bot UI
-- ============================================================================
-- Store tx signatures and close_reason directly on positions to support existing
-- bot panels without needing JSONB merge updates.
-- ============================================================================

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS entry_tx_sig TEXT,
  ADD COLUMN IF NOT EXISTS exit_tx_sig TEXT,
  ADD COLUMN IF NOT EXISTS close_reason TEXT;


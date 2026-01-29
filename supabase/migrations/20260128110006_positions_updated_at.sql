-- ============================================================================
-- RAPTOR Phase-X: positions.updated_at (compat + auditing)
-- ============================================================================
-- Phase-0 positions table tracks opened_at/closed_at and price_updated_at.
-- The runtime code updates `updated_at` in several hot paths; add it to avoid
-- runtime failures and to improve auditability of position mutations.
-- ============================================================================

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


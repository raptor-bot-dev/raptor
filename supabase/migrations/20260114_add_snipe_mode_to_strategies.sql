-- Migration: Add snipe_mode column to strategies table
-- v4.3: Per-user snipe mode for metadata fetch timeout control

-- Add snipe_mode column with default 'balanced'
ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS snipe_mode TEXT DEFAULT 'balanced';

-- Add check constraint for valid snipe modes
ALTER TABLE strategies
ADD CONSTRAINT strategies_snipe_mode_check
CHECK (snipe_mode IN ('speed', 'balanced', 'quality'));

-- Comment for documentation
COMMENT ON COLUMN strategies.snipe_mode IS 'Metadata fetch timeout mode: speed (0ms), balanced (200ms), quality (2000ms)';

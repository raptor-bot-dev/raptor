-- =============================================================================
-- RAPTOR v3.3 Migration 017: Add filter_mode to strategies
--
-- Problem: Too many tokens launching, need to filter by quality/activity.
--
-- Solution: Add filter_mode column with 3 options:
--   - strict: Require socials + activity check (3s delay)
--   - moderate: Activity check only (3s delay) - DEFAULT
--   - light: Require socials only, no delay
-- =============================================================================

ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS filter_mode TEXT DEFAULT 'moderate';

-- Add check constraint for valid values
ALTER TABLE strategies
ADD CONSTRAINT strategies_filter_mode_check
CHECK (filter_mode IN ('strict', 'moderate', 'light'));

-- Update existing rows to have the default
UPDATE strategies
SET filter_mode = 'moderate'
WHERE filter_mode IS NULL;

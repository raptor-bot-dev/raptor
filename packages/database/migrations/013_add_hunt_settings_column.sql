-- Migration: Add hunt_settings JSONB column to user_settings table
-- Fixes: "Could not find the 'hunt_settings' column" error
-- v5.0: The TypeScript code expects these JSONB columns but they were never added

-- Add the hunt_settings column as JSONB
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS hunt_settings JSONB DEFAULT '{}'::jsonb;

-- Also ensure other expected JSONB columns exist
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS gas_settings JSONB DEFAULT '{}'::jsonb;

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS slippage_settings JSONB DEFAULT '{}'::jsonb;

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS strategy_settings JSONB DEFAULT '{}'::jsonb;

-- Migrate existing data from separate hunt_settings table if it exists
-- This copies existing hunt settings into the new JSONB column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hunt_settings') THEN
    UPDATE user_settings us
    SET hunt_settings = (
      SELECT jsonb_object_agg(hs.chain, jsonb_build_object(
        'enabled', hs.enabled,
        'min_score', hs.min_score,
        'max_position_size', hs.max_position_size,
        'launchpads', hs.launchpads
      ))
      FROM hunt_settings hs
      WHERE hs.tg_id = us.tg_id
    )
    WHERE EXISTS (
      SELECT 1 FROM hunt_settings hs WHERE hs.tg_id = us.tg_id
    );
  END IF;
END $$;

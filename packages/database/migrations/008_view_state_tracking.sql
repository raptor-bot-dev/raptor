-- =============================================================================
-- RAPTOR v3.2 View State Tracking Migration
-- Fixes the sell panel 20-second revert bug by tracking UI view state
-- =============================================================================

-- Add view state column to trade_monitors
-- Tracks which view the user is currently seeing for this monitor
ALTER TABLE trade_monitors 
ADD COLUMN IF NOT EXISTS current_view TEXT NOT NULL DEFAULT 'MONITOR' 
CHECK (current_view IN ('MONITOR', 'SELL', 'TOKEN'));

-- Add view state timestamp for debugging/timeout logic
ALTER TABLE trade_monitors 
ADD COLUMN IF NOT EXISTS view_changed_at TIMESTAMPTZ DEFAULT NOW();

-- Index for efficient view state queries
CREATE INDEX IF NOT EXISTS idx_trade_monitors_view_state 
ON trade_monitors(user_id, mint, current_view) 
WHERE status = 'ACTIVE';

-- =============================================================================
-- RPC Functions for View State Management
-- =============================================================================

-- Set the current view for a monitor
CREATE OR REPLACE FUNCTION set_monitor_view(
  p_user_id BIGINT,
  p_mint TEXT,
  p_view TEXT
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  UPDATE trade_monitors
  SET current_view = p_view,
      view_changed_at = NOW()
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  RETURNING * INTO v_monitor;
  
  RETURN v_monitor;
END;
$$;

-- Get monitors for refresh, but SKIP those in SELL view
-- This is the core fix for the 20-second revert bug
CREATE OR REPLACE FUNCTION get_monitors_for_refresh(
  p_batch_size INTEGER DEFAULT 20,
  p_min_age_seconds INTEGER DEFAULT 15
)
RETURNS SETOF trade_monitors
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM trade_monitors
  WHERE status = 'ACTIVE'
    AND expires_at > NOW()
    AND last_refreshed_at < NOW() - (p_min_age_seconds || ' seconds')::INTERVAL
    AND current_view = 'MONITOR'  -- CRITICAL: Skip monitors in SELL view
  ORDER BY last_refreshed_at ASC
  LIMIT p_batch_size
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- Get monitor by user+mint with view state
CREATE OR REPLACE FUNCTION get_user_monitor(
  p_user_id BIGINT,
  p_mint TEXT
)
RETURNS trade_monitors
LANGUAGE plpgsql
AS $$
DECLARE
  v_monitor trade_monitors;
BEGIN
  SELECT * INTO v_monitor
  FROM trade_monitors
  WHERE user_id = p_user_id
    AND mint = p_mint
    AND status = 'ACTIVE'
  LIMIT 1;

  RETURN v_monitor;
END;
$$;

-- =============================================================================
-- Manual Settings Table (separated from AutoHunt settings)
-- =============================================================================

-- Create manual_settings table for buy/sell UI preferences
CREATE TABLE IF NOT EXISTS manual_settings (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  
  -- Slippage settings (in basis points, e.g., 500 = 5%)
  default_slippage_bps INTEGER NOT NULL DEFAULT 500,
  
  -- Priority fee settings (in SOL)
  default_priority_sol DECIMAL(10, 6) NOT NULL DEFAULT 0.0001,
  
  -- Quick buy amounts (SOL) - stored as JSON array
  quick_buy_amounts JSONB NOT NULL DEFAULT '[0.1, 0.25, 0.5, 1, 2]',
  
  -- Quick sell percentages - stored as JSON array  
  quick_sell_percents JSONB NOT NULL DEFAULT '[10, 25, 50, 75, 100]',
  
  -- UI preferences
  show_usd_values BOOLEAN NOT NULL DEFAULT true,
  confirm_large_trades BOOLEAN NOT NULL DEFAULT true,
  large_trade_threshold_sol DECIMAL(10, 4) NOT NULL DEFAULT 1.0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_manual_settings_user_id ON manual_settings(user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_manual_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS manual_settings_updated_at ON manual_settings;
CREATE TRIGGER manual_settings_updated_at
  BEFORE UPDATE ON manual_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_manual_settings_updated_at();

-- =============================================================================
-- RPC Functions for Manual Settings
-- =============================================================================

-- Get or create manual settings for user
CREATE OR REPLACE FUNCTION get_or_create_manual_settings(
  p_user_id BIGINT
)
RETURNS manual_settings
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings manual_settings;
BEGIN
  -- Try to find existing
  SELECT * INTO v_settings
  FROM manual_settings
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    -- Create with defaults
    INSERT INTO manual_settings (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_settings;
  END IF;
  
  RETURN v_settings;
END;
$$;

-- Update manual settings
CREATE OR REPLACE FUNCTION update_manual_settings(
  p_user_id BIGINT,
  p_slippage_bps INTEGER DEFAULT NULL,
  p_priority_sol DECIMAL DEFAULT NULL,
  p_quick_buy_amounts JSONB DEFAULT NULL,
  p_quick_sell_percents JSONB DEFAULT NULL
)
RETURNS manual_settings
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings manual_settings;
BEGIN
  -- Ensure settings exist
  PERFORM get_or_create_manual_settings(p_user_id);
  
  -- Update only provided fields
  UPDATE manual_settings
  SET default_slippage_bps = COALESCE(p_slippage_bps, default_slippage_bps),
      default_priority_sol = COALESCE(p_priority_sol, default_priority_sol),
      quick_buy_amounts = COALESCE(p_quick_buy_amounts, quick_buy_amounts),
      quick_sell_percents = COALESCE(p_quick_sell_percents, quick_sell_percents)
  WHERE user_id = p_user_id
  RETURNING * INTO v_settings;
  
  RETURN v_settings;
END;
$$;

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT ALL ON manual_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON manual_settings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE manual_settings_id_seq TO authenticated;

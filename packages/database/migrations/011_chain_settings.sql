-- Migration 011: Chain-specific settings for manual trading
-- Adds per-chain configuration for slippage, gas/priority, and anti-MEV

-- Create chain_settings table
CREATE TABLE IF NOT EXISTS chain_settings (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chain VARCHAR(10) NOT NULL,  -- 'sol', 'eth', 'base', 'bsc'

  -- Slippage (basis points)
  buy_slippage_bps INTEGER NOT NULL DEFAULT 500,   -- 5%
  sell_slippage_bps INTEGER NOT NULL DEFAULT 300,  -- 3%

  -- Gas/Priority
  gas_gwei DECIMAL(10, 2),           -- EVM: gwei (null for SOL)
  priority_sol DECIMAL(10, 6),       -- SOL: priority fee (null for EVM)

  -- Anti-MEV
  anti_mev_enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, chain)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_chain_settings_user_chain ON chain_settings(user_id, chain);

-- Get or create chain settings with chain-specific defaults
CREATE OR REPLACE FUNCTION get_or_create_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10)
) RETURNS chain_settings AS $$
DECLARE
  result chain_settings;
  default_buy_slip INTEGER;
  default_sell_slip INTEGER;
  default_gas DECIMAL(10,2);
  default_priority DECIMAL(10,6);
BEGIN
  -- Set chain-specific defaults
  CASE p_chain
    WHEN 'sol' THEN
      default_buy_slip := 1000;  -- 10%
      default_sell_slip := 800;  -- 8%
      default_priority := 0.0001;
      default_gas := NULL;
    WHEN 'eth' THEN
      default_buy_slip := 500;   -- 5%
      default_sell_slip := 300;  -- 3%
      default_gas := 30;
      default_priority := NULL;
    WHEN 'base' THEN
      default_buy_slip := 1000;  -- 10%
      default_sell_slip := 800;  -- 8%
      default_gas := 0.1;
      default_priority := NULL;
    WHEN 'bsc' THEN
      default_buy_slip := 1500;  -- 15%
      default_sell_slip := 1000; -- 10%
      default_gas := 5;
      default_priority := NULL;
    ELSE
      -- Default fallback
      default_buy_slip := 500;
      default_sell_slip := 300;
      default_gas := NULL;
      default_priority := NULL;
  END CASE;

  -- Insert with defaults if not exists
  INSERT INTO chain_settings (
    user_id, chain, buy_slippage_bps, sell_slippage_bps, gas_gwei, priority_sol
  )
  VALUES (
    p_user_id, p_chain, default_buy_slip, default_sell_slip, default_gas, default_priority
  )
  ON CONFLICT (user_id, chain) DO NOTHING;

  -- Return the settings
  SELECT * INTO result FROM chain_settings WHERE user_id = p_user_id AND chain = p_chain;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update chain settings (only updates non-null parameters)
CREATE OR REPLACE FUNCTION update_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10),
  p_buy_slippage_bps INTEGER DEFAULT NULL,
  p_sell_slippage_bps INTEGER DEFAULT NULL,
  p_gas_gwei DECIMAL(10,2) DEFAULT NULL,
  p_priority_sol DECIMAL(10,6) DEFAULT NULL,
  p_anti_mev_enabled BOOLEAN DEFAULT NULL
) RETURNS chain_settings AS $$
DECLARE
  result chain_settings;
BEGIN
  -- Ensure settings exist first
  PERFORM get_or_create_chain_settings(p_user_id, p_chain);

  -- Update only provided fields
  UPDATE chain_settings SET
    buy_slippage_bps = COALESCE(p_buy_slippage_bps, buy_slippage_bps),
    sell_slippage_bps = COALESCE(p_sell_slippage_bps, sell_slippage_bps),
    gas_gwei = COALESCE(p_gas_gwei, gas_gwei),
    priority_sol = COALESCE(p_priority_sol, priority_sol),
    anti_mev_enabled = COALESCE(p_anti_mev_enabled, anti_mev_enabled),
    updated_at = NOW()
  WHERE user_id = p_user_id AND chain = p_chain
  RETURNING * INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Reset chain settings to defaults
CREATE OR REPLACE FUNCTION reset_chain_settings(
  p_user_id BIGINT,
  p_chain VARCHAR(10)
) RETURNS chain_settings AS $$
BEGIN
  -- Delete existing and recreate with defaults
  DELETE FROM chain_settings WHERE user_id = p_user_id AND chain = p_chain;
  RETURN get_or_create_chain_settings(p_user_id, p_chain);
END;
$$ LANGUAGE plpgsql;

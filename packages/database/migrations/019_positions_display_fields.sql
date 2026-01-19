-- Migration 019: Add display accuracy columns for positions
-- Supports accurate MC display and token decimals tracking

-- Add display accuracy columns
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_decimals SMALLINT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_mc_sol NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_mc_usd NUMERIC(36, 18);

-- Backfill existing positions with pump.fun defaults (6 decimals for sol chain)
UPDATE positions SET token_decimals = 6 WHERE token_decimals IS NULL AND chain = 'sol';

-- Add column comments for documentation
COMMENT ON COLUMN positions.token_decimals IS 'Token decimals from mint (default 6 for pump.fun, 9 for pump.pro)';
COMMENT ON COLUMN positions.entry_mc_sol IS 'Market cap in SOL at entry time';
COMMENT ON COLUMN positions.entry_mc_usd IS 'Market cap in USD at entry time';

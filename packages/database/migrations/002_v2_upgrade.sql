-- RAPTOR v2 Upgrade Migration
-- Adds: Solana chain support, trading modes (pool/solo/snipe), 1% fee tracking

-- ============================================================================
-- Step 1: Add mode column to user_balances
-- ============================================================================
ALTER TABLE user_balances ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'pool';

-- Drop old unique constraint and add new one with mode
ALTER TABLE user_balances DROP CONSTRAINT IF EXISTS user_balances_tg_id_chain_key;
ALTER TABLE user_balances ADD CONSTRAINT user_balances_unique UNIQUE(tg_id, chain, mode);

-- ============================================================================
-- Step 2: Add mode column to positions
-- ============================================================================
ALTER TABLE positions ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'pool';

-- ============================================================================
-- Step 3: Add mode and fee columns to trades
-- ============================================================================
ALTER TABLE trades ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'pool';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(36, 18) DEFAULT 0;

-- ============================================================================
-- Step 4: Create fees tracking table
-- ============================================================================
CREATE TABLE IF NOT EXISTS fees (
  id SERIAL PRIMARY KEY,
  trade_id INT REFERENCES trades(id),
  tg_id BIGINT REFERENCES users(tg_id),
  chain TEXT NOT NULL,
  amount DECIMAL(36, 18) NOT NULL,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Step 5: Create snipe_requests table
-- ============================================================================
CREATE TABLE IF NOT EXISTS snipe_requests (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT REFERENCES users(tg_id),
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  amount DECIMAL(36, 18) NOT NULL,
  take_profit_percent INT DEFAULT 50,
  stop_loss_percent INT DEFAULT 30,
  skip_safety_check BOOLEAN DEFAULT FALSE,
  position_id INT REFERENCES positions(id),
  status TEXT DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- ============================================================================
-- Step 6: Update chain constraints to include ETH and Solana
-- ============================================================================
-- Drop existing constraints if they exist
ALTER TABLE user_balances DROP CONSTRAINT IF EXISTS user_balances_chain_check;
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_chain_check;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_chain_check;
ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_chain_check;
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_chain_check;

-- Add new chain constraints including eth and sol
ALTER TABLE user_balances ADD CONSTRAINT user_balances_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE positions ADD CONSTRAINT positions_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE trades ADD CONSTRAINT trades_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE deposits ADD CONSTRAINT deposits_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- Add chain constraint to new tables
ALTER TABLE fees ADD CONSTRAINT fees_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE snipe_requests ADD CONSTRAINT snipe_requests_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

-- ============================================================================
-- Step 7: Add mode constraints
-- ============================================================================
ALTER TABLE user_balances ADD CONSTRAINT user_balances_mode_check
  CHECK (mode IN ('pool', 'solo', 'snipe'));

ALTER TABLE positions ADD CONSTRAINT positions_mode_check
  CHECK (mode IN ('pool', 'solo', 'snipe'));

ALTER TABLE trades ADD CONSTRAINT trades_mode_check
  CHECK (mode IN ('pool', 'solo', 'snipe'));

-- ============================================================================
-- Step 8: Add snipe_requests status constraint
-- ============================================================================
ALTER TABLE snipe_requests ADD CONSTRAINT snipe_requests_status_check
  CHECK (status IN ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED'));

-- ============================================================================
-- Step 9: Create indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_fees_tg_id ON fees(tg_id);
CREATE INDEX IF NOT EXISTS idx_fees_chain ON fees(chain);
CREATE INDEX IF NOT EXISTS idx_fees_created_at ON fees(created_at);

CREATE INDEX IF NOT EXISTS idx_snipe_requests_tg_id ON snipe_requests(tg_id);
CREATE INDEX IF NOT EXISTS idx_snipe_requests_status ON snipe_requests(status);
CREATE INDEX IF NOT EXISTS idx_snipe_requests_chain ON snipe_requests(chain);
CREATE INDEX IF NOT EXISTS idx_snipe_requests_created_at ON snipe_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_user_balances_mode ON user_balances(mode);
CREATE INDEX IF NOT EXISTS idx_positions_mode ON positions(mode);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);

-- ============================================================================
-- Step 10: Add Solana-specific columns to positions
-- ============================================================================
-- Solana uses base58 addresses which can be longer
ALTER TABLE positions ALTER COLUMN token_address TYPE TEXT;

-- Add program_id for Solana tokens (pump.fun, Raydium, etc.)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS program_id TEXT;

-- ============================================================================
-- Step 11: Create user_mode_preferences table
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_mode_preferences (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT REFERENCES users(tg_id),
  chain TEXT NOT NULL,
  default_mode TEXT DEFAULT 'pool',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tg_id, chain)
);

ALTER TABLE user_mode_preferences ADD CONSTRAINT user_mode_preferences_chain_check
  CHECK (chain IN ('bsc', 'base', 'eth', 'sol'));

ALTER TABLE user_mode_preferences ADD CONSTRAINT user_mode_preferences_mode_check
  CHECK (default_mode IN ('pool', 'solo', 'snipe'));

-- ============================================================================
-- Step 12: Add fee_wallet tracking for withdrawals
-- ============================================================================
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(36, 18) DEFAULT 0;

-- ============================================================================
-- Done
-- ============================================================================

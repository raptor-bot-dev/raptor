-- RAPTOR Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  tg_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- User balances per chain
CREATE TABLE IF NOT EXISTS user_balances (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'base', 'eth')),
  deposited NUMERIC(36, 18) DEFAULT 0,
  current_value NUMERIC(36, 18) DEFAULT 0,
  deposit_address TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tg_id, chain)
);

-- Positions (active trades)
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'base', 'eth')),
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  amount_in NUMERIC(36, 18) NOT NULL,
  tokens_held NUMERIC(36, 18) NOT NULL,
  entry_price NUMERIC(36, 18) NOT NULL,
  current_price NUMERIC(36, 18) NOT NULL,
  unrealized_pnl NUMERIC(36, 18) DEFAULT 0,
  unrealized_pnl_percent NUMERIC(10, 4) DEFAULT 0,
  take_profit_percent INTEGER DEFAULT 50,
  stop_loss_percent INTEGER DEFAULT 30,
  source TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED', 'PENDING')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- Trades (buy/sell records)
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'base', 'eth')),
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  amount_in NUMERIC(36, 18) NOT NULL,
  amount_out NUMERIC(36, 18) NOT NULL,
  price NUMERIC(36, 18) NOT NULL,
  pnl NUMERIC(36, 18),
  pnl_percent NUMERIC(10, 4),
  source TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deposit tracking
CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'base', 'eth')),
  amount NUMERIC(36, 18) NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  from_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'base', 'eth')),
  amount NUMERIC(36, 18) NOT NULL,
  to_address TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- User settings
CREATE TABLE IF NOT EXISTS user_settings (
  tg_id BIGINT PRIMARY KEY REFERENCES users(tg_id) ON DELETE CASCADE,
  alerts_enabled BOOLEAN DEFAULT TRUE,
  daily_summary_enabled BOOLEAN DEFAULT TRUE,
  min_position_alert NUMERIC(36, 18) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_positions_tg_id_status ON positions(tg_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_trades_tg_id ON trades(tg_id);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_user_balances_tg_id ON user_balances(tg_id);
CREATE INDEX IF NOT EXISTS idx_deposits_tg_id ON deposits(tg_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_tg_id ON withdrawals(tg_id);

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for backend)
-- These policies allow the service key to access all data
CREATE POLICY "Service role has full access to users"
  ON users FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to user_balances"
  ON user_balances FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to positions"
  ON positions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to trades"
  ON trades FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to deposits"
  ON deposits FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to withdrawals"
  ON withdrawals FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to user_settings"
  ON user_settings FOR ALL
  USING (true)
  WITH CHECK (true);

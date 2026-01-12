-- RAPTOR v3.1 Complete Architecture Migration
-- ============================================================================
-- This migration transforms RAPTOR to the v3.1 architecture with:
-- - New tables: strategies, opportunities, trade_jobs, executions, notifications, safety_controls, cooldowns
-- - Updated tables: users, user_wallets, positions
-- - RPC functions for atomic operations
-- - State machine support
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 1: UPDATE EXISTING TABLES
-- ============================================================================

-- 1.1 Update users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate existing column names if they exist
UPDATE users SET tg_username = username WHERE tg_username IS NULL AND username IS NOT NULL;
UPDATE users SET tg_first_name = first_name WHERE tg_first_name IS NULL AND first_name IS NOT NULL;

-- Add unique constraint on referral_code
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral
  ON users(referral_code) WHERE referral_code IS NOT NULL;

-- 1.2 Update user_wallets table
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS encrypted_secret TEXT;
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS enc_version INTEGER DEFAULT 2;
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate from old column names if they exist
UPDATE user_wallets
SET public_key = COALESCE(public_key, solana_address, evm_address),
    encrypted_secret = COALESCE(encrypted_secret,
      CASE WHEN chain = 'sol' THEN solana_private_key_encrypted::TEXT
           ELSE evm_private_key_encrypted::TEXT END)
WHERE public_key IS NULL;

-- Create unique index for active wallet per user+chain
DROP INDEX IF EXISTS uq_wallet_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_active
  ON user_wallets(tg_id, chain)
  WHERE is_active = TRUE;

-- Rename tg_id to user_id for consistency (if needed)
-- ALTER TABLE user_wallets RENAME COLUMN tg_id TO user_id;

-- 1.3 Update positions table (significant changes)
-- Rename id column from SERIAL to UUID
ALTER TABLE positions ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();

-- Add new columns
ALTER TABLE positions ADD COLUMN IF NOT EXISTS strategy_id UUID;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS opportunity_id UUID;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_mint TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_name TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_execution_id UUID;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_tx_sig TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_cost_sol NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS size_tokens NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS current_price NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_execution_id UUID;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_tx_sig TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_price NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_value_sol NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS realized_pnl_sol NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS realized_pnl_percent NUMERIC(10, 4);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE positions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate existing data to new columns
UPDATE positions
SET token_mint = COALESCE(token_mint, token_address),
    entry_cost_sol = COALESCE(entry_cost_sol, CAST(amount_in AS NUMERIC)),
    size_tokens = COALESCE(size_tokens, CAST(tokens_held AS NUMERIC)),
    opened_at = COALESCE(opened_at, created_at)
WHERE token_mint IS NULL;

-- Update status values to new format
UPDATE positions SET status = 'OPEN' WHERE status = 'ACTIVE';

-- ============================================================================
-- SECTION 2: CREATE NEW TABLES
-- ============================================================================

-- 2.1 STRATEGIES table
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('MANUAL', 'AUTO')),
  name TEXT NOT NULL,

  enabled BOOLEAN DEFAULT TRUE,
  auto_execute BOOLEAN DEFAULT FALSE,

  chain TEXT NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol', 'bsc', 'base', 'eth')),
  risk_profile TEXT DEFAULT 'BALANCED' CHECK (risk_profile IN ('SAFE', 'BALANCED', 'DEGEN')),

  -- Position limits
  max_positions INTEGER DEFAULT 10,
  max_per_trade_sol NUMERIC(36, 18) DEFAULT 0.5,
  max_daily_sol NUMERIC(36, 18) DEFAULT 5,
  max_open_exposure_sol NUMERIC(36, 18) DEFAULT 10,

  -- Execution params
  slippage_bps INTEGER DEFAULT 1500,
  priority_fee_lamports BIGINT,

  -- Exit strategy
  take_profit_percent NUMERIC(6, 2) DEFAULT 50,
  stop_loss_percent NUMERIC(6, 2) DEFAULT 30,
  max_hold_minutes INTEGER DEFAULT 240,

  -- Trailing stop
  trailing_enabled BOOLEAN DEFAULT FALSE,
  trailing_activation_percent NUMERIC(6, 2),
  trailing_distance_percent NUMERIC(6, 2),

  -- DCA (future)
  dca_enabled BOOLEAN DEFAULT FALSE,
  dca_levels JSONB DEFAULT '[]'::jsonb,

  -- Moon bag
  moon_bag_percent NUMERIC(5, 2) DEFAULT 0,

  -- Filters for auto strategies
  min_score INTEGER DEFAULT 23,
  min_liquidity_sol NUMERIC(36, 18) DEFAULT 5,
  allowed_launchpads TEXT[] DEFAULT ARRAY['pump.fun'],

  -- Cooldown
  cooldown_seconds INTEGER DEFAULT 300,

  -- Blocklists
  token_allowlist JSONB DEFAULT '[]'::jsonb,
  token_denylist JSONB DEFAULT '[]'::jsonb,
  deployer_denylist JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, kind, name)
);

CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_auto ON strategies(chain, enabled, auto_execute)
  WHERE enabled = TRUE AND auto_execute = TRUE;

-- 2.2 OPPORTUNITIES table
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  chain TEXT NOT NULL CHECK (chain IN ('sol', 'bsc', 'base', 'eth')),
  source TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_name TEXT,
  token_symbol TEXT,

  detected_at TIMESTAMPTZ DEFAULT NOW(),

  score INTEGER,
  reasons JSONB,
  raw_data JSONB,

  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'QUALIFIED', 'REJECTED', 'EXPIRED', 'EXECUTING', 'COMPLETED'
  )),
  status_reason TEXT,
  outcome TEXT CHECK (outcome IN ('SUCCESS', 'FAILED', 'MIXED')),

  deployer TEXT,
  bonding_curve TEXT,
  initial_liquidity_sol NUMERIC(36, 18),
  bonding_progress_percent NUMERIC(6, 2),

  matched_strategy_ids UUID[],

  qualified_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_mint
  ON opportunities(chain, source, token_mint);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_new ON opportunities(status, chain)
  WHERE status IN ('NEW', 'QUALIFIED');

-- 2.3 TRADE_JOBS table (auto-execution queue)
CREATE TABLE IF NOT EXISTS trade_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  chain TEXT NOT NULL CHECK (chain IN ('sol', 'bsc', 'base', 'eth')),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),

  payload JSONB NOT NULL,

  idempotency_key TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED', 'LEASED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED'
  )),

  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,

  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,

  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  priority INTEGER NOT NULL DEFAULT 100,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue ON trade_jobs(status, run_after, priority, created_at)
  WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS idx_jobs_leased ON trade_jobs(lease_owner, lease_expires_at)
  WHERE status = 'LEASED';
CREATE INDEX IF NOT EXISTS idx_jobs_opportunity ON trade_jobs(opportunity_id)
  WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user ON trade_jobs(user_id, created_at DESC);

-- 2.4 EXECUTIONS table (audit trail + spend ledger)
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mode TEXT NOT NULL CHECK (mode IN ('MANUAL', 'AUTO')),
  job_id UUID REFERENCES trade_jobs(id) ON DELETE SET NULL,

  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,

  chain TEXT NOT NULL CHECK (chain IN ('sol', 'bsc', 'base', 'eth')),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  token_mint TEXT NOT NULL,

  idempotency_key TEXT,

  attempt INTEGER NOT NULL DEFAULT 1,

  amount_in_sol NUMERIC(36, 18),
  tokens_out NUMERIC(36, 18),
  price_per_token NUMERIC(36, 18),

  tx_sig TEXT,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,

  status TEXT NOT NULL CHECK (status IN (
    'RESERVED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELED'
  )),

  error TEXT,
  error_code TEXT,
  logs JSONB,
  result JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_idempotency
  ON executions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executions_user_day ON executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_job ON executions(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_executions_stale ON executions(status, created_at)
  WHERE status IN ('RESERVED', 'SUBMITTED');

-- 2.5 NOTIFICATIONS table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN (
    'OPPORTUNITY', 'OPPORTUNITY_DETECTED', 'TRADE_QUEUED', 'TRADE_DONE', 'TRADE_FAILED',
    'BUY_CONFIRMED', 'BUY_FAILED', 'SELL_CONFIRMED', 'SELL_FAILED',
    'POSITION_OPENED', 'POSITION_CLOSED',
    'TAKE_PROFIT', 'STOP_LOSS', 'TRAILING_STOP', 'TP_HIT', 'SL_HIT', 'TRAILING_STOP_HIT',
    'MAX_HOLD', 'RISK_ALERT', 'BUDGET_WARNING', 'KILL_SWITCH', 'CIRCUIT_BREAKER', 'DAILY_SUMMARY'
  )),

  payload JSONB NOT NULL,

  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications(next_attempt_at, created_at)
  WHERE delivered_at IS NULL;

-- 2.6 SAFETY_CONTROLS table
CREATE TABLE IF NOT EXISTS safety_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'USER')),
  user_id BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,

  auto_execute_enabled BOOLEAN DEFAULT TRUE,
  manual_trading_enabled BOOLEAN DEFAULT TRUE,
  trading_paused BOOLEAN DEFAULT FALSE,
  pause_reason TEXT,

  consecutive_failures INTEGER DEFAULT 0,
  circuit_breaker_threshold INTEGER DEFAULT 5,
  circuit_open_until TIMESTAMPTZ,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT scope_user_consistency CHECK (
    (scope = 'GLOBAL' AND user_id IS NULL) OR
    (scope = 'USER' AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_global
  ON safety_controls(scope)
  WHERE scope = 'GLOBAL';
CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_user
  ON safety_controls(user_id)
  WHERE scope = 'USER';

-- Insert default GLOBAL row
INSERT INTO safety_controls (scope, user_id, auto_execute_enabled, manual_trading_enabled)
VALUES ('GLOBAL', NULL, TRUE, TRUE)
ON CONFLICT DO NOTHING;

-- 2.7 COOLDOWNS table
CREATE TABLE IF NOT EXISTS cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  chain TEXT NOT NULL CHECK (chain IN ('sol', 'bsc', 'base', 'eth')),
  cooldown_type TEXT NOT NULL CHECK (cooldown_type IN ('MINT', 'DEPLOYER', 'USER_MINT')),
  target TEXT NOT NULL,

  cooldown_until TIMESTAMPTZ NOT NULL,
  reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(chain, cooldown_type, target)
);

CREATE INDEX IF NOT EXISTS idx_cooldowns_lookup ON cooldowns(chain, cooldown_type, target);
CREATE INDEX IF NOT EXISTS idx_cooldowns_expiry ON cooldowns(cooldown_until);

-- ============================================================================
-- SECTION 3: TRIGGERS FOR updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_wallets_updated ON user_wallets;
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON user_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_strategies_updated ON strategies;
CREATE TRIGGER trg_strategies_updated BEFORE UPDATE ON strategies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_opportunities_updated ON opportunities;
CREATE TRIGGER trg_opportunities_updated BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated ON trade_jobs;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON trade_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_executions_updated ON executions;
CREATE TRIGGER trg_executions_updated BEFORE UPDATE ON executions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_positions_updated ON positions;
CREATE TRIGGER trg_positions_updated BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_safety_updated ON safety_controls;
CREATE TRIGGER trg_safety_updated BEFORE UPDATE ON safety_controls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- SECTION 4: RPC FUNCTIONS
-- ============================================================================

-- 4.1 reserve_trade_budget - Atomic check + reserve
CREATE OR REPLACE FUNCTION reserve_trade_budget(
  p_mode TEXT,
  p_user_id BIGINT,
  p_strategy_id UUID,
  p_chain TEXT,
  p_action TEXT,
  p_token_mint TEXT,
  p_amount_sol NUMERIC,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_global safety_controls;
  v_strategy strategies;
  v_open_positions INT;
  v_daily_spent NUMERIC;
  v_current_exposure NUMERIC;
  v_existing_execution executions;
  v_reservation_id UUID;
  v_cooldown_active BOOLEAN;
BEGIN
  -- Validate mode
  IF p_mode NOT IN ('MANUAL', 'AUTO') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Invalid mode');
  END IF;

  -- ========================================
  -- 1. CHECK IDEMPOTENCY (prevent double-reserve)
  -- ========================================

  SELECT * INTO v_existing_execution
  FROM executions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_execution.status IN ('CONFIRMED', 'FAILED', 'CANCELED') THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'Already executed',
        'execution_id', v_existing_execution.id,
        'status', v_existing_execution.status
      );
    END IF;

    -- Stale RESERVED/SUBMITTED (older than 5 min) - allow takeover
    IF v_existing_execution.created_at < NOW() - INTERVAL '5 minutes' THEN
      UPDATE executions
      SET status = 'RESERVED',
          created_at = NOW(),
          updated_at = NOW()
      WHERE id = v_existing_execution.id;

      RETURN jsonb_build_object(
        'allowed', true,
        'reservation_id', v_existing_execution.id,
        'takeover', true
      );
    END IF;

    -- Recent pending - block
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Already processing',
      'execution_id', v_existing_execution.id
    );
  END IF;

  -- ========================================
  -- 2. GLOBAL SAFETY CHECKS
  -- ========================================

  SELECT * INTO v_global
  FROM safety_controls
  WHERE scope = 'GLOBAL';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Safety controls not initialized');
  END IF;

  IF v_global.trading_paused THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', COALESCE(v_global.pause_reason, 'Trading is globally paused')
    );
  END IF;

  IF v_global.circuit_open_until IS NOT NULL AND v_global.circuit_open_until > NOW() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', format('Circuit breaker open until %s', v_global.circuit_open_until)
    );
  END IF;

  IF p_mode = 'AUTO' AND NOT v_global.auto_execute_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Auto-execute globally disabled');
  END IF;

  IF p_mode = 'MANUAL' AND NOT v_global.manual_trading_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Manual trading globally disabled');
  END IF;

  -- ========================================
  -- 3. STRATEGY VALIDATION
  -- ========================================

  SELECT * INTO v_strategy
  FROM strategies
  WHERE id = p_strategy_id
    AND user_id = p_user_id
    AND enabled = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Strategy not found or disabled');
  END IF;

  IF p_mode = 'AUTO' AND NOT v_strategy.auto_execute THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Strategy auto_execute is off');
  END IF;

  -- ========================================
  -- 4. LIMIT CHECKS
  -- ========================================

  -- Max per trade
  IF p_amount_sol > v_strategy.max_per_trade_sol THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', format('Exceeds max per trade: %.4f > %.4f SOL',
                       p_amount_sol, v_strategy.max_per_trade_sol)
    );
  END IF;

  -- Daily limit (includes RESERVED + SUBMITTED + CONFIRMED from today)
  SELECT COALESCE(SUM(amount_in_sol), 0) INTO v_daily_spent
  FROM executions
  WHERE user_id = p_user_id
    AND chain = p_chain
    AND created_at >= date_trunc('day', NOW())
    AND status IN ('RESERVED', 'SUBMITTED', 'CONFIRMED');

  IF (v_daily_spent + p_amount_sol) > v_strategy.max_daily_sol THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', format('Daily limit exceeded: %.4f + %.4f > %.4f SOL',
                       v_daily_spent, p_amount_sol, v_strategy.max_daily_sol)
    );
  END IF;

  -- Max positions (for BUY only)
  IF p_action = 'BUY' THEN
    SELECT COUNT(*) INTO v_open_positions
    FROM positions
    WHERE tg_id = p_user_id
      AND chain = p_chain
      AND status = 'OPEN';

    IF v_open_positions >= v_strategy.max_positions THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', format('Max positions reached: %s', v_strategy.max_positions)
      );
    END IF;
  END IF;

  -- Max exposure (for BUY only)
  IF p_action = 'BUY' THEN
    SELECT COALESCE(SUM(entry_cost_sol), 0) INTO v_current_exposure
    FROM positions
    WHERE tg_id = p_user_id
      AND chain = p_chain
      AND status = 'OPEN';

    IF (v_current_exposure + p_amount_sol) > v_strategy.max_open_exposure_sol THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', format('Max exposure exceeded: %.4f + %.4f > %.4f SOL',
                         v_current_exposure, p_amount_sol, v_strategy.max_open_exposure_sol)
      );
    END IF;
  END IF;

  -- ========================================
  -- 5. COOLDOWN CHECK
  -- ========================================

  IF p_action = 'BUY' THEN
    SELECT EXISTS (
      SELECT 1 FROM cooldowns
      WHERE chain = p_chain
        AND (
          (cooldown_type = 'MINT' AND target = p_token_mint)
          OR (cooldown_type = 'USER_MINT' AND target = p_user_id || ':' || p_token_mint)
        )
        AND cooldown_until > NOW()
    ) INTO v_cooldown_active;

    IF v_cooldown_active THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Cooldown active for this token');
    END IF;
  END IF;

  -- ========================================
  -- 6. CREATE RESERVATION (atomic)
  -- ========================================

  v_reservation_id := gen_random_uuid();

  INSERT INTO executions (
    id, mode, user_id, strategy_id, chain, action, token_mint,
    amount_in_sol, idempotency_key, status, created_at
  ) VALUES (
    v_reservation_id, p_mode, p_user_id, p_strategy_id, p_chain, p_action, p_token_mint,
    p_amount_sol, p_idempotency_key, 'RESERVED', NOW()
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id
  );
END;
$$;

-- 4.2 claim_trade_jobs - Lease-based claiming
CREATE OR REPLACE FUNCTION claim_trade_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 30,
  p_chain TEXT DEFAULT NULL
)
RETURNS SETOF trade_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lease_expires TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM trade_jobs
    WHERE (status = 'QUEUED' OR (status = 'LEASED' AND lease_expires_at < v_now))
      AND run_after <= v_now
      AND attempts < max_attempts
      AND (p_chain IS NULL OR chain = p_chain)
    ORDER BY priority ASC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE trade_jobs
    SET
      status = 'LEASED',
      lease_owner = p_worker_id,
      lease_expires_at = v_lease_expires,
      updated_at = v_now
    WHERE id IN (SELECT id FROM claimable)
    RETURNING *
  )
  SELECT * FROM claimed;
END;
$$;

-- 4.3 mark_job_running - Start execution (increments attempts)
CREATE OR REPLACE FUNCTION mark_job_running(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE trade_jobs
  SET
    status = 'RUNNING',
    started_at = NOW(),
    attempts = attempts + 1,
    updated_at = NOW()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND status = 'LEASED'
    AND lease_expires_at > NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- 4.4 extend_lease - Heartbeat
CREATE OR REPLACE FUNCTION extend_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_extension_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE trade_jobs
  SET
    lease_expires_at = NOW() + (p_extension_seconds || ' seconds')::INTERVAL,
    updated_at = NOW()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND status IN ('LEASED', 'RUNNING')
    AND lease_expires_at > NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- 4.5 finalize_job - Complete with retry logic + circuit breaker
CREATE OR REPLACE FUNCTION finalize_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_retryable BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS trade_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_job trade_jobs;
  v_backoff_seconds INT;
BEGIN
  IF p_status NOT IN ('DONE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'Invalid terminal status: %', p_status;
  END IF;

  SELECT * INTO v_job
  FROM trade_jobs
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND status IN ('LEASED', 'RUNNING');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_status = 'FAILED' AND p_retryable AND v_job.attempts < v_job.max_attempts THEN
    v_backoff_seconds := POWER(2, v_job.attempts) * 5;

    UPDATE trade_jobs
    SET
      status = 'QUEUED',
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = p_error,
      run_after = NOW() + (v_backoff_seconds || ' seconds')::INTERVAL,
      updated_at = NOW()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

  ELSE
    UPDATE trade_jobs
    SET
      status = p_status,
      completed_at = NOW(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error = p_error,
      updated_at = NOW()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    IF p_status = 'DONE' THEN
      UPDATE safety_controls
      SET
        consecutive_failures = 0,
        circuit_open_until = NULL,
        updated_at = NOW()
      WHERE scope = 'GLOBAL';

    ELSIF p_status = 'FAILED' AND NOT p_retryable THEN
      UPDATE safety_controls
      SET
        consecutive_failures = consecutive_failures + 1,
        circuit_open_until = CASE
          WHEN consecutive_failures + 1 >= circuit_breaker_threshold
          THEN NOW() + INTERVAL '15 minutes'
          ELSE circuit_open_until
        END,
        updated_at = NOW()
      WHERE scope = 'GLOBAL';
    END IF;

    IF v_job.opportunity_id IS NOT NULL THEN
      PERFORM complete_opportunity_if_terminal(v_job.opportunity_id);
    END IF;
  END IF;

  RETURN v_job;
END;
$$;

-- 4.6 complete_opportunity_if_terminal
CREATE OR REPLACE FUNCTION complete_opportunity_if_terminal(
  p_opportunity_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending INT;
  v_done INT;
  v_failed INT;
BEGIN
  IF p_opportunity_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('DONE', 'FAILED', 'CANCELED')),
    COUNT(*) FILTER (WHERE status = 'DONE'),
    COUNT(*) FILTER (WHERE status = 'FAILED')
  INTO v_pending, v_done, v_failed
  FROM trade_jobs
  WHERE opportunity_id = p_opportunity_id;

  IF v_pending > 0 THEN
    RETURN;
  END IF;

  UPDATE opportunities
  SET
    status = 'COMPLETED',
    outcome = CASE
      WHEN v_done > 0 AND v_failed = 0 THEN 'SUCCESS'
      WHEN v_done = 0 AND v_failed > 0 THEN 'FAILED'
      ELSE 'MIXED'
    END,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_opportunity_id
    AND status = 'EXECUTING';
END;
$$;

-- 4.7 update_execution - Update execution record
CREATE OR REPLACE FUNCTION update_execution(
  p_execution_id UUID,
  p_status TEXT,
  p_tx_sig TEXT DEFAULT NULL,
  p_tokens_out NUMERIC DEFAULT NULL,
  p_price_per_token NUMERIC DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_result JSONB DEFAULT NULL
)
RETURNS executions
LANGUAGE plpgsql
AS $$
DECLARE
  v_execution executions;
BEGIN
  UPDATE executions
  SET
    status = p_status,
    tx_sig = COALESCE(p_tx_sig, tx_sig),
    tokens_out = COALESCE(p_tokens_out, tokens_out),
    price_per_token = COALESCE(p_price_per_token, price_per_token),
    submitted_at = CASE WHEN p_status = 'SUBMITTED' THEN NOW() ELSE submitted_at END,
    confirmed_at = CASE WHEN p_status = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
    error = COALESCE(p_error, error),
    error_code = COALESCE(p_error_code, error_code),
    result = COALESCE(p_result, result),
    updated_at = NOW()
  WHERE id = p_execution_id
  RETURNING * INTO v_execution;

  RETURN v_execution;
END;
$$;

-- 4.8 claim_notifications - Prevent double-send
CREATE OR REPLACE FUNCTION claim_notifications(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF notifications
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM notifications
    WHERE delivered_at IS NULL
      AND next_attempt_at <= NOW()
      AND delivery_attempts < 5
      AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '60 seconds')
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE notifications n
  SET
    claimed_by = p_worker_id,
    claimed_at = NOW()
  WHERE n.id IN (SELECT id FROM claimable)
  RETURNING n.*;
END;
$$;

-- 4.9 set_cooldown
CREATE OR REPLACE FUNCTION set_cooldown(
  p_chain TEXT,
  p_cooldown_type TEXT,
  p_target TEXT,
  p_duration_seconds INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO cooldowns (chain, cooldown_type, target, cooldown_until, reason)
  VALUES (
    p_chain,
    p_cooldown_type,
    p_target,
    NOW() + (p_duration_seconds || ' seconds')::INTERVAL,
    p_reason
  )
  ON CONFLICT (chain, cooldown_type, target) DO UPDATE
  SET
    cooldown_until = GREATEST(cooldowns.cooldown_until, EXCLUDED.cooldown_until),
    reason = COALESCE(EXCLUDED.reason, cooldowns.reason);
END;
$$;

-- 4.10 cleanup_stale_executions - Maintenance
CREATE OR REPLACE FUNCTION cleanup_stale_executions(
  p_stale_minutes INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE executions
  SET
    status = 'FAILED',
    error = 'Stale execution cleanup',
    updated_at = NOW()
  WHERE status IN ('RESERVED', 'SUBMITTED')
    AND tx_sig IS NULL
    AND created_at < NOW() - (p_stale_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- SECTION 5: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooldowns ENABLE ROW LEVEL SECURITY;

-- Service role has full access to all tables
CREATE POLICY "Service role full access to strategies"
  ON strategies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to opportunities"
  ON opportunities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to trade_jobs"
  ON trade_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to executions"
  ON executions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to notifications"
  ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to safety_controls"
  ON safety_controls FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to cooldowns"
  ON cooldowns FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- SECTION 6: CREATE DEFAULT MANUAL STRATEGIES FOR EXISTING USERS
-- ============================================================================

-- Create a default MANUAL strategy for each existing user
INSERT INTO strategies (user_id, kind, name, enabled, chain)
SELECT
  tg_id,
  'MANUAL',
  'Default',
  TRUE,
  'sol'
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM strategies s
  WHERE s.user_id = users.tg_id
    AND s.kind = 'MANUAL'
    AND s.chain = 'sol'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- DONE
-- ============================================================================

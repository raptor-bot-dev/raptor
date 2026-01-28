-- ============================================================================
-- RAPTOR Phase 0: Fresh Database Schema
-- ============================================================================
-- This migration creates the complete schema for the Bags.fm/Meteora revamp.
-- All tables encode idempotency, explicit state machines, and transactional outbox.
--
-- Tables:
--   1. users           - User identity, Telegram linkage, tiering
--   2. wallets         - Public keys associated with users (no private keys)
--   3. settings        - Per-user snap risk controls
--   4. launch_candidates - Normalized discovery output
--   5. positions       - Active/historical positions with lifecycle state
--   6. executions      - Immutable trade attempt log (idempotency anchor)
--   7. notifications_outbox - Transactional outbox for notifications
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed)

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    telegram_username TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    banned_at TIMESTAMPTZ,
    banned_reason TEXT,
    last_active_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

-- ============================================================================
-- 2. wallets
-- ============================================================================
-- SECURITY: Only public keys stored. No private keys or encrypted blobs.
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pubkey TEXT UNIQUE NOT NULL,
    label TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_pubkey ON wallets(pubkey);

-- Ensure only one active wallet per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_active
    ON wallets(user_id) WHERE is_active = TRUE;

-- ============================================================================
-- 3. settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    slippage_bps INTEGER NOT NULL DEFAULT 1500,
    max_positions INTEGER NOT NULL DEFAULT 2,
    max_trades_per_hour INTEGER NOT NULL DEFAULT 10,
    max_buy_amount_sol NUMERIC(20, 9) NOT NULL DEFAULT 0.1,
    allowlist_mode TEXT NOT NULL DEFAULT 'off' CHECK (allowlist_mode IN ('off', 'partners_only', 'custom')),
    kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. launch_candidates
-- ============================================================================
CREATE TABLE IF NOT EXISTS launch_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mint TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    launch_source TEXT NOT NULL CHECK (launch_source IN ('bags', 'pumpfun')),
    discovery_method TEXT NOT NULL CHECK (discovery_method IN ('telegram', 'onchain')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_payload JSONB,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected', 'expired')),
    status_reason TEXT,
    processed_at TIMESTAMPTZ,
    -- Deduplication: one record per mint per source
    UNIQUE(mint, launch_source)
);

CREATE INDEX IF NOT EXISTS idx_launch_candidates_mint ON launch_candidates(mint);
CREATE INDEX IF NOT EXISTS idx_launch_candidates_status ON launch_candidates(status);
CREATE INDEX IF NOT EXISTS idx_launch_candidates_first_seen ON launch_candidates(first_seen_at);

-- ============================================================================
-- 5. positions
-- ============================================================================
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES wallets(id),
    mint TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    -- Lifecycle state machine (explicit, never implicit)
    lifecycle_state TEXT NOT NULL DEFAULT 'PRE_GRADUATION'
        CHECK (lifecycle_state IN ('PRE_GRADUATION', 'POST_GRADUATION', 'CLOSED')),
    -- Pricing source (switches on graduation)
    pricing_source TEXT NOT NULL DEFAULT 'BONDING_CURVE'
        CHECK (pricing_source IN ('BONDING_CURVE', 'AMM_POOL')),
    -- Execution details
    router_used TEXT,
    entry_price NUMERIC(30, 18) NOT NULL,
    entry_cost_sol NUMERIC(20, 9) NOT NULL,
    size_tokens NUMERIC(30, 9) NOT NULL,
    -- Current state
    current_price NUMERIC(30, 18),
    current_value_sol NUMERIC(20, 9),
    peak_price NUMERIC(30, 18),
    -- Exit details
    exit_price NUMERIC(30, 18),
    exit_value_sol NUMERIC(20, 9),
    exit_trigger TEXT CHECK (exit_trigger IN ('TP', 'SL', 'TRAIL', 'MAXHOLD', 'EMERGENCY', 'MANUAL', 'GRADUATION')),
    realized_pnl_sol NUMERIC(20, 9),
    realized_pnl_percent NUMERIC(10, 4),
    -- TP/SL configuration
    tp_percent NUMERIC(10, 4),
    sl_percent NUMERIC(10, 4),
    tp_price NUMERIC(30, 18),
    sl_price NUMERIC(30, 18),
    trailing_enabled BOOLEAN DEFAULT FALSE,
    trailing_activation_percent NUMERIC(10, 4),
    trailing_distance_percent NUMERIC(10, 4),
    -- Trigger state machine for TP/SL engine
    trigger_state TEXT DEFAULT 'MONITORING'
        CHECK (trigger_state IN ('MONITORING', 'TRIGGERED', 'EXECUTING', 'COMPLETED', 'FAILED')),
    trigger_error TEXT,
    -- Timestamps
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    price_updated_at TIMESTAMPTZ,
    -- Metadata
    launch_candidate_id UUID REFERENCES launch_candidates(id),
    entry_execution_id UUID,
    exit_execution_id UUID,
    bonding_curve TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_user_lifecycle ON positions(user_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_positions_mint ON positions(mint);
CREATE INDEX IF NOT EXISTS idx_positions_lifecycle_state ON positions(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_positions_trigger_state ON positions(trigger_state) WHERE lifecycle_state != 'CLOSED';

-- ============================================================================
-- 6. executions
-- ============================================================================
-- Immutable log of trade attempts. Idempotency anchor for exactly-once execution.
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position_id UUID REFERENCES positions(id),
    mint TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    -- Request
    requested_amount_sol NUMERIC(20, 9),
    requested_tokens NUMERIC(30, 9),
    slippage_bps INTEGER,
    -- Result
    filled_amount_sol NUMERIC(20, 9),
    filled_tokens NUMERIC(30, 9),
    price_per_token NUMERIC(30, 18),
    signature TEXT,
    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
    error_code TEXT,
    error_detail TEXT,
    -- Router info
    router_used TEXT,
    quote_response JSONB,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_executions_idempotency_key ON executions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_executions_user_id ON executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_position_id ON executions(position_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_signature ON executions(signature) WHERE signature IS NOT NULL;

-- ============================================================================
-- 7. notifications_outbox
-- ============================================================================
-- Transactional outbox pattern for reliable notification delivery.
-- Uses SKIP LOCKED leasing for crash-safe processing.
CREATE TABLE IF NOT EXISTS notifications_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    -- Lease management for crash recovery
    sending_expires_at TIMESTAMPTZ,
    worker_id TEXT,
    -- Error tracking
    last_error TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_status_expires
    ON notifications_outbox(status, sending_expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_user_id ON notifications_outbox(user_id);

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE users IS 'User identity and Telegram linkage. No sensitive data.';
COMMENT ON TABLE wallets IS 'Public keys only. RAPTOR never stores private keys.';
COMMENT ON TABLE settings IS 'Per-user snap risk controls and preferences.';
COMMENT ON TABLE launch_candidates IS 'Normalized output from discovery layer (Bags/pump.fun).';
COMMENT ON TABLE positions IS 'Position lifecycle with explicit state machine.';
COMMENT ON TABLE executions IS 'Immutable trade log. Idempotency anchor via idempotency_key.';
COMMENT ON TABLE notifications_outbox IS 'Transactional outbox for crash-safe notifications.';

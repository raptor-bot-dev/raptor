-- ============================================================================
-- RAPTOR Phase 0: Seed Data
-- ============================================================================
-- Idempotent seed script for local/dev environments.
-- Safe to run multiple times.
-- ============================================================================

-- Test user 1 (dev account)
INSERT INTO users (id, telegram_chat_id, telegram_username, tier)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    123456789,
    'dev_user',
    'premium'
)
ON CONFLICT (telegram_chat_id) DO UPDATE SET
    telegram_username = EXCLUDED.telegram_username,
    tier = EXCLUDED.tier;

-- Test user 2 (free tier)
INSERT INTO users (id, telegram_chat_id, telegram_username, tier)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    987654321,
    'test_user',
    'free'
)
ON CONFLICT (telegram_chat_id) DO UPDATE SET
    telegram_username = EXCLUDED.telegram_username,
    tier = EXCLUDED.tier;

-- Wallet for test user 1
INSERT INTO wallets (id, user_id, pubkey, label, is_active, chain, wallet_index)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'So11111111111111111111111111111111111111112',
    'Dev Wallet',
    true,
    'sol',
    1
)
ON CONFLICT (pubkey) DO UPDATE SET
    label = EXCLUDED.label,
    is_active = EXCLUDED.is_active;

-- Wallet for test user 2
INSERT INTO wallets (id, user_id, pubkey, label, is_active, chain, wallet_index)
VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'Test Wallet',
    true,
    'sol',
    1
)
ON CONFLICT (pubkey) DO UPDATE SET
    label = EXCLUDED.label,
    is_active = EXCLUDED.is_active;

-- Settings for test user 1 (custom config)
INSERT INTO settings (user_id, slippage_bps, max_positions, max_buy_amount_sol, kill_switch)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    2000,  -- 20% slippage
    3,     -- 3 max positions
    0.5,   -- 0.5 SOL max buy
    false
)
ON CONFLICT (user_id) DO UPDATE SET
    slippage_bps = EXCLUDED.slippage_bps,
    max_positions = EXCLUDED.max_positions,
    max_buy_amount_sol = EXCLUDED.max_buy_amount_sol,
    kill_switch = EXCLUDED.kill_switch,
    updated_at = NOW();

-- Settings for test user 2 (defaults)
INSERT INTO settings (user_id)
VALUES ('22222222-2222-2222-2222-222222222222')
ON CONFLICT (user_id) DO NOTHING;

-- Sample launch candidate (Bags)
INSERT INTO launch_candidates (id, mint, symbol, name, launch_source, discovery_method, status, raw_payload)
VALUES (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq',
    'BAGS',
    'Bags Test Token',
    'bags',
    'telegram',
    'new',
    '{"signal": "test", "channel": "bags_signals"}'::jsonb
)
ON CONFLICT (mint, launch_source) DO UPDATE SET
    symbol = EXCLUDED.symbol,
    name = EXCLUDED.name,
    raw_payload = EXCLUDED.raw_payload;

-- Sample position (PRE_GRADUATION)
INSERT INTO positions (
    id, user_id, wallet_id, mint, symbol, name,
    lifecycle_state, pricing_source, router_used,
    entry_price, entry_cost_sol, size_tokens,
    current_price, tp_percent, sl_percent,
    launch_candidate_id
)
VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq',
    'BAGS',
    'Bags Test Token',
    'PRE_GRADUATION',
    'BONDING_CURVE',
    'bags-meteora',
    0.000001,
    0.1,
    100000,
    0.0000012,
    50,
    30,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
)
ON CONFLICT (id) DO UPDATE SET
    current_price = EXCLUDED.current_price,
    price_updated_at = NOW();

-- Sample execution (confirmed buy)
INSERT INTO executions (
    id, idempotency_key, user_id, position_id, mint, side,
    requested_amount_sol, filled_amount_sol, filled_tokens,
    price_per_token, signature, status, router_used
)
VALUES (
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'buy_bags_dev_1706000000',
    '11111111-1111-1111-1111-111111111111',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq',
    'BUY',
    0.1,
    0.1,
    100000,
    0.000001,
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'confirmed',
    'bags-meteora'
)
ON CONFLICT (idempotency_key) DO NOTHING;

-- Sample notification (pending)
INSERT INTO notifications_outbox (id, user_id, type, payload, status)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'POSITION_OPENED',
    '{"mint": "CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq", "symbol": "BAGS", "amount_sol": 0.1}'::jsonb,
    'pending'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Verification queries (for manual checking)
-- ============================================================================
-- SELECT * FROM users;
-- SELECT * FROM wallets;
-- SELECT * FROM settings;
-- SELECT * FROM launch_candidates;
-- SELECT * FROM positions;
-- SELECT * FROM executions;
-- SELECT * FROM notifications_outbox;

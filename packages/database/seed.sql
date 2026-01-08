-- RAPTOR Seed Data
-- Optional: Use for testing

-- Example test user (replace with actual Telegram ID)
INSERT INTO users (tg_id, username, first_name, created_at)
VALUES (123456789, 'testuser', 'Test', NOW())
ON CONFLICT (tg_id) DO NOTHING;

-- Example balances
INSERT INTO user_balances (tg_id, chain, deposited, current_value, deposit_address)
VALUES
  (123456789, 'bsc', '1.0', '1.05', '0x0000000000000000000000000000000000000001'),
  (123456789, 'base', '0.5', '0.55', '0x0000000000000000000000000000000000000002')
ON CONFLICT (tg_id, chain) DO NOTHING;

-- Example user settings
INSERT INTO user_settings (tg_id, alerts_enabled, daily_summary_enabled)
VALUES (123456789, TRUE, TRUE)
ON CONFLICT (tg_id) DO NOTHING;

-- ============================================================================
-- RAPTOR Phase-X: cooldowns (rate limiting / safety)
-- ============================================================================
-- Purpose:
-- - Enforce mint/user/deployer cooldowns in bot + hunter loops
-- ============================================================================

CREATE TABLE IF NOT EXISTS cooldowns (
  chain TEXT NOT NULL DEFAULT 'sol' CHECK (chain IN ('sol')),
  cooldown_type TEXT NOT NULL CHECK (cooldown_type IN ('MINT', 'USER_MINT', 'DEPLOYER')),
  target TEXT NOT NULL,
  cooldown_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain, cooldown_type, target)
);

CREATE INDEX IF NOT EXISTS idx_cooldowns_until ON cooldowns(cooldown_until);


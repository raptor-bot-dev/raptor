-- =============================================================================
-- RAPTOR v3.3 Migration 009: Fix MANUAL mode trades
--
-- Issue: reserve_trade_budget validates strategy even for MANUAL mode,
-- causing "Strategy not found or disabled" error when selling manually.
--
-- Fix: Skip strategy validation and limit checks for MANUAL mode trades.
-- =============================================================================

-- Drop and recreate reserve_trade_budget with MANUAL mode fix
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
  -- 3. STRATEGY VALIDATION (AUTO MODE ONLY)
  -- v3.3 FIX: Skip for MANUAL mode
  -- ========================================

  IF p_mode = 'AUTO' THEN
    -- AUTO mode requires valid strategy
    SELECT * INTO v_strategy
    FROM strategies
    WHERE id = p_strategy_id
      AND user_id = p_user_id
      AND enabled = TRUE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Strategy not found or disabled');
    END IF;

    IF NOT v_strategy.auto_execute THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Strategy auto_execute is off');
    END IF;

    -- ========================================
    -- 4. LIMIT CHECKS (AUTO MODE ONLY)
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
    -- 5. COOLDOWN CHECK (AUTO MODE ONLY)
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

  END IF; -- END IF p_mode = 'AUTO'

  -- ========================================
  -- 6. CREATE RESERVATION (atomic)
  -- For MANUAL mode, strategy_id can be NULL
  -- ========================================

  v_reservation_id := gen_random_uuid();

  INSERT INTO executions (
    id, mode, user_id, strategy_id, chain, action, token_mint,
    amount_in_sol, idempotency_key, status, created_at
  ) VALUES (
    v_reservation_id,
    p_mode,
    p_user_id,
    CASE WHEN p_mode = 'AUTO' THEN p_strategy_id ELSE NULL END,  -- NULL for MANUAL
    p_chain,
    p_action,
    p_token_mint,
    p_amount_sol,
    p_idempotency_key,
    'RESERVED',
    NOW()
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION reserve_trade_budget TO service_role;
GRANT EXECUTE ON FUNCTION reserve_trade_budget TO authenticated;

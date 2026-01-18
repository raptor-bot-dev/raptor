-- RAPTOR TP/SL Engine UUID Fix + Notification Retry Migration
-- ============================================================================
-- This migration fixes:
-- 1. positions.uuid_id - backfill NULLs, enforce NOT NULL, add unique index
-- 2. TP/SL RPC functions - use uuid_id instead of id column
-- 3. Notification retry - add atomic mark_notification_failed RPC
-- ============================================================================

-- ============================================================================
-- SECTION 1: FIX uuid_id COLUMN
-- ============================================================================

-- 1.1 Backfill any NULL uuid_id values
UPDATE positions SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;

-- 1.2 Enforce NOT NULL constraint
ALTER TABLE positions ALTER COLUMN uuid_id SET NOT NULL;

-- 1.3 Add unique index on uuid_id for fast lookups and race prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_uuid_id ON positions(uuid_id);

-- ============================================================================
-- SECTION 2: FIX TP/SL RPC FUNCTIONS (use uuid_id instead of id)
-- ============================================================================

-- 2.1 Fix trigger_exit_atomically to use uuid_id
CREATE OR REPLACE FUNCTION trigger_exit_atomically(
  p_position_id UUID,
  p_trigger TEXT,
  p_trigger_price NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
  v_position RECORD;
BEGIN
  -- Validate trigger type
  IF p_trigger NOT IN ('TP', 'SL', 'TRAIL', 'MAXHOLD', 'EMERGENCY', 'MANUAL') THEN
    RETURN jsonb_build_object('triggered', false, 'reason', 'Invalid trigger type');
  END IF;

  -- Attempt atomic state transition using uuid_id (FIX: was id)
  UPDATE positions SET
    trigger_state = 'TRIGGERED',
    exit_trigger = p_trigger,
    triggered_at = NOW(),
    current_price = p_trigger_price,
    price_updated_at = NOW(),
    updated_at = NOW()
  WHERE uuid_id = p_position_id
    AND status = 'OPEN'
    AND trigger_state = 'MONITORING';

  GET DIAGNOSTICS v_result = ROW_COUNT;

  IF v_result = 0 THEN
    -- Check why it failed
    SELECT uuid_id, status, trigger_state INTO v_position
    FROM positions
    WHERE uuid_id = p_position_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('triggered', false, 'reason', 'Position not found');
    ELSIF v_position.status != 'OPEN' THEN
      RETURN jsonb_build_object('triggered', false, 'reason', 'Position not open');
    ELSIF v_position.trigger_state != 'MONITORING' THEN
      RETURN jsonb_build_object('triggered', false, 'reason', 'Already triggered or executing', 'current_state', v_position.trigger_state);
    ELSE
      RETURN jsonb_build_object('triggered', false, 'reason', 'Unknown error');
    END IF;
  END IF;

  RETURN jsonb_build_object('triggered', true, 'position_id', p_position_id, 'trigger', p_trigger);
END;
$$;

-- 2.2 Fix mark_position_executing to use uuid_id
CREATE OR REPLACE FUNCTION mark_position_executing(
  p_position_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions SET
    trigger_state = 'EXECUTING',
    updated_at = NOW()
  WHERE uuid_id = p_position_id
    AND trigger_state = 'TRIGGERED';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- 2.3 Fix mark_trigger_completed to use uuid_id
CREATE OR REPLACE FUNCTION mark_trigger_completed(
  p_position_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions SET
    trigger_state = 'COMPLETED',
    updated_at = NOW()
  WHERE uuid_id = p_position_id
    AND trigger_state = 'EXECUTING';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- 2.4 Fix mark_trigger_failed to use uuid_id
CREATE OR REPLACE FUNCTION mark_trigger_failed(
  p_position_id UUID,
  p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions SET
    trigger_state = 'FAILED',
    close_reason = COALESCE(p_error, 'Trigger execution failed'),
    updated_at = NOW()
  WHERE uuid_id = p_position_id
    AND trigger_state = 'EXECUTING';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- ============================================================================
-- SECTION 3: NOTIFICATION RETRY RPC
-- ============================================================================

-- 3.1 Add atomic mark_notification_failed function
-- This replaces the broken inline RPC call in markNotificationFailed()
-- which used invalid supabase.rpc('increment', ...) within .update()
CREATE OR REPLACE FUNCTION mark_notification_failed(
  p_notification_id UUID,
  p_error TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE notifications SET
    delivery_attempts = delivery_attempts + 1,
    delivery_error = p_error,
    next_attempt_at = NOW() + INTERVAL '1 minute',
    claimed_by = NULL,
    claimed_at = NULL
  WHERE id = p_notification_id;

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- ============================================================================
-- SECTION 4: VERIFY MIGRATION
-- ============================================================================

-- Verify uuid_id is properly populated (should return 0)
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM positions WHERE uuid_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % positions still have NULL uuid_id', null_count;
  END IF;
END $$;

-- RAPTOR TP/SL Engine State Migration
-- ============================================================================
-- This migration adds:
-- 1. trigger_state column for the TP/SL state machine
-- 2. exit_trigger column (if not exists) for tracking what triggered the exit
-- 3. tp_price and sl_price for computed target prices
-- 4. Atomic trigger claim function for exactly-once execution
-- ============================================================================

-- ============================================================================
-- SECTION 1: ADD COLUMNS TO POSITIONS TABLE
-- ============================================================================

-- 1.1 Add trigger_state for the TP/SL state machine
-- States: MONITORING (watching) → TRIGGERED (queued) → EXECUTING (selling) → COMPLETED/FAILED
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trigger_state TEXT DEFAULT 'MONITORING';

-- Add constraint for valid states (use DO block to avoid error if constraint exists)
DO $$
BEGIN
  ALTER TABLE positions ADD CONSTRAINT chk_trigger_state
    CHECK (trigger_state IN ('MONITORING', 'TRIGGERED', 'EXECUTING', 'COMPLETED', 'FAILED'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 1.2 Add exit_trigger column (if not exists)
-- Values: TP, SL, TRAIL, MAXHOLD, EMERGENCY, MANUAL
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_trigger TEXT;

-- Add constraint for valid triggers
DO $$
BEGIN
  ALTER TABLE positions ADD CONSTRAINT chk_exit_trigger
    CHECK (exit_trigger IS NULL OR exit_trigger IN ('TP', 'SL', 'TRAIL', 'MAXHOLD', 'EMERGENCY', 'MANUAL'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 1.3 Add computed TP/SL price targets (denormalized for performance)
-- These are calculated at position open: tp_price = entry_price * (1 + tp_percent/100)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp_price NUMERIC(36, 18);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS sl_price NUMERIC(36, 18);

-- 1.4 Add triggered_at timestamp for tracking when trigger was claimed
ALTER TABLE positions ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMPTZ;

-- ============================================================================
-- SECTION 2: CREATE INDEXES
-- ============================================================================

-- Index for efficient TP/SL monitoring queries
-- Query pattern: SELECT * FROM positions WHERE status = 'OPEN' AND trigger_state = 'MONITORING'
CREATE INDEX IF NOT EXISTS idx_positions_tpsl_monitoring
  ON positions(token_mint, trigger_state)
  WHERE status = 'OPEN' AND trigger_state = 'MONITORING';

-- Index for finding triggered positions awaiting execution
CREATE INDEX IF NOT EXISTS idx_positions_triggered
  ON positions(trigger_state, triggered_at)
  WHERE trigger_state IN ('TRIGGERED', 'EXECUTING');

-- ============================================================================
-- SECTION 3: ATOMIC TRIGGER CLAIM FUNCTION
-- ============================================================================

-- This function atomically claims a position for exit, preventing double-execution
-- It uses optimistic locking via WHERE trigger_state = 'MONITORING'
-- Returns JSON with { triggered: boolean, reason?: string }
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

  -- Attempt atomic state transition
  -- This only succeeds if position is OPEN and in MONITORING state
  UPDATE positions
  SET
    trigger_state = 'TRIGGERED',
    exit_trigger = p_trigger,
    triggered_at = NOW(),
    current_price = p_trigger_price,
    price_updated_at = NOW(),
    updated_at = NOW()
  WHERE id = p_position_id
    AND status = 'OPEN'
    AND trigger_state = 'MONITORING';

  GET DIAGNOSTICS v_result = ROW_COUNT;

  IF v_result = 0 THEN
    -- Check why it failed
    SELECT id, status, trigger_state INTO v_position
    FROM positions
    WHERE id = p_position_id;

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

-- ============================================================================
-- SECTION 4: MARK EXECUTION STARTED/COMPLETED FUNCTIONS
-- ============================================================================

-- Mark position as executing (called before sending sell tx)
CREATE OR REPLACE FUNCTION mark_position_executing(
  p_position_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions
  SET
    trigger_state = 'EXECUTING',
    updated_at = NOW()
  WHERE id = p_position_id
    AND trigger_state = 'TRIGGERED';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- Mark position trigger as completed (called after successful sell)
-- Note: The actual position closing is handled by closePosition() function
CREATE OR REPLACE FUNCTION mark_trigger_completed(
  p_position_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions
  SET
    trigger_state = 'COMPLETED',
    updated_at = NOW()
  WHERE id = p_position_id
    AND trigger_state = 'EXECUTING';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- Mark position trigger as failed (called after failed sell)
CREATE OR REPLACE FUNCTION mark_trigger_failed(
  p_position_id UUID,
  p_error TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_result INTEGER;
BEGIN
  UPDATE positions
  SET
    trigger_state = 'FAILED',
    close_reason = COALESCE(p_error, 'Trigger execution failed'),
    updated_at = NOW()
  WHERE id = p_position_id
    AND trigger_state = 'EXECUTING';

  GET DIAGNOSTICS v_result = ROW_COUNT;
  RETURN v_result > 0;
END;
$$;

-- ============================================================================
-- SECTION 5: MIGRATE EXISTING POSITIONS
-- ============================================================================

-- Set trigger_state for existing open positions
UPDATE positions
SET trigger_state = 'MONITORING'
WHERE status = 'OPEN' AND trigger_state IS NULL;

-- Set trigger_state for existing closed positions
UPDATE positions
SET trigger_state = 'COMPLETED'
WHERE status = 'CLOSED' AND trigger_state IS NULL;

-- Set trigger_state for closing positions
UPDATE positions
SET trigger_state = 'EXECUTING'
WHERE status = 'CLOSING' AND trigger_state IS NULL;

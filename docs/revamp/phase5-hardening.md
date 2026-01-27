# Phase 5: Cleanup & Hardening

## Overview

Phase 5 consolidates Phases 1-4 into a production-ready, auditable system by:
- Removing dead code
- Adding error classification and circuit breakers
- Consolidating configuration with startup validation
- Preparing for audit per `audit.md` requirements

---

## Changes Summary

### 1. Dead Code Removal

**Deleted:**
- `apps/bot/src/commands/deposit.ts` - Disabled in v3, replaced by direct wallet transfers

**Updated:**
- `apps/bot/src/commands/index.ts` - Removed deposit export
- `apps/bot/src/handlers/callbacks.ts` - Removed deposit imports

### 2. Error Classification

**Added to `packages/shared/src/errors.ts`:**

```typescript
export type ErrorClass = 'RETRYABLE' | 'PERMANENT' | 'UNKNOWN';

export function classifyError(error: unknown): ErrorClass;
export function shouldRetry(error: unknown): boolean;
```

**Classification Rules:**
- **RETRYABLE**: Network timeouts, rate limits, 502/503 errors, connection resets
- **PERMANENT**: Invalid data, constraint violations, 401/403, "not found" errors
- **UNKNOWN**: Unrecognized errors (default to not retrying)

### 3. Circuit Breakers

**Added to both discovery sources:**
- `apps/hunter/src/sources/bagsSource.ts`
- `apps/hunter/src/sources/meteoraOnChainSource.ts`

**Behavior:**
- Opens after 5 consecutive handler failures
- Skips signal processing while open
- Auto-resets after 60 seconds cooldown
- Logs error classification when opening

### 4. Configuration Validation

**Added to `packages/shared/src/config.ts`:**

```typescript
interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateAllConfig(context: 'hunter' | 'bot' | 'executor'): ConfigValidationResult;
function validateAndLogConfig(context: 'hunter' | 'bot' | 'executor'): void;
```

**Validates:**
- Required env vars per context
- Discovery source consistency (enabled flag + required credentials)
- Production safety (no devnet/testnet in production)

---

## Environment Variables Reference

### Required (All Contexts)

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
```

### Required (Hunter/Executor)

```bash
SOLANA_RPC_URL=https://xxx
SOLANA_WSS_URL=wss://xxx
WALLET_ENCRYPTION_KEY=xxx
```

### Required (Bot)

```bash
TELEGRAM_BOT_TOKEN=xxx
WALLET_ENCRYPTION_KEY=xxx
```

### Discovery Sources (Optional)

```bash
# Telegram monitoring
BAGS_SOURCE_ENABLED=true
BAGS_BOT_TOKEN=xxx
BAGS_CHANNEL_ID=xxx
BAGS_DEDUPE_TTL_MS=60000

# On-chain detection
METEORA_ONCHAIN_ENABLED=true
METEORA_PROGRAM_ID=dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
```

### Position Monitoring (Optional)

```bash
GRADUATION_ENABLED=true
GRADUATION_POLL_INTERVAL_MS=10000

TPSL_ENGINE_ENABLED=true
LEGACY_POSITION_MONITOR=false
```

### Execution (Optional)

```bash
AUTO_EXECUTE_ENABLED=true
```

---

## Audit Readiness Checklist

Per `audit.md`, Phase 5 ensures:

### SwapRouter Safety
- [x] Slippage bounds always set
- [x] Router selection deterministic
- [x] Failure modes produce explicit errors

### Idempotency
- [x] `executions.idempotency_key` uniqueness enforced
- [x] Retried sends do not create new execution rows

### State Machine Correctness
- [x] Only allowed transitions possible
- [x] All transitions persisted

### Discovery Hardening
- [x] Parser rejects malformed signals
- [x] Dedupe enforced at DB layer
- [x] Circuit breakers prevent cascading failures

### Database Safety
- [x] Constraints present
- [x] Indexes support hot paths

---

## Verification

### Run Tests

```bash
pnpm test
pnpm build
pnpm lint
```

### Verify Config Validation

Start hunter with missing env vars:
```bash
unset SUPABASE_URL && pnpm -F @raptor/hunter start
# Should fail fast with clear error message
```

### Verify Circuit Breaker

1. Inject consecutive handler failures
2. Observe circuit breaker OPEN log
3. Wait 60s, observe circuit breaker CLOSED log

---

## Commit Gate Checklist

- [x] deposit.ts deleted
- [x] No unimplemented TODOs in execution paths
- [x] Error classification added to shared package
- [x] Circuit breakers in discovery sources
- [x] Config validation added to shared package
- [x] phase5-hardening.md created
- [ ] All tests passing
- [ ] No lint warnings

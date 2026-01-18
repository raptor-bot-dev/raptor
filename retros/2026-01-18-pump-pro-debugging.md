# Retro: pump.pro Token Support Debugging

**Date:** 2026-01-18
**Session:** pump.pro execution debugging (afternoon)
**Commits:**
- `d1b86f3` - Add job staleness check to ExecutionLoop
- `d25ae0d` - Fix parseError to handle object errors

---

## Context

pump.fun migrated most token creation to their new pump.pro program (`proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u`). This broke our token detection and required several fixes throughout the day.

## What We Fixed Today

### 1. pump.pro Create Discriminator (earlier session)
- pump.pro uses discriminator `[147,241,123,100,244,132,174,118]`
- Added to PumpFunMonitor alongside legacy create and create_v2

### 2. pump.pro Metadata Fetch (earlier session)
- pump.pro instructions don't include inline metadata like pump.fun
- Added API fetch from `frontend-api.pump.fun` with 3s timeout
- Added on-chain Metaplex Metadata Account fallback when API returns 530

### 3. Relaxed Scoring Hard Stops (earlier session)
- pump.fun API returns HTTP 530 for pump.pro tokens
- Metaplex metadata doesn't exist immediately after token creation
- Temporarily changed metadata rules to soft failures (pass with 0 points)
- Holdings check also allows "unknown" through

### 4. Job Staleness Check (this session)
**Problem:** Circuit breaker kept tripping from old jobs failing.

**Root Cause:** Jobs created 60+ seconds ago were being picked up by ExecutionLoop and failing. Token launch windows are extremely short (seconds), so stale jobs are useless.

**Fix:** Added 60-second TTL check in ExecutionLoop:
```typescript
const MAX_JOB_AGE_SECONDS = 60;
const jobAgeSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;
if (jobAgeSeconds > MAX_JOB_AGE_SECONDS) {
  // Finalize as CANCELED (not FAILED) to avoid tripping circuit breaker
  await finalizeJob({ status: 'CANCELED', ... });
  return;
}
```

### 5. parseError Object Handling (this session)
**Problem:** Failed job errors showed as `[object Object]` instead of actual message.

**Root Cause:** Supabase errors are plain objects thrown via `if (error) throw error;`. The `parseError()` function called `String(error)` which returns `[object Object]`.

**Fix:** Added object error handling:
```typescript
if (error && typeof error === 'object') {
  const objError = error as { message?: string; error?: string; details?: string };
  message = objError.message || objError.error || objError.details || JSON.stringify(error);
}
```

---

## Current State

### Working
- Token detection for pump.pro (WebSocket subscription working)
- Token parsing (discriminator recognized)
- Metadata fallback (API → on-chain → mint-based fallback)
- Scoring (relaxed rules pass pump.pro tokens)
- Job creation (OpportunityLoop creates jobs successfully)
- Staleness check (old jobs canceled, not failed)
- Error messages (parseError now extracts real messages)

### Not Working
- **Circuit breaker keeps tripping** - jobs are failing for some other reason
- Need to investigate actual execution errors now that parseError is fixed

---

## Next Steps (Tomorrow)

1. **Reset circuit breaker** and monitor fresh job execution
2. **Check FAILED jobs** for actual error messages (parseError fix should help)
3. **Possible issues to investigate:**
   - Wallet balance insufficient?
   - Bonding curve address wrong for pump.pro?
   - Transaction build failing?
   - RPC errors?

---

## Key Learnings

### 1. Circuit Breaker Pattern
The circuit breaker is aggressive (5 consecutive failures = 15 min lockout). Stale jobs were failing and tripping it repeatedly. Using CANCELED instead of FAILED for stale jobs prevents this.

### 2. Supabase Error Handling
Supabase RPC errors are plain objects, not Error instances. Always handle object errors in catch blocks:
```typescript
catch (error) {
  if (error && typeof error === 'object' && 'message' in error) {
    console.error(error.message);
  }
}
```

### 3. pump.pro vs pump.fun Differences
| Aspect | pump.fun | pump.pro |
|--------|----------|----------|
| Program ID | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u` |
| Discriminator | Legacy or create_v2 | `[147,241,123,100,244,132,174,118]` |
| Inline metadata | Yes (in instruction) | No (must fetch separately) |
| API support | Working | Returns 530 |
| Metaplex metadata | Available | Not created immediately |

### 4. Token Launch Timing
Token launches have extremely tight windows. A job that's 60+ seconds old is completely stale - the opportunity has passed. This is why staleness checks are critical.

---

## Deployments

| App | Version | Key Changes |
|-----|---------|-------------|
| raptor-hunter | v95 | Staleness check + parseError fix |

---

## References

- [MUST_READ/Changelog.md](../MUST_READ/Changelog.md)
- [MUST_READ/Project_status.md](../MUST_READ/Project_status.md)
- [apps/hunter/src/loops/execution.ts](../apps/hunter/src/loops/execution.ts)
- [packages/shared/src/errors.ts](../packages/shared/src/errors.ts)

# RAPTOR Security Audit Report v2.3.1

**Audit Date:** January 2026
**Auditor:** Claude Opus 4.5 (Anthropic)
**Scope:** Full codebase security review
**Status:** All findings remediated

---

## Executive Summary

This report documents a comprehensive security audit of the RAPTOR Telegram trading bot, covering Solana and EVM chain operations. The audit identified **20 security issues** across critical, high, and medium severity levels. All issues have been remediated and deployed.

### Findings Overview

| Severity | Found | Fixed | Status |
|----------|-------|-------|--------|
| Critical | 5 | 5 | ✅ Complete |
| High | 7 | 7 | ✅ Complete |
| Medium | 8 | 8 | ✅ Complete |
| **Total** | **20** | **20** | **✅ Complete** |

### Commits

| Commit | Description |
|--------|-------------|
| `1666724` | Critical security patches |
| `49b1784` | High severity patches |
| `6ff6bdf` | Medium severity patches |

---

## Threat Model

### Assets at Risk

1. **User Private Keys** - Encrypted wallet keys stored in database
2. **User Funds** - Native tokens (SOL, BNB, ETH) in self-custodial wallets
3. **Platform Integrity** - Bot availability and correct operation
4. **User Data** - Telegram IDs, wallet addresses, trading history

### Threat Actors

1. **External Attackers** - Attempting unauthorized access or fund theft
2. **MEV Bots** - Sandwich attacks on pending transactions
3. **Malicious Tokens** - Honeypots, rug pulls, high-tax tokens
4. **Compromised Dependencies** - Supply chain attacks

### Attack Surface

1. **Telegram Bot Interface** - User commands and callbacks
2. **RPC Endpoints** - Blockchain interactions
3. **Database** - Supabase storage
4. **External APIs** - DexScreener, GoPlus, Birdeye, etc.

---

## Critical Findings (C-001 to C-005)

### C-001: Single Master Key for All Wallets

**Severity:** Critical
**Location:** `packages/shared/src/crypto/encryption.ts`
**Status:** ✅ Fixed

**Description:**
All user private keys were encrypted with the same master key. Compromise of the master key would expose all user wallets simultaneously.

**Impact:**
- Complete loss of all user funds if master key leaked
- No isolation between user wallets

**Remediation:**
Implemented per-user key derivation using HKDF (HMAC-based Key Derivation Function):

```typescript
function deriveUserKey(masterKey: Buffer, tgId: number, salt: Buffer): Buffer {
  const info = Buffer.from(`raptor-wallet-v2-${tgId}`);
  const derived = crypto.hkdfSync('sha256', masterKey, salt, info, 32);
  return Buffer.from(derived);
}
```

Each user's keys are now encrypted with a unique derived key combining:
- Master key (from environment)
- User's Telegram ID
- Random 32-byte salt (stored with encrypted data)

**Files Modified:**
- `packages/shared/src/crypto/encryption.ts`
- `packages/shared/src/crypto/keypairs.ts`

---

### C-002: Missing Authorization on Wallet Operations

**Severity:** Critical
**Location:** `apps/bot/src/handlers/callbacks.ts`
**Status:** ✅ Fixed

**Description:**
Wallet operations (export keys, delete wallet, withdraw) did not verify that the requesting user owned the wallet being operated on.

**Impact:**
- Attackers could export other users' private keys
- Unauthorized withdrawals from any wallet

**Remediation:**
Created wallet authorization middleware:

```typescript
export async function verifyWalletOwnership(
  ctx: MyContext,
  chain: string,
  walletIndexStr: string
): Promise<WalletAuthResult>
```

All sensitive wallet operations now require ownership verification before execution.

**Files Created:**
- `apps/bot/src/middleware/walletAuth.ts`

**Files Modified:**
- `apps/bot/src/handlers/callbacks.ts`

---

### C-003: No Rate Limiting

**Severity:** Critical
**Location:** `apps/bot/src/index.ts`
**Status:** ✅ Fixed

**Description:**
No rate limiting on bot commands allowed unlimited requests, enabling DoS attacks and resource exhaustion.

**Impact:**
- Denial of service attacks
- API quota exhaustion
- Database overload

**Remediation:**
Implemented tiered rate limiting middleware:

| Operation Type | Limit |
|---------------|-------|
| General requests | 30/minute |
| Expensive operations (score, snipe) | 10/minute |
| Sensitive operations (withdraw, export) | 3/5 minutes |

```typescript
bot.use(rateLimitMiddleware());
```

**Files Created:**
- `apps/bot/src/middleware/rateLimit.ts`

---

### C-004: Integer Parsing Without Validation

**Severity:** Critical
**Location:** `apps/bot/src/handlers/callbacks.ts`
**Status:** ✅ Fixed

**Description:**
Callback data from inline keyboards was parsed without validation, allowing injection of malformed data.

**Impact:**
- Application crashes from invalid input
- Potential injection attacks
- Undefined behavior

**Remediation:**
Created comprehensive input validation utilities:

```typescript
export function parsePositiveInt(value: string): number | null
export function parseWalletIndex(value: string): number | null
export function isValidChain(chain: string): chain is Chain
export function isValidAddress(address: string, chain: Chain): boolean
export function sanitizeCallbackData(data: string): string | null
```

**Files Created:**
- `apps/bot/src/utils/validation.ts`

---

### C-005: Deposit Monitor Vulnerable to Reorg Attacks

**Severity:** Critical
**Location:** `apps/bot/src/services/depositMonitor.ts`
**Status:** ✅ Fixed

**Description:**
Deposits were credited immediately upon detection without waiting for blockchain finality, enabling double-deposit exploits via chain reorganizations.

**Impact:**
- Double-spend attacks on deposits
- Loss of platform funds

**Remediation:**
Implemented confirmation-based deposit crediting:

| Chain | Required Confirmations | Time |
|-------|----------------------|------|
| Solana | 32 slots | ~13 seconds |
| BSC | 15 blocks | ~45 seconds |
| Base | 12 blocks | ~24 seconds |
| Ethereum | 12 blocks | ~2.4 minutes |

Deposits enter a pending state and are only credited after sufficient confirmations.

**Files Modified:**
- `apps/bot/src/services/depositMonitor.ts`

---

## High Severity Findings (H-001 to H-007)

### H-001: Missing Slippage Protection on Swaps

**Severity:** High
**Location:** `apps/executor/src/chains/chainExecutor.ts`
**Status:** ✅ Fixed

**Description:**
Hardcoded 15% slippage on buys and 0% on sells made transactions vulnerable to MEV attacks and front-running.

**Remediation:**
Implemented configurable slippage per chain and operation:

| Chain | Buy | Sell | Emergency |
|-------|-----|------|-----------|
| Solana | 10% | 8% | 50% |
| BSC | 15% | 10% | 50% |
| Base | 10% | 8% | 50% |
| Ethereum | 5% | 3% | 30% |

**Files Created:**
- `apps/executor/src/security/tradeGuards.ts`

---

### H-002: No Transaction Simulation Before Execution

**Severity:** High
**Location:** `apps/executor/src/chains/chainExecutor.ts`
**Status:** ✅ Fixed

**Description:**
Transactions were submitted without simulation, leading to failed transactions, wasted gas, and potential loss scenarios.

**Remediation:**
Added pre-execution simulation using `eth_call`:

```typescript
export async function simulateTransaction(
  provider: ethers.JsonRpcProvider,
  tx: { to: string; data: string; value?: bigint; from: string }
): Promise<SimulationResult>
```

Transactions that fail simulation are rejected before submission.

---

### H-003: Unbounded Token Approval Amounts

**Severity:** High
**Location:** `apps/executor/src/execution/exitManager.ts`
**Status:** ✅ Fixed

**Description:**
Token approvals used `ethers.MaxUint256`, granting unlimited spending authority to routers permanently.

**Impact:**
- If router is compromised, all approved tokens at risk
- Unnecessary exposure of user funds

**Remediation:**
Changed to approve only exact amounts needed:

```typescript
// Before (vulnerable)
await token.approve(router, ethers.MaxUint256);

// After (secure)
await token.approve(router, tokensHeld);
```

---

### H-004: Missing Re-entrancy Guards

**Severity:** High
**Location:** `apps/executor/src/chains/chainExecutor.ts`
**Status:** ✅ Fixed

**Description:**
No protection against concurrent transaction execution for the same user/token pair.

**Remediation:**
Implemented re-entrancy guard with lock management:

```typescript
if (!reentrancyGuard.acquire(tgId, token, 'buy')) {
  throw new Error('Transaction already in progress for this token');
}
try {
  // ... execute transaction
} finally {
  reentrancyGuard.release(tgId, token);
}
```

---

### H-005: Insufficient Error Handling on RPC Failures

**Severity:** High
**Location:** `packages/shared/src/rpc/multiRpc.ts`
**Status:** ✅ Fixed

**Description:**
RPC failures were not handled gracefully, causing cascading failures.

**Remediation:**
- Simulation failures return detailed error messages with revert reasons
- Gas estimation falls back to defaults when simulation data unavailable
- Circuit breaker pattern for repeated failures

---

### H-006: No MEV Protection

**Severity:** High
**Location:** `apps/executor/src/chains/chainExecutor.ts`
**Status:** ✅ Fixed

**Description:**
Sell operations used `minOut = 0`, allowing MEV bots to extract 100% of trade value via sandwich attacks.

**Remediation:**
- `minOut` is never 0 for any operation
- `calculateMinOutput()` enforces minimum 1% of expected output even in worst case
- Emergency exits use 50% slippage, never 0

```typescript
if (operation === 'sell' && minOut === 0n && expectedOutput > 0n) {
  return expectedOutput / 100n; // 1% minimum
}
```

---

### H-007: Missing Withdrawal Amount Validation

**Severity:** High
**Location:** `apps/bot/src/services/wallet.ts`
**Status:** ✅ Fixed

**Description:**
Withdrawal amounts were not validated against balance or reasonable limits.

**Remediation:**
Comprehensive withdrawal validation:

| Check | Implementation |
|-------|---------------|
| Minimum amount | 0.001 SOL/BNB, 0.0001 ETH |
| Maximum amount | 1000 SOL, 100 BNB, 10 ETH |
| Balance check | Cannot exceed available balance |
| Address validation | Format and checksum verification |
| Rate limiting | 5 withdrawals/hour, $10k/hour |

**Files Created:**
- `apps/bot/src/utils/withdrawalValidation.ts`

---

## Medium Severity Findings (M-001 to M-008)

### M-001: Missing Input Sanitization

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
User messages and callback data were processed without sanitization.

**Remediation:**
Created `inputSanitization.ts` with:
- Control character removal
- HTML/Markdown escaping
- Injection pattern detection
- Address and amount validation

**Files Created:**
- `apps/bot/src/utils/inputSanitization.ts`

---

### M-002: Insufficient Security Event Logging

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Security-relevant events were not logged consistently.

**Remediation:**
Created comprehensive audit logging:

```typescript
securityLog.withdrawalInitiated(tgId, chain, amount, toAddress);
securityLog.tradeExecuted(tgId, chain, type, token, amount);
securityLog.honeypotDetected(chain, token, reason);
```

**Files Created:**
- `packages/shared/src/security/auditLog.ts`

---

### M-003: No Transaction Timeout Handling

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Pending transactions could hang indefinitely without timeout.

**Remediation:**
Chain-specific timeout handling:

| Chain | Timeout |
|-------|---------|
| Solana | 30 seconds |
| BSC | 60 seconds |
| Base | 45 seconds |
| Ethereum | 120 seconds |

**Files Created:**
- `apps/executor/src/security/transactionManager.ts`

---

### M-004: Missing Health Checks for External Services

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
No monitoring of external service availability.

**Remediation:**
Health check service with:
- Periodic checks (configurable intervals)
- Status tracking (healthy/degraded/unhealthy)
- Pre-built checks for database, RPC, APIs

**Files Created:**
- `packages/shared/src/security/healthCheck.ts`

---

### M-005: Hardcoded Configuration Values

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Trading limits, timeouts, and feature flags were hardcoded.

**Remediation:**
Externalized configuration via environment variables:

```typescript
// Environment variables supported:
MAX_POSITION_SIZE_SOL, MAX_POSITION_SIZE_BNB, MAX_POSITION_SIZE_ETH
DEFAULT_SLIPPAGE_BUY, DEFAULT_SLIPPAGE_SELL
RPC_TIMEOUT_MS, TX_TIMEOUT_SOL_MS, TX_TIMEOUT_EVM_MS
FEATURE_AUTO_HUNT, FEATURE_PRIVATE_RPC, FEATURE_MEV_PROTECTION
```

**Files Created:**
- `packages/shared/src/security/gracefulDegradation.ts`

---

### M-006: Missing Graceful Degradation

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Service failures caused hard crashes without fallback.

**Remediation:**
Implemented:
- Circuit breaker pattern (5 failures opens circuit, 30s reset)
- Retry with exponential backoff (1s initial, 2x multiplier, 30s max)
- Degraded mode with adjusted settings
- Fallback mechanisms

---

### M-007: No Position Size Limits

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Users could open arbitrarily large positions.

**Remediation:**
Position limits per chain:

| Chain | Min | Max | Max % of Balance |
|-------|-----|-----|------------------|
| Solana | 0.01 SOL | 50 SOL | 25% |
| BSC | 0.01 BNB | 10 BNB | 25% |
| Base/ETH | 0.001 ETH | 2 ETH | 25% |

---

### M-008: No Cooldown Between Trades

**Severity:** Medium
**Status:** ✅ Fixed

**Description:**
Rapid consecutive trades could cause issues and be exploited.

**Remediation:**
Trade cooldown system:
- 30 seconds between same pair trades
- 5 seconds between any user trades
- Maximum 10 trades per minute per user

---

## Security Architecture Summary

### Defense in Depth Layers

```
┌─────────────────────────────────────────────────────┐
│                   User Interface                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Rate Limiting (C-003)                  │ │
│  │           Input Sanitization (M-001)             │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                  Authorization                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Wallet Ownership (C-002)               │ │
│  │           Input Validation (C-004)               │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                 Trading Logic                         │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Slippage Protection (H-001)            │ │
│  │           Transaction Simulation (H-002)         │ │
│  │           MEV Protection (H-006)                 │ │
│  │           Re-entrancy Guards (H-004)             │ │
│  │           Position Limits (M-007)                │ │
│  │           Trade Cooldown (M-008)                 │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                  Cryptography                         │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Per-User Key Derivation (C-001)        │ │
│  │           AES-256-GCM Encryption                 │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                  Infrastructure                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Deposit Finality (C-005)               │ │
│  │           Health Checks (M-004)                  │ │
│  │           Graceful Degradation (M-006)           │ │
│  │           Audit Logging (M-002)                  │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### New Security Files

| File | Purpose |
|------|---------|
| `apps/bot/src/middleware/rateLimit.ts` | Request rate limiting |
| `apps/bot/src/middleware/walletAuth.ts` | Wallet ownership verification |
| `apps/bot/src/utils/validation.ts` | Input validation utilities |
| `apps/bot/src/utils/inputSanitization.ts` | Input sanitization |
| `apps/bot/src/utils/withdrawalValidation.ts` | Withdrawal validation |
| `apps/executor/src/security/tradeGuards.ts` | Trading security (slippage, simulation, re-entrancy) |
| `apps/executor/src/security/transactionManager.ts` | Transaction lifecycle management |
| `packages/shared/src/security/auditLog.ts` | Security event logging |
| `packages/shared/src/security/healthCheck.ts` | Service health monitoring |
| `packages/shared/src/security/gracefulDegradation.ts` | Failure handling and config |

---

## Recommendations

### Immediate Actions (Completed)
- [x] All 20 security issues remediated
- [x] Patches deployed to production

### Ongoing Monitoring
1. Monitor security audit logs for anomalies
2. Review health check dashboard regularly
3. Track rate limit triggers for abuse patterns
4. Monitor failed transaction rates

### Future Enhancements
1. **Hardware Security Module (HSM)** - Consider HSM for master key storage
2. **Multi-signature Withdrawals** - Add 2FA for large withdrawals
3. **Anomaly Detection** - ML-based detection of unusual trading patterns
4. **Bug Bounty Program** - Incentivize external security research
5. **Penetration Testing** - Schedule regular third-party pentests

---

## Appendix A: Environment Variables

```bash
# Trading Limits
MAX_POSITION_SIZE_SOL=50
MAX_POSITION_SIZE_BNB=10
MAX_POSITION_SIZE_ETH=2
MAX_POSITIONS_PER_USER=10

# Slippage Configuration
DEFAULT_SLIPPAGE_BUY=15
DEFAULT_SLIPPAGE_SELL=10

# Timeouts (milliseconds)
RPC_TIMEOUT_MS=5000
TX_TIMEOUT_SOL_MS=30000
TX_TIMEOUT_EVM_MS=60000

# Rate Limits
RATE_LIMIT_REQUESTS_PER_MIN=30

# Feature Flags
FEATURE_AUTO_HUNT=true
FEATURE_PRIVATE_RPC=true
FEATURE_SIMULATION=true
FEATURE_MEV_PROTECTION=true

# Required Secrets
USER_WALLET_ENCRYPTION_KEY=<64-hex-chars>
TELEGRAM_BOT_TOKEN=<bot-token>
```

---

## Appendix B: Database Schema Updates

### New Table: security_audit_log

```sql
CREATE TABLE security_audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  tg_id BIGINT,
  chain VARCHAR(10),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_timestamp ON security_audit_log(timestamp);
CREATE INDEX idx_audit_log_tg_id ON security_audit_log(tg_id);
CREATE INDEX idx_audit_log_severity ON security_audit_log(severity);
```

---

## Document Information

**Version:** 1.0
**Classification:** Internal
**Distribution:** Development Team, Security Team
**Review Cycle:** Quarterly

---

*Report generated by Claude Opus 4.5 (Anthropic) - January 2026*

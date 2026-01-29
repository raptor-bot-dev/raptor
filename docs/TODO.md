# TODO.md - Post-Deploy Tasks (2026-01-29)

## Overview

**Current State:** Infrastructure audit complete. 13 commits ahead of origin/main. 236 tests passing. Remote DB migrations in sync.

**Primary Goal:** Push to GitHub, deploy to Fly.io, then verify end-to-end.

---

## P0 - Critical (Must Complete)

### 1. Post-Deploy Smoke Test
**Context:** New durable queue, notification outbox, and Phase-0 wiring deployed.

**Steps:**
1. Verify Fly.io deploy succeeded: `fly status -a raptor-bot` and `fly status -a raptor-hunter`
2. Check logs for clean startup: `fly logs -a raptor-bot` and `fly logs -a raptor-hunter`
3. Open Telegram bot — verify Home panel loads
4. Check Positions panel — verify ownership checks work (no cross-user leak)
5. Arm autohunt — verify CandidateConsumerLoop is processing launch_candidates
6. Emergency sell on any remaining active positions (Token-2022 ATA fix still applies)

### 2. Verify Notification Delivery
**Context:** Outbox flow rewritten with UUID→Telegram ID resolution.

**Steps:**
1. Trigger a buy (arm autohunt, wait for detection) or use emergency sell
2. Watch for notification delivery in Telegram
3. Check `notifications_outbox` table for delivery status
4. Verify notification includes correct user's Telegram chat

### 3. Set Fly.io Secrets (if not already set)
**Required for raptor-bot:**
- SUPABASE_URL, SUPABASE_SERVICE_KEY, WALLET_ENCRYPTION_KEY
- Recommended: SOLANA_RPC_URL

**Required for raptor-hunter:**
- SUPABASE_SERVICE_KEY, WALLET_ENCRYPTION_KEY, SOLANA_RPC_URL, SOLANA_WSS_URL

**For Bags Telegram detection (hunter):**
- BAGS_SOURCE_ENABLED=true, BAGS_BOT_TOKEN, BAGS_CHANNEL_ID

**For on-chain detection (hunter):**
- METEORA_ONCHAIN_ENABLED=true

---

## P1 - Important

### 4. Test Autohunt End-to-End with Bags Discovery
**Steps:**
1. Arm autohunt via Telegram
2. Wait for Bags Telegram signal or on-chain detection
3. Verify: position created, TP/SL stored, notification sent
4. Test emergency sell on new position

### 5. Max Positions Setting
**Context:** User requested 5 positions instead of default 2
- Update via Settings UI or SQL: `UPDATE strategies SET max_positions = 5 WHERE tg_id = <USER_ID>`

---

## P2 - Nice to Have

### 6. Integration Tests
- Token-2022 ATA detection test
- Fee recipient resolution test
- Notification outbox delivery test
- Durable queue claim/lease/finalize test

### 7. Background Price Polling
- For scale (100+ users): poll Jupiter every 30s, store in DB/Redis

---

## Deployment Status

| App | Status | Next Action |
|-----|--------|-------------|
| raptor-bot | Deploying | Verify after push |
| raptor-hunter | Deploying | Verify after push |

---

## Key Commands
```bash
# Deploy status
fly status -a raptor-bot
fly status -a raptor-hunter
fly releases -a raptor-bot
fly releases -a raptor-hunter

# View logs
fly logs -a raptor-bot
fly logs -a raptor-hunter

# Build locally
pnpm -w build

# Run tests
pnpm -w test
```

You’re right — that guide is the **old hybrid (Railway + VPS)** model. If you’re deploying on **Fly.io**, the architecture, commands, and operational practices change materially.

Below is a corrected, **Fly.io-first deployment guide** you can drop into `docs/Deployment.md` (or replace the old one). It keeps things **lean**, and it assumes you want to **reuse the existing bot/executor/hunter services** rather than rewriting.

---

# RAPTOR Deployment Guide (Fly.io)

Deploy RAPTOR on Fly.io using a **multi-app** setup backed by **Supabase Postgres** (and optionally Redis).

## Architecture (Fly.io)

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLY.IO                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │ raptor-bot     │    │ raptor-hunter  │    │ raptor-executor│ │
│  │ (Telegram UI)  │◄──►│ (scan + score) │◄──►│ (trade + exits) │ │
│  │ stateless      │    │ worker         │    │ worker/API      │ │
│  └────────────────┘    └────────────────┘    └────────────────┘ │
│              │                    │                    │        │
│              └────────────────────┴────────────────────┴───────►│
│                                  Supabase Postgres               │
│                                                                 │
│ Optional: Redis (Fly Redis / Upstash) for queues/locks/caching   │
└─────────────────────────────────────────────────────────────────┘
```

### Why this setup

* **Bot** is stateless and reliable (Telegram webhook or long-poll).
* **Hunter** runs continuously (poll/stream + decision).
* **Executor** runs continuously (sign/submit/confirm + exit loop).
* **Supabase** stores users/config/positions/trades/receipts.
* **Redis** (optional but recommended) handles locks, job queues, rate limits.

---

## Prerequisites

### Accounts

* Telegram bot token from @BotFather
* Fly.io account
* Supabase project

### Local tools

```bash
# Install flyctl
brew install flyctl
# or:
curl -L https://fly.io/install.sh | sh

# Login
fly auth login
```

---

## Database (Supabase)

You already have migrations in the repo. Continue using them; do not invent new schema unless required.

1. Create Supabase project
2. Get:

* `SUPABASE_URL`
* `SUPABASE_SERVICE_KEY` (keep secret)

3. Run migrations (same as before, in Supabase SQL editor) in order:

* `packages/database/migrations/*.sql`

---

## Fly.io App Strategy

Create **three Fly apps** (recommended):

* `raptor-bot` (Telegram)
* `raptor-hunter` (scanner)
* `raptor-executor` (trading + exit loop)

This avoids “one big process” deployments and makes scaling and restarts safer.

> If you insist on a single Fly app, use process groups in `fly.toml`, but multi-app is simpler to operate.

---

## Networking between Fly apps

Fly apps can call each other over **private networking** using:

* `http://raptor-executor.internal:3001` (example)
* No public exposure required (except optional health endpoints)

---

## Environment Variables (Fly secrets)

Use Fly secrets; never commit `.env` to git.

### Common secrets (all apps)

```bash
fly secrets set \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_KEY="..." \
  USER_WALLET_ENCRYPTION_KEY="32+ chars random"
```

### Bot secrets (raptor-bot)

```bash
fly secrets set \
  TELEGRAM_BOT_TOKEN="..." \
  EXECUTOR_API_URL="http://raptor-executor.internal:3001" \
  EXECUTOR_API_KEY="strong-shared-secret"
```

### Hunter secrets (raptor-hunter)

Solana-only example:

```bash
fly secrets set \
  SOLANA_RPC_URL="https://..." \
  HELIUS_API_KEY="..." \
  HELIUS_WSS_URL="wss://..." \
  EXECUTOR_API_URL="http://raptor-executor.internal:3001" \
  EXECUTOR_API_KEY="same-shared-secret"
```

### Executor secrets (raptor-executor)

```bash
fly secrets set \
  SOLANA_RPC_URL="https://..." \
  HELIUS_API_KEY="..." \
  HELIUS_WSS_URL="wss://..." \
  EXECUTOR_API_KEY="same-shared-secret"
```

If you are truly **self-custodial per-user** and store encrypted wallet blobs, do **not** add any single global private key here.

If you do have an executor key (for fee wallet, relayer, etc.), keep it here as a secret.

---

## Auto-Deploy from GitHub

**IMPORTANT:** Fly.io is configured to auto-deploy from GitHub pushes to `main`.

- No manual `fly deploy` needed for routine changes
- Push to `main` → Fly.io builds and deploys automatically
- Check deployment status in Fly.io dashboard or `fly status -a <app>`

For secrets changes, use `fly secrets set` then `fly secrets deploy`.

---

## Deployment (per app)

### 1) Create apps (initial setup only)

From repo root:

```bash
fly apps create raptor-bot
fly apps create raptor-hunter
fly apps create raptor-executor
```

### 2) Configure regions (latency)

Pick your primary region (example: `ams`, `fra`, `lhr`, `iad`).

```bash
fly regions set ams -a raptor-executor
fly regions set ams -a raptor-hunter
fly regions set ams -a raptor-bot
```

### 3) Dockerfile / build

Use the existing repo build system. The key is that each Fly app should start the correct workspace package.

Typical pattern (examples):

* `apps/bot`
* `apps/hunter`
* `apps/executor`

You can do this either via:

* separate `Dockerfile` per app, or
* one Dockerfile with `ARG APP=bot` and set per Fly app.

**Lean recommended approach**: one Dockerfile with a build arg.

Example `fly deploy` usage:

```bash
fly deploy -a raptor-bot --build-arg APP=bot
fly deploy -a raptor-hunter --build-arg APP=hunter
fly deploy -a raptor-executor --build-arg APP=executor
```

### 4) Attach secrets

Set secrets per app (examples shown above).

### 5) Deploy

```bash
fly deploy -a raptor-executor
fly deploy -a raptor-hunter
fly deploy -a raptor-bot
```

---

## Exposing ports (only where needed)

### Executor API

If the bot calls executor over Fly private networking, executor does **not** need to be publicly exposed.

* Keep `internal_port = 3001`
* No `services` public section required unless you want external health checks.

### Bot

Telegram can work in two modes:

* **Long polling**: bot makes outbound calls only (no inbound port required). Easiest.
* **Webhook**: Telegram needs to reach your bot externally (requires public HTTPS endpoint).

Given operational simplicity, start with **long polling** unless you have a strong reason to use webhook.

---

## Health checks

Each service should have:

* `/health` returning basic readiness: DB reachable, RPC reachable, queue reachable.

On Fly:

```bash
fly checks list -a raptor-executor
fly logs -a raptor-executor
```

---

## Scaling / machine sizing (practical defaults)

### Bot

* shared CPU, 256–512MB RAM is usually fine.

### Hunter

* shared CPU or 1x dedicated CPU if you do heavy scanning
* 512MB–1GB RAM depending on ingestion

### Executor

* prioritize **low jitter**: dedicated CPU recommended
* 1GB RAM minimum if you do route simulation / lots of RPC calls

Fly examples:

```bash
fly scale vm shared-cpu-1x -a raptor-bot
fly scale memory 512 -a raptor-bot

fly scale vm shared-cpu-1x -a raptor-hunter
fly scale memory 1024 -a raptor-hunter

fly scale vm performance-1x -a raptor-executor
fly scale memory 2048 -a raptor-executor
```

---

## Operational checklist

### Security

* Secrets only via `fly secrets`
* Rotate `EXECUTOR_API_KEY` periodically
* Lock down executor API to Fly private networking if possible
* Never log decrypted wallet material
* Keep `USER_WALLET_ENCRYPTION_KEY` long and random

### Reliability

* Add job/position locks (Redis recommended)
* Use idempotency keys for buy/sell
* Always confirm signatures before sending “executed” notifications

---

## Troubleshooting

### View logs

```bash
fly logs -a raptor-bot
fly logs -a raptor-hunter
fly logs -a raptor-executor
```

### SSH into a machine

```bash
fly ssh console -a raptor-executor
```

### Common issues

**1) Bot not responding**

* Check token is correct
* Check bot process is running (`fly status`)
* If webhook: verify HTTPS route and Telegram webhook config

**2) Executor can’t reach RPC**

* Validate RPC URL
* Try increasing timeouts
* Move region closer to RPC infrastructure

**3) Hunter sends actions but executor rejects**

* Check `EXECUTOR_API_KEY` matches
* Check internal DNS URL is correct (`raptor-executor.internal:3001`)

---

## Minimal cost baseline

Fly costs vary by region and VM class. Start small:

* bot: shared-cpu-1x / 512MB
* hunter: shared-cpu-1x / 1GB
* executor: performance-1x / 2GB (or shared if budget constrained)

---

## Next steps

1. Deploy Supabase + migrations
2. Deploy `raptor-executor`
3. Deploy `raptor-hunter` and confirm it can call executor internally
4. Deploy `raptor-bot` and confirm it can notify and query status
5. Run small test funds and verify:

   * buy notification
   * emergency sell works
   * withdraw custom SOL and % math is correct

---

If you want, paste your current repo’s `Dockerfile` / `fly.toml` situation (or tell me whether you already have Fly configs), and I’ll produce the exact Fly config layout (multi-app or process groups) that matches your existing codebase without rewrites.

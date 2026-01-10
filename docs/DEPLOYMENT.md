# RAPTOR Deployment Guide

Complete deployment guide for the RAPTOR multi-chain MEV hunting bot.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   RAILWAY    │      │     VPS      │      │   SUPABASE   │  │
│  │              │      │   (Hetzner)  │      │              │  │
│  │  Telegram    │ ───► │   Executor   │ ───► │  PostgreSQL  │  │
│  │    Bot       │ ◄─── │   (Trading)  │ ◄─── │   Database   │  │
│  │              │      │              │      │              │  │
│  │  - Commands  │      │  - Sniping   │      │  - Users     │  │
│  │  - UI/UX     │      │  - Monitoring│      │  - Positions │  │
│  │  - Messages  │      │  - Execution │      │  - Trades    │  │
│  │              │      │  - Redis     │      │  - Settings  │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│        $5/mo               €5.49/mo              Free tier      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why Hybrid?**
- **Railway (Bot)**: Reliable, managed hosting for stateless bot logic
- **VPS (Executor)**: Low-latency, dedicated resources for time-critical trading
- **Supabase (Database)**: Managed PostgreSQL with real-time capabilities

---

## Prerequisites

### 1. Accounts & Services

- **Telegram**: Bot token from [@BotFather](https://t.me/botfather)
- **Railway**: Account at [railway.app](https://railway.app)
- **Hetzner**: VPS account at [hetzner.com](https://www.hetzner.com/cloud)
- **Supabase**: Project at [supabase.com](https://supabase.com)
- **GitHub**: Repository access

### 2. API Keys

- **Helius**: Solana RPC ([helius.dev](https://www.helius.dev))
- **Alchemy**: EVM RPCs ([alchemy.com](https://www.alchemy.com))
- **bloXroute** (optional): MEV protection for BSC
- **Flashbots** (optional): MEV protection for Ethereum
- **Sentry** (optional): Error tracking

### 3. Local Tools

```bash
# Install Railway CLI
npm install -g @railway/cli

# Install Docker (for VPS deployment)
# See: https://docs.docker.com/engine/install/

# Install pnpm (for building)
npm install -g pnpm
```

---

## Part 1: Database Setup (Supabase)

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note down:
   - `SUPABASE_URL`: Your project URL
   - `SUPABASE_ANON_KEY`: Public anon key
   - `SUPABASE_SERVICE_KEY`: Service role key (keep secret!)

### Step 2: Run Database Migrations

1. Open SQL Editor in Supabase dashboard
2. Run migrations in order:

```bash
# Navigate to migrations folder
cd packages/database/migrations

# Copy each file content and execute in SQL Editor:
# 1. 001_initial.sql
# 2. 002_v2_upgrade.sql
# 3. 003_v22_upgrade.sql
# 4. 004_self_custodial_wallets.sql
# 5. 005_multi_wallet_support.sql
```

### Step 3: Verify Tables

Run this query in SQL Editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

You should see: `users`, `user_wallets`, `user_settings`, `positions`, `trades`, `limit_orders`, etc.

---

## Part 2: VPS Setup (Hetzner)

### Step 1: Provision VPS

1. **Choose Server**:
   - Provider: Hetzner Cloud
   - Type: CX21 (2 vCPU, 4GB RAM, 40GB SSD)
   - Location: Closest to your target chains (US/EU)
   - OS: Ubuntu 22.04 LTS

2. **Configure SSH**:
   ```bash
   # Generate SSH key (if you don't have one)
   ssh-keygen -t ed25519 -C "your_email@example.com"

   # Add public key to Hetzner during VPS creation
   cat ~/.ssh/id_ed25519.pub
   ```

3. **Note VPS IP**: You'll need this later (e.g., `5.161.123.45`)

### Step 2: Run Setup Script

From your local machine:

```bash
# 1. SSH into VPS as root
ssh root@YOUR_VPS_IP

# 2. Download and run setup script
wget https://raw.githubusercontent.com/raptor-bot-dev/raptor/main/scripts/setup-vps.sh
chmod +x setup-vps.sh
sudo bash setup-vps.sh
```

This script will:
- Update system packages
- Create `raptor` user with sudo access
- Configure SSH security (disable password auth, disable root login)
- Setup firewall (UFW) with ports 22, 80, 443, 3000, 3001
- Install fail2ban for brute-force protection
- Install Docker & Docker Compose
- Install Node.js 20, pnpm, PM2
- Create application directories

### Step 3: Configure SSH Key for raptor User

```bash
# Copy your SSH key to raptor user
ssh-copy-id raptor@YOUR_VPS_IP

# Test connection
ssh raptor@YOUR_VPS_IP

# You should now be logged in as raptor user (not root)
```

### Step 4: Clone Repository

```bash
# As raptor user on VPS
cd /opt/raptor
git clone https://github.com/raptor-bot-dev/raptor.git .

# Verify
ls -la
# You should see: apps/, packages/, scripts/, etc.
```

### Step 5: Configure Environment Variables

```bash
# Create .env file
nano /opt/raptor/.env

# Copy content from .env.vps template and fill in your keys
# See "Environment Variables" section below
```

---

## Part 3: Deploy Executor (VPS)

### Option A: Docker Compose (Recommended)

```bash
# Build and start services
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f executor

# You should see:
# ✅ Configuration validated
# ✅ All RPC endpoints validated
# ✅ RAPTOR Execution Engine running
```

### Option B: PM2 (Alternative)

```bash
# Install dependencies and build
pnpm install --frozen-lockfile
pnpm build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup

# Check status
pm2 list
pm2 logs
```

### Verify Executor Health

```bash
# Check API health endpoint
curl http://localhost:3000/health

# Should return JSON with:
# - status: "healthy"
# - checks: database, redis, solana-rpc, bsc-rpc, base-rpc, memory
```

---

## Part 4: Deploy Bot (Railway)

### Step 1: Login to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# This will open browser for authentication
```

### Step 2: Create Railway Project

```bash
# In your local raptor directory
cd /path/to/raptor

# Link to new Railway project
railway init

# OR link to existing project
railway link
```

### Step 3: Configure Environment Variables

**Option A: Via Railway Dashboard**

1. Go to [railway.app/dashboard](https://railway.app/dashboard)
2. Select your project
3. Go to "Variables" tab
4. Add variables from `.env.railway` template

**Option B: Via CLI**

```bash
# Set variables from .env.railway
railway variables set TELEGRAM_BOT_TOKEN=your_token
railway variables set SUPABASE_URL=your_url
railway variables set SUPABASE_SERVICE_KEY=your_key
railway variables set EXECUTOR_API_URL=http://YOUR_VPS_IP:3001
railway variables set EXECUTOR_API_KEY=your_secret

# Or upload entire .env.railway file
railway variables --set-from-file .env.railway
```

### Step 4: Deploy

```bash
# Deploy bot to Railway
railway up

# Monitor deployment
railway logs -f

# Get deployment URL
railway status
```

### Step 5: Verify Bot

1. Open Telegram
2. Search for your bot (`@YourBotUsername`)
3. Send `/start`
4. You should see the welcome message

---

## Part 5: Post-Deployment

### Configure Domain (Optional)

**For API (VPS)**:

```bash
# Install nginx
sudo apt install nginx

# Configure reverse proxy (example)
sudo nano /etc/nginx/sites-available/raptor

# Add:
server {
    listen 80;
    server_name api.yourbot.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/raptor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Install SSL with Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourbot.com
```

**For Bot (Railway)**:

Railway provides automatic HTTPS URLs. Use custom domain feature in dashboard.

### Setup Monitoring

**1. Enable Sentry (Error Tracking)**:

Add `SENTRY_DSN` to both Railway and VPS `.env` files.

**2. Setup Uptime Monitoring**:

Use services like:
- UptimeRobot ([uptimerobot.com](https://uptimerobot.com))
- BetterUptime ([betteruptime.com](https://betteruptime.com))

Monitor:
- API health: `http://YOUR_VPS_IP:3000/health`
- Bot: Telegram bot availability

**3. Server Monitoring (VPS)**:

```bash
# Install Netdata (optional)
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Access at: http://YOUR_VPS_IP:19999
```

### Backup Strategy

**1. Database (Supabase)**:

Supabase has automatic daily backups (paid plans). For free tier:

```bash
# Manual backup via pg_dump
pg_dump "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" > backup.sql
```

**2. VPS Configuration**:

```bash
# Backup .env and config files
tar -czf raptor-config-backup.tar.gz /opt/raptor/.env /opt/raptor/ecosystem.config.js

# Transfer to local machine
scp raptor@YOUR_VPS_IP:/path/to/backup.tar.gz ./backups/
```

---

## Environment Variables Reference

### Bot (Railway) - Minimal

```env
# Required
TELEGRAM_BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
EXECUTOR_API_URL=http://YOUR_VPS_IP:3001
EXECUTOR_API_KEY=
USER_WALLET_ENCRYPTION_KEY=

# Optional
SENTRY_DSN=
```

### Executor (VPS) - Full Configuration

```env
# Application
NODE_ENV=production

# Database
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Redis
REDIS_URL=redis://localhost:6379

# Executor Keys
EXECUTOR_PRIVATE_KEY=            # EVM private key (NO 0x prefix)
SOLANA_EXECUTOR_PRIVATE_KEY=     # Solana private key (base58)

# Solana RPCs
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=XXX
HELIUS_API_KEY=
HELIUS_WSS_URL=wss://mainnet.helius-rpc.com/?api-key=XXX

# EVM RPCs
BSC_RPC_URL=https://bsc-dataseed.binance.org
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/XXX
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/XXX

# Private RPCs (Optional, for MEV protection)
ETH_PRIVATE_RPC_URL=https://rpc.flashbots.net
BSC_PRIVATE_RPC_URL=https://bsc.rpc.blxrbdn.com
BLOXROUTE_AUTH_HEADER=

# Fee Wallets
FEE_WALLET_SOL=
FEE_WALLET_EVM=

# Security
USER_WALLET_ENCRYPTION_KEY=      # 32 characters

# Trading (Optional)
VERIFICATION_SLIPPAGE_BPS=500    # 5%

# Monitoring (Optional)
SENTRY_DSN=
```

---

## Deployment Scripts

### Deploy Executor to VPS

```bash
# From local machine
bash scripts/deploy-executor.sh YOUR_VPS_IP
```

This will:
1. Create backup of existing deployment
2. Sync code to VPS
3. Upload `.env` file
4. Install dependencies and build
5. Restart services (Docker or PM2)
6. Run health checks

### Deploy Bot to Railway

```bash
# From local machine
bash scripts/deploy-bot.sh
```

This will:
1. Validate build locally
2. Sync environment variables
3. Deploy to Railway
4. Monitor deployment status

---

## Troubleshooting

### Bot Issues

**Bot not responding in Telegram:**

```bash
# Check Railway logs
railway logs -f

# Common issues:
# - TELEGRAM_BOT_TOKEN incorrect
# - EXECUTOR_API_URL not accessible
# - Network issues between Railway and VPS
```

**Fix:**
- Verify token with `curl https://api.telegram.org/bot<TOKEN>/getMe`
- Check VPS firewall allows incoming on port 3001
- Test executor from Railway: `curl http://YOUR_VPS_IP:3001/health`

### Executor Issues

**RPC connection failed:**

```bash
# Check logs
docker compose logs executor
# OR
pm2 logs raptor-executor

# Test RPC manually
curl -X POST https://mainnet.helius-rpc.com/?api-key=YOUR_KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

**Redis connection failed:**

```bash
# Check Redis status
docker compose ps redis
# OR
redis-cli ping

# Restart Redis
docker compose restart redis
```

**Out of memory:**

```bash
# Check memory usage
free -h
docker stats

# Increase VPS RAM or add swap:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Database Issues

**Connection timeout:**

- Check Supabase dashboard for outages
- Verify `SUPABASE_URL` and keys are correct
- Check if VPS IP is blocked (Supabase > Settings > Database > Connection Pooling)

### Performance Issues

**Slow trade execution:**

1. **Check RPC latency:**
   ```bash
   time curl -X POST YOUR_RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. **Use private RPCs** (Flashbots, bloXroute)

3. **Move VPS closer to RPC nodes** (US for Solana/Base, EU for BSC)

4. **Increase compute units** (Solana) or gas price (EVM)

---

## Maintenance

### Update Code

```bash
# VPS
ssh raptor@YOUR_VPS_IP
cd /opt/raptor
git pull
pnpm install
pnpm build
docker compose restart  # OR: pm2 restart all

# Railway (automatic on git push if connected)
git push origin main
```

### Monitor Logs

```bash
# VPS
docker compose logs -f --tail=100
# OR
pm2 logs --lines 100

# Railway
railway logs -f
```

### Database Maintenance

```sql
-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Archive old trades (older than 30 days)
DELETE FROM trades WHERE created_at < NOW() - INTERVAL '30 days';
```

### Cost Optimization

**Current monthly costs:**
- Railway: $5
- Hetzner CX21: €5.49 (~$6)
- Supabase: Free tier (up to 500MB database)
- **Total: ~$11/month**

**To reduce costs:**
- Use Railway free tier (500 hours/month)
- Downgrade to Hetzner CX11 (1 vCPU, 2GB RAM) for €3.79/month
- Use public RPCs (free but slower)

**To improve performance:**
- Upgrade VPS to CX31 or CX41
- Use dedicated RPCs (Helius Premium, Alchemy Growth)
- Add more private RPC providers

---

## Security Checklist

- [ ] VPS: SSH key-only authentication (no passwords)
- [ ] VPS: Root login disabled
- [ ] VPS: Firewall configured (UFW)
- [ ] VPS: fail2ban active
- [ ] VPS: Regular security updates (`apt update && apt upgrade`)
- [ ] Environment: All private keys secured (never committed to git)
- [ ] Environment: Strong `USER_WALLET_ENCRYPTION_KEY` (32+ random characters)
- [ ] Database: Service key never exposed to frontend
- [ ] Railway: Environment variables set (not in code)
- [ ] Monitoring: Sentry configured for error alerts
- [ ] Backups: Database backup strategy in place
- [ ] Testing: Test with small amounts first

---

## Next Steps

1. ✅ Deploy database (Supabase)
2. ✅ Provision VPS (Hetzner)
3. ✅ Deploy executor to VPS
4. ✅ Deploy bot to Railway
5. ⏭️ **Test with small amounts** (0.01 SOL, 0.0001 ETH)
6. ⏭️ Monitor for 24 hours
7. ⏭️ Gradually increase position limits
8. ⏭️ Setup monitoring and alerts
9. ⏭️ Announce to users

---

## Support

- **GitHub Issues**: [github.com/raptor-bot-dev/raptor/issues](https://github.com/raptor-bot-dev/raptor/issues)
- **Documentation**: Check `docs/` folder for more guides
- **Logs**: Always include logs when reporting issues

---

**🦖 Happy deploying!**

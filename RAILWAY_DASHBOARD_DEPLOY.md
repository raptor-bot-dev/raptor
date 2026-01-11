# 🚂 Deploy RAPTOR Bot via Railway Dashboard

## Step-by-Step Guide (5 minutes)

### 1️⃣ Create New Project (1 minute)

1. Go to **https://railway.app/new**
2. Click **"Deploy from GitHub repo"**
3. Select **"raptor-bot-dev/raptor"** repository
4. Click **"Deploy Now"**

Railway will start building automatically, but it will fail because we need to configure it first. That's okay!

---

### 2️⃣ Configure Service Settings (1 minute)

1. Click on the deployed service
2. Go to **Settings** tab
3. Scroll to **"Build"** section:
   - **Builder**: `DOCKERFILE`
   - **Dockerfile Path**: `Dockerfile`
   - **Docker Build Target**: `bot`
   - **Root Directory**: `apps/bot` ← **IMPORTANT!**

4. Scroll to **"Deploy"** section:
   - **Start Command**: `node dist/index.js`
   - **Healthcheck Path**: Leave empty (bot doesn't have HTTP endpoint)

5. Click **"Save"** (if there's a save button)

---

### 3️⃣ Set Environment Variables (2 minutes)

1. Go to **"Variables"** tab
2. Click **"+ New Variable"** and add these one by one:

```env
NODE_ENV=production
PORT=3000
TELEGRAM_BOT_TOKEN=8248463806:AAGG4r5kIGZ2qGLthMiAcpXWWzkeMsUPLa0
SUPABASE_URL=https://pkmckwmxdxwvwuqczaac.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrbWNrd214ZHh3dnd1cWN6YWFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MjQ4ODcsImV4cCI6MjA4MzUwMDg4N30.m46jk3GfQaNPL4suBf4XutBFaqBWF627VhJ639iXZzo
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrbWNrd214ZHh3dnd1cWN6YWFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzkyNDg4NywiZXhwIjoyMDgzNTAwODg3fQ.fNXoA87VYAZzkkw-fn7w18_v-ZDxrq-X18ganVjBOl4
EXECUTOR_API_URL=http://46.224.216.77:3001
EXECUTOR_API_KEY=ab40faa2a7526e55f7d330d859c610d7f2136f5c1add0c0e91ce4b938cf5ac0f
USER_WALLET_ENCRYPTION_KEY=00d1bcd0c6e960af75e2b78b3216a09bfad5aa3baa672cef15a11bdb289ca9dc
SENTRY_DSN=https://be639510090528c80501e24f8a12a536@o4510679100489728.ingest.de.sentry.io/4510679107305552
```

**TIP:** Copy all variables, click "Raw Editor" button, and paste them all at once!

---

### 4️⃣ Redeploy (30 seconds)

1. Go to **"Deployments"** tab
2. Click **"Deploy"** button in top right
3. Wait for build to complete (~2-3 minutes)

---

### 5️⃣ Check Logs (30 seconds)

1. While building, go to **"Logs"** tab
2. Watch for:
   - ✅ `"Building stage..."`
   - ✅ `"Successfully built..."`
   - ✅ `"✅ RAPTOR Bot started"`
   - ✅ `"Bot is running..."`

If you see errors, check the troubleshooting section below.

---

## ✅ Verify Deployment

### Check Railway Logs
In the **Logs** tab, you should see:
```
[Config] Configuration loaded from environment
[MultiRPC] Using public RPC fallbacks for sol...
✅ RAPTOR Bot started
Bot is running...
```

### Test in Telegram
1. Open Telegram
2. Search for your bot (the name you gave @BotFather)
3. Send: `/start`
4. You should get a welcome message!

---

## 🐛 Troubleshooting

### Build Fails with "Dockerfile not found"
**Fix:** Make sure **Root Directory** is set to `apps/bot` in Settings

### Build Fails with "Cannot find module"
**Fix:** Check that **Docker Build Target** is set to `bot`

### Bot starts but doesn't respond in Telegram
**Fix:**
1. Check TELEGRAM_BOT_TOKEN is correct
2. Check logs for errors
3. Make sure bot is running (not crashed)

### "EXECUTOR_API_URL connection failed"
**Fix:**
1. Verify VPS executor is running: `ssh raptor-vps docker compose ps`
2. Check VPS IP is correct: `46.224.216.77`
3. Check firewall allows port 3001

### Database connection errors
**Fix:**
1. Verify Supabase is running: https://supabase.com/dashboard
2. Check SUPABASE_SERVICE_KEY is correct
3. Make sure database migrations are applied

---

## 📊 Monitor Everything

### Railway Dashboard
- **Logs**: Real-time bot logs
- **Metrics**: CPU, Memory, Network usage
- **Deployments**: Build history

### VPS Executor
```bash
# SSH to VPS
ssh raptor-vps

# Check executor logs
cd /opt/raptor
docker compose logs -f executor
```

---

## 🧪 Test the Bot

Once deployed, test these commands in Telegram:

1. **`/start`** - Welcome message
2. **`/wallet`** - Create or import wallet
3. **`/gas`** - Configure gas settings
4. **`/help`** - See all commands

### Test a Trade (BE CAREFUL!)
1. Create a test wallet with `/wallet`
2. Deposit **0.01 SOL** (tiny amount!)
3. Find a token and try a **$1 trade**
4. Watch executor logs on VPS to see it execute
5. Check if position appears in bot

**⚠️ IMPORTANT: Only use test amounts until you verify everything works!**

---

## 🎯 Next Steps After Deployment

1. ✅ Bot responds to `/start`
2. ✅ Create a test wallet
3. ✅ Deposit 0.01 SOL
4. ✅ Configure gas settings with `/gas`
5. ✅ Try a tiny trade ($1-2)
6. ✅ Verify executor executes it
7. ✅ Check position tracking
8. ✅ Gradually increase if all works

---

## 📞 Quick Reference

**Railway Dashboard:** https://railway.app/dashboard
**VPS Executor:** `ssh raptor-vps`
**Supabase Dashboard:** https://supabase.com/dashboard
**Bot Repository:** https://github.com/raptor-bot-dev/raptor

**Useful Commands:**
```bash
# View Railway logs (if CLI works later)
railway logs -f

# Check VPS executor
ssh raptor-vps
docker compose logs -f executor
docker compose ps

# Restart bot on Railway
# Just click "Restart" in Railway dashboard
```

---

## 🎉 You're Live!

Once you see the bot responding in Telegram, you're ready to test! Remember:
- Start with tiny amounts (0.01 SOL, $1 trades)
- Monitor both Railway and VPS logs
- Test all features before trusting with larger amounts
- The executor is already monitoring Solana mainnet!

**Good luck! 🦖**

# 🚀 Deploy RAPTOR Bot to Railway (Quick Start)

## ✅ VPS Status: RUNNING
- Executor: http://46.224.216.77:3001 ✅
- Redis: Running ✅
- Solana: Monitoring ✅

---

## 📦 Deploy Bot in 3 Minutes

### Step 1: Login to Railway (30 seconds)
```bash
railway login
```
This will open your browser - sign in with GitHub.

### Step 2: Create/Link Project (30 seconds)
```bash
cd c:/RaptorBot/raptor/apps/bot
railway init
```
- Choose: "Empty Project"
- Name it: "raptor-bot"

### Step 3: Set Environment Variables (1 minute)
```bash
cd c:/RaptorBot/raptor
scripts/railway-vars.bat
```
This sets all required environment variables automatically.

### Step 4: Deploy! (1 minute)
```bash
cd apps/bot
railway up
```
Wait for build to complete (~60 seconds).

### Step 5: Check Logs
```bash
railway logs -f
```
You should see: "✅ RAPTOR Bot started"

---

## 🧪 Test the Bot

1. **Find your bot on Telegram:**
   - Search for your bot name
   - Or use the link from @BotFather

2. **Send `/start`**
   - Bot should respond with welcome message

3. **Try `/gas`**
   - Configure gas settings per chain

4. **Try `/wallet`**
   - Create or import a wallet
   - **USE A TEST WALLET WITH SMALL AMOUNTS!**

5. **Test a small trade:**
   - Deposit 0.01 SOL
   - Try a $1 trade
   - Monitor executor logs on VPS

---

## 🔍 Monitor Everything

**Railway Bot Logs:**
```bash
railway logs -f
```

**VPS Executor Logs:**
```bash
ssh raptor-vps
cd /opt/raptor
docker compose logs -f executor
```

**Check Service Status:**
```bash
# Bot (Railway)
railway status

# Executor (VPS)
ssh raptor-vps
docker compose ps
```

---

## ⚠️ Important Notes

1. **Test with tiny amounts first** (0.01 SOL, $1-2 trades)
2. **Never share your bot token or API keys**
3. **Monitor logs closely** during first trades
4. **The executor is already live** and monitoring Solana!

---

## 🐛 Troubleshooting

**Bot not responding:**
```bash
railway logs --tail=100
```

**Executor connection failed:**
- Check VPS is running: `ssh raptor-vps docker compose ps`
- Check firewall: Port 3001 should be open
- Verify EXECUTOR_API_URL in Railway variables

**Database errors:**
- Check Supabase is running: https://supabase.com/dashboard
- Verify migrations are applied

---

## 📞 Quick Commands Reference

```bash
# Railway
railway logs -f              # View logs
railway status               # Check deployment status
railway restart              # Restart bot
railway open                 # Open Railway dashboard
railway variables            # List all variables

# VPS
ssh raptor-vps                          # Connect to VPS
docker compose logs -f executor         # View executor logs
docker compose restart executor         # Restart executor
docker compose ps                       # Check service status
```

---

## ✅ What's Next After Deployment

1. Test bot with `/start`, `/wallet`, `/gas`
2. Create a test wallet
3. Deposit 0.01 SOL
4. Try a tiny trade ($1-2)
5. Watch executor logs to see it working
6. Gradually increase position sizes if all works well
7. Configure production settings in `/gas`

**The executor is already monitoring Solana - let's get the bot up and test it!** 🦖

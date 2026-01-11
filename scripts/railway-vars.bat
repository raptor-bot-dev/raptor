@echo off
REM =============================================================================
REM Railway Environment Variables Setup (Windows)
REM Run this after: railway login && railway link
REM =============================================================================

echo 🦖 Setting Railway environment variables...

REM Core Configuration
call railway variables set NODE_ENV=production
call railway variables set PORT=3000

REM Telegram
call railway variables set TELEGRAM_BOT_TOKEN=8248463806:AAGG4r5kIGZ2qGLthMiAcpXWWzkeMsUPLa0

REM Database (Supabase)
call railway variables set SUPABASE_URL=https://pkmckwmxdxwvwuqczaac.supabase.co
call railway variables set SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrbWNrd214ZHh3dnd1cWN6YWFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MjQ4ODcsImV4cCI6MjA4MzUwMDg4N30.m46jk3GfQaNPL4suBf4XutBFaqBWF627VhJ639iXZzo
call railway variables set SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrbWNrd214ZHh3dnd1cWN6YWFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzkyNDg4NywiZXhwIjoyMDgzNTAwODg3fQ.fNXoA87VYAZzkkw-fn7w18_v-ZDxrq-X18ganVjBOl4

REM Executor API (VPS)
call railway variables set EXECUTOR_API_URL=http://46.224.216.77:3001
call railway variables set EXECUTOR_API_KEY=ab40faa2a7526e55f7d330d859c610d7f2136f5c1add0c0e91ce4b938cf5ac0f

REM Wallet Encryption
call railway variables set USER_WALLET_ENCRYPTION_KEY=00d1bcd0c6e960af75e2b78b3216a09bfad5aa3baa672cef15a11bdb289ca9dc

REM Optional: Monitoring
call railway variables set SENTRY_DSN=https://be639510090528c80501e24f8a12a536@o4510679100489728.ingest.de.sentry.io/4510679107305552

echo.
echo ✅ All environment variables set!
echo.
echo Next steps:
echo   1. Deploy: railway up
echo   2. View logs: railway logs -f
echo   3. Test bot in Telegram
pause

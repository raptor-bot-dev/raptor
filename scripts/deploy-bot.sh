#!/bin/bash

# =============================================================================
# RAPTOR Bot Deployment Script
# Deploys Telegram bot to Railway
# =============================================================================
# Requirements: Railway CLI installed, Railway project configured
# Usage: bash scripts/deploy-bot.sh
# =============================================================================

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# =============================================================================
# Pre-deployment checks
# =============================================================================
log "🦖 Deploying RAPTOR Bot to Railway"
log "=================================================="

# Check if Railway CLI is installed
if ! command -v railway &>/dev/null; then
  error "Railway CLI not installed. Install it with: npm install -g @railway/cli"
fi

# Check if logged in to Railway
if ! railway whoami &>/dev/null; then
  error "Not logged in to Railway. Run: railway login"
fi

# Check if .env exists
if [[ ! -f ".env" ]]; then
  warn ".env file not found locally. Make sure environment variables are set in Railway dashboard."
fi

# =============================================================================
# 1. Link to Railway project (if not already linked)
# =============================================================================
log "Step 1/5: Checking Railway project link..."

if [[ ! -f "railway.json" ]] && [[ ! -f ".railway" ]]; then
  warn "Not linked to Railway project. Please link first:"
  log "  1. Create a new project on Railway: https://railway.app/new"
  log "  2. Run: railway link"
  error "Project not linked. Aborting."
fi

log "Railway project linked"

# =============================================================================
# 2. Validate build
# =============================================================================
log "Step 2/5: Running build validation..."

# Build locally to ensure no errors
if ! pnpm build; then
  error "Build failed. Fix errors before deploying."
fi

log "Build validation passed"

# =============================================================================
# 3. Set environment variables on Railway
# =============================================================================
log "Step 3/5: Syncing environment variables..."

if [[ -f ".env" ]]; then
  warn "Uploading .env to Railway (this will overwrite existing variables)"
  read -p "Continue? [y/N]: " -n 1 -r
  echo

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Upload environment variables
    railway variables --set-from-file .env

    # Set additional Railway-specific variables
    railway variables set NODE_ENV=production
    railway variables set PORT=3000

    log "Environment variables synced"
  else
    warn "Skipping environment variable sync"
  fi
else
  warn "No .env file found. Skipping variable sync."
  warn "Make sure to set variables manually in Railway dashboard."
fi

# =============================================================================
# 4. Deploy to Railway
# =============================================================================
log "Step 4/5: Deploying to Railway..."

# Deploy using Railway CLI
if railway up; then
  log "Deployment triggered successfully"
else
  error "Deployment failed. Check Railway logs for details."
fi

# =============================================================================
# 5. Monitor deployment
# =============================================================================
log "Step 5/5: Monitoring deployment..."

log "Waiting for deployment to complete..."
sleep 10

# Get deployment status
DEPLOYMENT_URL=$(railway status --json | grep -o '"url":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ -n "$DEPLOYMENT_URL" ]]; then
  log "Deployment URL: $DEPLOYMENT_URL"

  # Check health endpoint
  if curl -f -s "${DEPLOYMENT_URL}/health" > /dev/null; then
    log "✅ Health check passed"
  else
    warn "⚠️  Health check failed - deployment may still be starting"
  fi
else
  warn "Could not retrieve deployment URL. Check Railway dashboard."
fi

# =============================================================================
# Deployment Complete
# =============================================================================
log "=================================================="
log "✅ Bot Deployment Complete!"
log ""
log "Next steps:"
log "1. Check Railway dashboard: https://railway.app/dashboard"
log "2. View logs: railway logs"
log "3. Test bot in Telegram"
log ""
log "Useful commands:"
log "  - View logs: railway logs -f"
log "  - Check status: railway status"
log "  - Restart service: railway restart"
log "  - Open dashboard: railway open"
log ""
log "🦖 Bot is live!"

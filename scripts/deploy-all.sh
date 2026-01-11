#!/bin/bash

# =============================================================================
# RAPTOR Complete Deployment Script
# Deploys everything from scratch to Hetzner VPS
# =============================================================================
# Usage: bash scripts/deploy-all.sh
# =============================================================================

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

VPS_IP="46.224.216.77"
VPS_USER_ROOT="root"
VPS_USER_RAPTOR="raptor"
SSH_KEY="$HOME/.ssh/raptor_vps"

log "🦖 RAPTOR Complete Deployment to VPS: $VPS_IP"
log "============================================================"

# =============================================================================
# Step 1: Test SSH Connection
# =============================================================================
log "Step 1/7: Testing SSH connection..."

if ! ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$VPS_USER_ROOT@$VPS_IP" "echo 'SSH OK'" &>/dev/null; then
  error "Cannot connect to VPS. Please check:"
  echo "  1. VPS is running"
  echo "  2. SSH key is correct: $SSH_KEY"
  echo "  3. IP is correct: $VPS_IP"
  exit 1
fi

log "✅ SSH connection successful"

# =============================================================================
# Step 2: Run VPS Setup Script
# =============================================================================
log "Step 2/7: Running VPS setup script (this takes 5-10 minutes)..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_ROOT@$VPS_IP" bash <<'REMOTE_SETUP'
  set -e

  # Download setup script
  if [ ! -f setup-vps.sh ]; then
    wget -q https://raw.githubusercontent.com/raptor-bot-dev/raptor/main/scripts/setup-vps.sh
    chmod +x setup-vps.sh
  fi

  # Run setup script
  bash setup-vps.sh
REMOTE_SETUP

log "✅ VPS setup complete"

# =============================================================================
# Step 3: Configure Raptor User SSH Access
# =============================================================================
log "Step 3/7: Configuring raptor user SSH access..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_ROOT@$VPS_IP" bash <<'REMOTE_SSH'
  set -e

  # Copy SSH keys to raptor user
  mkdir -p /home/raptor/.ssh
  cp ~/.ssh/authorized_keys /home/raptor/.ssh/
  chown -R raptor:raptor /home/raptor/.ssh
  chmod 700 /home/raptor/.ssh
  chmod 600 /home/raptor/.ssh/authorized_keys

  echo "Raptor user SSH configured"
REMOTE_SSH

log "✅ Raptor user SSH access configured"

# =============================================================================
# Step 4: Clone Repository
# =============================================================================
log "Step 4/7: Cloning RAPTOR repository..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_RAPTOR@$VPS_IP" bash <<'REMOTE_CLONE'
  set -e

  cd /opt/raptor

  # Clone if not exists, otherwise pull
  if [ ! -d .git ]; then
    git clone https://github.com/raptor-bot-dev/raptor.git .
  else
    git fetch --all
    git reset --hard origin/main
  fi

  echo "Repository cloned/updated"
REMOTE_CLONE

log "✅ Repository cloned"

# =============================================================================
# Step 5: Configure Environment
# =============================================================================
log "Step 5/7: Configuring environment variables..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_RAPTOR@$VPS_IP" bash <<'REMOTE_ENV'
  set -e

  cd /opt/raptor

  # Copy .env.vps to .env
  cp .env.vps .env

  echo "Environment configured"
REMOTE_ENV

log "✅ Environment variables configured"

# =============================================================================
# Step 6: Build and Deploy with Docker
# =============================================================================
log "Step 6/7: Building and deploying services (this takes 5-10 minutes)..."

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_RAPTOR@$VPS_IP" bash <<'REMOTE_DEPLOY'
  set -e

  cd /opt/raptor

  # Build and start services
  docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build

  echo "Services deployed"
REMOTE_DEPLOY

log "✅ Services deployed"

# =============================================================================
# Step 7: Verify Deployment
# =============================================================================
log "Step 7/7: Verifying deployment..."

# Wait for services to start
sleep 15

# Check health endpoint
if curl -f -s "http://$VPS_IP:3000/health" > /dev/null; then
  log "✅ Health check passed!"
else
  warn "⚠️  Health check failed - services may still be starting"
fi

# Display service status
log "Checking service status..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER_RAPTOR@$VPS_IP" bash <<'REMOTE_STATUS'
  cd /opt/raptor
  docker compose ps
REMOTE_STATUS

# =============================================================================
# Deployment Complete
# =============================================================================
log "============================================================"
log "✅ DEPLOYMENT COMPLETE!"
log ""
log "Your RAPTOR executor is now running on:"
log "  🌐 API: http://$VPS_IP:3000"
log "  🏥 Health: http://$VPS_IP:3000/health"
log ""
log "Next steps:"
log "  1. Deploy bot to Railway: bash scripts/deploy-bot.sh"
log "  2. Test the bot in Telegram"
log ""
log "Useful commands:"
log "  ssh raptor@$VPS_IP                     # Connect to VPS"
log "  docker compose logs -f                 # View logs"
log "  docker compose restart                 # Restart services"
log "  curl http://$VPS_IP:3000/health        # Check health"
log ""
log "🦖 Happy hunting!"

#!/bin/bash

# =============================================================================
# RAPTOR Executor Deployment Script
# Deploys executor + API to VPS via SSH
# =============================================================================
# Requirements: SSH access to VPS, .env file configured
# Usage: bash scripts/deploy-executor.sh <vps-ip>
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
# Configuration
# =============================================================================
VPS_IP="${1:-}"
VPS_USER="raptor"
DEPLOY_PATH="/opt/raptor"
BACKUP_PATH="/opt/raptor-backups"

if [[ -z "$VPS_IP" ]]; then
  error "Usage: bash scripts/deploy-executor.sh <vps-ip>"
fi

log "🦖 Deploying RAPTOR Executor to $VPS_IP"
log "=================================================="

# =============================================================================
# 1. Pre-deployment checks
# =============================================================================
log "Step 1/8: Running pre-deployment checks..."

# Check SSH connectivity
if ! ssh -o ConnectTimeout=5 "$VPS_USER@$VPS_IP" "echo 'SSH OK'" &>/dev/null; then
  error "Cannot connect to VPS via SSH. Check your SSH key and VPS IP."
fi

# Check if .env exists
if [[ ! -f ".env" ]]; then
  error ".env file not found. Copy .env.example and configure it first."
fi

log "Pre-deployment checks passed"

# =============================================================================
# 2. Create backup
# =============================================================================
log "Step 2/8: Creating backup on VPS..."

ssh "$VPS_USER@$VPS_IP" bash <<'EOF'
  if [ -d "/opt/raptor" ]; then
    BACKUP_DIR="/opt/raptor-backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r /opt/raptor/* "$BACKUP_DIR/" 2>/dev/null || true
    echo "Backup created at $BACKUP_DIR"
  else
    echo "No existing deployment, skipping backup"
  fi
EOF

# =============================================================================
# 3. Sync code to VPS
# =============================================================================
log "Step 3/8: Syncing code to VPS..."

# Use rsync for efficient transfer
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '*.log' \
  ./ "$VPS_USER@$VPS_IP:$DEPLOY_PATH/"

log "Code synced successfully"

# =============================================================================
# 4. Upload .env file
# =============================================================================
log "Step 4/8: Uploading .env file..."

scp .env "$VPS_USER@$VPS_IP:$DEPLOY_PATH/.env"

log ".env uploaded"

# =============================================================================
# 5. Install dependencies and build
# =============================================================================
log "Step 5/8: Installing dependencies and building..."

ssh "$VPS_USER@$VPS_IP" bash <<EOF
  cd $DEPLOY_PATH
  pnpm install --frozen-lockfile
  pnpm build
  echo "Build completed successfully"
EOF

# =============================================================================
# 6. Stop running services
# =============================================================================
log "Step 6/8: Stopping existing services..."

ssh "$VPS_USER@$VPS_IP" bash <<'EOF'
  # Check if using Docker or PM2
  if docker ps | grep -q raptor; then
    echo "Stopping Docker containers..."
    cd /opt/raptor
    docker compose -f docker-compose.yml -f docker-compose.vps.yml down
  elif pm2 list | grep -q raptor; then
    echo "Stopping PM2 processes..."
    pm2 stop raptor-executor raptor-api || true
  else
    echo "No running services found"
  fi
EOF

# =============================================================================
# 7. Start services
# =============================================================================
log "Step 7/8: Starting services..."

# Ask user which deployment method to use
read -p "Deploy with Docker (d) or PM2 (p)? [d/p]: " -n 1 -r DEPLOY_METHOD
echo

if [[ $DEPLOY_METHOD =~ ^[Dd]$ ]]; then
  log "Starting services with Docker Compose..."
  ssh "$VPS_USER@$VPS_IP" bash <<'EOF'
    cd /opt/raptor
    docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
    docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
EOF
else
  log "Starting services with PM2..."
  ssh "$VPS_USER@$VPS_IP" bash <<'EOF'
    cd /opt/raptor
    pm2 start ecosystem.config.js
    pm2 save
    pm2 list
EOF
fi

# =============================================================================
# 8. Health check
# =============================================================================
log "Step 8/8: Running health checks..."

sleep 10

# Check API health
if curl -f -s "http://$VPS_IP:3000/health" > /dev/null; then
  log "✅ API health check passed"
else
  warn "⚠️  API health check failed - check logs on VPS"
fi

# Display logs
ssh "$VPS_USER@$VPS_IP" bash <<'EOF'
  echo ""
  echo "Recent logs:"
  if docker ps | grep -q raptor; then
    docker compose -f /opt/raptor/docker-compose.yml -f /opt/raptor/docker-compose.vps.yml logs --tail=20
  elif pm2 list | grep -q raptor; then
    pm2 logs --lines 20
  fi
EOF

# =============================================================================
# Deployment Complete
# =============================================================================
log "=================================================="
log "✅ Deployment Complete!"
log ""
log "Services running on:"
log "  - API: http://$VPS_IP:3000"
log "  - Health: http://$VPS_IP:3000/health"
log ""
log "Monitor services:"
if [[ $DEPLOY_METHOD =~ ^[Dd]$ ]]; then
  log "  docker compose -f docker-compose.yml -f docker-compose.vps.yml logs -f"
else
  log "  pm2 logs"
  log "  pm2 monit"
fi
log ""
log "Rollback if needed:"
log "  ssh $VPS_USER@$VPS_IP"
log "  cd /opt/raptor-backups"
log "  ls -la"
log ""
log "🦖 Happy hunting!"

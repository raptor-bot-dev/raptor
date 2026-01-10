#!/bin/bash

# =============================================================================
# RAPTOR VPS Setup Script
# Provisions a fresh Hetzner/Ubuntu VPS for RAPTOR deployment
# =============================================================================
# Requirements: Ubuntu 22.04 LTS, root access
# Usage: bash setup-vps.sh
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
  echo -e "${GREEN}[SETUP]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (use sudo)"
fi

log "🦖 RAPTOR VPS Setup Starting..."
log "=================================================="

# =============================================================================
# 1. System Update
# =============================================================================
log "Step 1/10: Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget git ufw fail2ban htop

# =============================================================================
# 2. Create raptor user
# =============================================================================
log "Step 2/10: Creating raptor user..."
if id "raptor" &>/dev/null; then
  warn "User 'raptor' already exists, skipping..."
else
  useradd -m -s /bin/bash raptor
  usermod -aG sudo raptor
  log "User 'raptor' created"
fi

# =============================================================================
# 3. Configure SSH Security
# =============================================================================
log "Step 3/10: Configuring SSH security..."

# Backup original sshd_config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Disable password authentication (SSH key only)
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Disable root login
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config

# Restart SSH
systemctl restart sshd
log "SSH hardened (password auth disabled, root login disabled)"

# =============================================================================
# 4. Configure Firewall (UFW)
# =============================================================================
log "Step 4/10: Configuring firewall..."
ufw --force disable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 3000/tcp comment 'API Server'
ufw allow 3001/tcp comment 'Executor API'
ufw --force enable
log "Firewall configured (ports 22, 80, 443, 3000, 3001 open)"

# =============================================================================
# 5. Configure fail2ban
# =============================================================================
log "Step 5/10: Configuring fail2ban..."
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = /var/log/auth.log
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log "fail2ban configured (SSH brute-force protection)"

# =============================================================================
# 6. Install Docker
# =============================================================================
log "Step 6/10: Installing Docker..."

if command -v docker &>/dev/null; then
  warn "Docker already installed, skipping..."
else
  # Install Docker dependencies
  apt-get install -y -qq ca-certificates curl gnupg lsb-release

  # Add Docker GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  # Add Docker repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Install Docker
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Add raptor user to docker group
  usermod -aG docker raptor

  # Enable Docker service
  systemctl enable docker
  systemctl start docker

  log "Docker installed successfully"
fi

# =============================================================================
# 7. Install Node.js 20
# =============================================================================
log "Step 7/10: Installing Node.js 20..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v)
  warn "Node.js already installed ($NODE_VERSION), skipping..."
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  log "Node.js 20 installed: $(node -v)"
fi

# =============================================================================
# 8. Install pnpm
# =============================================================================
log "Step 8/10: Installing pnpm..."

if command -v pnpm &>/dev/null; then
  warn "pnpm already installed, skipping..."
else
  npm install -g pnpm
  log "pnpm installed: $(pnpm -v)"
fi

# =============================================================================
# 9. Install PM2
# =============================================================================
log "Step 9/10: Installing PM2..."

if command -v pm2 &>/dev/null; then
  warn "PM2 already installed, skipping..."
else
  npm install -g pm2

  # Setup PM2 startup script
  env PATH=$PATH:/usr/bin pm2 startup systemd -u raptor --hp /home/raptor

  log "PM2 installed: $(pm2 -v)"
fi

# =============================================================================
# 10. Create application directories
# =============================================================================
log "Step 10/10: Creating application directories..."

mkdir -p /opt/raptor
mkdir -p /var/log/raptor/redis
mkdir -p /var/lib/raptor/redis

chown -R raptor:raptor /opt/raptor
chown -R raptor:raptor /var/log/raptor
chown -R raptor:raptor /var/lib/raptor

log "Application directories created"

# =============================================================================
# Setup Complete
# =============================================================================
log "=================================================="
log "✅ VPS Setup Complete!"
log ""
log "Next Steps:"
log "1. Copy your SSH public key to the raptor user:"
log "   ssh-copy-id raptor@your-vps-ip"
log ""
log "2. Test SSH connection as raptor user:"
log "   ssh raptor@your-vps-ip"
log ""
log "3. Clone the RAPTOR repository:"
log "   cd /opt/raptor"
log "   git clone https://github.com/raptor-bot-dev/raptor.git ."
log ""
log "4. Copy .env file to /opt/raptor/.env"
log ""
log "5. Deploy using Docker Compose:"
log "   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d"
log ""
log "6. OR deploy using PM2:"
log "   pnpm install"
log "   pnpm build"
log "   pm2 start ecosystem.config.js"
log "   pm2 save"
log ""
log "=================================================="

# Optional: Display system info
log "System Information:"
log "  - OS: $(lsb_release -d | cut -f2)"
log "  - Kernel: $(uname -r)"
log "  - CPU: $(nproc) cores"
log "  - RAM: $(free -h | awk '/^Mem:/ {print $2}')"
log "  - Docker: $(docker -v | cut -d' ' -f3 | cut -d',' -f1)"
log "  - Node.js: $(node -v)"
log "  - pnpm: $(pnpm -v)"
log "  - PM2: $(pm2 -v)"
log ""
log "🦖 Happy deploying!"

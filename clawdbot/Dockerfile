FROM node:20-alpine

# Add git (required for some npm deps like better-sqlite3)
RUN apk add --no-cache git

# Install clawdbot globally (pinned version for stability)
RUN npm install -g clawdbot@2026.1.24

# Set working directory for config/memories
WORKDIR /data

# Default command
CMD ["clawdbot", "gateway", "start", "--headless"]

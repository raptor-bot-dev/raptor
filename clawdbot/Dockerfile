FROM node:22-alpine

# Add git (required for some npm deps like better-sqlite3)
RUN apk add --no-cache git

# Install clawdbot globally
RUN npm install -g clawdbot@latest

# Set working directory for config/memories
WORKDIR /data

# Run gateway (--allow-unconfigured lets it start without config)
# Configure via environment variables in Railway
CMD ["clawdbot", "gateway", "--allow-unconfigured"]

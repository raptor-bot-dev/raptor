FROM node:20-alpine

# Add git (required for some npm deps like better-sqlite3)
RUN apk add --no-cache git

# Install clawdbot globally (latest version)
RUN npm install -g clawdbot@latest

# Set working directory for config/memories
WORKDIR /data

# Default command
CMD ["clawdbot", "gateway", "start", "--headless"]

/**
 * PM2 Ecosystem Configuration — RaptorBot Hetzner Deployment
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 status
 *   pm2 logs raptor-bot
 *   pm2 restart all
 *
 * Requirements:
 *   - .env file with DATABASE_URL, TELEGRAM_BOT_TOKEN, etc.
 *   - `pnpm build` must have been run first
 *   - PostgreSQL 16 running locally on port 5432
 */

module.exports = {
  apps: [
    {
      name: 'raptor-bot',
      script: 'dist/index.js',
      cwd: './apps/bot',
      node_args: '--enable-source-maps --env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Memory limit (restart if exceeded)
      max_memory_restart: '512M',
      // Log management
      error_file: '/var/log/raptor/bot-error.log',
      out_file: '/var/log/raptor/bot-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
    {
      name: 'raptor-hunter',
      script: 'dist/index.js',
      cwd: './apps/hunter',
      node_args: '--enable-source-maps --env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '1G',
      error_file: '/var/log/raptor/hunter-error.log',
      out_file: '/var/log/raptor/hunter-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};

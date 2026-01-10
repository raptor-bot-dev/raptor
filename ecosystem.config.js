/**
 * PM2 Ecosystem Configuration
 * For VPS deployment without Docker (alternative approach)
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'raptor-executor',
      script: './apps/executor/dist/index.js',
      cwd: '/opt/raptor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/raptor/executor-error.log',
      out_file: '/var/log/raptor/executor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 30000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
    {
      name: 'raptor-api',
      script: './apps/api/dist/index.js',
      cwd: '/opt/raptor',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/raptor/api-error.log',
      out_file: '/var/log/raptor/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      listen_timeout: 5000,
    },
  ],

  deploy: {
    production: {
      user: 'raptor',
      host: ['your-vps-ip'],
      ref: 'origin/main',
      repo: 'git@github.com:raptor-bot-dev/raptor.git',
      path: '/opt/raptor',
      'pre-deploy': 'git fetch --all',
      'post-deploy': 'pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
    },
  },
};

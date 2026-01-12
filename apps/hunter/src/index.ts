// =============================================================================
// RAPTOR v3.1 Hunter Worker
// Auto-hunt worker: launchpad monitoring, job queue consumer, position exits
// =============================================================================

import {
  validateHunterConfig,
  getWorkerId,
  isAutoExecuteEnabled,
} from '@raptor/shared';

import { OpportunityLoop } from './loops/opportunities.js';
import { ExecutionLoop } from './loops/execution.js';
import { PositionMonitorLoop } from './loops/positions.js';
import { MaintenanceLoop } from './loops/maintenance.js';

// Global promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

async function main() {
  console.log('🦅 RAPTOR Hunter v3.1 starting...');

  // Validate configuration
  validateHunterConfig();

  // Generate worker ID for job claiming
  const workerId = getWorkerId();
  console.log(`📋 Worker ID: ${workerId}`);

  // Check if auto-execute is enabled
  const autoExecuteEnabled = isAutoExecuteEnabled();
  if (!autoExecuteEnabled) {
    console.warn('⚠️  AUTO_EXECUTE_ENABLED is not true');
    console.warn('⚠️  Running in MONITOR-ONLY mode (no trades will be executed)');
  }

  // Initialize loops
  const opportunityLoop = new OpportunityLoop();
  const executionLoop = new ExecutionLoop(workerId, autoExecuteEnabled);
  const positionMonitorLoop = new PositionMonitorLoop(workerId);
  const maintenanceLoop = new MaintenanceLoop();

  // Start all loops
  try {
    await Promise.all([
      opportunityLoop.start(),
      executionLoop.start(),
      positionMonitorLoop.start(),
      maintenanceLoop.start(),
    ]);

    console.log('');
    console.log('✅ RAPTOR Hunter v3.1 is running');
    console.log('   - Opportunity loop: Monitoring launchpads');
    console.log('   - Execution loop: Processing trade jobs');
    console.log('   - Position loop: Monitoring exit triggers');
    console.log('   - Maintenance loop: Cleanup & recovery');
    console.log('');
  } catch (error) {
    console.error('Failed to start hunter:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n📦 Shutting down gracefully...');

    await Promise.all([
      opportunityLoop.stop(),
      executionLoop.stop(),
      positionMonitorLoop.stop(),
      maintenanceLoop.stop(),
    ]);

    console.log('✅ Hunter stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// =============================================================================
// RAPTOR v3.1 Hunter Worker
// Auto-hunt worker: launchpad monitoring, job queue consumer, position exits
// =============================================================================

import {
  validateHunterConfig,
  getWorkerId,
  isAutoExecuteEnabled,
  isTpSlEngineEnabled,
  isLegacyPositionMonitorEnabled,
  isBagsSourceEnabled,
  getBagsChannelId,
  getBagsBotToken,
  getBagsDedupeTtlMs,
  supabase,
} from '@raptor/shared';
import type { LaunchCandidateInsert } from '@raptor/database';

import { OpportunityLoop } from './loops/opportunities.js';
import { ExecutionLoop } from './loops/execution.js';
import { PositionMonitorLoop } from './loops/positions.js';
import { TpSlMonitorLoop } from './loops/tpslMonitor.js';
import { MaintenanceLoop } from './loops/maintenance.js';
import { BagsSource, type BagsSignal } from './sources/index.js';

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

  // Check TP/SL engine feature flags
  const tpslEngineEnabled = isTpSlEngineEnabled();
  const legacyPositionMonitorEnabled = isLegacyPositionMonitorEnabled();

  if (tpslEngineEnabled) {
    console.log('✅ TP/SL Engine: ENABLED (event-driven)');
  }
  if (legacyPositionMonitorEnabled) {
    console.log('✅ Legacy Position Monitor: ENABLED');
  }
  if (!tpslEngineEnabled && !legacyPositionMonitorEnabled) {
    console.warn('⚠️  No position monitor enabled! TP/SL triggers will NOT fire.');
  }

  // Initialize loops
  const opportunityLoop = new OpportunityLoop(autoExecuteEnabled);
  const executionLoop = new ExecutionLoop(workerId, autoExecuteEnabled);
  const maintenanceLoop = new MaintenanceLoop();

  // Conditionally create position monitoring loops
  const positionMonitorLoop = legacyPositionMonitorEnabled
    ? new PositionMonitorLoop(workerId)
    : null;
  const tpslMonitorLoop = tpslEngineEnabled
    ? new TpSlMonitorLoop(workerId)
    : null;

  // Initialize BagsSource for Telegram signal ingestion (Phase 1)
  const bagsSourceEnabled = isBagsSourceEnabled();
  const bagsSource = bagsSourceEnabled
    ? new BagsSource({
        botToken: getBagsBotToken(),
        channelId: getBagsChannelId(),
        enabled: true,
        dedupeTtlMs: getBagsDedupeTtlMs(),
      })
    : null;

  // Register signal handler for BagsSource
  if (bagsSource) {
    bagsSource.onSignal(async (signal: BagsSignal) => {
      const insert: LaunchCandidateInsert = {
        mint: signal.mint,
        symbol: signal.symbol,
        name: signal.name,
        launch_source: 'bags',
        discovery_method: 'telegram',
        raw_payload: { text: signal.raw, received_at: signal.timestamp },
        status: 'new',
      };

      const { error } = await supabase
        .from('launch_candidates')
        .upsert(insert, { onConflict: 'mint,launch_source' });

      if (error) {
        console.error('[BagsSource] Failed to insert launch_candidate:', error.message);
      } else {
        console.log(
          `[BagsSource] Inserted launch_candidate: ${signal.symbol || 'UNKNOWN'} (${signal.mint.slice(0, 12)}...)`
        );
      }
    });
  }

  // Start all loops
  try {
    const startPromises: Promise<void>[] = [
      opportunityLoop.start(),
      executionLoop.start(),
      maintenanceLoop.start(),
    ];

    if (positionMonitorLoop) {
      startPromises.push(positionMonitorLoop.start());
    }
    if (tpslMonitorLoop) {
      startPromises.push(tpslMonitorLoop.start());
    }
    if (bagsSource) {
      startPromises.push(bagsSource.start());
    }

    await Promise.all(startPromises);

    console.log('');
    console.log('✅ RAPTOR Hunter v3.1 is running');
    console.log('   - Opportunity loop: Monitoring launchpads');
    console.log('   - Execution loop: Processing trade jobs');
    if (positionMonitorLoop) {
      console.log('   - Position loop (legacy): Monitoring exit triggers');
    }
    if (tpslMonitorLoop) {
      console.log('   - TP/SL Engine: Event-driven trigger monitoring');
    }
    if (bagsSource) {
      console.log('   - Bags Source: Monitoring Telegram channel');
    }
    console.log('   - Maintenance loop: Cleanup & recovery');
    console.log('');
  } catch (error) {
    console.error('Failed to start hunter:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n📦 Shutting down gracefully...');

    const stopPromises: Promise<void>[] = [
      opportunityLoop.stop(),
      executionLoop.stop(),
      maintenanceLoop.stop(),
    ];

    if (positionMonitorLoop) {
      stopPromises.push(positionMonitorLoop.stop());
    }
    if (tpslMonitorLoop) {
      stopPromises.push(tpslMonitorLoop.stop());
    }
    if (bagsSource) {
      stopPromises.push(bagsSource.stop());
    }

    await Promise.all(stopPromises);

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

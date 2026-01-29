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
  isGraduationMonitorEnabled,
  isMeteoraOnChainEnabled,
  getMeteoraProgramId,
  isCandidateConsumerEnabled,
  isObserverEnabled,
  getObserverBotToken,
  getObserverChannelId,
  dexscreener,
  supabase,
} from '@raptor/shared';
import type { LaunchCandidateInsert } from '@raptor/database';

import { ExecutionLoop } from './loops/execution.js';
import { PositionMonitorLoop } from './loops/positions.js';
import { TpSlMonitorLoop } from './loops/tpslMonitor.js';
import { GraduationMonitorLoop } from './loops/graduationMonitor.js';
import { MaintenanceLoop } from './loops/maintenance.js';
import { CandidateConsumerLoop } from './loops/candidateConsumer.js';
import {
  BagsSource,
  MeteoraOnChainSource,
  type BagsSignal,
  type MeteoraOnChainSignal,
} from './sources/index.js';
import { HunterObserver } from './observability/observer.js';

async function upsertLaunchCandidateMerged(insert: LaunchCandidateInsert): Promise<void> {
  const mint = insert.mint;
  const launchSource = insert.launch_source;

  const { data: existing, error: fetchError } = await supabase
    .from('launch_candidates')
    .select('id,symbol,name,discovery_method,raw_payload,status,first_seen_at')
    .eq('mint', mint)
    .eq('launch_source', launchSource)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!existing) {
    const { error } = await supabase.from('launch_candidates').insert(insert);
    if (error) throw error;
    return;
  }

  const existingPayload =
    existing.raw_payload && typeof existing.raw_payload === 'object' ? (existing.raw_payload as Record<string, unknown>) : {};
  const incomingPayload =
    insert.raw_payload && typeof insert.raw_payload === 'object' ? (insert.raw_payload as Record<string, unknown>) : {};

  const mergedPayload = { ...existingPayload, ...incomingPayload };

  // Preserve on-chain as "truth" if already present; otherwise allow upgrade to on-chain.
  const mergedDiscoveryMethod =
    existing.discovery_method === 'onchain' || insert.discovery_method === 'onchain'
      ? 'onchain'
      : (existing.discovery_method as 'telegram' | 'onchain');

  // Do not reset non-new statuses back to 'new' on duplicate signals.
  const mergedStatus = existing.status === 'new' ? insert.status : existing.status;

  const updates: Partial<LaunchCandidateInsert> & { status: string } = {
    symbol: existing.symbol ?? insert.symbol ?? null,
    name: existing.name ?? insert.name ?? null,
    discovery_method: mergedDiscoveryMethod,
    raw_payload: mergedPayload as unknown as LaunchCandidateInsert['raw_payload'],
    status: mergedStatus,
  };

  const { error: updateError } = await supabase
    .from('launch_candidates')
    .update(updates)
    .eq('id', existing.id);

  if (updateError) throw updateError;
}

// Global promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

async function main() {
  console.log('🦖 RAPTOR Hunter v3.1 starting...');

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
  const graduationMonitorEnabled = isGraduationMonitorEnabled();
  const meteoraOnChainEnabled = isMeteoraOnChainEnabled();

  if (tpslEngineEnabled) {
    console.log('✅ TP/SL Engine: ENABLED (event-driven)');
  }
  if (legacyPositionMonitorEnabled) {
    console.log('✅ Legacy Position Monitor: ENABLED');
  }
  if (graduationMonitorEnabled) {
    console.log('✅ Graduation Monitor: ENABLED (lifecycle tracking)');
  }
  if (meteoraOnChainEnabled) {
    console.log('✅ Meteora On-Chain Source: ENABLED (WebSocket detection)');
  }

  // Check candidate consumer feature flag
  const candidateConsumerEnabled = isCandidateConsumerEnabled();
  if (candidateConsumerEnabled) {
    console.log('✅ Candidate Consumer: ENABLED (auto-trading from launch_candidates)');
  }

  if (!tpslEngineEnabled && !legacyPositionMonitorEnabled) {
    console.warn('⚠️  No position monitor enabled! TP/SL triggers will NOT fire.');
  }

  // Initialize observer for Telegram observability channel
  const observerEnabled = isObserverEnabled();
  const observer = observerEnabled
    ? new HunterObserver({
        botToken: getObserverBotToken(),
        channelId: getObserverChannelId(),
        enabled: true,
      })
    : null;
  if (observerEnabled) {
    console.log('✅ Observer: ENABLED (Telegram observability channel)');
  }

  // Initialize loops
  const executionLoop = new ExecutionLoop(workerId, autoExecuteEnabled);
  const maintenanceLoop = new MaintenanceLoop();

  // Conditionally create position monitoring loops
  const positionMonitorLoop = legacyPositionMonitorEnabled
    ? new PositionMonitorLoop(workerId)
    : null;
  const tpslMonitorLoop = tpslEngineEnabled
    ? new TpSlMonitorLoop(workerId)
    : null;
  const graduationMonitorLoop = graduationMonitorEnabled
    ? new GraduationMonitorLoop(workerId)
    : null;
  const candidateConsumerLoop = candidateConsumerEnabled
    ? new CandidateConsumerLoop(workerId, observer)
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
        first_seen_at: new Date(signal.timestamp).toISOString(),
        raw_payload: {
          telegram: { text: signal.raw, received_at: signal.timestamp },
        },
        status: 'new',
      };

      try {
        await upsertLaunchCandidateMerged(insert);
        console.log(
          `[BagsSource] Upserted launch_candidate: ${signal.symbol || 'UNKNOWN'} (${signal.mint.slice(0, 12)}...)`
        );

        // Fire-and-forget observer notification (Telegram-based detection won't have on-chain fields).
        if (observer) {
          (async () => {
            let marketCapUsd: number | null = null;
            let liquidityUsd: number | null = null;

            try {
              const { data: tokenInfo } = await dexscreener.getTokenByAddress(signal.mint);
              if (tokenInfo) {
                marketCapUsd = tokenInfo.marketCap;
                liquidityUsd = tokenInfo.liquidity || null;
              }
            } catch {}

            await observer.postDetection({
              mint: signal.mint,
              source: 'bags_telegram',
              timestamp: signal.timestamp,
              name: signal.name ?? null,
              symbol: signal.symbol ?? null,
              marketCapUsd,
              liquidityUsd,
            });
          })().catch(() => {});
        }
      } catch (error) {
        console.error('[BagsSource] Failed to upsert launch_candidate:', (error as Error).message);
      }
    });
  }

  // Initialize MeteoraOnChainSource for on-chain signal detection (Phase 4)
  const meteoraOnChainSource = meteoraOnChainEnabled
    ? new MeteoraOnChainSource({
        programId: getMeteoraProgramId(),
        enabled: true,
      })
    : null;

  // Register signal handler for MeteoraOnChainSource
  if (meteoraOnChainSource) {
    meteoraOnChainSource.onSignal(async (signal: MeteoraOnChainSignal) => {
      const insert: LaunchCandidateInsert = {
        mint: signal.mint,
        launch_source: 'bags',
        discovery_method: 'onchain',
        first_seen_at: new Date(signal.timestamp).toISOString(),
        raw_payload: {
          onchain: {
            bonding_curve: signal.bondingCurve,
            creator: signal.creator,
            signature: signal.signature,
            slot: signal.slot,
            detected_at: signal.timestamp,
          },
        },
        status: 'new',
      };

      try {
        await upsertLaunchCandidateMerged(insert);
        console.log(
          `[MeteoraOnChainSource] SAVED mint=${signal.mint.slice(0, 12)}... ` +
            `creator=${signal.creator.slice(0, 12)}... tx=${signal.signature.slice(0, 12)}...`
        );

        // Fire-and-forget observer notification with async enrichment
        if (observer) {
          (async () => {
            let name: string | null = null;
            let symbol: string | null = null;
            let marketCapUsd: number | null = null;
            let liquidityUsd: number | null = null;

            try {
              const { data: tokenInfo } = await dexscreener.getTokenByAddress(signal.mint);
              if (tokenInfo) {
                name = tokenInfo.name || null;
                symbol = tokenInfo.symbol || null;
                marketCapUsd = tokenInfo.marketCap;
                liquidityUsd = tokenInfo.liquidity || null;
              }
            } catch {}

            await observer.postDetection({
              mint: signal.mint,
              creator: signal.creator,
              bondingCurve: signal.bondingCurve,
              signature: signal.signature,
              slot: signal.slot,
              source: 'meteora_onchain',
              timestamp: signal.timestamp,
              name,
              symbol,
              marketCapUsd,
              liquidityUsd,
            });
          })().catch(() => {});
        }
      } catch (error) {
        console.error('[MeteoraOnChainSource] Failed to upsert launch_candidate:', (error as Error).message);
      }
    });
  }

  // Start all loops
  try {
    const startPromises: Promise<void>[] = [
      executionLoop.start(),
      maintenanceLoop.start(),
    ];

    if (positionMonitorLoop) {
      startPromises.push(positionMonitorLoop.start());
    }
    if (tpslMonitorLoop) {
      startPromises.push(tpslMonitorLoop.start());
    }
    if (graduationMonitorLoop) {
      startPromises.push(graduationMonitorLoop.start());
    }
    if (bagsSource) {
      startPromises.push(bagsSource.start());
    }
    if (meteoraOnChainSource) {
      startPromises.push(meteoraOnChainSource.start());
    }
    if (candidateConsumerLoop) {
      startPromises.push(candidateConsumerLoop.start());
    }

    await Promise.all(startPromises);

    console.log('');
    console.log('✅ RAPTOR Hunter v3.1 is running (BAGS-only mode)');
    console.log('   - Execution loop: Processing trade jobs');
    if (positionMonitorLoop) {
      console.log('   - Position loop (legacy): Monitoring exit triggers');
    }
    if (tpslMonitorLoop) {
      console.log('   - TP/SL Engine: Event-driven trigger monitoring');
    }
    if (graduationMonitorLoop) {
      console.log('   - Graduation monitor: Lifecycle state tracking');
    }
    if (bagsSource) {
      console.log('   - Bags Source: Monitoring Telegram channel');
    }
    if (meteoraOnChainSource) {
      console.log('   - Meteora On-Chain: WebSocket program monitoring');
    }
    if (candidateConsumerLoop) {
      console.log('   - Candidate Consumer: Auto-trading from launch_candidates');
    }
    if (observer) {
      console.log('   - Observer: Posting to Telegram channel');
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
      executionLoop.stop(),
      maintenanceLoop.stop(),
    ];

    if (positionMonitorLoop) {
      stopPromises.push(positionMonitorLoop.stop());
    }
    if (tpslMonitorLoop) {
      stopPromises.push(tpslMonitorLoop.stop());
    }
    if (graduationMonitorLoop) {
      stopPromises.push(graduationMonitorLoop.stop());
    }
    if (bagsSource) {
      stopPromises.push(bagsSource.stop());
    }
    if (meteoraOnChainSource) {
      stopPromises.push(meteoraOnChainSource.stop());
    }
    if (candidateConsumerLoop) {
      stopPromises.push(candidateConsumerLoop.stop());
    }
    if (observer) {
      observer.stop();
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

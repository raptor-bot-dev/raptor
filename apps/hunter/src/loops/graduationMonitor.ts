// =============================================================================
// RAPTOR Phase 3: Graduation Monitor Loop
// Polls bonding curves to detect token graduations and update position lifecycle
// =============================================================================

import {
  getGraduationMonitoringMints,
  getBondingCurveSnapshot,
  isGraduationMonitorEnabled,
  getGraduationPollIntervalMs,
  hasGraduated,
} from '@raptor/shared';

import { graduateAllPositionsForMint } from '../handlers/graduationHandler.js';

/**
 * GraduationMonitorLoop - Monitors bonding curves for graduation events
 *
 * When a pump.fun token graduates (bonding curve completes), it migrates
 * to a Raydium/Meteora AMM. This loop detects that event and transitions
 * positions from PRE_GRADUATION to POST_GRADUATION lifecycle state.
 *
 * Key features:
 * - Batches bonding curve checks by mint (reduces RPC calls)
 * - Atomic position state transitions
 * - Configurable poll interval (default 10s)
 * - Feature-flagged via GRADUATION_ENABLED
 */
export class GraduationMonitorLoop {
  private running = false;
  private workerId: string;

  // Polling
  private pollTimer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;

  // Stats
  private stats = {
    pollCycles: 0,
    mintsChecked: 0,
    graduationsDetected: 0,
    positionsGraduated: 0,
    errors: 0,
  };

  constructor(workerId: string) {
    this.workerId = workerId;
    this.pollIntervalMs = getGraduationPollIntervalMs();
  }

  /**
   * Start the graduation monitor loop
   */
  async start(): Promise<void> {
    if (!isGraduationMonitorEnabled()) {
      console.log('[GraduationMonitorLoop] Graduation monitor is disabled (GRADUATION_ENABLED != true)');
      return;
    }

    if (this.running) return;

    console.log('[GraduationMonitorLoop] Starting...');
    console.log(`[GraduationMonitorLoop] Poll interval: ${this.pollIntervalMs}ms`);

    this.running = true;

    // Start polling
    this.schedulePoll();

    console.log('[GraduationMonitorLoop] Started');
  }

  /**
   * Stop the graduation monitor loop
   */
  async stop(): Promise<void> {
    console.log('[GraduationMonitorLoop] Stopping...');
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    console.log('[GraduationMonitorLoop] Stopped');
    this.logStats();
  }

  /**
   * Get current statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Schedule next poll cycle
   */
  private schedulePoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      await this.pollCycle();
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Main poll cycle - check all monitored mints for graduation
   */
  private async pollCycle(): Promise<void> {
    this.stats.pollCycles++;

    try {
      // Get unique mints with pre-graduation positions
      const mints = await getGraduationMonitoringMints();

      if (mints.length === 0) {
        return; // No positions to monitor
      }

      // Check each mint's bonding curve
      for (const { mint, position_count } of mints) {
        await this.checkMintGraduation(mint, position_count);
      }
    } catch (error) {
      this.stats.errors++;
      console.error('[GraduationMonitorLoop] Poll cycle error:', error);
    }
  }

  /**
   * Check if a specific mint has graduated
   */
  private async checkMintGraduation(mint: string, positionCount: number): Promise<void> {
    this.stats.mintsChecked++;

    try {
      // Fetch bonding curve state
      const snapshot = await getBondingCurveSnapshot(mint);

      if (!snapshot) {
        // Token might already be on Raydium (no bonding curve found)
        // This is actually a graduation signal - bonding curve account is closed
        console.log(
          `[GraduationMonitorLoop] No bonding curve found for ${mint.slice(0, 12)}... ` +
            `(${positionCount} positions) - treating as graduated`
        );
        await this.handleGraduation(mint);
        return;
      }

      // Check if bonding curve is complete
      if (hasGraduated(snapshot.state)) {
        console.log(
          `[GraduationMonitorLoop] Graduation detected for ${mint.slice(0, 12)}... ` +
            `(${positionCount} positions)`
        );
        await this.handleGraduation(mint);
      }
    } catch (error) {
      this.stats.errors++;
      console.error(
        `[GraduationMonitorLoop] Error checking mint ${mint.slice(0, 12)}...:`,
        error
      );
    }
  }

  /**
   * Handle a graduation event - transition all positions for this mint
   */
  private async handleGraduation(mint: string): Promise<void> {
    this.stats.graduationsDetected++;

    try {
      // Graduate all positions for this mint
      const results = await graduateAllPositionsForMint(mint, null);

      // Count successful graduations
      const graduatedCount = results.filter((r) => r.graduated).length;
      this.stats.positionsGraduated += graduatedCount;

      if (graduatedCount > 0) {
        console.log(
          `[GraduationMonitorLoop] Graduated ${graduatedCount} position(s) for ${mint.slice(0, 12)}...`
        );
      }
    } catch (error) {
      this.stats.errors++;
      console.error(
        `[GraduationMonitorLoop] Error handling graduation for ${mint.slice(0, 12)}...:`,
        error
      );
    }
  }

  /**
   * Log statistics
   */
  private logStats(): void {
    console.log('[GraduationMonitorLoop] Session stats:', {
      pollCycles: this.stats.pollCycles,
      mintsChecked: this.stats.mintsChecked,
      graduationsDetected: this.stats.graduationsDetected,
      positionsGraduated: this.stats.positionsGraduated,
      errors: this.stats.errors,
    });
  }
}

// =============================================================================
// RAPTOR v3.1 Maintenance Loop
// Cleanup stale executions, expire opportunities, recover leases
// =============================================================================

import { cleanupStaleExecutions, supabase } from '@raptor/shared';

const MAINTENANCE_INTERVAL_MS = 60000; // Run every minute

export class MaintenanceLoop {
  private running = false;
  private lastRun = 0;

  async start(): Promise<void> {
    console.log('[MaintenanceLoop] Starting...');
    this.running = true;
    this.run();
  }

  async stop(): Promise<void> {
    console.log('[MaintenanceLoop] Stopping...');
    this.running = false;
  }

  /**
   * Main maintenance loop
   */
  private async run(): Promise<void> {
    while (this.running) {
      try {
        const now = Date.now();

        // Only run every MAINTENANCE_INTERVAL_MS
        if (now - this.lastRun >= MAINTENANCE_INTERVAL_MS) {
          this.lastRun = now;
          await this.performMaintenance();
        }
      } catch (error) {
        console.error('[MaintenanceLoop] Error:', error);
      }

      await this.sleep(5000); // Check every 5 seconds
    }
  }

  /**
   * Perform all maintenance tasks
   */
  private async performMaintenance(): Promise<void> {
    console.log('[MaintenanceLoop] Running maintenance...');

    // 1. Cleanup stale executions (RESERVED/SUBMITTED with no tx_sig for 5+ min)
    const staleCount = await cleanupStaleExecutions(5);
    if (staleCount > 0) {
      console.log(`[MaintenanceLoop] Cleaned up ${staleCount} stale executions`);
    }

    // 2. Cleanup old sent notifications (older than 24 hours)
    await this.cleanupOldNotifications();

    console.log('[MaintenanceLoop] Maintenance complete');
  }

  /**
   * Cleanup old sent notifications (new schema: notifications_outbox)
   */
  private async cleanupOldNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago

    const { error } = await supabase
      .from('notifications_outbox')
      .delete()
      .eq('status', 'sent')
      .lt('sent_at', cutoff);

    if (error) {
      console.error('[MaintenanceLoop] Error cleaning notifications_outbox:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

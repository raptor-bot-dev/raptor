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

    // 2. Expire old opportunities (NEW status older than 60 seconds)
    await this.expireOldOpportunities();

    // 3. Delete expired cooldowns
    await this.deleteExpiredCooldowns();

    // 4. Cleanup old delivered notifications (older than 24 hours)
    await this.cleanupOldNotifications();

    console.log('[MaintenanceLoop] Maintenance complete');
  }

  /**
   * Expire opportunities that have been NEW for too long
   */
  private async expireOldOpportunities(): Promise<void> {
    const cutoff = new Date(Date.now() - 60000).toISOString(); // 60 seconds ago

    const { data, error } = await supabase
      .from('opportunities')
      .update({
        status: 'EXPIRED',
        expired_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'NEW')
      .lt('detected_at', cutoff)
      .select('id');

    if (error) {
      console.error('[MaintenanceLoop] Error expiring opportunities:', error);
      return;
    }

    if (data && data.length > 0) {
      console.log(`[MaintenanceLoop] Expired ${data.length} old opportunities`);
    }
  }

  /**
   * Delete cooldowns that have passed
   */
  private async deleteExpiredCooldowns(): Promise<void> {
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('cooldowns')
      .delete()
      .lt('cooldown_until', now);

    if (error) {
      console.error('[MaintenanceLoop] Error deleting cooldowns:', error);
    }
  }

  /**
   * Cleanup old delivered notifications
   */
  private async cleanupOldNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago

    const { error } = await supabase
      .from('notifications')
      .delete()
      .not('delivered_at', 'is', null)
      .lt('delivered_at', cutoff);

    if (error) {
      console.error('[MaintenanceLoop] Error cleaning notifications:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

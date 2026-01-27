// =============================================================================
// RAPTOR Phase 1: Bags Signal Deduplicator
// In-memory deduplication layer (secondary to DB constraint)
// =============================================================================

/**
 * Configuration for the deduplicator.
 */
export interface DeduplicatorConfig {
  /** Time window in milliseconds to consider signals as duplicates (default: 60000ms = 1 minute) */
  ttlMs?: number;
  /** Maximum number of entries to track (default: 10000) */
  maxEntries?: number;
}

/**
 * In-memory deduplication layer for Bags signals.
 *
 * Purpose: Reduce DB spam by filtering obvious duplicates before hitting the
 * unique constraint. The DB constraint is the primary deduplication mechanism;
 * this is a performance optimization.
 *
 * Uses a time-windowed Set with automatic expiration.
 */
export class BagsDeduplicator {
  private seen: Map<string, number>;
  private ttlMs: number;
  private maxEntries: number;

  constructor(config: DeduplicatorConfig = {}) {
    this.seen = new Map();
    this.ttlMs = config.ttlMs ?? 60_000; // 1 minute default
    this.maxEntries = config.maxEntries ?? 10_000;
  }

  /**
   * Check if a mint has been seen recently.
   * Also triggers cleanup of expired entries.
   */
  isDuplicate(mint: string): boolean {
    this.cleanup();

    const lastSeen = this.seen.get(mint);
    if (lastSeen === undefined) {
      return false;
    }

    // Check if still within TTL window
    const now = Date.now();
    return now - lastSeen < this.ttlMs;
  }

  /**
   * Mark a mint as seen.
   * Call this after successfully processing a signal.
   */
  mark(mint: string): void {
    this.seen.set(mint, Date.now());

    // Enforce max entries limit by removing oldest entries
    if (this.seen.size > this.maxEntries) {
      this.evictOldest();
    }
  }

  /**
   * Check and mark in one atomic operation.
   * Returns true if this is a duplicate (was already seen).
   */
  checkAndMark(mint: string): boolean {
    if (this.isDuplicate(mint)) {
      return true;
    }
    this.mark(mint);
    return false;
  }

  /**
   * Clear all tracked entries.
   * Useful for testing or resetting state.
   */
  clear(): void {
    this.seen.clear();
  }

  /**
   * Get the current number of tracked entries.
   */
  get size(): number {
    return this.seen.size;
  }

  /**
   * Remove expired entries from the map.
   * Called automatically during isDuplicate checks.
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;

    for (const [mint, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(mint);
      }
    }
  }

  /**
   * Evict the oldest entries when max size is exceeded.
   * Removes ~10% of oldest entries at once for efficiency.
   */
  private evictOldest(): void {
    const entries = Array.from(this.seen.entries());
    entries.sort((a, b) => a[1] - b[1]); // Sort by timestamp ascending

    // Remove oldest 10%
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.seen.delete(entries[i][0]);
    }
  }
}

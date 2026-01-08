// Pool Mode Manager
// Manages the collective pool where all users share proportional P&L

import {
  getUserAllocations,
  getUserBalancesByMode,
  updateBalance,
  type Chain,
  type Opportunity,
} from '@raptor/shared';

export interface PoolAllocation {
  tgId: number;
  percentage: number;
  amount: bigint;
}

export class PoolManager {
  /**
   * Get all user allocations for pool mode on a chain
   */
  async getAllocations(chain: Chain): Promise<PoolAllocation[]> {
    const allocations = await getUserAllocations(chain, 'pool');
    const total = this.calculateTotal(allocations);

    if (total === 0n) {
      return [];
    }

    const result: PoolAllocation[] = [];
    for (const [tgId, amount] of allocations) {
      const percentage = (Number(amount) / Number(total)) * 100;
      result.push({ tgId, percentage, amount });
    }

    return result;
  }

  /**
   * Get total pool size on a chain
   */
  async getTotalPoolSize(chain: Chain): Promise<bigint> {
    const allocations = await getUserAllocations(chain, 'pool');
    return this.calculateTotal(allocations);
  }

  /**
   * Calculate position size for the pool based on opportunity
   */
  calculatePoolPositionSize(
    poolTotal: bigint,
    opportunity: Opportunity,
    maxPoolPercent: number = 30
  ): bigint {
    // Limit to max percent of pool
    const maxAmount = (poolTotal * BigInt(maxPoolPercent)) / 100n;

    // Also limit to recommended size from opportunity
    const recommended = opportunity.recommended_size;

    return recommended < maxAmount ? recommended : maxAmount;
  }

  /**
   * Calculate each user's share of a position
   */
  calculateUserShares(
    positionSize: bigint,
    allocations: PoolAllocation[]
  ): Map<number, bigint> {
    const shares = new Map<number, bigint>();
    const total = allocations.reduce((sum, a) => sum + a.amount, 0n);

    if (total === 0n) {
      return shares;
    }

    for (const allocation of allocations) {
      const share = (positionSize * allocation.amount) / total;
      if (share > 0n) {
        shares.set(allocation.tgId, share);
      }
    }

    return shares;
  }

  /**
   * Distribute profits/losses proportionally to all pool users
   */
  async distributePnL(
    chain: Chain,
    pnl: bigint,
    allocations: PoolAllocation[]
  ): Promise<void> {
    const total = allocations.reduce((sum, a) => sum + a.amount, 0n);

    if (total === 0n) {
      return;
    }

    for (const allocation of allocations) {
      const userShare = (pnl * allocation.amount) / total;
      const currentBalance = allocation.amount;
      const newBalance = currentBalance + userShare;

      // Update user balance
      // Note: This is simplified - actual implementation would handle
      // negative PnL that could make balance negative
      if (newBalance >= 0n) {
        await updateBalance(
          allocation.tgId,
          chain,
          { current_value: newBalance.toString() },
          'pool'
        );
      }
    }
  }

  /**
   * Check if an opportunity should be executed for the pool
   */
  shouldExecute(opportunity: Opportunity, poolSize: bigint): boolean {
    // Need minimum pool size
    if (poolSize < opportunity.recommended_size / 10n) {
      console.log('[PoolManager] Pool size too small for opportunity');
      return false;
    }

    // Check score threshold
    if (opportunity.score < 50) {
      console.log('[PoolManager] Opportunity score too low');
      return false;
    }

    return true;
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(chain: Chain): Promise<{
    totalSize: bigint;
    userCount: number;
    averageDeposit: bigint;
  }> {
    const allocations = await this.getAllocations(chain);
    const totalSize = allocations.reduce((sum, a) => sum + a.amount, 0n);
    const userCount = allocations.length;
    const averageDeposit = userCount > 0 ? totalSize / BigInt(userCount) : 0n;

    return { totalSize, userCount, averageDeposit };
  }

  private calculateTotal(allocations: Map<number, bigint>): bigint {
    let total = 0n;
    for (const amount of allocations.values()) {
      total += amount;
    }
    return total;
  }
}

// Singleton instance
export const poolManager = new PoolManager();

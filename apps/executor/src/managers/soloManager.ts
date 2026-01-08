// Solo Mode Manager
// Manages personal vaults where each user has their own allocation

import {
  getOrCreateBalance,
  updateBalance,
  getActivePositionsByMode,
  type Chain,
  type UserBalance,
  type Position,
} from '@raptor/shared';

export interface SoloVault {
  tgId: number;
  chain: Chain;
  balance: bigint;
  activePositions: number;
  depositAddress: string;
}

export class SoloManager {
  /**
   * Get or create a solo vault for a user
   */
  async getOrCreateVault(
    tgId: number,
    chain: Chain,
    depositAddress: string
  ): Promise<UserBalance> {
    return getOrCreateBalance(tgId, chain, depositAddress, 'solo');
  }

  /**
   * Get user's solo vault balance
   */
  async getVaultBalance(tgId: number, chain: Chain): Promise<bigint> {
    try {
      const balances = await import('@raptor/shared').then((m) =>
        m.getUserBalancesByMode(tgId, 'solo')
      );
      const chainBalance = balances.find((b) => b.chain === chain);
      if (chainBalance) {
        return BigInt(Math.floor(parseFloat(chainBalance.current_value) * 1e18));
      }
      return 0n;
    } catch {
      return 0n;
    }
  }

  /**
   * Get all active positions in solo mode for a user
   */
  async getSoloPositions(tgId: number): Promise<Position[]> {
    return getActivePositionsByMode(tgId, 'solo');
  }

  /**
   * Calculate position size for solo mode
   * User gets 100% of their vault for each trade (subject to limits)
   */
  calculatePositionSize(
    vaultBalance: bigint,
    maxPositionPercent: number = 30
  ): bigint {
    // Limit to max percent of vault per position
    return (vaultBalance * BigInt(maxPositionPercent)) / 100n;
  }

  /**
   * Check if user has sufficient balance for a solo trade
   */
  hasSufficientBalance(vaultBalance: bigint, requiredAmount: bigint): boolean {
    return vaultBalance >= requiredAmount;
  }

  /**
   * Update vault balance after a trade
   */
  async updateVaultBalance(
    tgId: number,
    chain: Chain,
    newBalance: bigint
  ): Promise<void> {
    const balanceStr = (Number(newBalance) / 1e18).toString();
    await updateBalance(
      tgId,
      chain,
      { current_value: balanceStr },
      'solo'
    );
  }

  /**
   * Process a buy for solo mode
   * Deducts from vault balance
   */
  async processBuy(
    tgId: number,
    chain: Chain,
    amount: bigint
  ): Promise<void> {
    const currentBalance = await this.getVaultBalance(tgId, chain);
    const newBalance = currentBalance - amount;

    if (newBalance < 0n) {
      throw new Error('Insufficient solo vault balance');
    }

    await this.updateVaultBalance(tgId, chain, newBalance);
  }

  /**
   * Process a sell for solo mode
   * Adds to vault balance
   */
  async processSell(
    tgId: number,
    chain: Chain,
    amount: bigint
  ): Promise<void> {
    const currentBalance = await this.getVaultBalance(tgId, chain);
    const newBalance = currentBalance + amount;
    await this.updateVaultBalance(tgId, chain, newBalance);
  }

  /**
   * Get vault summary for a user across all chains
   */
  async getVaultSummary(tgId: number): Promise<SoloVault[]> {
    const balances = await import('@raptor/shared').then((m) =>
      m.getUserBalancesByMode(tgId, 'solo')
    );

    const vaults: SoloVault[] = [];

    for (const balance of balances) {
      const positions = await getActivePositionsByMode(tgId, 'solo');
      const chainPositions = positions.filter((p) => p.chain === balance.chain);

      vaults.push({
        tgId,
        chain: balance.chain,
        balance: BigInt(Math.floor(parseFloat(balance.current_value) * 1e18)),
        activePositions: chainPositions.length,
        depositAddress: balance.deposit_address,
      });
    }

    return vaults;
  }
}

// Singleton instance
export const soloManager = new SoloManager();

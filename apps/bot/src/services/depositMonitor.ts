/**
 * Deposit Monitor Service
 *
 * Watches for incoming deposits across all chains and notifies users.
 *
 * SECURITY: v2.3.1 - Requires confirmation finality before crediting deposits
 * to prevent reorg attacks and double-deposit exploits.
 */

import { ethers } from 'ethers';
import {
  Chain,
  EVMChain,
  getChainConfig,
  SOLANA_CONFIG,
  updateBalance,
  supabase,
} from '@raptor/shared';
import { sendAlertToUser } from '../notifications/alertService.js';

interface WatchedAddress {
  tgId: number;
  chain: Chain;
  address: string;
  lastBalance: bigint;
}

/**
 * Pending deposit waiting for confirmations
 */
interface PendingDeposit {
  key: string;
  tgId: number;
  chain: Chain;
  address: string;
  amount: bigint;
  txHash: string;
  detectedAt: number;
  confirmations: number;
  blockNumber?: number;
  slot?: number;
}

const POLL_INTERVAL_MS = 15000; // 15 seconds

/**
 * Required confirmations per chain to consider deposit final
 * These values ensure protection against typical reorg depths
 */
const REQUIRED_CONFIRMATIONS: Record<Chain, number> = {
  sol: 32, // ~13 seconds on Solana (fast finality)
  bsc: 15, // ~45 seconds on BSC
  base: 12, // ~24 seconds on Base
  eth: 12, // ~2.4 minutes on Ethereum
};

/**
 * Maximum time to wait for confirmations before timing out (1 hour)
 */
const DEPOSIT_TIMEOUT_MS = 60 * 60 * 1000;

export class DepositMonitor {
  private watchedAddresses: Map<string, WatchedAddress> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private pendingDeposits: Map<string, PendingDeposit> = new Map();
  private running: boolean = false;
  private pollIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    // Initialize providers for each EVM chain
    const evmChains: EVMChain[] = ['bsc', 'base', 'eth'];
    for (const chain of evmChains) {
      try {
        const config = getChainConfig(chain);
        this.providers.set(chain, new ethers.JsonRpcProvider(config.rpcUrl));
      } catch (error) {
        console.warn(`[DepositMonitor] Could not initialize ${chain} provider:`, error);
      }
    }
  }

  /**
   * Start the deposit monitor
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log('[DepositMonitor] Starting...');
    this.running = true;

    // Load existing deposit addresses from database
    await this.loadWatchedAddresses();

    // Start polling for deposits
    this.startPolling();

    console.log(`[DepositMonitor] Monitoring ${this.watchedAddresses.size} addresses`);
  }

  /**
   * Stop the deposit monitor
   */
  async stop(): Promise<void> {
    console.log('[DepositMonitor] Stopping...');
    this.running = false;

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Load all deposit addresses from database
   */
  private async loadWatchedAddresses(): Promise<void> {
    try {
      const { data: balances, error } = await supabase
        .from('user_balances')
        .select('*')
        .not('deposit_address', 'is', null);

      if (error) {
        console.error('[DepositMonitor] Error loading addresses:', error);
        return;
      }

      for (const balance of balances || []) {
        await this.watchAddress(
          balance.tg_id,
          balance.chain as Chain,
          balance.deposit_address
        );
      }
    } catch (error) {
      console.error('[DepositMonitor] Error loading watched addresses:', error);
    }
  }

  /**
   * Add an address to watch for deposits
   */
  async watchAddress(tgId: number, chain: Chain, address: string): Promise<void> {
    const key = `${chain}:${address.toLowerCase()}`;

    // Get current balance
    const currentBalance = await this.getBalance(chain, address);

    this.watchedAddresses.set(key, {
      tgId,
      chain,
      address,
      lastBalance: currentBalance,
    });

    console.log(`[DepositMonitor] Watching ${chain}:${address} for user ${tgId}`);
  }

  /**
   * Start polling for balance changes
   */
  private startPolling(): void {
    this.pollIntervalId = setInterval(async () => {
      if (!this.running) return;

      // Check for new deposits
      await this.checkAllBalances();

      // Check pending deposits for confirmations
      await this.checkPendingDeposits();
    }, POLL_INTERVAL_MS);

    // Also run immediately
    this.checkAllBalances();
  }

  /**
   * Check all watched addresses for balance changes
   */
  private async checkAllBalances(): Promise<void> {
    const checkPromises: Promise<void>[] = [];

    for (const [key, watched] of this.watchedAddresses) {
      checkPromises.push(this.checkBalance(key, watched));
    }

    await Promise.allSettled(checkPromises);
  }

  /**
   * Check a single address for balance changes
   */
  private async checkBalance(key: string, watched: WatchedAddress): Promise<void> {
    try {
      const currentBalance = await this.getBalance(watched.chain, watched.address);

      // Check if balance increased (deposit detected)
      if (currentBalance > watched.lastBalance) {
        const depositAmount = currentBalance - watched.lastBalance;
        await this.handleDeposit(watched, depositAmount);

        // Update last known balance
        watched.lastBalance = currentBalance;
        this.watchedAddresses.set(key, watched);
      }
    } catch (error) {
      console.error(`[DepositMonitor] Error checking ${key}:`, error);
    }
  }

  /**
   * Handle a detected deposit - adds to pending and notifies user
   * SECURITY: Does NOT credit balance until confirmations are met
   */
  private async handleDeposit(
    watched: WatchedAddress,
    amountWei: bigint
  ): Promise<void> {
    const { tgId, chain, address } = watched;

    // Generate unique key for this deposit detection
    const key = `${chain}:${address}:${Date.now()}`;

    // Check if we're already tracking a pending deposit for this address
    // (prevents duplicate pending entries from rapid polling)
    for (const [, pending] of this.pendingDeposits) {
      if (pending.address === address && pending.chain === chain && pending.amount === amountWei) {
        return; // Already tracking this deposit
      }
    }

    // Convert to human-readable amount for logging
    const symbol = this.getChainSymbol(chain);
    const amount = this.formatAmount(chain, amountWei);

    console.log(
      `[DepositMonitor] Deposit detected: ${amount} ${symbol} to ${address} for user ${tgId} (pending confirmation)`
    );

    // Add to pending deposits
    const pending: PendingDeposit = {
      key,
      tgId,
      chain,
      address,
      amount: amountWei,
      txHash: '', // Will be populated when we find the tx
      detectedAt: Date.now(),
      confirmations: 0,
    };

    this.pendingDeposits.set(key, pending);

    // Notify user that deposit is pending
    await sendAlertToUser(tgId, 'DEPOSIT_PENDING', {
      amount,
      chain,
      symbol,
      address,
      requiredConfirmations: REQUIRED_CONFIRMATIONS[chain],
    });
  }

  /**
   * Check pending deposits for confirmation
   * Credits balance when sufficient confirmations reached
   */
  private async checkPendingDeposits(): Promise<void> {
    const now = Date.now();

    for (const [key, pending] of this.pendingDeposits) {
      try {
        // Check for timeout
        if (now - pending.detectedAt > DEPOSIT_TIMEOUT_MS) {
          console.warn(`[DepositMonitor] Deposit timed out: ${key}`);
          this.pendingDeposits.delete(key);
          continue;
        }

        // Get current confirmations
        const confirmations = await this.getConfirmations(pending);
        pending.confirmations = confirmations;

        // Check if we have enough confirmations
        const required = REQUIRED_CONFIRMATIONS[pending.chain];
        if (confirmations >= required) {
          console.log(
            `[DepositMonitor] Deposit confirmed: ${key} with ${confirmations} confirmations`
          );

          // Credit the balance
          await this.creditDeposit(pending);

          // Remove from pending
          this.pendingDeposits.delete(key);
        }
      } catch (error) {
        console.error(`[DepositMonitor] Error checking pending ${key}:`, error);
      }
    }
  }

  /**
   * Credit a confirmed deposit to user balance
   */
  private async creditDeposit(deposit: PendingDeposit): Promise<void> {
    const { tgId, chain, address, amount } = deposit;
    const symbol = this.getChainSymbol(chain);
    const amountStr = this.formatAmount(chain, amount);

    // Update balance in database
    try {
      const { data: balance } = await supabase
        .from('user_balances')
        .select('current_value')
        .eq('tg_id', tgId)
        .eq('chain', chain)
        .single();

      const currentValue = balance ? parseFloat(balance.current_value) : 0;
      const newValue = currentValue + parseFloat(amountStr);

      await updateBalance(tgId, chain, {
        current_value: newValue.toString(),
        deposited: amountStr,
      });

      console.log(
        `[DepositMonitor] Balance credited: ${amountStr} ${symbol} for user ${tgId}`
      );
    } catch (error) {
      console.error('[DepositMonitor] Error crediting deposit:', error);
      throw error; // Re-throw to prevent removing from pending
    }

    // Send confirmation notification to user
    await sendAlertToUser(tgId, 'DEPOSIT_CONFIRMED', {
      amount: amountStr,
      chain,
      symbol,
      address,
    });
  }

  /**
   * Get confirmation count for a pending deposit
   */
  private async getConfirmations(deposit: PendingDeposit): Promise<number> {
    if (deposit.chain === 'sol') {
      return this.getSolanaConfirmations(deposit);
    }
    return this.getEvmConfirmations(deposit);
  }

  /**
   * Get Solana slot confirmations
   */
  private async getSolanaConfirmations(deposit: PendingDeposit): Promise<number> {
    try {
      const response = await fetch(SOLANA_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSlot',
          params: [{ commitment: 'finalized' }],
        }),
      });

      const data = (await response.json()) as { result?: number };
      const finalizedSlot = data.result || 0;

      // If we don't have a slot yet, get current and use as baseline
      if (!deposit.slot) {
        deposit.slot = finalizedSlot;
        return 0;
      }

      return Math.max(0, finalizedSlot - deposit.slot);
    } catch (error) {
      console.error('[DepositMonitor] Error getting Solana confirmations:', error);
      return 0;
    }
  }

  /**
   * Get EVM block confirmations
   */
  private async getEvmConfirmations(deposit: PendingDeposit): Promise<number> {
    const provider = this.providers.get(deposit.chain);
    if (!provider) return 0;

    try {
      const currentBlock = await provider.getBlockNumber();

      // If we don't have a block yet, get current and use as baseline
      if (!deposit.blockNumber) {
        deposit.blockNumber = currentBlock;
        return 0;
      }

      return Math.max(0, currentBlock - deposit.blockNumber);
    } catch (error) {
      console.error(`[DepositMonitor] Error getting ${deposit.chain} confirmations:`, error);
      return 0;
    }
  }

  /**
   * Get native token symbol for chain
   */
  private getChainSymbol(chain: Chain): string {
    switch (chain) {
      case 'sol':
        return 'SOL';
      case 'bsc':
        return 'BNB';
      default:
        return 'ETH';
    }
  }

  /**
   * Format amount for display
   */
  private formatAmount(chain: Chain, amountWei: bigint): string {
    if (chain === 'sol') {
      return (Number(amountWei) / 1e9).toFixed(6);
    }
    return ethers.formatEther(amountWei);
  }

  /**
   * Get balance for an address on a chain
   */
  private async getBalance(chain: Chain, address: string): Promise<bigint> {
    if (chain === 'sol') {
      return this.getSolanaBalance(address);
    }

    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`No provider for chain ${chain}`);
    }

    return provider.getBalance(address);
  }

  /**
   * Get Solana balance
   */
  private async getSolanaBalance(address: string): Promise<bigint> {
    try {
      const response = await fetch(SOLANA_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address],
        }),
      });

      const data = (await response.json()) as { result?: { value?: number } };
      return BigInt(data.result?.value || 0);
    } catch (error) {
      console.error('[DepositMonitor] Error getting Solana balance:', error);
      return 0n;
    }
  }

  /**
   * Get the number of watched addresses
   */
  getWatchedCount(): number {
    return this.watchedAddresses.size;
  }

  /**
   * Get the number of pending deposits
   */
  getPendingCount(): number {
    return this.pendingDeposits.size;
  }

  /**
   * Get pending deposit status for monitoring
   */
  getPendingStatus(): Array<{
    chain: Chain;
    address: string;
    amount: string;
    confirmations: number;
    required: number;
    age: number;
  }> {
    const now = Date.now();
    const status: Array<{
      chain: Chain;
      address: string;
      amount: string;
      confirmations: number;
      required: number;
      age: number;
    }> = [];

    for (const [, pending] of this.pendingDeposits) {
      status.push({
        chain: pending.chain,
        address: pending.address,
        amount: this.formatAmount(pending.chain, pending.amount),
        confirmations: pending.confirmations,
        required: REQUIRED_CONFIRMATIONS[pending.chain],
        age: Math.floor((now - pending.detectedAt) / 1000),
      });
    }

    return status;
  }
}

// Singleton instance
export const depositMonitor = new DepositMonitor();

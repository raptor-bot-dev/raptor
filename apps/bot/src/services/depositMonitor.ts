/**
 * Deposit Monitor Service
 *
 * Watches for incoming deposits across all chains and notifies users.
 *
 * SECURITY: v2.3.1 - Requires confirmation finality before crediting deposits
 * to prevent reorg attacks and double-deposit exploits.
 */

import {
  Chain,
  SOLANA_CONFIG,
  supabase,
  createLogger,
  maskAddress,
} from '@raptor/shared';
import { sendAlertToUser } from '../notifications/alertService.js';

const logger = createLogger('DepositMonitor');

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
};

/**
 * Maximum time to wait for confirmations before timing out (1 hour)
 */
const DEPOSIT_TIMEOUT_MS = 60 * 60 * 1000;

export class DepositMonitor {
  private watchedAddresses: Map<string, WatchedAddress> = new Map();
  private pendingDeposits: Map<string, PendingDeposit> = new Map();
  private running: boolean = false;
  private pollIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    // Solana-only build - no EVM providers needed
  }

  /**
   * Start the deposit monitor
   */
  async start(): Promise<void> {
    if (this.running) return;

    logger.info('Starting deposit monitor');
    this.running = true;

    // Load existing deposit addresses from database
    await this.loadWatchedAddresses();

    // Start polling for deposits
    this.startPolling();

    logger.info(`Monitoring ${this.watchedAddresses.size} addresses`);
  }

  /**
   * Stop the deposit monitor
   */
  async stop(): Promise<void> {
    logger.info('Stopping deposit monitor');
    this.running = false;

    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Load all deposit addresses from database
   * Uses wallets table with users join (Phase 0 schema)
   */
  private async loadWatchedAddresses(): Promise<void> {
    try {
      const { data: wallets, error } = await supabase
        .from('wallets')
        .select('*, users(telegram_chat_id)')
        .eq('is_active', true);

      if (error) {
        logger.error('Error loading addresses', error);
        return;
      }

      for (const wallet of wallets || []) {
        const tgId = Number((wallet as any)?.users?.telegram_chat_id ?? 0);
        if (!tgId || !wallet.pubkey) continue;
        // Solana-only build — all wallets are Solana
        await this.watchAddress(tgId, 'sol' as Chain, wallet.pubkey);
      }
    } catch (error) {
      logger.error('Error loading watched addresses', error);
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

    logger.info('Watching address for deposits', { userId: tgId, chain, address });
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
      logger.error(`Error checking balance`, error, { key });
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

    logger.info('Deposit detected (pending confirmation)', {
      userId: tgId,
      chain,
      address,
      amount: `${amount} ${symbol}`,
    });

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
          logger.warn('Deposit confirmation timed out', { key });
          this.pendingDeposits.delete(key);
          continue;
        }

        // Get current confirmations
        const confirmations = await this.getConfirmations(pending);
        pending.confirmations = confirmations;

        // Check if we have enough confirmations
        const required = REQUIRED_CONFIRMATIONS[pending.chain];
        if (confirmations >= required) {
          logger.info('Deposit confirmed', { key, confirmations });

          // Credit the balance
          await this.creditDeposit(pending);

          // Remove from pending
          this.pendingDeposits.delete(key);
        }
      } catch (error) {
        logger.error('Error checking pending deposit', error, { key });
      }
    }
  }

  /**
   * Credit a confirmed deposit to user balance
   * Phase 0: On-chain balances tracked via wallet pubkeys — no user_balances table.
   * We log the deposit and notify the user; actual balance is on-chain.
   */
  private async creditDeposit(deposit: PendingDeposit): Promise<void> {
    const { tgId, chain, address, amount } = deposit;
    const symbol = this.getChainSymbol(chain);
    const amountStr = this.formatAmount(chain, amount);

    logger.info('Deposit confirmed (on-chain balance)', {
      userId: tgId,
      amount: `${amountStr} ${symbol}`,
      chain,
      address,
    });

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
    // Solana-only build
    return this.getSolanaConfirmations(deposit);
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
      logger.error('Error getting Solana confirmations', error);
      return 0;
    }
  }

  /**
   * Get native token symbol for chain
   */
  private getChainSymbol(_chain: Chain): string {
    // Solana-only build
    return 'SOL';
  }

  /**
   * Format amount for display
   */
  private formatAmount(_chain: Chain, amountWei: bigint): string {
    // Solana-only build - amount is in lamports (1 SOL = 1e9 lamports)
    return (Number(amountWei) / 1e9).toFixed(6);
  }

  /**
   * Get balance for an address on a chain
   */
  private async getBalance(_chain: Chain, address: string): Promise<bigint> {
    // Solana-only build
    return this.getSolanaBalance(address);
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
      logger.error('Error getting Solana balance', error);
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

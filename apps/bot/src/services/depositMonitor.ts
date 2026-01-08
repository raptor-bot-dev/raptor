// Deposit Monitor Service
// Watches for incoming deposits across all chains and notifies users

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

const POLL_INTERVAL_MS = 15000; // 15 seconds

export class DepositMonitor {
  private watchedAddresses: Map<string, WatchedAddress> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
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
        .from('balances')
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

      await this.checkAllBalances();
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
   * Handle a detected deposit
   */
  private async handleDeposit(
    watched: WatchedAddress,
    amountWei: bigint
  ): Promise<void> {
    const { tgId, chain, address } = watched;

    // Convert to human-readable amount
    let amount: string;
    let symbol: string;

    if (chain === 'sol') {
      // Solana uses lamports (9 decimals)
      amount = (Number(amountWei) / 1e9).toFixed(6);
      symbol = 'SOL';
    } else {
      // EVM chains use wei (18 decimals)
      amount = ethers.formatEther(amountWei);
      symbol = chain === 'bsc' ? 'BNB' : 'ETH';
    }

    console.log(
      `[DepositMonitor] Deposit detected: ${amount} ${symbol} to ${address} for user ${tgId}`
    );

    // Update balance in database
    try {
      const { data: balance } = await supabase
        .from('balances')
        .select('current_value')
        .eq('tg_id', tgId)
        .eq('chain', chain)
        .single();

      const currentValue = balance ? parseFloat(balance.current_value) : 0;
      const newValue = currentValue + parseFloat(amount);

      await updateBalance(tgId, chain, {
        current_value: newValue.toString(),
        deposited: amount,
      });
    } catch (error) {
      console.error('[DepositMonitor] Error updating balance:', error);
    }

    // Send notification to user
    await sendAlertToUser(tgId, 'DEPOSIT_CONFIRMED', {
      amount,
      chain,
      symbol,
      address,
    });
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
}

// Singleton instance
export const depositMonitor = new DepositMonitor();

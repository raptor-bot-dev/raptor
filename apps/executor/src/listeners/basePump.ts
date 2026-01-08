import { ethers, Contract } from 'ethers';
import type { Opportunity } from '@raptor/shared';
import { BASE_CONFIG, MIN_OPPORTUNITY_SCORE, getUserAllocations } from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';
import { calculateScore } from '../scoring/scorer.js';

const FACTORY_ABI = [
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol)',
];

export class BasePumpListener {
  private executor: ChainExecutor;
  private factory: Contract | null = null;
  private running = false;

  constructor(executor: ChainExecutor) {
    this.executor = executor;
  }

  async start(): Promise<void> {
    this.running = true;

    const launchpad = BASE_CONFIG.launchpads.find((lp) => lp.name === 'BasePump');
    if (!launchpad) {
      console.log('[Base] BasePump not configured, skipping');
      return;
    }

    // Skip if factory address is placeholder
    if (launchpad.factory === '0x0000000000000000000000000000000000000000') {
      console.log('[Base] BasePump factory address not configured, skipping');
      return;
    }

    const wsProvider = this.executor.getWsProvider();
    if (!wsProvider) {
      console.log('[Base] WebSocket not available for BasePump listener');
      return;
    }

    this.factory = new Contract(launchpad.factory, FACTORY_ABI, wsProvider);

    this.factory.on('TokenCreated', async (token, creator, name, symbol) => {
      if (!this.running) return;

      console.log(`[Base] BasePump launch detected: ${name} (${symbol})`);

      try {
        await this.processLaunch(token, name, symbol);
      } catch (error) {
        console.error('[Base] Error processing BasePump launch:', error);
      }
    });

    console.log('[Base] BasePump listener started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.factory) {
      this.factory.removeAllListeners();
    }
  }

  private async processLaunch(
    token: string,
    name: string,
    symbol: string
  ): Promise<void> {
    const opportunity: Opportunity = {
      id: `base-${token}-${Date.now()}`,
      chain: 'base',
      token,
      name,
      symbol,
      launchpad: 'BasePump',
      liquidity: 0n,
      buy_tax: 0,
      sell_tax: 0,
      score: 0,
      recommended_size: 0n,
      timestamp: Date.now(),
      expires_at: Date.now() + 60000,
    };

    // Analyze and score
    const score = await calculateScore(opportunity, BASE_CONFIG);
    opportunity.score = score;

    if (score >= MIN_OPPORTUNITY_SCORE) {
      console.log(`[Base] Target acquired: ${symbol} (Score: ${score})`);

      // Get user allocations
      const allocations = await getUserAllocations('base');

      if (allocations.size > 0) {
        await this.executor.processOpportunity(opportunity, allocations);
      } else {
        console.log('[Base] No user allocations available');
      }
    } else {
      console.log(`[Base] Target rejected: ${symbol} (Score: ${score})`);
    }
  }
}

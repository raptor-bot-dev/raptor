import { ethers, Contract } from 'ethers';
import type { Opportunity } from '@raptor/shared';
import { BSC_CONFIG, MIN_OPPORTUNITY_SCORE, getUserAllocations } from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';
import { calculateScore } from '../scoring/scorer.js';

const FACTORY_ABI = [
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol)',
];

export class FourMemeListener {
  private executor: ChainExecutor;
  private factory: Contract | null = null;
  private running = false;

  constructor(executor: ChainExecutor) {
    this.executor = executor;
  }

  async start(): Promise<void> {
    this.running = true;

    const launchpad = BSC_CONFIG.launchpads.find((lp) => lp.name === 'four.meme');
    if (!launchpad) {
      console.log('[BSC] four.meme not configured, skipping');
      return;
    }

    // Skip if factory address is placeholder
    if (launchpad.factory === '0x0000000000000000000000000000000000000000') {
      console.log('[BSC] four.meme factory address not configured, skipping');
      return;
    }

    const wsProvider = this.executor.getWsProvider();
    if (!wsProvider) {
      console.log('[BSC] WebSocket not available for four.meme listener');
      return;
    }

    this.factory = new Contract(launchpad.factory, FACTORY_ABI, wsProvider);

    this.factory.on('TokenCreated', async (token, creator, name, symbol) => {
      if (!this.running) return;

      console.log(`[BSC] four.meme launch detected: ${name} (${symbol})`);

      try {
        await this.processLaunch(token, name, symbol);
      } catch (error) {
        console.error('[BSC] Error processing four.meme launch:', error);
      }
    });

    console.log('[BSC] four.meme listener started');
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
    // four.meme tokens are typically 0% tax
    const opportunity: Opportunity = {
      id: `bsc-${token}-${Date.now()}`,
      chain: 'bsc',
      token,
      name,
      symbol,
      launchpad: 'four.meme',
      liquidity: 0n, // Will be fetched during scoring
      buy_tax: 0,
      sell_tax: 0,
      score: 0,
      recommended_size: 0n,
      timestamp: Date.now(),
      expires_at: Date.now() + 60000, // 1 minute window
    };

    // Analyze and score
    const score = await calculateScore(opportunity, BSC_CONFIG);
    opportunity.score = score;

    if (score >= MIN_OPPORTUNITY_SCORE) {
      console.log(`[BSC] Target acquired: ${symbol} (Score: ${score})`);

      // Get user allocations
      const allocations = await getUserAllocations('bsc');

      if (allocations.size > 0) {
        // Execute
        await this.executor.processOpportunity(opportunity, allocations);
      } else {
        console.log('[BSC] No user allocations available');
      }
    } else {
      console.log(`[BSC] Target rejected: ${symbol} (Score: ${score})`);
    }
  }
}

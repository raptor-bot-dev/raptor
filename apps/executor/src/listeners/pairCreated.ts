import { ethers, Contract } from 'ethers';
import type { ChainConfig, Opportunity } from '@raptor/shared';
import { MIN_OPPORTUNITY_SCORE, getUserAllocations } from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';
import { calculateScore } from '../scoring/scorer.js';

const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
];

export class PairCreatedListener {
  private executor: ChainExecutor;
  private config: ChainConfig;
  private factories: Contract[] = [];
  private running = false;

  constructor(executor: ChainExecutor) {
    this.executor = executor;
    this.config = executor.getConfig();
  }

  async start(): Promise<void> {
    this.running = true;

    const wsProvider = this.executor.getWsProvider();
    if (!wsProvider) {
      console.log(`[${this.config.name}] WebSocket not available for pair listener`);
      return;
    }

    // Listen to all DEX factories
    for (const dex of this.config.dexes) {
      const factory = new Contract(dex.factory, FACTORY_ABI, wsProvider);

      factory.on('PairCreated', async (token0, token1, pair) => {
        if (!this.running) return;

        // Determine which is the new token
        const newToken =
          token0.toLowerCase() === this.config.wrappedNative.toLowerCase()
            ? token1
            : token0;

        console.log(
          `[${this.config.name}] New pair on ${dex.name}: ${newToken}`
        );

        try {
          await this.processPair(newToken, dex.name);
        } catch (error) {
          console.error(
            `[${this.config.name}] Error processing pair:`,
            error
          );
        }
      });

      this.factories.push(factory);
    }

    console.log(
      `[${this.config.name}] Pair listener started for ${this.factories.length} DEXes`
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const factory of this.factories) {
      factory.removeAllListeners();
    }
  }

  private async processPair(token: string, dexName: string): Promise<void> {
    // Create opportunity
    const opportunity: Opportunity = {
      id: `${this.config.name.toLowerCase()}-${token}-${Date.now()}`,
      chain: this.config.name.toLowerCase() as 'bsc' | 'base',
      token,
      name: 'Unknown',
      symbol: 'UNKNOWN',
      launchpad: dexName,
      liquidity: 0n,
      buy_tax: 0,
      sell_tax: 0,
      score: 0,
      recommended_size: 0n,
      timestamp: Date.now(),
      expires_at: Date.now() + 60000,
    };

    // Calculate score
    const score = await calculateScore(opportunity, this.config);
    opportunity.score = score;

    if (score >= MIN_OPPORTUNITY_SCORE) {
      console.log(
        `[${this.config.name}] Target acquired from ${dexName} (Score: ${score})`
      );

      const chain = this.config.name.toLowerCase() as 'bsc' | 'base';
      const allocations = await getUserAllocations(chain);

      if (allocations.size > 0) {
        await this.executor.processOpportunity(opportunity, allocations);
      }
    }
  }
}

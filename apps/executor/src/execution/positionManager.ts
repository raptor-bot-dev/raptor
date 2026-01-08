import type { Position } from '@raptor/shared';
import {
  getAllActivePositions,
  updatePosition,
  MAX_HOLD_TIME,
} from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';

const PRICE_UPDATE_INTERVAL = 30000; // 30 seconds
const POSITION_CHECK_INTERVAL = 10000; // 10 seconds

export class PositionManager {
  private executors: Map<string, ChainExecutor> = new Map();
  private running = false;
  private priceInterval: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(executors: ChainExecutor[]) {
    for (const executor of executors) {
      const config = executor.getConfig();
      this.executors.set(config.name.toLowerCase(), executor);
    }
  }

  async start(): Promise<void> {
    this.running = true;

    // Start price update loop
    this.priceInterval = setInterval(
      () => this.updatePrices(),
      PRICE_UPDATE_INTERVAL
    );

    // Start position check loop
    this.checkInterval = setInterval(
      () => this.checkPositions(),
      POSITION_CHECK_INTERVAL
    );

    console.log('Position manager started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.priceInterval) clearInterval(this.priceInterval);
    if (this.checkInterval) clearInterval(this.checkInterval);
    console.log('Position manager stopped');
  }

  private async updatePrices(): Promise<void> {
    if (!this.running) return;

    try {
      const positions = await getAllActivePositions();

      for (const position of positions) {
        const executor = this.executors.get(position.chain);
        if (!executor) continue;

        try {
          const currentPrice = await executor.getTokenPrice(
            position.token_address
          );

          if (currentPrice > 0n) {
            const entryPrice = parseFloat(position.entry_price);
            const currentPriceNum =
              Number(currentPrice) / Number(BigInt(position.tokens_held));
            const pnlPercent =
              ((currentPriceNum - entryPrice) / entryPrice) * 100;

            await updatePosition(position.id, {
              current_price: currentPriceNum.toString(),
              unrealized_pnl_percent: pnlPercent,
            });
          }
        } catch (error) {
          console.error(
            `Failed to update price for position ${position.id}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error('Price update failed:', error);
    }
  }

  private async checkPositions(): Promise<void> {
    if (!this.running) return;

    try {
      const positions = await getAllActivePositions();

      for (const position of positions) {
        await this.checkPosition(position);
      }
    } catch (error) {
      console.error('Position check failed:', error);
    }
  }

  private async checkPosition(position: Position): Promise<void> {
    const executor = this.executors.get(position.chain);
    if (!executor) return;

    // Check take profit
    if (position.unrealized_pnl_percent >= position.take_profit_percent) {
      console.log(
        `[${position.chain}] Take profit triggered for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'TAKE_PROFIT');
      return;
    }

    // Check stop loss
    if (position.unrealized_pnl_percent <= -position.stop_loss_percent) {
      console.log(
        `[${position.chain}] Stop loss triggered for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'STOP_LOSS');
      return;
    }

    // Check max hold time
    const holdTime = Date.now() - new Date(position.created_at).getTime();
    if (holdTime > MAX_HOLD_TIME) {
      console.log(
        `[${position.chain}] Max hold time reached for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'MAX_HOLD_TIME');
      return;
    }
  }

  private async closePosition(
    position: Position,
    executor: ChainExecutor,
    reason: string
  ): Promise<void> {
    try {
      await executor.executeSell(
        position.id,
        position.token_address,
        position.token_symbol,
        BigInt(position.tokens_held),
        position.tg_id,
        position.entry_price
      );

      console.log(
        `[${position.chain}] Closed position ${position.id} (${reason})`
      );

      // TODO: Send notification to user
    } catch (error) {
      console.error(
        `Failed to close position ${position.id}:`,
        error
      );
    }
  }
}

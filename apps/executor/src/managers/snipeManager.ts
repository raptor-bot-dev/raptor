// Snipe Mode Manager
// Manages manual snipe requests from users

import {
  createSnipeRequest,
  getPendingSnipeRequests,
  updateSnipeRequestStatus,
  getPositionByToken,
  type Chain,
  type SnipeRequest,
  type SnipeStatus,
} from '@raptor/shared';

export interface SnipeResult {
  success: boolean;
  positionId?: number;
  txHash?: string;
  error?: string;
  tokensReceived?: number;
  entryPrice?: number;
}

export class SnipeManager {
  private processing: Set<number> = new Set(); // Track requests being processed

  /**
   * Create a new snipe request
   */
  async createRequest(params: {
    tgId: number;
    chain: Chain;
    tokenAddress: string;
    amount: string;
    takeProfitPercent?: number;
    stopLossPercent?: number;
    skipSafetyCheck?: boolean;
  }): Promise<SnipeRequest> {
    console.log(`[SnipeManager] Creating snipe request for ${params.tokenAddress}`);

    const request = await createSnipeRequest({
      tg_id: params.tgId,
      chain: params.chain,
      token_address: params.tokenAddress,
      amount: params.amount,
      take_profit_percent: params.takeProfitPercent,
      stop_loss_percent: params.stopLossPercent,
      skip_safety_check: params.skipSafetyCheck,
    });

    console.log(`[SnipeManager] Snipe request created: ${request.id}`);
    return request;
  }

  /**
   * Get all pending snipe requests for a chain
   */
  async getPendingRequests(chain?: Chain): Promise<SnipeRequest[]> {
    return getPendingSnipeRequests(chain);
  }

  /**
   * Mark a request as being processed
   */
  markProcessing(requestId: number): boolean {
    if (this.processing.has(requestId)) {
      return false; // Already being processed
    }
    this.processing.add(requestId);
    return true;
  }

  /**
   * Unmark a request as processing
   */
  unmarkProcessing(requestId: number): void {
    this.processing.delete(requestId);
  }

  /**
   * Update request status to executing
   */
  async markExecuting(requestId: number): Promise<void> {
    await updateSnipeRequestStatus(requestId, 'EXECUTING');
  }

  /**
   * Mark request as completed with position ID
   */
  async markCompleted(requestId: number, positionId: number): Promise<void> {
    await updateSnipeRequestStatus(requestId, 'COMPLETED', { position_id: positionId });
    this.unmarkProcessing(requestId);
  }

  /**
   * Mark request as failed with error message
   */
  async markFailed(requestId: number, error: string): Promise<void> {
    await updateSnipeRequestStatus(requestId, 'FAILED', { error_message: error });
    this.unmarkProcessing(requestId);
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: number): Promise<void> {
    await updateSnipeRequestStatus(requestId, 'CANCELLED');
    this.unmarkProcessing(requestId);
  }

  /**
   * Check if user already has a position in this token
   */
  async hasExistingPosition(
    tgId: number,
    chain: Chain,
    tokenAddress: string
  ): Promise<boolean> {
    const position = await getPositionByToken(tgId, chain, tokenAddress);
    return position !== null;
  }

  /**
   * Validate snipe request parameters
   */
  validateRequest(params: {
    chain: Chain;
    tokenAddress: string;
    amount: string;
  }): { valid: boolean; error?: string } {
    // Check chain - Solana-only build
    if (params.chain !== 'sol') {
      return { valid: false, error: 'Only Solana is supported' };
    }

    // Check amount
    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) {
      return { valid: false, error: 'Invalid amount' };
    }

    // Check minimum amount
    const minAmount = 0.1; // 0.1 SOL
    if (amount < minAmount) {
      return {
        valid: false,
        error: `Minimum amount is ${minAmount} SOL`,
      };
    }

    // Validate Solana token address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.tokenAddress)) {
      return { valid: false, error: 'Invalid Solana token address' };
    }

    return { valid: true };
  }

  /**
   * Process pending snipe requests
   * This is called periodically by the executor
   */
  async processPendingRequests(
    executor: {
      executeBuy: (
        token: string,
        amount: number,
        tgId: number,
        mode: 'snipe',
        options?: {
          skipSafetyCheck?: boolean;
          takeProfitPercent?: number;
          stopLossPercent?: number;
          source?: string;
        }
      ) => Promise<{ success: boolean; txHash?: string; error?: string; position?: { id: number } }>;
    },
    chain?: Chain
  ): Promise<SnipeResult[]> {
    const requests = await this.getPendingRequests(chain);
    const results: SnipeResult[] = [];

    for (const request of requests) {
      // Skip if already processing
      if (!this.markProcessing(request.id)) {
        continue;
      }

      try {
        // Check for existing position
        if (await this.hasExistingPosition(request.tg_id, request.chain, request.token_address)) {
          await this.markFailed(request.id, 'Already have position in this token');
          results.push({
            success: false,
            error: 'Already have position in this token',
          });
          continue;
        }

        // Mark as executing
        await this.markExecuting(request.id);

        // Execute the buy
        const amount = parseFloat(request.amount);
        const result = await executor.executeBuy(
          request.token_address,
          amount,
          request.tg_id,
          'snipe',
          {
            skipSafetyCheck: request.skip_safety_check,
            takeProfitPercent: request.take_profit_percent,
            stopLossPercent: request.stop_loss_percent,
            source: 'snipe',
          }
        );

        if (result.success && result.position) {
          await this.markCompleted(request.id, result.position.id);
          results.push({
            success: true,
            positionId: result.position.id,
            txHash: result.txHash,
          });
        } else {
          await this.markFailed(request.id, result.error || 'Unknown error');
          results.push({
            success: false,
            error: result.error,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.markFailed(request.id, errorMessage);
        results.push({
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }
}

// Singleton instance
export const snipeManager = new SnipeManager();

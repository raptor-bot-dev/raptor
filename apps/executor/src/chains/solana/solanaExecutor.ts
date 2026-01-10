// Solana Executor for RAPTOR v2
// Handles all Solana trades via pump.fun or Jupiter

import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  solToLamports,
  lamportsToSol,
  isValidSolanaAddress,
  getSolanaExplorerUrl,
  applyBuyFeeDecimal,
  applySellFeeDecimal,
  getFeeWallet,
  recordTrade,
  recordFee,
  createPosition,
  type TradingMode,
  type Position,
  type BondingCurveState,
} from '@raptor/shared';

import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { JupiterClient, jupiter } from './jupiter.js';
import {
  calculateBuyOutput,
  calculateSellOutput,
  decodeBondingCurveState,
  getCurrentPrice,
  hasGraduated,
  PumpFunClient,
  getPumpFunClient,
  deriveBondingCurvePDA,
} from './pumpFun.js';

// Re-export for convenience
export { JupiterClient, jupiter } from './jupiter.js';
export * from './pumpFun.js';

export interface SolanaTradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  price: number;
}

export interface SolanaTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: bigint;
  price: number;
  graduated: boolean;
  bondingCurveProgress?: number;
}

export class SolanaExecutor {
  private rpcUrl: string;
  private wssUrl: string;
  private jupiterClient: JupiterClient;
  private connection: Connection;
  private pumpFunClient: PumpFunClient | null = null;
  private running: boolean = false;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
    this.wssUrl = SOLANA_CONFIG.wssUrl;
    this.jupiterClient = new JupiterClient();
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  /**
   * Get or create the PumpFunClient (lazy initialization)
   */
  private getPumpFunClient(): PumpFunClient {
    if (!this.pumpFunClient) {
      this.pumpFunClient = getPumpFunClient();
    }
    return this.pumpFunClient;
  }

  /**
   * Start the Solana executor
   */
  async start(): Promise<void> {
    console.log('[SolanaExecutor] Starting...');
    this.running = true;

    // Verify RPC connection
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
        }),
      });
      const data = (await response.json()) as { result?: string };
      if (data.result === 'ok') {
        console.log('[SolanaExecutor] RPC connection healthy');
      } else {
        console.warn('[SolanaExecutor] RPC health check returned:', data);
      }
    } catch (error) {
      console.error('[SolanaExecutor] Failed to connect to RPC:', error);
    }

    console.log('[SolanaExecutor] Started successfully');
  }

  /**
   * Stop the Solana executor
   */
  async stop(): Promise<void> {
    console.log('[SolanaExecutor] Stopping...');
    this.running = false;
    console.log('[SolanaExecutor] Stopped');
  }

  /**
   * Execute a buy order
   * Routes through pump.fun for tokens on bonding curve, Jupiter for graduated tokens
   */
  async executeBuy(
    tokenMint: string,
    solAmount: number,
    tgId: number,
    mode: TradingMode,
    options?: {
      skipSafetyCheck?: boolean;
      takeProfitPercent?: number;
      stopLossPercent?: number;
      source?: string;
    }
  ): Promise<SolanaTradeResult> {
    console.log(
      `[SolanaExecutor] Buy ${solAmount} SOL of ${tokenMint} for user ${tgId}`
    );

    // Validate address
    if (!isValidSolanaAddress(tokenMint)) {
      return {
        success: false,
        error: 'Invalid token mint address',
        amountIn: solAmount,
        amountOut: 0,
        fee: 0,
        price: 0,
      };
    }

    // Check minimum position size
    if (solAmount < SOLANA_CONFIG.minPositionSize) {
      return {
        success: false,
        error: `Minimum position size is ${SOLANA_CONFIG.minPositionSize} SOL`,
        amountIn: solAmount,
        amountOut: 0,
        fee: 0,
        price: 0,
      };
    }

    // Apply 1% fee
    const { netAmount, fee } = applyBuyFeeDecimal(solAmount);
    console.log(`[SolanaExecutor] Net amount: ${netAmount} SOL, Fee: ${fee} SOL`);

    try {
      // Check if token is on bonding curve or graduated
      const tokenInfo = await this.getTokenInfo(tokenMint);

      let txHash: string;
      let tokensReceived: number;

      if (tokenInfo && !tokenInfo.graduated) {
        // Use pump.fun bonding curve
        console.log('[SolanaExecutor] Token on bonding curve, using pump.fun');
        const result = await this.buyViaPumpFun(tokenMint, netAmount);
        txHash = result.txHash;
        tokensReceived = result.tokensReceived;
      } else {
        // Use Jupiter for graduated tokens
        console.log('[SolanaExecutor] Token graduated, using Jupiter');
        const result = await this.buyViaJupiter(tokenMint, netAmount);
        txHash = result.txHash;
        tokensReceived = result.tokensReceived;
      }

      const price = netAmount / tokensReceived;

      // Record trade
      await recordTrade({
        tg_id: tgId,
        chain: 'sol',
        mode,
        token_address: tokenMint,
        token_symbol: tokenInfo?.symbol || 'UNKNOWN',
        type: 'BUY',
        amount_in: netAmount.toString(),
        amount_out: tokensReceived.toString(),
        price: price.toString(),
        fee_amount: fee.toString(),
        source: options?.source || 'manual',
        tx_hash: txHash,
        status: 'CONFIRMED',
      });

      // Record fee
      await recordFee({
        tg_id: tgId,
        chain: 'sol',
        amount: fee.toString(),
        token: 'SOL',
      });

      // Create position
      await createPosition({
        tg_id: tgId,
        chain: 'sol',
        mode,
        token_address: tokenMint,
        token_symbol: tokenInfo?.symbol || 'UNKNOWN',
        amount_in: netAmount.toString(),
        tokens_held: tokensReceived.toString(),
        entry_price: price.toString(),
        take_profit_percent: options?.takeProfitPercent ?? 50,
        stop_loss_percent: options?.stopLossPercent ?? 30,
        source: options?.source || 'manual',
        score: 0,
        program_id: tokenInfo?.graduated ? PROGRAM_IDS.RAYDIUM_AMM : PROGRAM_IDS.PUMP_FUN,
      });

      console.log(`[SolanaExecutor] Buy successful: ${txHash}`);

      return {
        success: true,
        txHash,
        amountIn: netAmount,
        amountOut: tokensReceived,
        fee,
        price,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Buy failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        amountIn: solAmount,
        amountOut: 0,
        fee: 0,
        price: 0,
      };
    }
  }

  /**
   * Execute a sell order
   */
  async executeSell(
    tokenMint: string,
    tokenAmount: number,
    tgId: number,
    mode: TradingMode,
    position?: Position
  ): Promise<SolanaTradeResult> {
    console.log(
      `[SolanaExecutor] Sell ${tokenAmount} tokens of ${tokenMint} for user ${tgId}`
    );

    try {
      // Check if token is on bonding curve or graduated
      const tokenInfo = await this.getTokenInfo(tokenMint);

      let txHash: string;
      let solReceived: number;

      if (tokenInfo && !tokenInfo.graduated) {
        // Use pump.fun bonding curve
        console.log('[SolanaExecutor] Token on bonding curve, using pump.fun');
        const result = await this.sellViaPumpFun(tokenMint, tokenAmount);
        txHash = result.txHash;
        solReceived = result.solReceived;
      } else {
        // Use Jupiter for graduated tokens
        console.log('[SolanaExecutor] Token graduated, using Jupiter');
        const result = await this.sellViaJupiter(tokenMint, tokenAmount);
        txHash = result.txHash;
        solReceived = result.solReceived;
      }

      // Apply 1% fee
      const { netAmount, fee } = applySellFeeDecimal(solReceived);

      const price = solReceived / tokenAmount;

      // Calculate PnL if position provided
      let pnl: string | null = null;
      let pnlPercent: number | null = null;
      if (position) {
        const entryValue = parseFloat(position.amount_in);
        pnl = (netAmount - entryValue).toString();
        pnlPercent = ((netAmount - entryValue) / entryValue) * 100;
      }

      // Record trade
      await recordTrade({
        tg_id: tgId,
        position_id: position?.id,
        chain: 'sol',
        mode,
        token_address: tokenMint,
        token_symbol: tokenInfo?.symbol || 'UNKNOWN',
        type: 'SELL',
        amount_in: tokenAmount.toString(),
        amount_out: netAmount.toString(),
        price: price.toString(),
        pnl,
        pnl_percent: pnlPercent,
        fee_amount: fee.toString(),
        source: position?.source || 'manual',
        tx_hash: txHash,
        status: 'CONFIRMED',
      });

      // Record fee
      await recordFee({
        tg_id: tgId,
        chain: 'sol',
        amount: fee.toString(),
        token: 'SOL',
      });

      console.log(`[SolanaExecutor] Sell successful: ${txHash}`);

      return {
        success: true,
        txHash,
        amountIn: tokenAmount,
        amountOut: netAmount,
        fee,
        price,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Sell failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        amountIn: tokenAmount,
        amountOut: 0,
        fee: 0,
        price: 0,
      };
    }
  }

  /**
   * Get current token price in SOL
   */
  async getTokenPrice(tokenMint: string): Promise<number> {
    try {
      // First try Jupiter price API
      const price = await this.jupiterClient.getTokenPrice(tokenMint);
      if (price > 0) {
        return price;
      }

      // Fallback to bonding curve calculation
      const bondingCurve = await this.getBondingCurveState(tokenMint);
      if (bondingCurve) {
        return getCurrentPrice(bondingCurve);
      }

      return 0;
    } catch (error) {
      console.error('[SolanaExecutor] Error getting token price:', error);
      return 0;
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenMint: string): Promise<SolanaTokenInfo | null> {
    try {
      // Get mint info from RPC
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [tokenMint, { encoding: 'jsonParsed' }],
        }),
      });

      interface RpcAccountInfo {
        result?: {
          value?: {
            data?: {
              parsed?: {
                info?: {
                  decimals?: number;
                  supply?: string;
                };
              };
            };
          };
        };
      }
      const data = (await response.json()) as RpcAccountInfo;
      const accountInfo = data.result?.value;

      if (!accountInfo) {
        return null;
      }

      // Check bonding curve state
      const bondingCurve = await this.getBondingCurveState(tokenMint);
      const graduated = bondingCurve ? hasGraduated(bondingCurve) : true;

      const price = await this.getTokenPrice(tokenMint);

      return {
        mint: tokenMint,
        symbol: 'UNKNOWN', // Would need metadata API
        name: 'Unknown Token',
        decimals: accountInfo.data?.parsed?.info?.decimals || 6,
        supply: BigInt(accountInfo.data?.parsed?.info?.supply || 0),
        price,
        graduated,
        bondingCurveProgress: bondingCurve ? this.calculateProgress(bondingCurve) : undefined,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Error getting token info:', error);
      return null;
    }
  }

  /**
   * Buy via pump.fun bonding curve
   */
  private async buyViaPumpFun(
    tokenMint: string,
    solAmount: number
  ): Promise<{ txHash: string; tokensReceived: number }> {
    console.log(`[SolanaExecutor] Executing pump.fun buy of ${solAmount} SOL`);

    try {
      const client = this.getPumpFunClient();
      const mint = new PublicKey(tokenMint);
      const lamports = solToLamports(solAmount);

      const result = await client.buy({
        mint,
        solAmount: lamports,
        minTokensOut: 0n, // Will use default slippage
        slippageBps: 500, // 5% slippage
      });

      const tokensReceived = Number(result.tokenAmount) / 1e6;

      console.log(`[SolanaExecutor] pump.fun buy successful: ${result.signature}`);

      return {
        txHash: result.signature,
        tokensReceived,
      };
    } catch (error) {
      console.error('[SolanaExecutor] pump.fun buy failed:', error);
      throw error;
    }
  }

  /**
   * Sell via pump.fun bonding curve
   */
  private async sellViaPumpFun(
    tokenMint: string,
    tokenAmount: number
  ): Promise<{ txHash: string; solReceived: number }> {
    console.log(`[SolanaExecutor] Executing pump.fun sell of ${tokenAmount} tokens`);

    try {
      const client = this.getPumpFunClient();
      const mint = new PublicKey(tokenMint);
      const tokensRaw = BigInt(Math.floor(tokenAmount * 1e6));

      const result = await client.sell({
        mint,
        tokenAmount: tokensRaw,
        minSolOut: 0n, // Will use default slippage
        slippageBps: 500, // 5% slippage
      });

      const solReceived = lamportsToSol(result.solAmount);

      console.log(`[SolanaExecutor] pump.fun sell successful: ${result.signature}`);

      return {
        txHash: result.signature,
        solReceived,
      };
    } catch (error) {
      console.error('[SolanaExecutor] pump.fun sell failed:', error);
      throw error;
    }
  }

  /**
   * Buy via Jupiter aggregator
   * SECURITY: P0-1 - Now properly executes swap transaction instead of returning fake hash
   */
  private async buyViaJupiter(
    tokenMint: string,
    solAmount: number
  ): Promise<{ txHash: string; tokensReceived: number }> {
    console.log(`[SolanaExecutor] Getting Jupiter quote for ${solAmount} SOL`);

    try {
      // Get quote with 5% slippage
      const quote = await this.jupiterClient.quoteBuy(tokenMint, solAmount, 500);
      const expectedTokens = Number(quote.outAmount);

      console.log(`[SolanaExecutor] Jupiter quote: ${expectedTokens / 1e6} tokens (slippage: ${quote.slippageBps}bps)`);

      // Get the swap transaction from Jupiter
      const client = this.getPumpFunClient();
      const userPublicKey = client.getPublicKey().toBase58();
      const swapResponse = await this.jupiterClient.getSwapTransaction(quote, userPublicKey);

      // Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Get the wallet keypair for signing
      const privateKey = process.env.SOLANA_EXECUTOR_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('SOLANA_EXECUTOR_PRIVATE_KEY not set');
      }
      const { Keypair } = await import('@solana/web3.js');
      const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

      // Sign the transaction
      transaction.sign([wallet]);

      // Send the transaction
      const rawTransaction = transaction.serialize();
      const txHash = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        {
          signature: txHash,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight: swapResponse.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const tokensReceived = expectedTokens / 1e6; // Adjust decimals
      console.log(`[SolanaExecutor] Jupiter buy successful: ${txHash}`);

      return {
        txHash,
        tokensReceived,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Jupiter buy failed:', error);
      throw error;
    }
  }

  /**
   * Sell via Jupiter aggregator
   * SECURITY: P0-1 - Now properly executes swap transaction instead of returning fake hash
   */
  private async sellViaJupiter(
    tokenMint: string,
    tokenAmount: number
  ): Promise<{ txHash: string; solReceived: number }> {
    console.log(`[SolanaExecutor] Getting Jupiter quote for ${tokenAmount} tokens`);

    try {
      // Get quote with 5% slippage
      const quote = await this.jupiterClient.quoteSell(
        tokenMint,
        BigInt(Math.floor(tokenAmount * 1e6)),
        500
      );
      const expectedSol = lamportsToSol(BigInt(quote.outAmount));

      console.log(`[SolanaExecutor] Jupiter quote: ${expectedSol} SOL (slippage: ${quote.slippageBps}bps)`);

      // Get the swap transaction from Jupiter
      const client = this.getPumpFunClient();
      const userPublicKey = client.getPublicKey().toBase58();
      const swapResponse = await this.jupiterClient.getSwapTransaction(quote, userPublicKey);

      // Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Get the wallet keypair for signing
      const privateKey = process.env.SOLANA_EXECUTOR_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('SOLANA_EXECUTOR_PRIVATE_KEY not set');
      }
      const { Keypair } = await import('@solana/web3.js');
      const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));

      // Sign the transaction
      transaction.sign([wallet]);

      // Send the transaction
      const rawTransaction = transaction.serialize();
      const txHash = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        {
          signature: txHash,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight: swapResponse.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log(`[SolanaExecutor] Jupiter sell successful: ${txHash}`);

      return {
        txHash,
        solReceived: expectedSol,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Jupiter sell failed:', error);
      throw error;
    }
  }

  /**
   * Get bonding curve state for a pump.fun token
   */
  private async getBondingCurveState(
    tokenMint: string
  ): Promise<BondingCurveState | null> {
    try {
      const mint = new PublicKey(tokenMint);
      const [bondingCurvePDA] = deriveBondingCurvePDA(mint);

      const accountInfo = await this.connection.getAccountInfo(bondingCurvePDA);

      if (!accountInfo || accountInfo.data.length < 49) {
        // No bonding curve found - token likely graduated or doesn't exist
        return null;
      }

      return decodeBondingCurveState(Buffer.from(accountInfo.data));
    } catch (error) {
      console.error('[SolanaExecutor] Error getting bonding curve state:', error);
      return null;
    }
  }

  /**
   * Calculate bonding curve progress
   */
  private calculateProgress(state: BondingCurveState): number {
    const GRADUATION_THRESHOLD = 85; // ~85 SOL
    const currentSol = lamportsToSol(state.realSolReserves);
    return Math.min(100, (currentSol / GRADUATION_THRESHOLD) * 100);
  }
}

// Singleton instance
export const solanaExecutor = new SolanaExecutor();

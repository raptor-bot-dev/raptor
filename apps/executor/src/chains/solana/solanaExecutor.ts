// Solana Executor for RAPTOR v2
// Handles all Solana trades via SwapRouter abstraction (Phase 2)
//
// Phase 2: Refactored to use RouterFactory for venue-agnostic routing
// - BagsTradeRouter: PRE_GRADUATION tokens on Meteora bonding curve
// - JupiterRouter: POST_GRADUATION tokens and fallback
//
// L-1 NOTE: This file uses console.log for logging. For production, these should
// be migrated to the structured logger from @raptor/shared to ensure sensitive
// data (addresses, keys) is properly sanitized. The structured logger is imported
// below but migration of all log statements is deferred to avoid introducing
// regressions in the critical trading path.

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
  createLogger,
  type TradingMode,
  type Position,
  type BondingCurveState,
} from '@raptor/shared';

// v3.5: Import chain settings helpers
import {
  getSolanaSlippageBps,
  getSolanaPriorityFee,
  isAntiMevEnabled,
} from '../../security/tradeGuards.js';

// v3.5: Import Jito client
import { createJitoClient, type JitoClient } from './jitoClient.js';
import { createHeliusSender, type HeliusSender } from './heliusSender.js';

// L-1: Structured logger for sensitive operations
// TODO: Migrate remaining console.log statements to use this logger
const logger = createLogger('SolanaExecutor');

import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { JupiterClient, jupiter } from './jupiter.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';
import {
  RouterFactory,
  type SwapIntent,
  type LifecycleState,
} from '../../routers/index.js';
import {
  calculateBuyOutput,
  calculateSellOutput,
  decodeBondingCurveState,
  getCurrentPrice,
  hasGraduated,
  PumpFunClient,
  getPumpFunClient,
  deriveBondingCurvePDA,
  findBondingCurveAndProgram,  // AUDIT FIX: For pump.pro support
  getTokenProgramForMint,  // v4.6: Detect SPL vs Token-2022
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
  route?: string; // 'pump.fun' or 'Jupiter'
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
  private jitoClient: JitoClient | null = null;
  private heliusSender: HeliusSender | null = null;
  private running: boolean = false;

  // Phase 2: RouterFactory for venue-agnostic swap routing
  private routerFactory: RouterFactory;

  // H-1 fix: Default timeout for transaction confirmation (30 seconds)
  private static readonly TX_CONFIRM_TIMEOUT_MS = 30000;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
    this.wssUrl = SOLANA_CONFIG.wssUrl;
    this.jupiterClient = new JupiterClient();
    this.connection = new Connection(this.rpcUrl, 'confirmed');
    this.jitoClient = createJitoClient(this.connection);
    this.heliusSender = createHeliusSender(this.connection, process.env.HELIUS_API_KEY);

    // Phase 2: Initialize RouterFactory with Helius Sender (primary) + Jito (fallback)
    this.routerFactory = new RouterFactory({
      jupiter: {
        rpcUrl: this.rpcUrl,
        jitoClient: this.jitoClient || undefined,
      },
      bags: {
        rpcUrl: this.rpcUrl,
        jitoClient: this.jitoClient || undefined,
        heliusSender: this.heliusSender || undefined,
      },
    });
  }

  /**
   * Confirm transaction with explicit timeout
   *
   * SECURITY: H-1 fix - Prevents hanging indefinitely on network congestion.
   * The Solana confirmTransaction method can take up to ~2 minutes with blockhash
   * strategy. This wrapper ensures we fail fast and allow retry logic to handle it.
   *
   * @param signature - Transaction signature to confirm
   * @param blockhash - Recent blockhash used in transaction
   * @param lastValidBlockHeight - Block height after which tx is invalid
   * @param timeoutMs - Maximum time to wait (default: 30s)
   * @throws Error with 'TIMEOUT' if confirmation takes too long
   */
  private async confirmTransactionWithTimeout(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number,
    timeoutMs: number = SolanaExecutor.TX_CONFIRM_TIMEOUT_MS
  ): Promise<void> {
    const confirmPromise = this.connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Transaction confirmation timeout after ${timeoutMs}ms. Signature: ${signature.slice(0, 20)}...`));
      }, timeoutMs);
    });

    const confirmation = await Promise.race([confirmPromise, timeoutPromise]);

    if (confirmation.value.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
    }
  }

  /**
   * Get raw token balance for a wallet (in smallest units, no decimals applied)
   *
   * H-3: Used to verify actual swap output instead of relying on quote estimates.
   * This helps detect slippage differences between quoted and actual amounts.
   *
   * @param tokenMint - Token mint address
   * @param walletAddress - Wallet public key
   * @returns Token balance (in raw units) or 0 if no account
   */
  private async getTokenBalanceRaw(tokenMint: string, walletAddress: string): Promise<bigint> {
    try {
      const mint = new PublicKey(tokenMint);
      const wallet = new PublicKey(walletAddress);

      // v4.6 FIX: Detect token program (SPL vs Token-2022) for correct ATA derivation
      // pump.fun tokens use Token-2022, which has ATAs at different addresses than standard SPL
      const tokenProgramId = await getTokenProgramForMint(this.connection, mint);

      // Derive ATA using the correct token program
      const ata = await getAssociatedTokenAddress(
        mint,
        wallet,
        false,  // allowOwnerOffCurve
        tokenProgramId
      );

      console.log(`[SolanaExecutor] getTokenBalanceRaw: mint=${tokenMint}, wallet=${walletAddress}, tokenProgram=${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL'}, ata=${ata.toBase58()}`);

      const accountInfo = await this.connection.getTokenAccountBalance(ata);
      console.log(`[SolanaExecutor] Token balance: ${accountInfo.value.amount} (${accountInfo.value.uiAmountString})`);
      return BigInt(accountInfo.value.amount);
    } catch (error) {
      // Account may not exist yet (balance = 0)
      console.log(`[SolanaExecutor] getTokenBalanceRaw error (likely no ATA): ${error instanceof Error ? error.message : 'Unknown'}`);
      return BigInt(0);
    }
  }

  /**
   * Get SOL balance for a wallet
   * Used to calculate actual SOL spent in pump.fun buys
   */
  private async getSolBalance(walletAddress: string): Promise<bigint> {
    try {
      const wallet = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(wallet);
      return BigInt(balance);
    } catch (error) {
      console.error('[SolanaExecutor] Failed to get SOL balance:', error);
      return BigInt(0);
    }
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

    try {
      const response = await fetchWithTimeout(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth',
        }),
      }, 5000);

      const data = (await response.json()) as { result?: string };
      if (data.result === 'ok') {
        console.log('[SolanaExecutor] RPC connection healthy');
      } else {
        console.warn('[SolanaExecutor] RPC health check returned:', data);
      }
    } catch (error) {
      const errorName = (error as Error).name;
      if (errorName === 'AbortError') {
        console.error('[SolanaExecutor] RPC connection timeout');
      } else {
        console.error('[SolanaExecutor] Failed to connect to RPC:', error);
      }
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
   * Execute a buy order using internal EXECUTOR_KEYPAIR
   * Routes through pump.fun for tokens on bonding curve, Jupiter for graduated tokens
   *
   * @deprecated L-3: Use executeBuyWithKeypair() instead for better separation of concerns.
   * This method uses a shared internal keypair which is not suitable for multi-user scenarios.
   * Scheduled for removal in v4.0.
   */
  async executeBuy(
    _tokenMint: string,
    _solAmount: number,
    _tgId: number,
    _mode: TradingMode,
    _options?: {
      skipSafetyCheck?: boolean;
      takeProfitPercent?: number;
      stopLossPercent?: number;
      source?: string;
    }
  ): Promise<SolanaTradeResult> {
    // BAGS-only mode: deprecated pump.fun execution path removed.
    // Use executeBuyWithKeypair() via RouterFactory instead.
    throw new Error('BAGS-only mode: executeBuy() is disabled. Use executeBuyWithKeypair() via RouterFactory.');
  }

  /**
   * Execute buy with external keypair (for bot integration)
   * Phase 2: Routes via RouterFactory (BagsTradeRouter or JupiterRouter)
   *
   * v3.5: Added tgId option for fetching chain settings (slippage, anti-MEV)
   * Phase 2: Refactored to use RouterFactory for venue-agnostic routing
   *
   * @param tokenMint - Token to buy
   * @param solAmount - Amount in SOL (GROSS - before fee)
   * @param keypair - User's keypair (from bot)
   * @param options - Buy options
   * @returns Trade result WITHOUT database recording
   */
  async executeBuyWithKeypair(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      skipSafetyCheck?: boolean;
      slippageBps?: number;
      tgId?: number;           // v3.5: For chain settings lookup
      priorityFeeSol?: number; // v3.5: Override priority fee
      useJito?: boolean;       // v3.5: Override anti-MEV setting
      lifecycleState?: LifecycleState; // Phase 2: Explicit lifecycle state
      bondingCurve?: string;   // Phase 2: Bonding curve address for pre-graduation tokens
    }
  ): Promise<SolanaTradeResult> {
    console.log(
      `[SolanaExecutor] Buy ${solAmount} SOL of ${tokenMint} with external keypair`
    );

    try {
      // Apply 1% platform fee
      const { netAmount, fee } = applyBuyFeeDecimal(solAmount);

      // v3.5: Fetch chain settings if tgId provided
      let slippageBps = options?.slippageBps;
      let priorityFeeSol = options?.priorityFeeSol;
      let useJito = options?.useJito;

      if (options?.tgId) {
        // Get slippage from chain settings if not explicitly provided
        if (slippageBps === undefined) {
          slippageBps = await getSolanaSlippageBps(options.tgId, 'buy');
          console.log(`[SolanaExecutor] Using chain settings buy slippage: ${slippageBps} bps`);
        }

        // Get priority fee from chain settings if not explicitly provided
        if (priorityFeeSol === undefined) {
          priorityFeeSol = await getSolanaPriorityFee(options.tgId) ?? undefined;
          if (priorityFeeSol !== undefined) {
            console.log(`[SolanaExecutor] Using chain settings priority fee: ${priorityFeeSol} SOL`);
          }
        }

        // Check anti-MEV preference if not explicitly set
        if (useJito === undefined) {
          useJito = await isAntiMevEnabled(options.tgId, 'sol');
          console.log(`[SolanaExecutor] Anti-MEV (Jito) enabled: ${useJito}`);
        }
      }

      // Default slippage if still not set
      slippageBps = slippageBps ?? 1000; // 10%

      console.log('[SolanaExecutor] Fee breakdown', {
        gross: solAmount,
        fee,
        net: netAmount,
        slippageBps,
        priorityFeeSol,
        useJito,
      });

      // Phase 2: Use RouterFactory for venue-agnostic routing
      const swapResult = await this.routerFactory.executeBuy(
        tokenMint,
        netAmount,
        keypair,
        {
          slippageBps,
          lifecycleState: options?.lifecycleState,
          bondingCurve: options?.bondingCurve,
          useJito: useJito && this.jitoClient !== null,
          priorityFeeSol,
          executionId: `buy-${tokenMint.slice(0, 8)}-${Date.now()}`,
        }
      );

      if (!swapResult.success) {
        throw new Error(swapResult.error || 'Swap execution failed');
      }

      // Phase 2: Extract results from RouterFactory response
      const route = swapResult.router
        ? (useJito ? `${swapResult.router} (Jito)` : swapResult.router)
        : 'unknown';

      // Calculate tokens received from quote
      const tokensReceived = swapResult.quote?.expectedOutput
        ? Number(swapResult.quote.expectedOutput)
        : 0;

      // Calculate price from quote or actualOutput
      const actualSolSpent = swapResult.quote
        ? lamportsToSol(swapResult.quote.inputAmount)
        : netAmount;
      const price = tokensReceived > 0 ? actualSolSpent / tokensReceived : 0;

      console.log('[SolanaExecutor] Buy successful', {
        txHash: swapResult.signature,
        tokensReceived,
        actualSolSpent,
        requestedAmount: netAmount,
        price,
        route,
      });

      // NO recordTrade() - let bot handle DB
      // NO createPosition() - let bot handle DB

      return {
        success: true,
        txHash: swapResult.signature,
        amountIn: actualSolSpent,
        amountOut: tokensReceived,
        fee,
        price,
        route,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Buy failed', error);
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
   * Execute a sell order using internal EXECUTOR_KEYPAIR
   *
   * @deprecated L-3: Use executeSellWithKeypair() instead for better separation of concerns.
   * This method uses a shared internal keypair which is not suitable for multi-user scenarios.
   * Scheduled for removal in v4.0.
   */
  async executeSell(
    _tokenMint: string,
    _tokenAmount: number,
    _tgId: number,
    _mode: TradingMode,
    _position?: Position
  ): Promise<SolanaTradeResult> {
    // BAGS-only mode: deprecated pump.fun execution path removed.
    // Use executeSellWithKeypair() via RouterFactory instead.
    throw new Error('BAGS-only mode: executeSell() is disabled. Use executeSellWithKeypair() via RouterFactory.');
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

      // Wait for confirmation with timeout (H-1 fix)
      await this.confirmTransactionWithTimeout(
        txHash,
        transaction.message.recentBlockhash,
        swapResponse.lastValidBlockHeight
      );

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

      // Wait for confirmation with timeout (H-1 fix)
      await this.confirmTransactionWithTimeout(
        txHash,
        transaction.message.recentBlockhash,
        swapResponse.lastValidBlockHeight
      );

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
   * Buy via pump.fun bonding curve with external keypair
   *
   * v3.5: Added Jito bundle support for MEV protection
   * v4.5: Fixed to return actual SOL spent (from balance change) instead of requested amount
   */
  private async buyViaPumpFunWithKeypair(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
    }
  ): Promise<{ txHash: string; tokensReceived: bigint; actualSolSpent: number }> {
    console.log(`[SolanaExecutor] Executing pump.fun buy of ${solAmount} SOL with external keypair`);

    try {
      // Create a PumpFunClient with the external keypair
      const { PumpFunClient } = await import('./pumpFun.js');
      const client = new PumpFunClient(keypair);

      const mint = new PublicKey(tokenMint);
      const lamports = solToLamports(solAmount);
      const slippageBps = options?.slippageBps || 500; // Default 5% slippage

      // v4.5: Get SOL balance BEFORE buy to calculate actual spend
      const walletAddress = keypair.publicKey.toBase58();
      const balanceBefore = await this.getSolBalance(walletAddress);

      // v3.5: For pump.fun, Jito integration would require modifying the PumpFunClient
      // to return unsigned transactions. For now, pump.fun sends directly.
      const result = await client.buy({
        mint,
        solAmount: lamports,
        minTokensOut: 0n, // Will use slippageBps to calculate
        slippageBps,
        priorityFeeSol: options?.priorityFeeSol,
      });

      // v4.5: Get SOL balance AFTER buy to calculate actual spend
      // Small delay to ensure balance is updated after confirmation
      await new Promise(resolve => setTimeout(resolve, 500));
      const balanceAfter = await this.getSolBalance(walletAddress);
      const actualSolSpent = lamportsToSol(balanceBefore - balanceAfter);

      console.log(`[SolanaExecutor] pump.fun buy successful: ${result.signature}`);
      console.log(`[SolanaExecutor] Actual SOL spent: ${actualSolSpent} (requested: ${solAmount})`);

      return {
        txHash: result.signature,
        tokensReceived: result.tokenAmount,
        actualSolSpent,
      };
    } catch (error) {
      console.error('[SolanaExecutor] pump.fun buy with keypair failed:', error);
      throw error;
    }
  }

  /**
   * Buy via Jupiter aggregator with external keypair
   *
   * H-3: Now verifies actual tokens received by checking balance before/after swap.
   * This ensures accurate reporting even when slippage differs from quote.
   *
   * v3.5: Added Jito bundle support and priority fee options
   */
  private async buyViaJupiterWithKeypair(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
    }
  ): Promise<{ txHash: string; tokensReceived: bigint }> {
    console.log(`[SolanaExecutor] Getting Jupiter quote for ${solAmount} SOL with external keypair`);

    try {
      const slippageBps = options?.slippageBps || 500; // Default 5% slippage
      const userPublicKey = keypair.publicKey.toBase58();

      // H-3: Get balance before swap for accurate output verification
      const balanceBefore = await this.getTokenBalanceRaw(tokenMint, userPublicKey);

      // Get quote
      const quote = await this.jupiterClient.quoteBuy(tokenMint, solAmount, slippageBps);
      const expectedTokens = BigInt(quote.outAmount);

      console.log(`[SolanaExecutor] Jupiter quote: ${Number(expectedTokens) / 1e6} tokens (slippage: ${quote.slippageBps}bps)`);

      // Get the swap transaction from Jupiter
      const swapResponse = await this.jupiterClient.getSwapTransaction(quote, userPublicKey);

      // Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Sign the transaction with external keypair
      transaction.sign([keypair]);

      let txHash: string;

      // v3.5: Send via Jito if enabled for MEV protection
      if (options?.useJito && this.jitoClient) {
        console.log('[SolanaExecutor] Sending via Jito for MEV protection');
        const jitoResult = await this.jitoClient.sendTransaction(transaction, keypair, {
          priorityFeeSol: options.priorityFeeSol,
        });

        if (!jitoResult.success) {
          throw new Error(`Jito bundle failed: ${jitoResult.error}`);
        }

        // Get the signature from the main transaction
        const sig = transaction.signatures[0];
        txHash = sig ? Buffer.from(sig).toString('base64') : jitoResult.bundleId || '';

        // Wait for Jito bundle confirmation
        if (jitoResult.bundleId && jitoResult.signatures?.[0]) {
          const confirmed = await this.jitoClient.waitForBundleConfirmation(
            jitoResult.bundleId,
            jitoResult.signatures[0],
            SolanaExecutor.TX_CONFIRM_TIMEOUT_MS
          );
          if (!confirmed) {
            console.warn('[SolanaExecutor] Jito bundle confirmation timeout, checking RPC...');
          }
        }
      } else {
        // Send via standard RPC
        const rawTransaction = transaction.serialize();
        txHash = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });

        console.log(`[SolanaExecutor] Transaction sent: ${txHash}`);

        // Wait for confirmation with timeout (H-1 fix)
        await this.confirmTransactionWithTimeout(
          txHash,
          transaction.message.recentBlockhash,
          swapResponse.lastValidBlockHeight
        );
      }

      // H-3: Verify actual tokens received
      const balanceAfter = await this.getTokenBalanceRaw(tokenMint, userPublicKey);
      const actualTokensReceived = balanceAfter - balanceBefore;

      // Log if slippage was significant
      const slippageDiff = Number(expectedTokens - actualTokensReceived);
      if (slippageDiff > 0) {
        const slippagePercent = (slippageDiff / Number(expectedTokens)) * 100;
        console.log(`[SolanaExecutor] Actual slippage: ${slippagePercent.toFixed(2)}% (expected: ${expectedTokens}, actual: ${actualTokensReceived})`);
      }

      console.log(`[SolanaExecutor] Jupiter buy successful: ${txHash}, tokens received: ${actualTokensReceived}`);

      return {
        txHash,
        tokensReceived: actualTokensReceived > 0 ? actualTokensReceived : expectedTokens, // Fallback to expected if balance check fails
      };
    } catch (error) {
      console.error('[SolanaExecutor] Jupiter buy with keypair failed:', error);
      throw error;
    }
  }

  /**
   * Execute sell with external keypair (for bot/hunter integration)
   * Phase 2: Routes via RouterFactory (BagsTradeRouter or JupiterRouter)
   *
   * v3.5: Added tgId option for fetching chain settings (slippage, anti-MEV)
   * v4.6: DECIMALS FIX - Now fetches fresh balance from chain and accepts sellPercent
   *       This eliminates decimals bugs by using authoritative on-chain data.
   * Phase 2: Refactored to use RouterFactory for venue-agnostic routing
   *
   * @param tokenMint - Token to sell
   * @param tokenAmount - DEPRECATED: Use sellPercent option instead. If sellPercent is provided, this is ignored.
   * @param keypair - User's keypair (from bot/hunter)
   * @param options - Sell options
   * @returns Trade result WITHOUT database recording
   */
  async executeSellWithKeypair(
    tokenMint: string,
    tokenAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      tgId?: number;           // v3.5: For chain settings lookup
      priorityFeeSol?: number; // v3.5: Override priority fee
      useJito?: boolean;       // v3.5: Override anti-MEV setting
      sellPercent?: number;    // v4.6: Sell percentage (1-100). If provided, ignores tokenAmount and fetches fresh balance.
      lifecycleState?: LifecycleState; // Phase 2: Explicit lifecycle state
      bondingCurve?: string;   // Phase 2: Bonding curve address for pre-graduation tokens
      positionId?: string;     // Phase 2: Position ID for tracking
    }
  ): Promise<SolanaTradeResult> {
    console.log(
      `[SolanaExecutor] Sell ${options?.sellPercent ? `${options.sellPercent}%` : tokenAmount + ' tokens'} of ${tokenMint} with external keypair`
    );

    try {
      // v3.5: Fetch chain settings if tgId provided
      let slippageBps = options?.slippageBps;
      let priorityFeeSol = options?.priorityFeeSol;
      let useJito = options?.useJito;

      if (options?.tgId) {
        // Get slippage from chain settings if not explicitly provided
        if (slippageBps === undefined) {
          slippageBps = await getSolanaSlippageBps(options.tgId, 'sell');
          console.log(`[SolanaExecutor] Using chain settings sell slippage: ${slippageBps} bps`);
        }

        // Get priority fee from chain settings if not explicitly provided
        if (priorityFeeSol === undefined) {
          priorityFeeSol = await getSolanaPriorityFee(options.tgId) ?? undefined;
          if (priorityFeeSol !== undefined) {
            console.log(`[SolanaExecutor] Using chain settings priority fee: ${priorityFeeSol} SOL`);
          }
        }

        // Check anti-MEV preference if not explicitly set
        if (useJito === undefined) {
          useJito = await isAntiMevEnabled(options.tgId, 'sol');
          console.log(`[SolanaExecutor] Anti-MEV (Jito) enabled: ${useJito}`);
        }
      }

      // Default slippage if still not set
      slippageBps = slippageBps ?? 800; // 8%

      // v4.6 DECIMALS FIX: Fetch fresh balance from chain and compute raw sell amount
      // This eliminates decimals bugs by using authoritative on-chain data
      let sellAmountRaw: bigint;
      let balanceRaw: bigint;
      let decimals: number;
      const walletAddress = keypair.publicKey.toBase58();

      if (options?.sellPercent !== undefined) {
        // Fetch fresh balance from chain (authoritative source)
        balanceRaw = await this.getTokenBalanceRaw(tokenMint, walletAddress);
        decimals = await this.getTokenDecimals(tokenMint);

        if (balanceRaw <= 0n) {
          throw new Error(`PREFLIGHT_ZERO_BALANCE: No tokens to sell. Wallet: ${walletAddress}, Mint: ${tokenMint}`);
        }

        // Calculate sell amount from percentage
        const percent = Math.min(100, Math.max(1, options.sellPercent));
        sellAmountRaw = (balanceRaw * BigInt(percent)) / 100n;

        // Dust protection: if selling >95%, sell everything to avoid dust
        if (percent >= 95 && sellAmountRaw < balanceRaw) {
          sellAmountRaw = balanceRaw;
        }

        console.log(`[SolanaExecutor] v4.6 DECIMALS FIX: Fetched fresh balance from chain`, {
          balanceRaw: balanceRaw.toString(),
          sellPercent: percent,
          sellAmountRaw: sellAmountRaw.toString(),
          decimals,
        });
      } else {
        // Legacy path: tokenAmount provided directly (for backward compatibility)
        // WARNING: This path is deprecated and may have decimals issues
        decimals = await this.getTokenDecimals(tokenMint);
        balanceRaw = await this.getTokenBalanceRaw(tokenMint, walletAddress);

        // Assume tokenAmount is decimal-adjusted, convert to raw
        sellAmountRaw = BigInt(Math.floor(tokenAmount * Math.pow(10, decimals)));

        console.warn(`[SolanaExecutor] Using legacy tokenAmount path (deprecated). Consider using sellPercent option.`);
      }

      // PREFLIGHT CHECK: Ensure we're not trying to sell more than we have
      if (sellAmountRaw > balanceRaw) {
        throw new Error(
          `PREFLIGHT_BALANCE_ERROR: Requested ${sellAmountRaw} but only ${balanceRaw} available. ` +
          `Mint: ${tokenMint}, Decimals: ${decimals}, Wallet: ${walletAddress}`
        );
      }

      if (sellAmountRaw <= 0n) {
        throw new Error(`PREFLIGHT_ZERO_AMOUNT: Calculated sell amount is zero or negative.`);
      }

      // For return value, calculate decimal-adjusted amount
      const tokenAmountForReturn = Number(sellAmountRaw) / Math.pow(10, decimals);

      // Phase 2: Use RouterFactory for venue-agnostic routing
      const swapResult = await this.routerFactory.executeSell(
        tokenMint,
        sellAmountRaw,
        keypair,
        {
          slippageBps,
          lifecycleState: options?.lifecycleState,
          bondingCurve: options?.bondingCurve,
          useJito: useJito && this.jitoClient !== null,
          priorityFeeSol,
          positionId: options?.positionId,
          executionId: `sell-${tokenMint.slice(0, 8)}-${Date.now()}`,
        }
      );

      if (!swapResult.success) {
        throw new Error(swapResult.error || 'Swap execution failed');
      }

      // Phase 2: Extract results from RouterFactory response
      const route = swapResult.router
        ? (useJito ? `${swapResult.router} (Jito)` : swapResult.router)
        : 'unknown';

      // Calculate SOL received from quote
      const solReceived = swapResult.quote?.expectedOutput
        ? lamportsToSol(swapResult.quote.expectedOutput)
        : 0;

      // Calculate price
      const price = tokenAmountForReturn > 0 ? solReceived / tokenAmountForReturn : 0;

      console.log('[SolanaExecutor] Sell successful', {
        txHash: swapResult.signature,
        solReceivedSOL: solReceived,
        sellAmountRaw: sellAmountRaw.toString(),
        tokenAmountDecimalAdjusted: tokenAmountForReturn,
        price,
        route,
      });

      // NO recordTrade() - let caller handle DB
      return {
        success: true,
        txHash: swapResult.signature,
        amountIn: tokenAmountForReturn,  // v4.6: Return decimal-adjusted amount
        amountOut: solReceived,
        fee: 0, // Fee calculated by caller
        price,
        route,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Sell failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        amountIn: tokenAmount,  // Return original tokenAmount for backward compatibility
        amountOut: 0,
        fee: 0,
        price: 0,
      };
    }
  }

  /**
   * v4.6: Sell via pump.fun/pump.pro bonding curve with RAW token amount (BigInt)
   * This method accepts raw token amount directly, avoiding decimals conversion bugs.
   */
  private async sellViaPumpFunWithKeypairRaw(
    tokenMint: string,
    tokensRaw: bigint,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
      programId?: PublicKey;
    }
  ): Promise<{ txHash: string; solReceived: bigint }> {
    const programName = options?.programId?.toBase58().startsWith('pro') ? 'pump.pro' : 'pump.fun';
    console.log(`[SolanaExecutor] v4.6 RAW: Executing ${programName} sell of ${tokensRaw} raw tokens with external keypair`);

    try {
      const mint = new PublicKey(tokenMint);

      // Detect program if not provided
      let programId = options?.programId;
      if (!programId) {
        const bondingCurveInfo = await findBondingCurveAndProgram(this.connection, mint);
        if (bondingCurveInfo) {
          programId = bondingCurveInfo.programId;
          console.log(`[SolanaExecutor] Auto-detected program: ${programId.toBase58()}`);
        }
      }

      // Create a PumpFunClient with the external keypair
      const { PumpFunClient } = await import('./pumpFun.js');
      const client = new PumpFunClient(keypair);

      const slippageBps = options?.slippageBps || 500; // Default 5% slippage

      const result = await client.sell({
        mint,
        tokenAmount: tokensRaw,  // Pass raw BigInt directly - NO conversion needed!
        minSolOut: 0n,
        slippageBps,
        priorityFeeSol: options?.priorityFeeSol,
        programId,
      });

      console.log(`[SolanaExecutor] ${programName} sell successful: ${result.signature}`);

      return {
        txHash: result.signature,
        solReceived: result.solAmount,
      };
    } catch (error) {
      console.error(`[SolanaExecutor] ${programName} sell with keypair failed:`, error);
      throw error;
    }
  }

  /**
   * v4.6: Sell via Jupiter with RAW token amount (BigInt)
   * This method accepts raw token amount directly, avoiding decimals conversion bugs.
   */
  private async sellViaJupiterWithKeypairRaw(
    tokenMint: string,
    tokensRaw: bigint,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
    }
  ): Promise<{ txHash: string; solReceived: bigint }> {
    console.log(`[SolanaExecutor] v4.6 RAW: Getting Jupiter sell quote for ${tokensRaw} raw tokens with external keypair`);

    try {
      const slippageBps = options?.slippageBps || 500; // Default 5% slippage

      // Pass raw BigInt directly to Jupiter - NO conversion needed!
      const quote = await this.jupiterClient.quoteSell(tokenMint, tokensRaw, slippageBps);
      const expectedSol = BigInt(quote.outAmount);

      console.log(`[SolanaExecutor] Jupiter quote: ${lamportsToSol(expectedSol)} SOL (slippage: ${quote.slippageBps}bps)`);

      // Get the swap transaction from Jupiter
      const userPublicKey = keypair.publicKey.toBase58();
      const swapResponse = await this.jupiterClient.getSwapTransaction(quote, userPublicKey);

      // Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Sign the transaction with external keypair
      transaction.sign([keypair]);

      let txHash: string;

      // Send via Jito if enabled for MEV protection
      if (options?.useJito && this.jitoClient) {
        console.log('[SolanaExecutor] Sending sell via Jito for MEV protection');
        const jitoResult = await this.jitoClient.sendTransaction(transaction, keypair, {
          priorityFeeSol: options.priorityFeeSol,
        });

        if (!jitoResult.success) {
          throw new Error(`Jito bundle failed: ${jitoResult.error}`);
        }

        const sig = transaction.signatures[0];
        txHash = sig ? Buffer.from(sig).toString('base64') : jitoResult.bundleId || '';

        if (jitoResult.bundleId && jitoResult.signatures?.[0]) {
          const confirmed = await this.jitoClient.waitForBundleConfirmation(
            jitoResult.bundleId,
            jitoResult.signatures[0],
            SolanaExecutor.TX_CONFIRM_TIMEOUT_MS
          );
          if (!confirmed) {
            console.warn('[SolanaExecutor] Jito bundle confirmation timeout, checking RPC...');
          }
        }
      } else {
        // Send via standard RPC
        console.log('[SolanaExecutor] Sending sell via standard RPC');
        const rawTransaction = transaction.serialize();
        txHash = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });

        console.log(`[SolanaExecutor] Transaction sent: ${txHash}`);

        // Wait for confirmation with timeout
        await this.confirmTransactionWithTimeout(
          txHash,
          transaction.message.recentBlockhash,
          swapResponse.lastValidBlockHeight
        );
      }

      console.log(`[SolanaExecutor] Jupiter sell successful: ${txHash}`);

      return {
        txHash,
        solReceived: expectedSol,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Jupiter sell with keypair failed:', error);
      throw error;
    }
  }

  /**
   * Sell via pump.fun/pump.pro bonding curve with external keypair
   * DEPRECATED: Use sellViaPumpFunWithKeypairRaw instead
   *
   * v3.5: Added options interface update for consistency
   * AUDIT FIX: Added programId support for pump.pro tokens
   */
  private async sellViaPumpFunWithKeypair(
    tokenMint: string,
    tokenAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
      programId?: PublicKey;  // AUDIT FIX: Program ID for pump.pro support
    }
  ): Promise<{ txHash: string; solReceived: bigint }> {
    const programName = options?.programId?.toBase58().startsWith('pro') ? 'pump.pro' : 'pump.fun';
    console.log(`[SolanaExecutor] Executing ${programName} sell of ${tokenAmount} tokens with external keypair`);

    try {
      const mint = new PublicKey(tokenMint);

      // AUDIT FIX: Detect program if not provided
      let programId = options?.programId;
      if (!programId) {
        const bondingCurveInfo = await findBondingCurveAndProgram(this.connection, mint);
        if (bondingCurveInfo) {
          programId = bondingCurveInfo.programId;
          console.log(`[SolanaExecutor] Auto-detected program: ${programId.toBase58()}`);
        }
      }

      // Create a PumpFunClient with the external keypair
      const { PumpFunClient } = await import('./pumpFun.js');
      const client = new PumpFunClient(keypair);

      // P0-2 FIX: Get actual token decimals instead of assuming 6
      const decimals = await this.getTokenDecimals(tokenMint);
      const tokensRaw = BigInt(Math.floor(tokenAmount * Math.pow(10, decimals)));

      const slippageBps = options?.slippageBps || 500; // Default 5% slippage

      // v3.5: pump.fun sends directly, no Jito integration at this level
      // AUDIT FIX: Pass programId to sell method for pump.pro support
      const result = await client.sell({
        mint,
        tokenAmount: tokensRaw,
        minSolOut: 0n, // Will use slippageBps to calculate
        slippageBps,
        priorityFeeSol: options?.priorityFeeSol,
        programId,  // AUDIT FIX: Pass program ID
      });

      console.log(`[SolanaExecutor] ${programName} sell successful: ${result.signature}`);

      return {
        txHash: result.signature,
        solReceived: result.solAmount,
      };
    } catch (error) {
      console.error(`[SolanaExecutor] ${programName} sell with keypair failed:`, error);
      throw error;
    }
  }

  /**
   * Sell via Jupiter aggregator with external keypair
   *
   * v3.5: Added Jito bundle support for MEV protection
   */
  private async sellViaJupiterWithKeypair(
    tokenMint: string,
    tokenAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFeeSol?: number;
      useJito?: boolean;
    }
  ): Promise<{ txHash: string; solReceived: bigint }> {
    console.log(`[SolanaExecutor] Getting Jupiter sell quote for ${tokenAmount} tokens with external keypair`);

    try {
      const slippageBps = options?.slippageBps || 500; // Default 5% slippage

      // P0-2 FIX: Get actual token decimals instead of assuming 6
      const decimals = await this.getTokenDecimals(tokenMint);
      const tokensRaw = BigInt(Math.floor(tokenAmount * Math.pow(10, decimals)));

      // Get quote
      const quote = await this.jupiterClient.quoteSell(tokenMint, tokensRaw, slippageBps);
      const expectedSol = BigInt(quote.outAmount);

      console.log(`[SolanaExecutor] Jupiter quote: ${lamportsToSol(expectedSol)} SOL (slippage: ${quote.slippageBps}bps)`);

      // Get the swap transaction from Jupiter
      const userPublicKey = keypair.publicKey.toBase58();
      const swapResponse = await this.jupiterClient.getSwapTransaction(quote, userPublicKey);

      // Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Sign the transaction with external keypair
      transaction.sign([keypair]);

      let txHash: string;

      // v3.5: Send via Jito if enabled for MEV protection
      if (options?.useJito && this.jitoClient) {
        console.log('[SolanaExecutor] Sending sell via Jito for MEV protection');
        const jitoResult = await this.jitoClient.sendTransaction(transaction, keypair, {
          priorityFeeSol: options.priorityFeeSol,
        });

        if (!jitoResult.success) {
          throw new Error(`Jito bundle failed: ${jitoResult.error}`);
        }

        // Get the signature from the main transaction
        const sig = transaction.signatures[0];
        txHash = sig ? Buffer.from(sig).toString('base64') : jitoResult.bundleId || '';

        // Wait for Jito bundle confirmation
        if (jitoResult.bundleId && jitoResult.signatures?.[0]) {
          const confirmed = await this.jitoClient.waitForBundleConfirmation(
            jitoResult.bundleId,
            jitoResult.signatures[0],
            SolanaExecutor.TX_CONFIRM_TIMEOUT_MS
          );
          if (!confirmed) {
            console.warn('[SolanaExecutor] Jito bundle confirmation timeout, checking RPC...');
          }
        }
      } else {
        // Send via standard RPC
        const rawTransaction = transaction.serialize();
        txHash = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });

        console.log(`[SolanaExecutor] Transaction sent: ${txHash}`);

        // Wait for confirmation with timeout (H-1 fix)
        await this.confirmTransactionWithTimeout(
          txHash,
          transaction.message.recentBlockhash,
          swapResponse.lastValidBlockHeight
        );
      }

      console.log(`[SolanaExecutor] Jupiter sell successful: ${txHash}`);

      return {
        txHash,
        solReceived: expectedSol,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Jupiter sell with keypair failed:', error);
      throw error;
    }
  }

  /**
   * Get bonding curve state for a pump.fun token (legacy - pump.fun only)
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
   * AUDIT FIX: Get bonding curve state with program detection
   * Checks both pump.fun and pump.pro programs to find active bonding curve
   *
   * @returns State and program ID if found, null if token has graduated or doesn't exist
   */
  private async getBondingCurveStateWithProgram(
    tokenMint: string
  ): Promise<{
    state: BondingCurveState;
    programId: PublicKey;
    bondingCurve: PublicKey;
  } | null> {
    try {
      const mint = new PublicKey(tokenMint);

      // Use the new findBondingCurveAndProgram to check both programs
      const result = await findBondingCurveAndProgram(this.connection, mint);

      if (!result) {
        // No bonding curve found on either program - token graduated or doesn't exist
        return null;
      }

      // Fetch and decode the bonding curve state
      const accountInfo = await this.connection.getAccountInfo(result.bondingCurve);

      if (!accountInfo || accountInfo.data.length < 49) {
        return null;
      }

      const state = decodeBondingCurveState(Buffer.from(accountInfo.data));

      return {
        state,
        programId: result.programId,
        bondingCurve: result.bondingCurve,
      };
    } catch (error) {
      console.error('[SolanaExecutor] Error getting bonding curve state with program:', error);
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

  /**
   * P0-2 FIX: Get token decimals from on-chain mint info
   * Returns actual decimals instead of assuming 6
   */
  async getTokenDecimals(tokenMint: string): Promise<number> {
    try {
      const mint = new PublicKey(tokenMint);

      // Try standard SPL Token program first
      try {
        const mintInfo = await getMint(this.connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
        return mintInfo.decimals;
      } catch {
        // Try Token-2022 program
        try {
          const mintInfo = await getMint(this.connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
          return mintInfo.decimals;
        } catch {
          // Default to 6 decimals (most common for pump.fun tokens)
          console.warn(`[SolanaExecutor] Could not fetch decimals for ${tokenMint}, defaulting to 6`);
          return 6;
        }
      }
    } catch (error) {
      console.error('[SolanaExecutor] Error getting token decimals:', error);
      return 6; // Default fallback
    }
  }

  /**
   * P0-3 FIX: Detect which token program owns the mint
   * Returns TOKEN_2022_PROGRAM_ID for pump.fun tokens, TOKEN_PROGRAM_ID otherwise
   */
  private async getTokenProgramId(mint: PublicKey): Promise<PublicKey> {
    try {
      const accountInfo = await this.connection.getAccountInfo(mint);
      if (accountInfo) {
        // Check if owner is Token-2022 program
        if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          return TOKEN_2022_PROGRAM_ID;
        }
      }
      return TOKEN_PROGRAM_ID;
    } catch {
      // Default to standard SPL Token program
      return TOKEN_PROGRAM_ID;
    }
  }

  /**
   * Get token balance for a given wallet and mint
   * Used by Trade Monitor to display current holdings
   * P0-3 FIX: Now handles both SPL Token and Token-2022 programs
   */
  async getTokenBalance(
    tokenMint: string,
    walletAddress?: string
  ): Promise<number | null> {
    try {
      const mint = new PublicKey(tokenMint);
      let owner: PublicKey;

      if (walletAddress) {
        owner = new PublicKey(walletAddress);
      } else {
        // Use executor wallet if no address provided
        const privateKey = process.env.SOLANA_EXECUTOR_PRIVATE_KEY;
        if (!privateKey) {
          console.warn('[SolanaExecutor] No wallet address provided and SOLANA_EXECUTOR_PRIVATE_KEY not set');
          return null;
        }
        const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
        owner = wallet.publicKey;
      }

      // P0-3 FIX: Detect correct token program for ATA derivation
      const tokenProgramId = await this.getTokenProgramId(mint);

      // Derive the Associated Token Account (ATA) with correct program
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false, // allowOwnerOffCurve
        tokenProgramId
      );

      // Try to get the token account balance
      try {
        const balance = await this.connection.getTokenAccountBalance(ata);
        const amount = parseFloat(balance.value.amount) / Math.pow(10, balance.value.decimals);
        return amount;
      } catch {
        // Token account doesn't exist - no balance
        return 0;
      }
    } catch (error) {
      console.error('[SolanaExecutor] Error getting token balance:', error);
      return null;
    }
  }

  /**
   * Get token balance for a keypair
   * Used by Bot with user's self-custodial wallet
   */
  async getTokenBalanceForKeypair(
    tokenMint: string,
    keypair: Keypair
  ): Promise<number | null> {
    return this.getTokenBalance(tokenMint, keypair.publicKey.toBase58());
  }

  /**
   * Get Jupiter client for external use (e.g., Trade Monitor)
   */
  get jupiter(): JupiterClient {
    return this.jupiterClient;
  }

  /**
   * Get the RPC connection for external use
   */
  getConnection(): Connection {
    return this.connection;
  }
}

// Singleton instance
export const solanaExecutor = new SolanaExecutor();

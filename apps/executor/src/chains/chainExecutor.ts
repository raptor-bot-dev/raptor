import { ethers, Wallet, Contract, TransactionReceipt } from 'ethers';
import type { ChainConfig, Opportunity, Position, TradingMode, EVMChain } from '@raptor/shared';
import {
  createPosition,
  recordTrade,
  closePosition,
  recordFee,
  DEFAULT_TAKE_PROFIT,
  DEFAULT_STOP_LOSS,
  applyBuyFee,
  applySellFee,
  getFeeWallet,
} from '@raptor/shared';
import { TokenAnalyzer } from '../analyzers/tokenAnalyzer.js';
import { calculatePositionSize } from '../scoring/scorer.js';
import { PrivateRpcClient, createPrivateRpcClient } from '../rpc/privateRpc.js';
// v2.3.1 Security imports
import {
  getSlippage,
  getSlippageAsync,
  isAntiMevEnabled,
  getUserGasPrice,
  calculateMinOutput,
  reentrancyGuard,
  simulateTransaction,
  validateSwapParams,
} from '../security/tradeGuards.js';

// SECURITY: P1-3 - Confirmation requirements per chain
// Higher confirmation counts for chains with faster block times or reorg risk
const CONFIRMATION_REQUIREMENTS: Record<string, { confirmations: number; timeout: number }> = {
  bsc: { confirmations: 3, timeout: 90000 },    // BSC: 3 confirmations, 90s timeout
  base: { confirmations: 3, timeout: 60000 },   // Base: 3 confirmations, 60s timeout
  eth: { confirmations: 12, timeout: 300000 },  // ETH: 12 confirmations, 5min timeout (slow blocks)
};

function getConfirmationConfig(chainName: string): { confirmations: number; timeout: number } {
  const name = chainName.toLowerCase();
  return CONFIRMATION_REQUIREMENTS[name] || CONFIRMATION_REQUIREMENTS.bsc;
}

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export class ChainExecutor {
  private config: ChainConfig;
  private provider: ethers.JsonRpcProvider;
  private wsProvider: ethers.WebSocketProvider | null = null;
  private wallet: Wallet;
  private analyzer: TokenAnalyzer;
  private router: Contract;
  private running = false;
  private privateRpc: PrivateRpcClient;

  constructor(config: ChainConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(process.env.EXECUTOR_PRIVATE_KEY!, this.provider);
    this.analyzer = new TokenAnalyzer(this.provider, config);
    this.router = new Contract(config.dexes[0].router, ROUTER_ABI, this.wallet);
    this.privateRpc = createPrivateRpcClient(config, this.provider, this.wallet);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.config.name}] Executor started`);

    // Log private RPC status
    if (this.privateRpc.isEnabled()) {
      console.log(`[${this.config.name}] Private RPC enabled (${this.config.privateRpc?.type})`);
    } else {
      console.log(`[${this.config.name}] Private RPC disabled - using public mempool`);
    }

    // Connect WebSocket if available
    if (this.config.wssUrl) {
      try {
        this.wsProvider = new ethers.WebSocketProvider(this.config.wssUrl);
        console.log(`[${this.config.name}] WebSocket connected`);
      } catch (error) {
        console.warn(`[${this.config.name}] WebSocket connection failed, using HTTP`);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.wsProvider) {
      await this.wsProvider.destroy();
    }
    console.log(`[${this.config.name}] Executor stopped`);
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getWsProvider(): ethers.WebSocketProvider | null {
    return this.wsProvider;
  }

  getConfig(): ChainConfig {
    return this.config;
  }

  async processOpportunity(
    opportunity: Opportunity,
    userAllocations: Map<number, bigint>
  ): Promise<void> {
    if (!this.running) return;

    console.log(
      `[${this.config.name}] Processing: ${opportunity.symbol} (Score: ${opportunity.score})`
    );

    // Analyze token
    const analysis = await this.analyzer.analyze(opportunity.token);

    if (!analysis.safe) {
      console.log(
        `[${this.config.name}] Token failed safety check: ${analysis.reason}`
      );
      return;
    }

    // Execute for each user with allocation
    for (const [tgId, allocation] of userAllocations) {
      const positionSize = calculatePositionSize(
        allocation,
        analysis.liquidity,
        this.config
      );

      if (positionSize === 0n) continue;

      try {
        await this.executeBuy(
          opportunity.token,
          opportunity.symbol,
          positionSize,
          tgId,
          opportunity.launchpad,
          opportunity.score
        );

        console.log(
          `[${this.config.name}] Opened position for user ${tgId}: ${opportunity.symbol}`
        );
      } catch (error) {
        console.error(
          `[${this.config.name}] Failed to execute for user ${tgId}:`,
          error
        );
      }
    }
  }

  private async executeBuy(
    token: string,
    symbol: string,
    amount: bigint,
    tgId: number,
    source: string,
    score: number,
    mode: TradingMode = 'pool'
  ): Promise<{ position: Position; receipt: TransactionReceipt }> {
    const chain = this.getChainKey();

    // SECURITY: Re-entrancy guard - prevent concurrent buys for same user/token
    if (!reentrancyGuard.acquire(tgId, token, 'buy')) {
      throw new Error('Transaction already in progress for this token');
    }

    try {
      // Apply 1% fee
      const { netAmount, fee } = applyBuyFee(amount);
      console.log(`[${this.config.name}] Buy fee: ${ethers.formatEther(fee)} ${this.config.nativeToken}`);

      const path = [this.config.wrappedNative, token];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Get expected output using net amount
      const amountsOut = await this.router.getAmountsOut(netAmount, path);

      // SECURITY: H-001 - Use configurable slippage (v3.5: from chain_settings DB)
      const slippage = await getSlippageAsync(chain, 'buy', tgId);
      const minOut = calculateMinOutput(amountsOut[1], slippage, 'buy');

      // v3.5: Get user's gas price preference
      const userGasGwei = await getUserGasPrice(tgId, chain);
      const gasPrice = userGasGwei ? BigInt(Math.round(userGasGwei * 1e9)) : undefined;

      // v3.5: Check if anti-MEV is enabled for this user/chain
      const useAntiMev = await isAntiMevEnabled(tgId, chain);

      // SECURITY: Validate swap parameters
      const validation = validateSwapParams({
        tokenAddress: token,
        amount: netAmount,
        minOutput: minOut,
        slippage,
        operation: 'buy',
      });
      if (!validation.valid) {
        throw new Error(`Swap validation failed: ${validation.error}`);
      }

      // Encode the swap transaction data
      const routerInterface = new ethers.Interface(ROUTER_ABI);
      const swapData = routerInterface.encodeFunctionData('swapExactETHForTokens', [
        minOut,
        path,
        this.wallet.address,
        deadline,
      ]);

      // SECURITY: H-002 - Simulate transaction before execution
      const simulation = await simulateTransaction(this.provider, {
        to: this.config.dexes[0].router,
        data: swapData,
        value: netAmount,
        from: this.wallet.address,
      });

      if (!simulation.success) {
        throw new Error(`Transaction simulation failed: ${simulation.revertReason || simulation.error}`);
      }

      // Estimate gas dynamically (use simulation result if available)
      const gasEstimate = simulation.gasUsed || await this.provider.estimateGas({
        to: this.config.dexes[0].router,
        data: swapData,
        value: netAmount,
        from: this.wallet.address,
      });
      const gasLimit = (gasEstimate * 120n) / 100n; // Add 20% buffer

      // v3.5: Execute swap via private RPC if enabled AND user has anti-MEV enabled
      let receipt: TransactionReceipt;
      const shouldUsePrivateRpc = this.privateRpc.isEnabled() && useAntiMev;

      if (shouldUsePrivateRpc) {
        console.log(`[${this.config.name}] Executing buy via private RPC (anti-MEV enabled)...`);
        const result = await this.privateRpc.executeTransaction({
          to: this.config.dexes[0].router,
          data: swapData,
          value: netAmount,
          gasLimit,
          gasPrice, // v3.5: User's custom gas price
        });

        if (!result.success || !result.txHash) {
          throw new Error(result.error || 'Private RPC transaction failed');
        }

        // SECURITY: P1-3 - Wait for proper number of confirmations per chain
        const confirmConfig = getConfirmationConfig(this.config.name);
        const txReceipt = await this.provider.waitForTransaction(
          result.txHash,
          confirmConfig.confirmations,
          confirmConfig.timeout
        );
        if (!txReceipt) throw new Error('Transaction not confirmed');
        receipt = txReceipt;
      } else {
        // Direct execution (anti-MEV disabled or private RPC not available)
        if (!useAntiMev) {
          console.log(`[${this.config.name}] Executing buy via public mempool (anti-MEV disabled by user)...`);
        }
        const txOptions: { value: bigint; gasLimit: bigint; gasPrice?: bigint } = {
          value: netAmount,
          gasLimit,
        };
        if (gasPrice) {
          txOptions.gasPrice = gasPrice; // v3.5: User's custom gas price
        }
        const tx = await this.router.swapExactETHForTokens(
          minOut,
          path,
          this.wallet.address,
          deadline,
          txOptions
        );
        const txReceipt = await tx.wait();
        if (!txReceipt) throw new Error('Transaction failed');
        receipt = txReceipt;
      }

      // Get actual tokens received
      const tokenContract = new Contract(token, ERC20_ABI, this.provider);
      const tokensReceived = await tokenContract.balanceOf(this.wallet.address);
      const entryPrice = Number(netAmount) / Number(tokensReceived);

      // Record fee
      await recordFee({
        tg_id: tgId,
        chain,
        amount: ethers.formatEther(fee),
        token: this.config.nativeToken,
      });

      // Record in database
      const position = await createPosition({
        tg_id: tgId,
        chain,
        mode,
        token_address: token,
        token_symbol: symbol,
        amount_in: ethers.formatEther(netAmount),
        tokens_held: tokensReceived.toString(),
        entry_price: entryPrice.toString(),
        take_profit_percent: DEFAULT_TAKE_PROFIT,
        stop_loss_percent: DEFAULT_STOP_LOSS,
        source,
        score,
      });

      await recordTrade({
        tg_id: tgId,
        position_id: position.id,
        chain,
        mode,
        token_address: token,
        token_symbol: symbol,
        type: 'BUY',
        amount_in: ethers.formatEther(netAmount),
        amount_out: tokensReceived.toString(),
        price: entryPrice.toString(),
        fee_amount: ethers.formatEther(fee),
        source,
        tx_hash: receipt.hash,
        status: 'CONFIRMED',
      });

      return { position, receipt };
    } finally {
      // SECURITY: Always release the re-entrancy lock
      reentrancyGuard.release(tgId, token);
    }
  }

  /**
   * Get the chain key for database operations
   */
  private getChainKey(): EVMChain {
    const name = this.config.name.toLowerCase();
    if (name === 'bsc' || name === 'base' || name === 'ethereum' || name === 'eth') {
      return name === 'ethereum' ? 'eth' : (name as EVMChain);
    }
    return 'bsc'; // Default fallback
  }

  async executeSell(
    positionId: number,
    token: string,
    symbol: string,
    tokensHeld: bigint,
    tgId: number,
    entryPrice: string,
    mode: TradingMode = 'pool',
    isEmergency: boolean = false
  ): Promise<TransactionReceipt> {
    const chain = this.getChainKey();

    // SECURITY: Re-entrancy guard - prevent concurrent sells for same user/token
    if (!reentrancyGuard.acquire(tgId, token, 'sell')) {
      throw new Error('Transaction already in progress for this token');
    }

    try {
      // SECURITY: H-003 - Approve only exact amount needed, not MaxUint256
      const tokenContract = new Contract(token, ERC20_ABI, this.wallet);
      const approveTx = await tokenContract.approve(this.router.target, tokensHeld);
      await approveTx.wait();

      const path = [token, this.config.wrappedNative];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // v3.5: Get user's chain settings for slippage, gas, and anti-MEV
      const userGasGwei = await getUserGasPrice(tgId, chain);
      const gasPrice = userGasGwei ? BigInt(Math.round(userGasGwei * 1e9)) : undefined;
      const useAntiMev = await isAntiMevEnabled(tgId, chain);

      // SECURITY: H-006 - Get expected output and calculate minOut with slippage
      // Never use 0 for minOut to prevent sandwich attacks
      let minOut: bigint;
      let slippage: number;
      try {
        const amountsOut = await this.router.getAmountsOut(tokensHeld, path);
        slippage = await getSlippageAsync(chain, isEmergency ? 'emergencyExit' : 'sell', tgId);
        minOut = calculateMinOutput(amountsOut[1], slippage, isEmergency ? 'emergencyExit' : 'sell');
      } catch {
        // If we can't get quote, use emergency exit with high slippage
        console.warn(`[${this.config.name}] Could not get sell quote, using emergency slippage`);
        slippage = await getSlippageAsync(chain, 'emergencyExit', tgId);
        // Estimate based on entry price (rough)
        const estimatedOut = BigInt(Math.floor(Number(tokensHeld) * parseFloat(entryPrice)));
        minOut = calculateMinOutput(estimatedOut, slippage, 'emergencyExit');
      }

      // SECURITY: Validate sell parameters
      const validation = validateSwapParams({
        tokenAddress: token,
        amount: tokensHeld,
        minOutput: minOut,
        slippage,
        operation: 'sell',
      });
      if (!validation.valid) {
        throw new Error(`Sell validation failed: ${validation.error}`);
      }

      // Encode the swap transaction data
      const routerInterface = new ethers.Interface(ROUTER_ABI);
      const swapData = routerInterface.encodeFunctionData('swapExactTokensForETH', [
        tokensHeld,
        minOut, // SECURITY: Never 0 - use calculated slippage
        path,
        this.wallet.address,
        deadline,
      ]);

      // SECURITY: H-002 - Simulate transaction before execution
      const simulation = await simulateTransaction(this.provider, {
        to: this.config.dexes[0].router,
        data: swapData,
        from: this.wallet.address,
      });

      if (!simulation.success && !isEmergency) {
        throw new Error(`Sell simulation failed: ${simulation.revertReason || simulation.error}`);
      }

      // Estimate gas dynamically
      const gasEstimate = simulation.gasUsed || await this.provider.estimateGas({
        to: this.config.dexes[0].router,
        data: swapData,
        from: this.wallet.address,
      });
      const gasLimit = (gasEstimate * 120n) / 100n; // Add 20% buffer

      // v3.5: Execute swap via private RPC if enabled AND user has anti-MEV enabled
      let receipt: TransactionReceipt;
      const shouldUsePrivateRpc = this.privateRpc.isEnabled() && useAntiMev;

      if (shouldUsePrivateRpc) {
        console.log(`[${this.config.name}] Executing sell via private RPC (anti-MEV enabled)...`);
        const result = await this.privateRpc.executeTransaction({
          to: this.config.dexes[0].router,
          data: swapData,
          gasLimit,
          gasPrice, // v3.5: User's custom gas price
        });

        if (!result.success || !result.txHash) {
          throw new Error(result.error || 'Private RPC transaction failed');
        }

        // SECURITY: P1-3 - Wait for proper number of confirmations per chain
        const confirmConfig = getConfirmationConfig(this.config.name);
        const txReceipt = await this.provider.waitForTransaction(
          result.txHash,
          confirmConfig.confirmations,
          confirmConfig.timeout
        );
        if (!txReceipt) throw new Error('Transaction not confirmed');
        receipt = txReceipt;
      } else {
        // Direct execution (anti-MEV disabled or private RPC not available)
        if (!useAntiMev) {
          console.log(`[${this.config.name}] Executing sell via public mempool (anti-MEV disabled by user)...`);
        }
        const txOptions: { gasLimit: bigint; gasPrice?: bigint } = { gasLimit };
        if (gasPrice) {
          txOptions.gasPrice = gasPrice; // v3.5: User's custom gas price
        }
        const tx = await this.router.swapExactTokensForETH(
          tokensHeld,
          minOut, // SECURITY: Use calculated minimum, never 0
          path,
          this.wallet.address,
          deadline,
          txOptions
        );
        const txReceipt = await tx.wait();
        if (!txReceipt) throw new Error('Transaction failed');
        receipt = txReceipt;
      }

      // Get amount received from swap
      const amountOut = await this.getAmountFromReceipt(receipt);

      // Apply 1% fee to output
      const { netAmount, fee } = applySellFee(amountOut);
      console.log(`[${this.config.name}] Sell fee: ${ethers.formatEther(fee)} ${this.config.nativeToken}`);

      // Record fee
      await recordFee({
        tg_id: tgId,
        chain,
        amount: ethers.formatEther(fee),
        token: this.config.nativeToken,
      });

      // Calculate PnL based on net amount after fee
      const exitPrice = Number(netAmount) / Number(tokensHeld);
      const entryPriceNum = parseFloat(entryPrice);
      const pnlPercent = ((exitPrice - entryPriceNum) / entryPriceNum) * 100;

      // Close position in database
      await closePosition(positionId, {
        exit_price: exitPrice.toString(),
        pnl: ethers.formatEther(netAmount),
        pnl_percent: pnlPercent,
      });

      // Record sell trade
      await recordTrade({
        tg_id: tgId,
        position_id: positionId,
        chain,
        mode,
        token_address: token,
        token_symbol: symbol,
        type: 'SELL',
        amount_in: tokensHeld.toString(),
        amount_out: ethers.formatEther(netAmount),
        price: exitPrice.toString(),
        pnl: ethers.formatEther(netAmount),
        pnl_percent: pnlPercent,
        fee_amount: ethers.formatEther(fee),
        source: isEmergency ? 'EMERGENCY_EXIT' : 'AUTO_EXIT',
        tx_hash: receipt.hash,
        status: 'CONFIRMED',
      });

      return receipt;
    } finally {
      // SECURITY: Always release the re-entrancy lock
      reentrancyGuard.release(tgId, token);
    }
  }

  private async getAmountFromReceipt(receipt: TransactionReceipt): Promise<bigint> {
    // Parse logs to get actual amount received
    // This is simplified - production would parse specific events
    const balance = await this.provider.getBalance(this.wallet.address);
    return balance;
  }

  async getTokenPrice(token: string): Promise<bigint> {
    const path = [token, this.config.wrappedNative];
    const oneToken = ethers.parseUnits('1', 18);

    try {
      const amounts = await this.router.getAmountsOut(oneToken, path);
      return amounts[1];
    } catch {
      return 0n;
    }
  }
}

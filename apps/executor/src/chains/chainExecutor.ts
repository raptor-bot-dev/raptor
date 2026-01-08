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

  constructor(config: ChainConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(process.env.EXECUTOR_PRIVATE_KEY!, this.provider);
    this.analyzer = new TokenAnalyzer(this.provider, config);
    this.router = new Contract(config.dexes[0].router, ROUTER_ABI, this.wallet);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.config.name}] Executor started`);

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
    // Apply 1% fee
    const { netAmount, fee } = applyBuyFee(amount);
    console.log(`[${this.config.name}] Buy fee: ${ethers.formatEther(fee)} ${this.config.nativeToken}`);

    const path = [this.config.wrappedNative, token];
    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Get expected output using net amount
    const amountsOut = await this.router.getAmountsOut(netAmount, path);
    const minOut = (amountsOut[1] * 85n) / 100n; // 15% slippage tolerance

    // Execute swap with net amount
    const tx = await this.router.swapExactETHForTokens(
      minOut,
      path,
      this.wallet.address,
      deadline,
      { value: netAmount, gasLimit: 300000n }
    );

    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction failed');

    // Get actual tokens received
    const tokenContract = new Contract(token, ERC20_ABI, this.provider);
    const tokensReceived = await tokenContract.balanceOf(this.wallet.address);
    const entryPrice = Number(netAmount) / Number(tokensReceived);

    const chain = this.getChainKey();

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
    mode: TradingMode = 'pool'
  ): Promise<TransactionReceipt> {
    // Approve router
    const tokenContract = new Contract(token, ERC20_ABI, this.wallet);
    const approveTx = await tokenContract.approve(this.router.target, tokensHeld);
    await approveTx.wait();

    const path = [token, this.config.wrappedNative];
    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Execute swap
    const tx = await this.router.swapExactTokensForETH(
      tokensHeld,
      0n, // Accept any amount (emergency exit)
      path,
      this.wallet.address,
      deadline,
      { gasLimit: 300000n }
    );

    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction failed');

    // Get amount received from swap
    const amountOut = await this.getAmountFromReceipt(receipt);

    // Apply 1% fee to output
    const { netAmount, fee } = applySellFee(amountOut);
    console.log(`[${this.config.name}] Sell fee: ${ethers.formatEther(fee)} ${this.config.nativeToken}`);

    const chain = this.getChainKey();

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
      source: 'AUTO_EXIT',
      tx_hash: receipt.hash,
      status: 'CONFIRMED',
    });

    return receipt;
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

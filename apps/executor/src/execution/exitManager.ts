import { ethers, Contract } from 'ethers';
import type { ChainConfig, Position } from '@raptor/shared';
// v2.3.1 Security imports
import {
  getSlippage,
  calculateMinOutput,
  simulateTransaction,
} from '../security/tradeGuards.js';

const ROUTER_ABI = [
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export interface ExitResult {
  success: boolean;
  txHash?: string;
  amountReceived?: bigint;
  pnl?: bigint;
  pnlPercent?: number;
  error?: string;
}

export class ExitManager {
  private config: ChainConfig;
  private wallet: ethers.Wallet;
  private router: Contract;

  constructor(
    config: ChainConfig,
    provider: ethers.JsonRpcProvider,
    privateKey: string
  ) {
    this.config = config;
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.router = new Contract(config.dexes[0].router, ROUTER_ABI, this.wallet);
  }

  async exit(
    position: Position,
    slippagePercent?: number
  ): Promise<ExitResult> {
    try {
      const tokenAddress = position.token_address;
      const tokensHeld = BigInt(position.tokens_held);
      const chain = this.config.name.toLowerCase();

      // SECURITY: H-003 - Approve only exact amount needed, never MaxUint256
      const token = new Contract(tokenAddress, ERC20_ABI, this.wallet);
      const currentAllowance = await token.allowance(
        this.wallet.address,
        this.router.target
      );

      if (currentAllowance < tokensHeld) {
        // Approve exact amount needed, not MaxUint256
        const approveTx = await token.approve(
          this.router.target,
          tokensHeld
        );
        await approveTx.wait();
      }

      const path = [tokenAddress, this.config.wrappedNative];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Get expected output
      let amountsOut: bigint[];
      let expectedOutput: bigint;
      try {
        amountsOut = await this.router.getAmountsOut(tokensHeld, path);
        expectedOutput = amountsOut[1];
      } catch {
        // If we can't get amounts, return error instead of using 0
        return { success: false, error: 'Could not get price quote - token may be illiquid' };
      }

      // SECURITY: H-001 - Use configurable slippage with proper calculation
      const effectiveSlippage = slippagePercent ?? getSlippage(chain, 'sell');
      const minOut = calculateMinOutput(expectedOutput, effectiveSlippage, 'sell');

      // SECURITY: H-006 - Never allow 0 minOut for MEV protection
      if (minOut === 0n) {
        return { success: false, error: 'Calculated minOut is 0 - trade would be vulnerable to MEV' };
      }

      // SECURITY: H-002 - Simulate before execution
      const swapData = new ethers.Interface(ROUTER_ABI).encodeFunctionData(
        'swapExactTokensForETH',
        [tokensHeld, minOut, path, this.wallet.address, deadline]
      );

      const simulation = await simulateTransaction(this.wallet.provider as ethers.JsonRpcProvider, {
        to: this.config.dexes[0].router,
        data: swapData,
        from: this.wallet.address,
      });

      if (!simulation.success) {
        return {
          success: false,
          error: `Simulation failed: ${simulation.revertReason || simulation.error}`,
        };
      }

      // Execute swap with dynamic gas
      const gasLimit = simulation.gasUsed ? (simulation.gasUsed * 120n) / 100n : 300000n;
      const tx = await this.router.swapExactTokensForETH(
        tokensHeld,
        minOut,
        path,
        this.wallet.address,
        deadline,
        { gasLimit }
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        return { success: false, error: 'Transaction reverted' };
      }

      // Calculate PnL
      const amountIn = ethers.parseEther(position.amount_in);
      const amountOut = expectedOutput;
      const pnl = amountOut - amountIn;
      const pnlPercent = (Number(pnl) / Number(amountIn)) * 100;

      return {
        success: true,
        txHash: receipt.hash,
        amountReceived: amountOut,
        pnl,
        pnlPercent,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async emergencyExit(position: Position): Promise<ExitResult> {
    // Emergency exit with high slippage tolerance
    // SECURITY: Still uses minimum output to prevent complete MEV extraction
    try {
      const tokenAddress = position.token_address;
      const tokensHeld = BigInt(position.tokens_held);
      const chain = this.config.name.toLowerCase();

      // SECURITY: H-003 - Approve only exact amount, never MaxUint256
      const token = new Contract(tokenAddress, ERC20_ABI, this.wallet);
      const approveTx = await token.approve(
        this.router.target,
        tokensHeld
      );
      await approveTx.wait();

      const path = [tokenAddress, this.config.wrappedNative];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Try to get expected output for slippage calculation
      let minOut: bigint;
      try {
        const amountsOut = await this.router.getAmountsOut(tokensHeld, path);
        // SECURITY: H-006 - Use emergency slippage (50%) but never 0
        const slippage = getSlippage(chain, 'emergencyExit');
        minOut = calculateMinOutput(amountsOut[1], slippage, 'emergencyExit');
      } catch {
        // If we truly can't get a quote, use 1 wei as absolute minimum
        // This still provides some MEV protection vs 0
        console.warn('[EmergencyExit] Could not get quote, using 1 wei minimum');
        minOut = 1n;
      }

      const tx = await this.router.swapExactTokensForETH(
        tokensHeld,
        minOut, // SECURITY: Never truly 0
        path,
        this.wallet.address,
        deadline,
        { gasLimit: 500000n }
      );

      const receipt = await tx.wait();

      return {
        success: receipt?.status === 1,
        txHash: receipt?.hash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

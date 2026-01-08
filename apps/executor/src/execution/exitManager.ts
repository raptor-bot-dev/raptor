import { ethers, Contract } from 'ethers';
import type { ChainConfig, Position } from '@raptor/shared';

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
    slippagePercent: number = 20
  ): Promise<ExitResult> {
    try {
      const tokenAddress = position.token_address;
      const tokensHeld = BigInt(position.tokens_held);

      // Check and set allowance
      const token = new Contract(tokenAddress, ERC20_ABI, this.wallet);
      const currentAllowance = await token.allowance(
        this.wallet.address,
        this.router.target
      );

      if (currentAllowance < tokensHeld) {
        const approveTx = await token.approve(
          this.router.target,
          ethers.MaxUint256
        );
        await approveTx.wait();
      }

      const path = [tokenAddress, this.config.wrappedNative];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      // Get expected output
      let amountsOut: bigint[];
      try {
        amountsOut = await this.router.getAmountsOut(tokensHeld, path);
      } catch {
        // If we can't get amounts, use emergency exit (0 min out)
        amountsOut = [tokensHeld, 0n];
      }

      // Calculate minimum output with slippage
      const minOut =
        (amountsOut[1] * BigInt(100 - slippagePercent)) / 100n;

      // Execute swap
      const tx = await this.router.swapExactTokensForETH(
        tokensHeld,
        minOut,
        path,
        this.wallet.address,
        deadline,
        { gasLimit: 300000n }
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        return { success: false, error: 'Transaction reverted' };
      }

      // Calculate PnL
      const amountIn = ethers.parseEther(position.amount_in);
      const amountOut = amountsOut[1];
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
    // Emergency exit with 0 minimum output
    // Use this when normal exit fails
    try {
      const tokenAddress = position.token_address;
      const tokensHeld = BigInt(position.tokens_held);

      const token = new Contract(tokenAddress, ERC20_ABI, this.wallet);
      const approveTx = await token.approve(
        this.router.target,
        ethers.MaxUint256
      );
      await approveTx.wait();

      const path = [tokenAddress, this.config.wrappedNative];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const tx = await this.router.swapExactTokensForETH(
        tokensHeld,
        0n, // Accept any amount
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

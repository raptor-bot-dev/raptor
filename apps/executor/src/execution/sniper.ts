import { ethers, Contract } from 'ethers';
import type { ChainConfig, Opportunity } from '@raptor/shared';

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
];

export interface SnipeResult {
  success: boolean;
  txHash?: string;
  tokensReceived?: bigint;
  gasUsed?: bigint;
  error?: string;
}

export class Sniper {
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

  async snipe(
    opportunity: Opportunity,
    amount: bigint,
    slippagePercent: number = 15
  ): Promise<SnipeResult> {
    try {
      const path = [this.config.wrappedNative, opportunity.token];
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      // Get expected output
      let amountsOut: bigint[];
      try {
        amountsOut = await this.router.getAmountsOut(amount, path);
      } catch {
        return { success: false, error: 'Failed to get amounts out' };
      }

      // Calculate minimum output with slippage
      const minOut =
        (amountsOut[1] * BigInt(100 - slippagePercent)) / 100n;

      // Check gas price
      const feeData = await this.wallet.provider!.getFeeData();
      if (feeData.gasPrice && feeData.gasPrice > this.config.maxGasPrice) {
        return { success: false, error: 'Gas price too high' };
      }

      // Execute swap
      const tx = await this.router.swapExactETHForTokens(
        minOut,
        path,
        this.wallet.address,
        deadline,
        {
          value: amount,
          gasLimit: 300000n,
          gasPrice: feeData.gasPrice,
        }
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        return { success: false, error: 'Transaction reverted' };
      }

      return {
        success: true,
        txHash: receipt.hash,
        tokensReceived: amountsOut[1],
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async estimateGas(
    opportunity: Opportunity,
    amount: bigint
  ): Promise<bigint | null> {
    try {
      const path = [this.config.wrappedNative, opportunity.token];
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const gas = await this.router.swapExactETHForTokens.estimateGas(
        0n, // amountOutMin
        path,
        this.wallet.address,
        deadline,
        { value: amount }
      );

      return gas;
    } catch {
      return null;
    }
  }
}

import { ethers, Contract } from 'ethers';
import type { ChainConfig, TokenAnalysis } from '@raptor/shared';
import { MAX_BUY_TAX, MAX_SELL_TAX } from '@raptor/shared';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

export class TokenAnalyzer {
  private provider: ethers.JsonRpcProvider;
  private config: ChainConfig;

  constructor(provider: ethers.JsonRpcProvider, config: ChainConfig) {
    this.provider = provider;
    this.config = config;
  }

  async analyze(tokenAddress: string): Promise<TokenAnalysis> {
    try {
      const [liquidity, taxes, honeypotCheck] = await Promise.all([
        this.checkLiquidity(tokenAddress),
        this.estimateTaxes(tokenAddress),
        this.checkHoneypot(tokenAddress),
      ]);

      const issues: string[] = [];

      // Check minimum liquidity
      const minLiq =
        this.config.name === 'BSC'
          ? BigInt(3e18) // 3 BNB
          : BigInt(1e18); // 1 ETH

      if (liquidity < minLiq) {
        issues.push('Low liquidity');
      }

      // Check taxes
      if (taxes.buyTax > MAX_BUY_TAX) {
        issues.push(`High buy tax: ${taxes.buyTax / 100}%`);
      }
      if (taxes.sellTax > MAX_SELL_TAX) {
        issues.push(`High sell tax: ${taxes.sellTax / 100}%`);
      }

      // Check honeypot
      if (honeypotCheck.isHoneypot) {
        issues.push('Honeypot detected');
      }
      if (!honeypotCheck.canSell) {
        issues.push('Cannot sell');
      }
      if (honeypotCheck.hasBlacklist) {
        issues.push('Has blacklist');
      }

      const safe = issues.length === 0;

      return {
        safe,
        reason: issues.length > 0 ? issues.join(', ') : undefined,
        liquidity,
        buyTax: taxes.buyTax,
        sellTax: taxes.sellTax,
        isHoneypot: honeypotCheck.isHoneypot,
        hasBlacklist: honeypotCheck.hasBlacklist,
        canSell: honeypotCheck.canSell,
      };
    } catch (error) {
      console.error('Token analysis failed:', error);
      return {
        safe: false,
        reason: 'Analysis failed',
        liquidity: 0n,
        buyTax: 0,
        sellTax: 0,
        isHoneypot: true,
        hasBlacklist: false,
        canSell: false,
      };
    }
  }

  private async checkLiquidity(tokenAddress: string): Promise<bigint> {
    // Simplified liquidity check
    // In production, this would check actual LP pairs
    try {
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await token.balanceOf(this.config.dexes[0].router);
      return balance;
    } catch {
      return 0n;
    }
  }

  private async estimateTaxes(
    tokenAddress: string
  ): Promise<{ buyTax: number; sellTax: number }> {
    // Simplified tax estimation
    // In production, this would simulate actual swaps
    // For now, assume 0% tax for bonding curve launches
    return {
      buyTax: 0,
      sellTax: 0,
    };
  }

  private async checkHoneypot(tokenAddress: string): Promise<{
    isHoneypot: boolean;
    hasBlacklist: boolean;
    canSell: boolean;
  }> {
    // Simplified honeypot check
    // In production, this would:
    // 1. Check for common honeypot patterns in bytecode
    // 2. Simulate buy/sell transactions
    // 3. Check for ownership and control functions

    try {
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);

      // Check if contract has owner function (potential red flag)
      try {
        await token.owner();
      } catch {
        // No owner function - potentially safer
      }

      return {
        isHoneypot: false,
        hasBlacklist: false,
        canSell: true,
      };
    } catch {
      return {
        isHoneypot: true,
        hasBlacklist: false,
        canSell: false,
      };
    }
  }
}

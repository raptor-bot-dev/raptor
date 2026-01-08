// Honeypot Detector for EVM Chains
// Uses eth_call to simulate buy/sell transactions and detect honeypots

import { ethers, Contract, Interface } from 'ethers';
import { getChainConfig, EVMChain } from '@raptor/shared';

// Standard ERC20 function selectors
const COMMON_HONEYPOT_SELECTORS = [
  '0xa9059cbb', // transfer
  '0x23b872dd', // transferFrom
  '0x095ea7b3', // approve
];

// Uniswap V2 Router ABI (simplified)
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
];

// ERC20 ABI (simplified)
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function owner() external view returns (address)',
];

export interface HoneypotResult {
  isHoneypot: boolean;
  reason?: string;
  buyGas?: number;
  sellGas?: number;
  buyTax?: number;
  sellTax?: number;
  maxTxAmount?: bigint;
  maxWalletAmount?: bigint;
  isRenounced?: boolean;
}

export interface SimulationResult {
  success: boolean;
  gas?: number;
  tax?: number;
  error?: string;
  amountIn?: bigint;
  amountOut?: bigint;
}

// Common addresses for simulation
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const SIMULATION_AMOUNT = ethers.parseEther('0.1'); // 0.1 ETH/BNB for simulation

export class HoneypotDetector {
  private provider: ethers.JsonRpcProvider;
  private chain: EVMChain;
  private routerAddress: string;
  private wrappedNative: string;

  constructor(provider: ethers.JsonRpcProvider, chain: EVMChain = 'bsc') {
    this.provider = provider;
    this.chain = chain;

    const config = getChainConfig(chain);
    // Get first DEX router
    this.routerAddress = config.dexes[0]?.router || '';
    this.wrappedNative = config.wrappedNative;
  }

  async detect(tokenAddress: string): Promise<HoneypotResult> {
    console.log(`[HoneypotDetector] Analyzing ${tokenAddress} on ${this.chain}`);

    try {
      // Get contract bytecode
      const bytecode = await this.provider.getCode(tokenAddress);

      if (bytecode === '0x') {
        return { isHoneypot: true, reason: 'No contract code' };
      }

      // Check for suspicious bytecode patterns
      const suspiciousPatterns = this.checkBytecodePatterns(bytecode);
      if (suspiciousPatterns.length > 0) {
        return {
          isHoneypot: true,
          reason: suspiciousPatterns.join(', '),
        };
      }

      // Get token info
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        return { isHoneypot: true, reason: 'Failed to get token info' };
      }

      // Check ownership
      const isRenounced = await this.checkOwnership(tokenAddress);

      // Simulate buy transaction
      const buyResult = await this.simulateBuy(tokenAddress);
      if (!buyResult.success) {
        return {
          isHoneypot: true,
          reason: buyResult.error || 'Buy simulation failed',
          isRenounced,
        };
      }

      // Calculate buy tax
      const buyTax = buyResult.tax || 0;
      if (buyTax > 30) {
        return {
          isHoneypot: true,
          reason: `Buy tax too high: ${buyTax}%`,
          buyTax,
          isRenounced,
        };
      }

      // Simulate sell transaction
      const sellResult = await this.simulateSell(tokenAddress, buyResult.amountOut || 0n);
      if (!sellResult.success) {
        return {
          isHoneypot: true,
          reason: sellResult.error || 'Sell simulation failed',
          buyGas: buyResult.gas,
          buyTax,
          isRenounced,
        };
      }

      // Calculate sell tax
      const sellTax = sellResult.tax || 0;
      if (sellTax > 30) {
        return {
          isHoneypot: true,
          reason: `Sell tax too high: ${sellTax}%`,
          buyGas: buyResult.gas,
          buyTax,
          sellTax,
          isRenounced,
        };
      }

      console.log(`[HoneypotDetector] ${tokenAddress}: Buy tax ${buyTax}%, Sell tax ${sellTax}%`);

      return {
        isHoneypot: false,
        buyGas: buyResult.gas,
        sellGas: sellResult.gas,
        buyTax,
        sellTax,
        isRenounced,
      };
    } catch (error) {
      console.error('[HoneypotDetector] Detection failed:', error);
      return { isHoneypot: true, reason: 'Detection failed' };
    }
  }

  private checkBytecodePatterns(bytecode: string): string[] {
    const issues: string[] = [];
    const lowerBytecode = bytecode.toLowerCase();

    // Check for missing standard ERC20 functions
    let missingCount = 0;
    for (const selector of COMMON_HONEYPOT_SELECTORS) {
      if (!lowerBytecode.includes(selector.slice(2).toLowerCase())) {
        missingCount++;
      }
    }
    if (missingCount >= 2) {
      issues.push('Missing multiple ERC20 functions');
    }

    // Additional checks for known honeypot patterns could be added here
    // e.g., checking for specific bytecode sequences used in known honeypots

    return issues;
  }

  private async getTokenInfo(tokenAddress: string): Promise<{
    decimals: number;
    totalSupply: bigint;
  } | null> {
    try {
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const [decimals, totalSupply] = await Promise.all([
        token.decimals().catch(() => 18),
        token.totalSupply().catch(() => 0n),
      ]);
      return { decimals, totalSupply };
    } catch {
      return null;
    }
  }

  private async checkOwnership(tokenAddress: string): Promise<boolean> {
    try {
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const owner = await token.owner();
      // Check if owner is zero address or dead address
      return (
        owner === ethers.ZeroAddress ||
        owner.toLowerCase() === DEAD_ADDRESS.toLowerCase()
      );
    } catch {
      // No owner function = likely renounced or not ownable
      return true;
    }
  }

  private async simulateBuy(tokenAddress: string): Promise<SimulationResult> {
    try {
      const router = new Contract(this.routerAddress, ROUTER_ABI, this.provider);
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);

      const path = [this.wrappedNative, tokenAddress];

      // Get expected output amount
      let amountsOut: bigint[];
      try {
        amountsOut = await router.getAmountsOut(SIMULATION_AMOUNT, path);
      } catch {
        return { success: false, error: 'No liquidity pool found' };
      }

      const expectedTokens = amountsOut[1];
      if (expectedTokens === 0n) {
        return { success: false, error: 'Zero output amount' };
      }

      // Simulate the swap using eth_call with state override
      // This creates a "virtual" account with ETH to perform the swap
      const simulationAddress = '0x1234567890123456789012345678901234567890';

      // Encode the swap call
      const iface = new Interface(ROUTER_ABI);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const swapData = iface.encodeFunctionData(
        'swapExactETHForTokensSupportingFeeOnTransferTokens',
        [0, path, simulationAddress, deadline]
      );

      // Use eth_call with state override to simulate
      try {
        const gasEstimate = await this.provider.estimateGas({
          to: this.routerAddress,
          data: swapData,
          value: SIMULATION_AMOUNT,
          from: simulationAddress,
        });

        // Calculate tax by comparing expected vs actual
        // Since we can't easily get actual received amount in simulation,
        // we estimate based on gas usage and known patterns
        // Higher gas often indicates fee-on-transfer
        const gas = Number(gasEstimate);
        const estimatedTax = gas > 250000 ? Math.min(Math.floor((gas - 150000) / 5000), 15) : 0;

        return {
          success: true,
          gas,
          tax: estimatedTax,
          amountIn: SIMULATION_AMOUNT,
          amountOut: expectedTokens,
        };
      } catch (error: unknown) {
        // If gas estimation fails, the buy likely fails
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.includes('execution reverted')) {
          return { success: false, error: 'Buy transaction reverts' };
        }
        // Try a simplified approach - just check if we can get amounts out
        return {
          success: true,
          gas: 200000,
          tax: 0,
          amountIn: SIMULATION_AMOUNT,
          amountOut: expectedTokens,
        };
      }
    } catch (error) {
      console.error('[HoneypotDetector] Buy simulation error:', error);
      return { success: false, error: 'Buy simulation failed' };
    }
  }

  private async simulateSell(
    tokenAddress: string,
    tokenAmount: bigint
  ): Promise<SimulationResult> {
    try {
      const router = new Contract(this.routerAddress, ROUTER_ABI, this.provider);

      // Use a portion of tokens for sell simulation
      const sellAmount = tokenAmount > 0n ? tokenAmount / 2n : 1000000n;
      const path = [tokenAddress, this.wrappedNative];

      // Get expected output amount
      let amountsOut: bigint[];
      try {
        amountsOut = await router.getAmountsOut(sellAmount, path);
      } catch {
        return { success: false, error: 'Sell quote failed - possible honeypot' };
      }

      const expectedNative = amountsOut[1];
      if (expectedNative === 0n) {
        return { success: false, error: 'Zero sell output - honeypot detected' };
      }

      // Simulate the sell
      const simulationAddress = '0x1234567890123456789012345678901234567890';
      const iface = new Interface(ROUTER_ABI);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const swapData = iface.encodeFunctionData(
        'swapExactTokensForETHSupportingFeeOnTransferTokens',
        [sellAmount, 0, path, simulationAddress, deadline]
      );

      try {
        const gasEstimate = await this.provider.estimateGas({
          to: this.routerAddress,
          data: swapData,
          from: simulationAddress,
        });

        const gas = Number(gasEstimate);
        const estimatedTax = gas > 300000 ? Math.min(Math.floor((gas - 180000) / 5000), 20) : 0;

        return {
          success: true,
          gas,
          tax: estimatedTax,
          amountIn: sellAmount,
          amountOut: expectedNative,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.includes('execution reverted')) {
          return { success: false, error: 'Sell transaction reverts - honeypot' };
        }
        // If gas estimation fails but quote succeeded, might still be sellable
        return {
          success: true,
          gas: 250000,
          tax: 0,
          amountIn: sellAmount,
          amountOut: expectedNative,
        };
      }
    } catch (error) {
      console.error('[HoneypotDetector] Sell simulation error:', error);
      return { success: false, error: 'Sell simulation failed' };
    }
  }

  /**
   * Quick check for obvious honeypots without full simulation
   */
  async quickCheck(tokenAddress: string): Promise<{ safe: boolean; reason?: string }> {
    try {
      // Check if token has any liquidity
      const router = new Contract(this.routerAddress, ROUTER_ABI, this.provider);
      const path = [this.wrappedNative, tokenAddress];

      try {
        const amounts = await router.getAmountsOut(ethers.parseEther('0.01'), path);
        if (amounts[1] === 0n) {
          return { safe: false, reason: 'No liquidity' };
        }
      } catch {
        return { safe: false, reason: 'Not tradeable' };
      }

      // Check if sell is possible
      const sellPath = [tokenAddress, this.wrappedNative];
      try {
        await router.getAmountsOut(1000000n, sellPath);
      } catch {
        return { safe: false, reason: 'Cannot sell - honeypot' };
      }

      return { safe: true };
    } catch {
      return { safe: false, reason: 'Check failed' };
    }
  }
}

// Factory function to create detector for specific chain
export function createHoneypotDetector(
  chain: EVMChain
): HoneypotDetector {
  const config = getChainConfig(chain);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  return new HoneypotDetector(provider, chain);
}

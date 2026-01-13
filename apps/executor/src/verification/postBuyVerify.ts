/**
 * Post-Buy Verification for RAPTOR v2.2
 *
 * Runs asynchronously after a FAST tier buy to verify the token
 * is safe to hold. This catches honeypots that slip through fast checks.
 *
 * Process:
 * 1. Simulate sell transaction
 * 2. Run full analysis if sell succeeds
 * 3. If honeypot detected: blacklist + emergency sell + notify user
 * 4. If low score: warn user (don't auto-sell)
 */

import type { Chain, EVMChain } from '@raptor/shared';
import { speedCache, getChainConfig, SOLANA_CONFIG } from '@raptor/shared';
import { ethers, Contract, Interface } from 'ethers';
import { runFullAnalysis } from '../analysis/fullAnalysis.js';

const DEFAULT_VERIFICATION_SLIPPAGE_BPS = 500; // 5%

// v3.3.2: Jupiter API key for authenticated requests
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

function getVerificationSlippageBps(): number {
  return parseInt(process.env.VERIFICATION_SLIPPAGE_BPS || String(DEFAULT_VERIFICATION_SLIPPAGE_BPS), 10);
}

// Verification result
export interface VerificationResult {
  positionId: number;
  tokenAddress: string;
  chain: Chain;
  verified: boolean;
  isHoneypot: boolean;
  canSell: boolean;
  sellSimError?: string;
  score?: number;
  decision?: string;
  issues: string[];
  action: 'HOLD' | 'WARN' | 'EMERGENCY_SELL';
  timestamp: number;
}

// Verification queue
interface PendingVerification {
  positionId: number;
  tokenAddress: string;
  chain: Chain;
  tgId: number;
  buyTxHash: string;
  addedAt: number;
}

// Sell simulation result
interface SellSimulationResult {
  canSell: boolean;
  sellTax?: number;
  expectedOutput?: bigint;
  error?: string;
}

const verificationQueue: PendingVerification[] = [];
let isProcessing = false;

// Callbacks for notifications
type NotifyCallback = (tgId: number, result: VerificationResult) => Promise<void>;
type EmergencySellCallback = (positionId: number) => Promise<void>;

let notifyUser: NotifyCallback | null = null;
let triggerEmergencySell: EmergencySellCallback | null = null;

// ABI fragments for EVM simulation
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
];

// Simulation wallet address - use well-known dead address for safety
const SIMULATION_WALLET = '0x000000000000000000000000000000000000dEaD';

/**
 * Register notification callbacks
 */
export function registerVerificationCallbacks(
  notify: NotifyCallback,
  emergencySell: EmergencySellCallback
): void {
  notifyUser = notify;
  triggerEmergencySell = emergencySell;
}

/**
 * Queue a position for post-buy verification
 * Called after a FAST tier buy completes
 */
export function queueVerification(
  positionId: number,
  tokenAddress: string,
  chain: Chain,
  tgId: number,
  buyTxHash: string
): void {
  verificationQueue.push({
    positionId,
    tokenAddress,
    chain,
    tgId,
    buyTxHash,
    addedAt: Date.now(),
  });

  console.log(`[PostBuy] Queued verification for position ${positionId}`);

  // Start processing if not already running
  if (!isProcessing) {
    processQueue();
  }
}

/**
 * Process verification queue
 */
async function processQueue(): Promise<void> {
  if (isProcessing || verificationQueue.length === 0) {
    return;
  }

  isProcessing = true;

  while (verificationQueue.length > 0) {
    const item = verificationQueue.shift()!;

    try {
      // Wait a bit after buy for blockchain state to settle
      const timeSinceBuy = Date.now() - item.addedAt;
      if (timeSinceBuy < 5000) {
        await new Promise(resolve => setTimeout(resolve, 5000 - timeSinceBuy));
      }

      const result = await verifyPosition(item);

      // Handle result
      await handleVerificationResult(item.tgId, result);
    } catch (error) {
      console.error(`[PostBuy] Error verifying position ${item.positionId}:`, error);
    }
  }

  isProcessing = false;
}

/**
 * Verify a single position
 */
async function verifyPosition(item: PendingVerification): Promise<VerificationResult> {
  const { positionId, tokenAddress, chain } = item;
  const issues: string[] = [];

  console.log(`[PostBuy] Verifying position ${positionId}: ${tokenAddress} on ${chain}`);

  // Step 1: Simulate sell
  const sellSimResult = await simulateSell(tokenAddress, chain);

  if (!sellSimResult.canSell) {
    // HONEYPOT DETECTED
    console.log(`[PostBuy] HONEYPOT detected for ${tokenAddress}`);

    // Add to blacklist
    speedCache.addToBlacklist('token', tokenAddress);

    return {
      positionId,
      tokenAddress,
      chain,
      verified: true,
      isHoneypot: true,
      canSell: false,
      sellSimError: sellSimResult.error,
      issues: ['Cannot sell - likely honeypot'],
      action: 'EMERGENCY_SELL',
      timestamp: Date.now(),
    };
  }

  // Step 2: Run full analysis
  const analysis = await runFullAnalysis(tokenAddress, chain);

  if (analysis.total !== undefined) {
    if (analysis.total < 15) {
      issues.push(`Very low score: ${analysis.total}/35`);
    }

    // Check for hard stops that weren't caught
    if (analysis.hardStops?.triggered && analysis.hardStops.reasons.length > 0) {
      issues.push(...analysis.hardStops.reasons.map(hs => `Hard stop: ${hs}`));
    }
  }

  // Determine action
  let action: 'HOLD' | 'WARN' | 'EMERGENCY_SELL' = 'HOLD';

  if (issues.length > 0) {
    action = 'WARN';
  }

  // High sell tax is a soft warning, not emergency
  if (sellSimResult.sellTax && sellSimResult.sellTax > 10) {
    issues.push(`High sell tax: ${sellSimResult.sellTax}%`);
    action = 'WARN';
  }

  return {
    positionId,
    tokenAddress,
    chain,
    verified: true,
    isHoneypot: false,
    canSell: true,
    score: analysis.total,
    decision: analysis.decision,
    issues,
    action,
    timestamp: Date.now(),
  };
}

/**
 * Handle verification result
 */
async function handleVerificationResult(
  tgId: number,
  result: VerificationResult
): Promise<void> {
  console.log(`[PostBuy] Result for position ${result.positionId}: ${result.action}`);

  switch (result.action) {
    case 'EMERGENCY_SELL':
      // Trigger emergency sell
      if (triggerEmergencySell) {
        try {
          await triggerEmergencySell(result.positionId);
        } catch (error) {
          console.error(`[PostBuy] Emergency sell failed for ${result.positionId}:`, error);
        }
      }

      // Notify user
      if (notifyUser) {
        await notifyUser(tgId, result);
      }
      break;

    case 'WARN':
      // Just notify user of issues
      if (notifyUser) {
        await notifyUser(tgId, result);
      }
      break;

    case 'HOLD':
      // All good, no notification needed
      console.log(`[PostBuy] Position ${result.positionId} verified OK`);
      break;
  }
}

/**
 * Simulate a sell transaction
 */
async function simulateSell(
  tokenAddress: string,
  chain: Chain
): Promise<SellSimulationResult> {
  try {
    if (chain === 'sol') {
      return await simulateSolanaSell(tokenAddress);
    } else {
      return await simulateEvmSell(tokenAddress, chain as EVMChain);
    }
  } catch (error) {
    console.error(`[PostBuy] Simulation error for ${tokenAddress}:`, error);
    return {
      canSell: false,
      error: error instanceof Error ? error.message : 'Simulation failed',
    };
  }
}

/**
 * Simulate Solana sell using Jupiter API
 */
async function simulateSolanaSell(tokenAddress: string): Promise<SellSimulationResult> {
  // Use unified api.jup.ag endpoint (quote-api.jup.ag has DNS issues on some platforms)
  const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  // Simulate selling 1000 tokens (adjusted by decimals later)
  const testAmount = 1000000000; // 1000 with 6 decimals (common for SPL)

  try {
    // Get quote from Jupiter
    const quoteUrl = new URL(JUPITER_QUOTE_API);
    quoteUrl.searchParams.set('inputMint', tokenAddress);
    quoteUrl.searchParams.set('outputMint', SOL_MINT);
    quoteUrl.searchParams.set('amount', testAmount.toString());

    const verificationSlippageBps = getVerificationSlippageBps();
    quoteUrl.searchParams.set('slippageBps', verificationSlippageBps.toString());

    // v3.3.2: Add API key header if available
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (JUPITER_API_KEY) {
      headers['x-api-key'] = JUPITER_API_KEY;
    }
    const response = await fetch(quoteUrl.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      // If Jupiter returns error, token might not be tradeable
      const errorText = await response.text();

      // Check for common "no route" errors
      if (errorText.includes('No route found') || errorText.includes('ROUTE_NOT_FOUND')) {
        return {
          canSell: false,
          error: 'No liquidity route found - cannot sell',
        };
      }

      return {
        canSell: false,
        error: `Jupiter API error: ${response.status}`,
      };
    }

    interface JupiterQuote {
      outAmount: string;
      inAmount: string;
      priceImpactPct: string;
      error?: string;
    }

    const quote = (await response.json()) as JupiterQuote;

    if (quote.error) {
      return {
        canSell: false,
        error: quote.error,
      };
    }

    // Check price impact (high impact suggests low liquidity or manipulation)
    const priceImpact = parseFloat(quote.priceImpactPct || '0');
    if (priceImpact > 50) {
      return {
        canSell: true,
        sellTax: Math.round(priceImpact), // Treat extreme price impact as "tax"
        expectedOutput: BigInt(quote.outAmount),
        error: `Extreme price impact: ${priceImpact.toFixed(1)}%`,
      };
    }

    // Calculate effective tax from price impact
    const effectiveTax = Math.max(0, Math.round(priceImpact));

    console.log(`[PostBuy] Solana sell simulation: ${tokenAddress} - priceImpact: ${priceImpact.toFixed(2)}%`);

    return {
      canSell: true,
      sellTax: effectiveTax,
      expectedOutput: BigInt(quote.outAmount),
    };
  } catch (error) {
    console.error('[PostBuy] Jupiter quote error:', error);

    // Network errors might be temporary, don't mark as honeypot
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        canSell: true, // Assume can sell, just couldn't verify
        error: 'Could not reach Jupiter API',
      };
    }

    return {
      canSell: false,
      error: error instanceof Error ? error.message : 'Jupiter simulation failed',
    };
  }
}

/**
 * Simulate EVM sell using DEX router
 */
async function simulateEvmSell(
  tokenAddress: string,
  chain: EVMChain
): Promise<SellSimulationResult> {
  const config = getChainConfig(chain);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  const routerAddress = config.dexes[0]?.router;
  const wrappedNative = config.wrappedNative;

  if (!routerAddress) {
    return {
      canSell: false,
      error: 'No DEX router configured',
    };
  }

  try {
    const router = new Contract(routerAddress, ROUTER_ABI, provider);
    const token = new Contract(tokenAddress, ERC20_ABI, provider);

    // Get token decimals
    let decimals = 18;
    try {
      decimals = await token.decimals();
    } catch {
      // Default to 18 if decimals() fails
    }

    // Test amount: 1000 tokens
    const testAmount = BigInt(1000) * BigInt(10 ** decimals);
    const sellPath = [tokenAddress, wrappedNative];

    // Step 1: Try to get a quote via getAmountsOut
    let expectedOutput: bigint;
    try {
      const amounts = await router.getAmountsOut(testAmount, sellPath);
      expectedOutput = amounts[1];

      if (expectedOutput === 0n) {
        return {
          canSell: false,
          error: 'Zero output amount - no liquidity or honeypot',
        };
      }
    } catch (error) {
      // getAmountsOut failed - likely no liquidity pool or honeypot
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      if (errorMsg.includes('INSUFFICIENT_LIQUIDITY') || errorMsg.includes('INSUFFICIENT_INPUT_AMOUNT')) {
        return {
          canSell: false,
          error: 'Insufficient liquidity',
        };
      }

      return {
        canSell: false,
        error: `Quote failed: ${errorMsg}`,
      };
    }

    // Step 2: Simulate the actual swap transaction using eth_call
    const iface = new Interface(ROUTER_ABI);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const swapData = iface.encodeFunctionData(
      'swapExactTokensForETHSupportingFeeOnTransferTokens',
      [
        testAmount,
        0, // Accept any output for simulation
        sellPath,
        SIMULATION_WALLET,
        deadline,
      ]
    );

    // Try to estimate gas for the swap
    // This will fail if the token blocks selling
    try {
      await provider.estimateGas({
        to: routerAddress,
        data: swapData,
        from: SIMULATION_WALLET,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Check for common honeypot revert messages
      if (
        errorMsg.includes('TRANSFER_FAILED') ||
        errorMsg.includes('TransferHelper') ||
        errorMsg.includes('execution reverted') ||
        errorMsg.includes('INSUFFICIENT_OUTPUT_AMOUNT')
      ) {
        // Some tokens have transfer restrictions but aren't honeypots
        // Check if it's a tax-related issue
        if (errorMsg.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
          // High tax token, but might be sellable
          return {
            canSell: true,
            sellTax: 30, // Assume ~30% tax if output insufficient
            expectedOutput,
            error: 'High tax detected',
          };
        }

        return {
          canSell: false,
          error: 'Sell transaction reverts - likely honeypot',
        };
      }

      // Gas estimation can fail for other reasons, don't immediately mark as honeypot
      console.warn(`[PostBuy] Gas estimation warning for ${tokenAddress}: ${errorMsg}`);
    }

    // Step 3: Calculate effective sell tax
    // Compare quote output to what we'd expect with 0% tax
    // This is a rough estimate
    const sellTax = await estimateSellTax(provider, tokenAddress, wrappedNative, routerAddress, testAmount, expectedOutput);

    console.log(`[PostBuy] EVM sell simulation: ${tokenAddress} on ${chain} - sellTax: ${sellTax}%`);

    return {
      canSell: true,
      sellTax,
      expectedOutput,
    };
  } catch (error) {
    console.error(`[PostBuy] EVM simulation error for ${tokenAddress}:`, error);
    return {
      canSell: false,
      error: error instanceof Error ? error.message : 'EVM simulation failed',
    };
  }
}

/**
 * Estimate sell tax by comparing reserves-based expected output to actual quote
 */
async function estimateSellTax(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  wrappedNative: string,
  routerAddress: string,
  inputAmount: bigint,
  actualOutput: bigint
): Promise<number> {
  try {
    // Get a small quote to establish base rate
    const router = new Contract(routerAddress, ROUTER_ABI, provider);
    const smallAmount = inputAmount / 100n; // 1% of test amount

    const smallAmounts = await router.getAmountsOut(smallAmount, [tokenAddress, wrappedNative]);
    const smallOutput = smallAmounts[1];

    // Expected output if linear (no tax)
    const expectedLinearOutput = smallOutput * 100n;

    // Calculate difference as tax percentage
    if (expectedLinearOutput === 0n) return 0;

    const taxBps = Number((expectedLinearOutput - actualOutput) * 10000n / expectedLinearOutput);
    const taxPercent = Math.max(0, Math.min(100, taxBps / 100));

    return Math.round(taxPercent);
  } catch {
    // If estimation fails, assume no tax
    return 0;
  }
}

/**
 * Get queue status
 */
export function getVerificationQueueStatus(): {
  pending: number;
  processing: boolean;
  items: { positionId: number; tokenAddress: string; chain: Chain; age: number }[];
} {
  return {
    pending: verificationQueue.length,
    processing: isProcessing,
    items: verificationQueue.map(item => ({
      positionId: item.positionId,
      tokenAddress: item.tokenAddress,
      chain: item.chain,
      age: Date.now() - item.addedAt,
    })),
  };
}

/**
 * Clear verification queue (for shutdown)
 */
export function clearVerificationQueue(): void {
  verificationQueue.length = 0;
  isProcessing = false;
}

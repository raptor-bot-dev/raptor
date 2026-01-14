/**
 * Post-Buy Verification for RAPTOR v4.0
 * Solana-only build
 *
 * Runs asynchronously after a FAST tier buy to verify the token
 * is safe to hold. This catches honeypots that slip through fast checks.
 *
 * Process:
 * 1. Simulate sell transaction using Jupiter
 * 2. Run full analysis if sell succeeds
 * 3. If honeypot detected: blacklist + emergency sell + notify user
 * 4. If low score: warn user (don't auto-sell)
 */

import type { Chain } from '@raptor/shared';
import { speedCache } from '@raptor/shared';
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
  const sellSimResult = await simulateSolanaSell(tokenAddress);

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
 * Simulate Solana sell using Jupiter API
 */
async function simulateSolanaSell(tokenAddress: string): Promise<SellSimulationResult> {
  // Use unified api.jup.ag endpoint
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

    // Add API key header if available
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

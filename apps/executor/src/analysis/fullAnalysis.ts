/**
 * Full Token Analysis Service for RAPTOR v4.0
 * Solana-only build
 *
 * Combines all analyzers to produce a comprehensive 7-category score.
 * Used by manual snipe and post-buy verification.
 */

import type { Chain } from '@raptor/shared';
import { speedCache, checkSolanaHardStops } from '@raptor/shared';
import { calculateFullScore, type ScoreInput, type ScoreResult, type CategoryScores } from '../scoring/scorer.js';
import { solanaAnalyzer } from '../analyzers/solanaAnalyzer.js';

// Analysis result matching snipe.ts TokenAnalysis interface
export interface FullAnalysisResult {
  total: number;
  decision: string;
  categories: CategoryScores;
  hardStops: {
    triggered: boolean;
    reasons: string[];
  };
  reasons: string[];
  tokenInfo: {
    name: string;
    symbol: string;
    liquidity: string;
    holders: number;
    age: string;
  };
  // Additional data for internal use
  raw?: {
    canSell: boolean;
    buyTax: number;
    sellTax: number;
    isHoneypot: boolean;
    liquidity: bigint;
  };
}

// In-memory tier cache for analysis results
const tierCache = new Map<string, { score: number; hardStop: boolean; timestamp: number }>();
const TIER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Run full token analysis
 * Target: < 3 seconds total
 */
export async function runFullAnalysis(
  tokenAddress: string,
  _chain: Chain,
  positionSizeUSD: number = 100,
  forceFull: boolean = false
): Promise<FullAnalysisResult> {
  console.log(`[FullAnalysis] Starting analysis for ${tokenAddress} on Solana`);
  const startTime = Date.now();

  try {
    // Check cache unless forced full
    if (!forceFull) {
      const cacheKey = `sol:${tokenAddress.toLowerCase()}`;
      const cached = tierCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < TIER_CACHE_TTL) {
        if (cached.score < 10 || cached.hardStop) {
          console.log(`[FullAnalysis] Skipping - previously identified as unsafe`);
          return createFailedAnalysis('Token previously identified as unsafe');
        }
      }

      // Check speedCache for token info
      const tokenInfo = speedCache.getTokenInfo(tokenAddress);
      if (tokenInfo && (tokenInfo.score < 10 || tokenInfo.isHoneypot)) {
        return createFailedAnalysis('Token identified as unsafe in cache');
      }
    }

    // Run Solana analysis
    const result = await analyzeSolanaToken(tokenAddress, positionSizeUSD);

    // Cache the result
    const cacheKey = `sol:${tokenAddress.toLowerCase()}`;
    tierCache.set(cacheKey, {
      score: result.total,
      hardStop: result.hardStops.triggered,
      timestamp: Date.now(),
    });

    return result;
  } catch (error) {
    console.error(`[FullAnalysis] Error analyzing ${tokenAddress}:`, error);
    return createFailedAnalysis('Analysis failed');
  } finally {
    console.log(`[FullAnalysis] Completed in ${Date.now() - startTime}ms`);
  }
}

/**
 * Analyze Solana token
 */
async function analyzeSolanaToken(
  tokenAddress: string,
  positionSizeUSD: number
): Promise<FullAnalysisResult> {
  // Use existing Solana analyzer
  const analysis = await solanaAnalyzer.analyzeToken(tokenAddress);

  // Check hard stops
  const hardStopResult = checkSolanaHardStops({
    hasFreezeAuthority: !analysis.isFreezeAuthorityNull,
    hasMintAuthority: !analysis.isMintAuthorityNull,
    hasPermanentDelegate: false,
    hasCloseAuthority: false,
  });

  // Build score input
  const scoreInput: ScoreInput = {
    canSell: analysis.safe,
    buyTax: 0, // Solana tokens typically don't have taxes
    sellTax: 0,
    isHoneypot: !analysis.safe,
    hasMintAuthority: !analysis.isMintAuthorityNull,
    totalSupply: 0n,
    liquidity: BigInt(Math.floor(analysis.liquidity * 1e9)), // Convert SOL to lamports
    isLpLocked: analysis.graduated, // Graduated = LP in Raydium
    lpLockDurationDays: analysis.graduated ? 365 : 0,
    topHolderPercent: 20, // Default estimate
    top10HoldersPercent: 50,
    holderCount: analysis.holders,
    deployerRugCount: 0,
    deployerSuccessCount: 0,
    isDeployerBlacklisted: false,
    hasOwnership: false,
    canPauseTransfers: false,
    hasBlacklist: false,
    hasFreezeAuthority: !analysis.isFreezeAuthorityNull,
    estimatedSlippage: 500, // 5% default
    estimatedGasUSD: 0.01, // Solana gas is cheap
    positionSizeUSD,
  };

  const scoreResult = calculateFullScore(scoreInput);

  // Convert old score (0-100) to decision context
  const reasons = [...scoreResult.reasons];
  if (analysis.reason) {
    reasons.push(analysis.reason);
  }

  return {
    total: scoreResult.total,
    decision: scoreResult.decision,
    categories: scoreResult.categories,
    hardStops: {
      triggered: hardStopResult.triggered,
      reasons: hardStopResult.reasons,
    },
    reasons,
    tokenInfo: {
      name: 'Solana Token',
      symbol: tokenAddress.slice(0, 6),
      liquidity: `${analysis.liquidity.toFixed(2)} SOL`,
      holders: analysis.holders,
      age: analysis.graduated ? 'Graduated' : `${analysis.bondingCurveProgress.toFixed(0)}% bonded`,
    },
    raw: {
      canSell: analysis.safe,
      buyTax: 0,
      sellTax: 0,
      isHoneypot: !analysis.safe,
      liquidity: BigInt(Math.floor(analysis.liquidity * 1e9)),
    },
  };
}

/**
 * Create a failed analysis result
 */
function createFailedAnalysis(reason: string): FullAnalysisResult {
  return {
    total: 0,
    decision: 'SKIP',
    categories: {
      sellability: 0,
      supplyIntegrity: 0,
      liquidityControl: 0,
      distribution: 0,
      deployerProvenance: 0,
      postLaunchControls: 0,
      executionRisk: 0,
    },
    hardStops: {
      triggered: true,
      reasons: [reason],
    },
    reasons: [reason],
    tokenInfo: {
      name: 'Unknown',
      symbol: '???',
      liquidity: '0',
      holders: 0,
      age: 'Unknown',
    },
  };
}

/**
 * Export for use in bot and other services
 */
export { calculateFullScore, type ScoreResult, type CategoryScores };

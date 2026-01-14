/**
 * Token Analysis Service for RAPTOR v4.0
 * Solana-only build
 *
 * Provides full token analysis callable from bot and executor.
 * Uses RPC calls to fetch token data and run the scorer.
 */

import type { Chain } from '../types.js';
import { SOLANA_CONFIG } from '../constants.js';
import { checkSolanaHardStops } from '../analyzer/hardStops.js';

// Category scores (0-5 each, total max 35)
export interface CategoryScores {
  sellability: number;
  supplyIntegrity: number;
  liquidityControl: number;
  distribution: number;
  deployerProvenance: number;
  postLaunchControls: number;
  executionRisk: number;
}

// Score thresholds
const SCORE_SKIP = 14;
const SCORE_TINY = 22;
const SCORE_TRADABLE = 28;

export type ScoreDecision = 'SKIP' | 'TINY' | 'TRADABLE' | 'BEST';

// Full analysis result
export interface TokenAnalysisResult {
  total: number;
  decision: ScoreDecision;
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
}

/**
 * Run full token analysis
 */
export async function analyzeToken(
  tokenAddress: string,
  _chain: Chain
): Promise<TokenAnalysisResult> {
  console.log(`[TokenAnalysis] Analyzing ${tokenAddress} on Solana`);
  const startTime = Date.now();

  try {
    return await analyzeSolanaToken(tokenAddress);
  } catch (error) {
    console.error(`[TokenAnalysis] Error:`, error);
    return createFailedResult('Analysis failed');
  } finally {
    console.log(`[TokenAnalysis] Completed in ${Date.now() - startTime}ms`);
  }
}

/**
 * Analyze Solana token
 */
async function analyzeSolanaToken(tokenAddress: string): Promise<TokenAnalysisResult> {
  const config = SOLANA_CONFIG;

  try {
    // Fetch mint info
    const mintInfo = await fetchSolanaMintInfo(config.rpcUrl, tokenAddress);

    // Check hard stops
    const hardStops = checkSolanaHardStops({
      hasFreezeAuthority: mintInfo.freezeAuthority !== null,
      hasMintAuthority: mintInfo.mintAuthority !== null,
      hasPermanentDelegate: false,
      hasCloseAuthority: false,
    });

    // Calculate category scores
    const categories: CategoryScores = {
      sellability: mintInfo.freezeAuthority === null ? 5 : 0,
      supplyIntegrity: mintInfo.mintAuthority === null ? 5 : 2,
      liquidityControl: 3, // Default - would need LP check
      distribution: 3, // Default - would need holder analysis
      deployerProvenance: 3, // Default
      postLaunchControls: mintInfo.freezeAuthority === null ? 5 : 2,
      executionRisk: 5, // Solana gas is cheap
    };

    const total = Object.values(categories).reduce((a, b) => a + b, 0);
    const decision = getDecision(total);
    const reasons = buildReasons(categories, mintInfo);

    return {
      total,
      decision,
      categories,
      hardStops: {
        triggered: hardStops.triggered,
        reasons: hardStops.reasons,
      },
      reasons,
      tokenInfo: {
        name: 'Solana Token',
        symbol: tokenAddress.slice(0, 6),
        liquidity: 'Unknown',
        holders: 0,
        age: 'Unknown',
      },
    };
  } catch (error) {
    console.error('[TokenAnalysis] Solana analysis failed:', error);
    return createFailedResult('Solana analysis failed');
  }
}

/**
 * Fetch Solana mint info
 */
async function fetchSolanaMintInfo(
  rpcUrl: string,
  mintAddress: string
): Promise<{
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: bigint;
}> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [mintAddress, { encoding: 'jsonParsed' }],
    }),
  });

  interface MintResponse {
    result?: {
      value?: {
        data?: {
          parsed?: {
            info?: {
              mintAuthority?: string | null;
              freezeAuthority?: string | null;
              supply: string;
            };
          };
        };
      };
    };
  }

  const data = (await response.json()) as MintResponse;
  const info = data.result?.value?.data?.parsed?.info;

  return {
    mintAuthority: info?.mintAuthority || null,
    freezeAuthority: info?.freezeAuthority || null,
    supply: BigInt(info?.supply || '0'),
  };
}

/**
 * Get decision from total score
 */
function getDecision(total: number): ScoreDecision {
  if (total <= SCORE_SKIP) return 'SKIP';
  if (total <= SCORE_TINY) return 'TINY';
  if (total <= SCORE_TRADABLE) return 'TRADABLE';
  return 'BEST';
}

/**
 * Build reasons list for Solana
 */
function buildReasons(
  categories: CategoryScores,
  mintInfo: { mintAuthority: string | null; freezeAuthority: string | null }
): string[] {
  const reasons: string[] = [];
  if (mintInfo.freezeAuthority) reasons.push('Freeze authority active');
  if (mintInfo.mintAuthority) reasons.push('Mint authority active');
  if (categories.liquidityControl < 3) reasons.push('Low liquidity');
  return reasons;
}

/**
 * Create a failed result
 */
function createFailedResult(reason: string): TokenAnalysisResult {
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

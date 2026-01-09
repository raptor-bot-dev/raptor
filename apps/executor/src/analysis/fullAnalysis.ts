/**
 * Full Token Analysis Service for RAPTOR v2.2
 *
 * Combines all analyzers to produce a comprehensive 7-category score.
 * Used by manual snipe and post-buy verification.
 *
 * Process:
 * 1. Fetch basic token info (name, symbol, supply)
 * 2. Run honeypot detection
 * 3. Check hard stops
 * 4. Gather holder distribution
 * 5. Check deployer history
 * 6. Calculate 7-category score
 */

import type { Chain, EVMChain } from '@raptor/shared';
import { getChainConfig, speedCache, checkEVMHardStops, checkSolanaHardStops } from '@raptor/shared';
import { ethers, Contract } from 'ethers';
import { calculateFullScore, type ScoreInput, type ScoreResult, type CategoryScores } from '../scoring/scorer.js';
import { HoneypotDetector } from '../analyzers/honeypotDetector.js';
import { solanaAnalyzer } from '../analyzers/solanaAnalyzer.js';

// ERC20 ABI for basic info
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
];

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

/**
 * Run full token analysis
 * Target: < 3 seconds total
 */
export async function runFullAnalysis(
  tokenAddress: string,
  chain: Chain,
  positionSizeUSD: number = 100
): Promise<FullAnalysisResult> {
  console.log(`[FullAnalysis] Starting analysis for ${tokenAddress} on ${chain}`);
  const startTime = Date.now();

  try {
    if (chain === 'sol') {
      return await analyzeSolanaToken(tokenAddress, positionSizeUSD);
    } else {
      return await analyzeEVMToken(tokenAddress, chain as EVMChain, positionSizeUSD);
    }
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
    hasPermanentDelegate: false, // Would need additional check
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
      name: 'Solana Token', // Would need metadata fetch
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
 * Analyze EVM token (BSC, Base, ETH)
 */
async function analyzeEVMToken(
  tokenAddress: string,
  chain: EVMChain,
  positionSizeUSD: number
): Promise<FullAnalysisResult> {
  const config = getChainConfig(chain);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Run checks in parallel for speed
  const [tokenInfo, honeypotResult, holderData, deployerData] = await Promise.all([
    getEVMTokenInfo(provider, tokenAddress),
    runHoneypotCheck(provider, chain, tokenAddress),
    getHolderDistribution(provider, tokenAddress),
    getDeployerHistory(tokenAddress),
  ]);

  // Check hard stops
  const hardStopResult = checkEVMHardStops({
    isHoneypot: honeypotResult.isHoneypot,
    canPauseTransfers: false, // Would need bytecode analysis
    hasBlacklist: false,
    isProxy: false,
    isOpenSource: true, // Assume true for speed
    canChangeBalance: false,
    hasSelfDestruct: false,
    hasHiddenOwner: false,
    hasExternalCall: false,
    hasTradingCooldown: false,
  });

  // Get gas estimate
  const gasPrice = speedCache.getPriorityFee(chain, 'normal');
  const nativePrice = speedCache.getNativePrice(chain);
  const estimatedGasUSD = (Number(gasPrice) * 200000 / 1e18) * nativePrice;

  // Build score input
  const scoreInput: ScoreInput = {
    canSell: !honeypotResult.isHoneypot,
    buyTax: (honeypotResult.buyTax || 0) * 100, // Convert to basis points
    sellTax: (honeypotResult.sellTax || 0) * 100,
    isHoneypot: honeypotResult.isHoneypot,
    hasMintAuthority: false, // EVM tokens typically don't have this
    totalSupply: tokenInfo.totalSupply,
    liquidity: holderData.liquidity,
    isLpLocked: false, // Would need LP lock check
    lpLockDurationDays: 0,
    topHolderPercent: holderData.topHolderPercent,
    top10HoldersPercent: holderData.top10Percent,
    holderCount: holderData.holderCount,
    deployerRugCount: deployerData.rugCount,
    deployerSuccessCount: deployerData.successCount,
    isDeployerBlacklisted: deployerData.isBlacklisted,
    hasOwnership: !honeypotResult.isRenounced,
    canPauseTransfers: false,
    hasBlacklist: false,
    estimatedSlippage: 500,
    estimatedGasUSD,
    positionSizeUSD,
  };

  const scoreResult = calculateFullScore(scoreInput);

  // Format liquidity string
  const liquidityNative = Number(holderData.liquidity) / 1e18;
  const nativeSymbol = chain === 'bsc' ? 'BNB' : 'ETH';

  return {
    total: scoreResult.total,
    decision: scoreResult.decision,
    categories: scoreResult.categories,
    hardStops: {
      triggered: hardStopResult.triggered,
      reasons: hardStopResult.reasons,
    },
    reasons: scoreResult.reasons,
    tokenInfo: {
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      liquidity: `${liquidityNative.toFixed(2)} ${nativeSymbol}`,
      holders: holderData.holderCount,
      age: 'Unknown', // Would need creation timestamp
    },
    raw: {
      canSell: !honeypotResult.isHoneypot,
      buyTax: (honeypotResult.buyTax || 0) * 100,
      sellTax: (honeypotResult.sellTax || 0) * 100,
      isHoneypot: honeypotResult.isHoneypot,
      liquidity: holderData.liquidity,
    },
  };
}

/**
 * Get basic EVM token info
 */
async function getEVMTokenInfo(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string
): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}> {
  try {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name().catch(() => 'Unknown'),
      token.symbol().catch(() => '???'),
      token.decimals().catch(() => 18),
      token.totalSupply().catch(() => 0n),
    ]);
    return { name, symbol, decimals, totalSupply };
  } catch {
    return { name: 'Unknown', symbol: '???', decimals: 18, totalSupply: 0n };
  }
}

/**
 * Run honeypot detection
 */
async function runHoneypotCheck(
  provider: ethers.JsonRpcProvider,
  chain: Chain,
  tokenAddress: string
): Promise<{
  isHoneypot: boolean;
  buyTax?: number;
  sellTax?: number;
  isRenounced?: boolean;
}> {
  try {
    if (chain === 'sol') {
      return { isHoneypot: false };
    }

    const detector = new HoneypotDetector(provider, chain as 'bsc' | 'base' | 'eth');
    const result = await detector.detect(tokenAddress);

    return {
      isHoneypot: result.isHoneypot,
      buyTax: result.buyTax,
      sellTax: result.sellTax,
      isRenounced: result.isRenounced,
    };
  } catch (error) {
    console.error('[FullAnalysis] Honeypot check failed:', error);
    return { isHoneypot: true }; // Fail safe
  }
}

/**
 * Get holder distribution data
 */
async function getHolderDistribution(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string
): Promise<{
  holderCount: number;
  topHolderPercent: number;
  top10Percent: number;
  liquidity: bigint;
}> {
  // Placeholder - in production would use an indexer API
  // like Moralis, Covalent, or custom indexer
  return {
    holderCount: 100,
    topHolderPercent: 20,
    top10Percent: 50,
    liquidity: BigInt(5e18), // 5 ETH/BNB default
  };
}

/**
 * Get deployer history
 */
async function getDeployerHistory(
  tokenAddress: string
): Promise<{
  rugCount: number;
  successCount: number;
  isBlacklisted: boolean;
}> {
  // Placeholder - in production would:
  // 1. Find deployer from token creation tx
  // 2. Check deployer's other tokens
  // 3. Check local blacklist
  return {
    rugCount: 0,
    successCount: 0,
    isBlacklisted: false,
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

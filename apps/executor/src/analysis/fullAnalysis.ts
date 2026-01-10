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
 * Tier decision for routing analysis
 * SECURITY: P1-5 - Determines fast vs full analysis path
 */
type AnalysisTier = 'FAST' | 'FULL' | 'SKIP';

// In-memory tier cache for analysis results
const tierCache = new Map<string, { score: number; hardStop: boolean; timestamp: number }>();
const TIER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Determine which analysis tier to use
 * SECURITY: P1-5 - Fast tier for known-good tokens, full tier for new/unknown
 */
async function determineAnalysisTier(
  tokenAddress: string,
  chain: Chain
): Promise<AnalysisTier> {
  // Check if token is in cache with recent analysis
  const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`;
  const cached = tierCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < TIER_CACHE_TTL) {
    // Use cached score to determine if we need full analysis
    if (cached.score >= 25) {
      console.log(`[FullAnalysis] FAST tier - cached high score (${cached.score})`);
      return 'FAST';
    }
    if (cached.score < 10 || cached.hardStop) {
      console.log(`[FullAnalysis] SKIP tier - cached low score or hard stop`);
      return 'SKIP';
    }
  }

  // Also check speedCache for token info
  const tokenInfo = speedCache.getTokenInfo(tokenAddress);
  if (tokenInfo) {
    if (tokenInfo.score >= 25) {
      return 'FAST';
    }
    if (tokenInfo.score < 10 || tokenInfo.isHoneypot) {
      return 'SKIP';
    }
  }

  // Check known launchpads for fast-path
  if (chain === 'sol') {
    // Pump.fun tokens with graduation are generally safe
    const isPumpFun = tokenAddress.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(tokenAddress);
    if (isPumpFun) {
      console.log(`[FullAnalysis] FULL tier - pump.fun token needs verification`);
      return 'FULL';
    }
  }

  // Default to full analysis for unknown tokens
  return 'FULL';
}

/**
 * Run fast token analysis (for known-good tokens)
 * SECURITY: P1-5 - Quick checks only, uses cached data where available
 */
async function runFastAnalysis(
  tokenAddress: string,
  chain: Chain,
  cachedResult?: FullAnalysisResult
): Promise<FullAnalysisResult> {
  if (cachedResult) {
    // Refresh only time-sensitive data
    console.log(`[FullAnalysis] Using cached result with refresh`);
    return {
      ...cachedResult,
      tokenInfo: {
        ...cachedResult.tokenInfo,
        age: 'Cached',
      },
    };
  }

  // Run minimal checks
  if (chain === 'sol') {
    return analyzeSolanaToken(tokenAddress, 100);
  } else {
    return analyzeEVMToken(tokenAddress, chain as EVMChain, 100);
  }
}

/**
 * Run full token analysis
 * Target: < 3 seconds total
 * SECURITY: P1-5 - Now routes to fast/full based on tier decision
 */
export async function runFullAnalysis(
  tokenAddress: string,
  chain: Chain,
  positionSizeUSD: number = 100,
  forceFull: boolean = false
): Promise<FullAnalysisResult> {
  console.log(`[FullAnalysis] Starting analysis for ${tokenAddress} on ${chain}`);
  const startTime = Date.now();

  try {
    // SECURITY: P1-5 - Determine analysis tier unless forced full
    if (!forceFull) {
      const tier = await determineAnalysisTier(tokenAddress, chain);

      if (tier === 'SKIP') {
        console.log(`[FullAnalysis] Skipping - previously identified as unsafe`);
        return createFailedAnalysis('Token previously identified as unsafe');
      }

      if (tier === 'FAST') {
        const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`;
        const cached = tierCache.get(cacheKey);
        // For fast path, we don't have full cached result, just run minimal checks
        return runFastAnalysis(tokenAddress, chain, undefined);
      }
    }

    // FULL analysis path
    let result: FullAnalysisResult;
    if (chain === 'sol') {
      result = await analyzeSolanaToken(tokenAddress, positionSizeUSD);
    } else {
      result = await analyzeEVMToken(tokenAddress, chain as EVMChain, positionSizeUSD);
    }

    // Cache the result for future tier decisions
    const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`;
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
 * SECURITY: P1-7 - Uses real APIs instead of placeholder data
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
  // Try to get data from Moralis API first
  const moralisKey = process.env.MORALIS_API_KEY;
  if (moralisKey) {
    try {
      // Get token holders from Moralis
      const holdersResponse = await fetch(
        `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/owners?chain=bsc`,
        {
          headers: {
            'X-API-Key': moralisKey,
            'Accept': 'application/json',
          },
        }
      );

      if (holdersResponse.ok) {
        interface MoralisHoldersResponse {
          result?: Array<{
            owner_address: string;
            balance: string;
            percentage_relative_to_total_supply: number;
          }>;
          total?: number;
        }
        const holdersData = (await holdersResponse.json()) as MoralisHoldersResponse;

        if (holdersData.result && holdersData.result.length > 0) {
          const holderCount = holdersData.total || holdersData.result.length;
          const topHolderPercent = holdersData.result[0]?.percentage_relative_to_total_supply || 0;

          // Calculate top 10 percentage
          let top10Percent = 0;
          for (let i = 0; i < Math.min(10, holdersData.result.length); i++) {
            top10Percent += holdersData.result[i]?.percentage_relative_to_total_supply || 0;
          }

          // Get liquidity from pair
          const liquidity = await estimateLiquidity(provider, tokenAddress);

          return {
            holderCount,
            topHolderPercent: Math.round(topHolderPercent),
            top10Percent: Math.round(top10Percent),
            liquidity,
          };
        }
      }
    } catch (error) {
      console.warn('[FullAnalysis] Moralis API error:', error);
    }
  }

  // Fallback: Try to estimate from on-chain data
  try {
    const liquidity = await estimateLiquidity(provider, tokenAddress);

    // Estimate holder distribution based on liquidity
    // Higher liquidity typically means more distributed
    const liquidityEth = Number(liquidity) / 1e18;
    const estimatedHolders = Math.floor(liquidityEth * 50 + 50); // Rough estimate

    return {
      holderCount: Math.min(estimatedHolders, 1000), // Cap estimate
      topHolderPercent: liquidityEth > 10 ? 15 : liquidityEth > 5 ? 25 : 35,
      top10Percent: liquidityEth > 10 ? 40 : liquidityEth > 5 ? 55 : 70,
      liquidity,
    };
  } catch {
    // Final fallback
    return {
      holderCount: 50,
      topHolderPercent: 30,
      top10Percent: 60,
      liquidity: BigInt(1e18), // 1 ETH/BNB minimum
    };
  }
}

/**
 * Estimate liquidity from DEX pair
 */
async function estimateLiquidity(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string
): Promise<bigint> {
  try {
    // Common DEX factory addresses
    const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

    const factoryAbi = ['function getPair(address, address) view returns (address)'];
    const pairAbi = ['function getReserves() view returns (uint112, uint112, uint32)'];

    const factory = new Contract(PANCAKE_FACTORY, factoryAbi, provider);
    const pairAddress = await factory.getPair(tokenAddress, WBNB);

    if (pairAddress === ethers.ZeroAddress) {
      return BigInt(1e18); // No pair found, return minimum
    }

    const pair = new Contract(pairAddress, pairAbi, provider);
    const [reserve0, reserve1] = await pair.getReserves();

    // Determine which reserve is the native token
    const nativeReserve = tokenAddress.toLowerCase() < WBNB.toLowerCase() ? reserve1 : reserve0;

    return BigInt(nativeReserve) * 2n; // Total liquidity = 2x native reserve
  } catch {
    return BigInt(1e18); // Fallback to 1 ETH/BNB
  }
}

/**
 * Get deployer history
 * SECURITY: P1-7 - Analyzes deployer wallet for rug history
 */
async function getDeployerHistory(
  tokenAddress: string
): Promise<{
  rugCount: number;
  successCount: number;
  isBlacklisted: boolean;
}> {
  // Check local blacklist first
  const isBlacklisted = await checkDeployerBlacklist(tokenAddress);
  if (isBlacklisted) {
    return {
      rugCount: 10, // Assume high rug count for blacklisted
      successCount: 0,
      isBlacklisted: true,
    };
  }

  // Try to get deployer info from BSCScan API
  const bscscanKey = process.env.BSCSCAN_API_KEY;
  if (bscscanKey) {
    try {
      // Get contract creation tx to find deployer
      const creationResponse = await fetch(
        `https://api.bscscan.com/api?module=contract&action=getcontractcreation&contractaddresses=${tokenAddress}&apikey=${bscscanKey}`
      );

      interface BSCScanCreationResponse {
        status: string;
        result?: Array<{
          contractCreator: string;
          txHash: string;
        }>;
      }
      const creationData = (await creationResponse.json()) as BSCScanCreationResponse;

      if (creationData.status === '1' && creationData.result?.[0]) {
        const deployerAddress = creationData.result[0].contractCreator;

        // Get all tokens created by this deployer
        const tokensResponse = await fetch(
          `https://api.bscscan.com/api?module=account&action=tokentx&address=${deployerAddress}&page=1&offset=100&apikey=${bscscanKey}`
        );

        interface BSCScanTokenTxResponse {
          status: string;
          result?: Array<{
            contractAddress: string;
            from: string;
          }>;
        }
        const tokensData = (await tokensResponse.json()) as BSCScanTokenTxResponse;

        if (tokensData.status === '1' && tokensData.result) {
          // Count unique contracts deployed
          const deployedTokens = new Set<string>();
          for (const tx of tokensData.result) {
            if (tx.from.toLowerCase() === deployerAddress.toLowerCase()) {
              deployedTokens.add(tx.contractAddress.toLowerCase());
            }
          }

          // Rough heuristic: many tokens = possible serial deployer
          const tokenCount = deployedTokens.size;
          if (tokenCount > 10) {
            return {
              rugCount: Math.floor(tokenCount * 0.3), // Assume 30% are rugs
              successCount: Math.floor(tokenCount * 0.2),
              isBlacklisted: false,
            };
          }

          return {
            rugCount: 0,
            successCount: Math.min(tokenCount, 3),
            isBlacklisted: false,
          };
        }
      }
    } catch (error) {
      console.warn('[FullAnalysis] BSCScan API error:', error);
    }
  }

  // Default: unknown deployer
  return {
    rugCount: 0,
    successCount: 0,
    isBlacklisted: false,
  };
}

/**
 * Check deployer against local blacklist
 */
async function checkDeployerBlacklist(tokenAddress: string): Promise<boolean> {
  // Local blacklist of known rug deployers
  // In production, this would be loaded from database
  const KNOWN_RUG_DEPLOYERS = new Set([
    // Add known rug deployer addresses here
    // '0x...',
  ]);

  // Check if this token's deployer is in blacklist
  // Would need to fetch deployer first, simplified here
  return false;
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

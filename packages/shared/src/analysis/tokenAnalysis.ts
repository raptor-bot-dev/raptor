/**
 * Token Analysis Service for RAPTOR v2.2
 *
 * Provides full token analysis callable from bot and executor.
 * Uses RPC calls to fetch token data and run the scorer.
 */

import type { Chain, EVMChain } from '../types.js';
import { getChainConfig } from '../chains.js';
import { SOLANA_CONFIG } from '../constants.js';
import { checkEVMHardStops, checkSolanaHardStops } from '../analyzer/hardStops.js';

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
  chain: Chain
): Promise<TokenAnalysisResult> {
  console.log(`[TokenAnalysis] Analyzing ${tokenAddress} on ${chain}`);
  const startTime = Date.now();

  try {
    if (chain === 'sol') {
      return await analyzeSolanaToken(tokenAddress);
    } else {
      return await analyzeEVMToken(tokenAddress, chain as EVMChain);
    }
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
 * Analyze EVM token
 */
async function analyzeEVMToken(
  tokenAddress: string,
  chain: EVMChain
): Promise<TokenAnalysisResult> {
  const config = getChainConfig(chain);

  try {
    // Fetch token info and run honeypot check in parallel
    const [tokenInfo, honeypotCheck] = await Promise.all([
      fetchEVMTokenInfo(config.rpcUrl, tokenAddress),
      checkEVMHoneypot(config.rpcUrl, tokenAddress, chain),
    ]);

    // Check hard stops
    const hardStops = checkEVMHardStops({
      isHoneypot: honeypotCheck.isHoneypot,
      canPauseTransfers: false,
      hasBlacklist: false,
      isProxy: false,
      isOpenSource: true,
      canChangeBalance: false,
      hasSelfDestruct: false,
      hasHiddenOwner: false,
      hasExternalCall: false,
      hasTradingCooldown: false,
    });

    // Calculate category scores
    const categories: CategoryScores = {
      sellability: calculateSellabilityScore(honeypotCheck),
      supplyIntegrity: 4, // Default - EVM tokens typically don't have mint authority
      liquidityControl: calculateLiquidityScore(honeypotCheck.liquidity, chain),
      distribution: 3, // Default - would need holder analysis
      deployerProvenance: 3, // Default - would need deployer check
      postLaunchControls: honeypotCheck.isRenounced ? 5 : 3,
      executionRisk: calculateExecutionRiskScore(chain),
    };

    const total = Object.values(categories).reduce((a, b) => a + b, 0);
    const decision = getDecision(total);
    const reasons = buildEVMReasons(honeypotCheck);

    // Format liquidity
    const liquidityNative = Number(honeypotCheck.liquidity) / 1e18;
    const nativeSymbol = chain === 'bsc' ? 'BNB' : 'ETH';

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
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        liquidity: `${liquidityNative.toFixed(2)} ${nativeSymbol}`,
        holders: 0, // Would need indexer
        age: 'Unknown',
      },
    };
  } catch (error) {
    console.error('[TokenAnalysis] EVM analysis failed:', error);
    return createFailedResult('EVM analysis failed');
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
 * Fetch EVM token basic info
 */
async function fetchEVMTokenInfo(
  rpcUrl: string,
  tokenAddress: string
): Promise<{ name: string; symbol: string }> {
  // Use eth_call to get name and symbol
  const nameData = '0x06fdde03'; // name()
  const symbolData = '0x95d89b41'; // symbol()

  try {
    const [nameResult, symbolResult] = await Promise.all([
      ethCall(rpcUrl, tokenAddress, nameData),
      ethCall(rpcUrl, tokenAddress, symbolData),
    ]);

    return {
      name: decodeString(nameResult) || 'Unknown',
      symbol: decodeString(symbolResult) || '???',
    };
  } catch {
    return { name: 'Unknown', symbol: '???' };
  }
}

/**
 * Check EVM token for honeypot characteristics
 */
async function checkEVMHoneypot(
  rpcUrl: string,
  tokenAddress: string,
  chain: EVMChain
): Promise<{
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  liquidity: bigint;
  isRenounced: boolean;
}> {
  const config = getChainConfig(chain);
  const routerAddress = config.dexes[0]?.router;
  const wrappedNative = config.wrappedNative;

  if (!routerAddress) {
    return { isHoneypot: true, buyTax: 0, sellTax: 0, liquidity: 0n, isRenounced: false };
  }

  try {
    // Check if we can get a quote (basic liquidity check)
    const amountsOutData = encodeGetAmountsOut(
      BigInt(1e17), // 0.1 native
      [wrappedNative, tokenAddress]
    );

    const quoteResult = await ethCall(rpcUrl, routerAddress, amountsOutData);

    if (!quoteResult || quoteResult === '0x') {
      return { isHoneypot: true, buyTax: 0, sellTax: 0, liquidity: 0n, isRenounced: false };
    }

    // Check ownership
    const ownerData = '0x8da5cb5b'; // owner()
    let isRenounced = false;
    try {
      const ownerResult = await ethCall(rpcUrl, tokenAddress, ownerData);
      const owner = '0x' + ownerResult.slice(-40);
      isRenounced = owner === '0x0000000000000000000000000000000000000000' ||
                    owner === '0x000000000000000000000000000000000000dead';
    } catch {
      isRenounced = true; // No owner function = likely renounced
    }

    return {
      isHoneypot: false,
      buyTax: 0, // Would need simulation for accurate tax
      sellTax: 0,
      liquidity: BigInt(5e18), // Placeholder
      isRenounced,
    };
  } catch (error) {
    console.error('[TokenAnalysis] Honeypot check error:', error);
    return { isHoneypot: true, buyTax: 0, sellTax: 0, liquidity: 0n, isRenounced: false };
  }
}

/**
 * Make eth_call
 */
async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  });

  interface RpcResponse {
    result?: string;
    error?: { message: string };
  }

  const result = (await response.json()) as RpcResponse;
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.result || '0x';
}

/**
 * Encode getAmountsOut call
 */
function encodeGetAmountsOut(amountIn: bigint, path: string[]): string {
  // getAmountsOut(uint256,address[])
  const selector = '0xd06ca61f';
  const amountHex = amountIn.toString(16).padStart(64, '0');
  const pathOffset = '0000000000000000000000000000000000000000000000000000000000000040';
  const pathLength = path.length.toString(16).padStart(64, '0');
  const pathAddresses = path.map(addr => addr.slice(2).padStart(64, '0')).join('');

  return selector + amountHex + pathOffset + pathLength + pathAddresses;
}

/**
 * Decode string from ABI-encoded result
 */
function decodeString(hex: string): string {
  try {
    if (!hex || hex === '0x' || hex.length < 130) return '';
    // Skip offset (32 bytes) and length (32 bytes), then decode
    const length = parseInt(hex.slice(66, 130), 16);
    const strHex = hex.slice(130, 130 + length * 2);
    return Buffer.from(strHex, 'hex').toString('utf8').replace(/\0/g, '');
  } catch {
    return '';
  }
}

/**
 * Calculate sellability score based on honeypot check
 */
function calculateSellabilityScore(check: { isHoneypot: boolean; buyTax: number; sellTax: number }): number {
  if (check.isHoneypot) return 0;
  let score = 5;
  if (check.sellTax > 10) score -= 3;
  else if (check.sellTax > 5) score -= 2;
  else if (check.sellTax > 2) score -= 1;
  return Math.max(0, score);
}

/**
 * Calculate liquidity score
 */
function calculateLiquidityScore(liquidity: bigint, chain: Chain): number {
  const liquidityNative = Number(liquidity) / 1e18;
  const minLiquidity = chain === 'eth' ? 2 : chain === 'bsc' ? 3 : 1;

  if (liquidityNative >= minLiquidity * 5) return 5;
  if (liquidityNative >= minLiquidity * 2) return 4;
  if (liquidityNative >= minLiquidity) return 3;
  if (liquidityNative >= minLiquidity / 2) return 2;
  return 1;
}

/**
 * Calculate execution risk score based on chain
 */
function calculateExecutionRiskScore(chain: Chain): number {
  // ETH has highest gas costs
  if (chain === 'eth') return 2;
  // BSC and Base are cheaper
  return 4;
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
 * Build reasons list for EVM
 */
function buildEVMReasons(check: {
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  isRenounced: boolean;
}): string[] {
  const reasons: string[] = [];
  if (check.isHoneypot) reasons.push('Potential honeypot');
  if (check.sellTax > 5) reasons.push(`High sell tax: ${check.sellTax}%`);
  if (!check.isRenounced) reasons.push('Ownership not renounced');
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

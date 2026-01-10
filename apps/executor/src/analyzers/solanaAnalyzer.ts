// Solana Token Analyzer
// Verifies token safety and calculates scores for Solana tokens

import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  isValidSolanaAddress,
  lamportsToSol,
  tokenAmountToDecimal,
  SPL_TOKEN_DECIMALS,
  type BondingCurveState,
  calculateBondingCurveProgress,
  calculateBondingCurvePrice,
} from '@raptor/shared';

export interface SolanaTokenAnalysis {
  safe: boolean;
  reason?: string;
  score: number;
  liquidity: number; // in SOL
  isRenounced: boolean;
  isFreezeAuthorityNull: boolean;
  isMintAuthorityNull: boolean;
  bondingCurveProgress: number; // 0-100
  graduated: boolean;
  marketCap: number; // in SOL
  holders: number;
  launchpad: string | null;
}

export interface MintInfo {
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export class SolanaAnalyzer {
  private rpcUrl: string;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
  }

  /**
   * Analyze a Solana token for safety and score
   */
  async analyzeToken(
    mintAddress: string,
    bondingCurveState?: BondingCurveState
  ): Promise<SolanaTokenAnalysis> {
    console.log(`[SolanaAnalyzer] Analyzing token: ${mintAddress}`);

    // Validate address
    if (!isValidSolanaAddress(mintAddress)) {
      return {
        safe: false,
        reason: 'Invalid mint address',
        score: 0,
        liquidity: 0,
        isRenounced: false,
        isFreezeAuthorityNull: false,
        isMintAuthorityNull: false,
        bondingCurveProgress: 0,
        graduated: false,
        marketCap: 0,
        holders: 0,
        launchpad: null,
      };
    }

    try {
      // Get mint info
      const mintInfo = await this.getMintInfo(mintAddress);
      if (!mintInfo) {
        return {
          safe: false,
          reason: 'Could not fetch mint info',
          score: 0,
          liquidity: 0,
          isRenounced: false,
          isFreezeAuthorityNull: false,
          isMintAuthorityNull: false,
          bondingCurveProgress: 0,
          graduated: false,
          marketCap: 0,
          holders: 0,
          launchpad: null,
        };
      }

      // Check authorities
      const isMintAuthorityNull = mintInfo.mintAuthority === null;
      const isFreezeAuthorityNull = mintInfo.freezeAuthority === null;
      const isRenounced = isMintAuthorityNull && isFreezeAuthorityNull;

      // Calculate bonding curve progress
      let bondingCurveProgress = 0;
      let graduated = true;
      let liquidity = 0;
      let marketCap = 0;
      let launchpad: string | null = null;

      if (bondingCurveState) {
        bondingCurveProgress = calculateBondingCurveProgress(bondingCurveState);
        graduated = bondingCurveState.complete;
        liquidity = lamportsToSol(bondingCurveState.realSolReserves);
        const price = calculateBondingCurvePrice(bondingCurveState);
        const totalSupply = tokenAmountToDecimal(
          bondingCurveState.tokenTotalSupply,
          SPL_TOKEN_DECIMALS
        );
        marketCap = price * totalSupply;
        launchpad = 'pump.fun';
      }

      // Get holder count
      const holders = await this.getHolderCount(mintAddress);

      // Calculate safety score
      const score = this.calculateScore({
        isRenounced,
        isMintAuthorityNull,
        isFreezeAuthorityNull,
        bondingCurveProgress,
        liquidity,
        holders,
        graduated,
      });

      // Determine if safe
      const safe = this.isSafe({
        isFreezeAuthorityNull,
        isMintAuthorityNull,
        bondingCurveProgress,
        liquidity,
        score,
      });

      let reason: string | undefined;
      if (!safe) {
        if (!isFreezeAuthorityNull) {
          reason = 'Freeze authority not renounced';
        } else if (!isMintAuthorityNull) {
          reason = 'Mint authority not renounced';
        } else if (liquidity < 1) {
          reason = 'Insufficient liquidity';
        } else if (score < 15) {
          // SECURITY: P1-1 - Updated threshold for 0-35 scale
          reason = 'Low safety score';
        }
      }

      console.log(`[SolanaAnalyzer] Token ${mintAddress} score: ${score}`);

      return {
        safe,
        reason,
        score,
        liquidity,
        isRenounced,
        isFreezeAuthorityNull,
        isMintAuthorityNull,
        bondingCurveProgress,
        graduated,
        marketCap,
        holders,
        launchpad,
      };
    } catch (error) {
      console.error('[SolanaAnalyzer] Error analyzing token:', error);
      return {
        safe: false,
        reason: 'Analysis failed',
        score: 0,
        liquidity: 0,
        isRenounced: false,
        isFreezeAuthorityNull: false,
        isMintAuthorityNull: false,
        bondingCurveProgress: 0,
        graduated: false,
        marketCap: 0,
        holders: 0,
        launchpad: null,
      };
    }
  }

  /**
   * Get mint account info
   */
  async getMintInfo(mintAddress: string): Promise<MintInfo | null> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            mintAddress,
            { encoding: 'jsonParsed' },
          ],
        }),
      });

      interface MintResponse {
        result?: {
          value?: {
            data?: {
              parsed?: {
                info?: {
                  decimals: number;
                  supply: string;
                  mintAuthority?: string | null;
                  freezeAuthority?: string | null;
                };
              };
            };
          };
        };
      }
      const data = (await response.json()) as MintResponse;
      const info = data.result?.value?.data?.parsed?.info;

      if (!info) {
        return null;
      }

      return {
        decimals: info.decimals,
        supply: BigInt(info.supply),
        mintAuthority: info.mintAuthority || null,
        freezeAuthority: info.freezeAuthority || null,
      };
    } catch (error) {
      console.error('[SolanaAnalyzer] Error getting mint info:', error);
      return null;
    }
  }

  /**
   * Get holder count for a token
   * SECURITY: P1-2 - Uses multiple data sources for accurate count
   */
  async getHolderCount(mintAddress: string): Promise<number> {
    // Try Birdeye API first for accurate count
    const birdeyeCount = await this.getHolderCountFromBirdeye(mintAddress);
    if (birdeyeCount > 0) {
      return birdeyeCount;
    }

    // Fallback to RPC-based estimation using getProgramAccounts
    try {
      // Use getTokenAccountsByMint for more accurate count
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByMint',
          params: [
            mintAddress,
            { encoding: 'jsonParsed' },
          ],
        }),
      });

      interface TokenAccountsResponse {
        result?: {
          value?: Array<{
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: { amount: string };
                  };
                };
              };
            };
          }>;
        };
      }
      const data = (await response.json()) as TokenAccountsResponse;
      const accounts = data.result?.value || [];

      // Filter out zero balances
      const nonZeroHolders = accounts.filter(
        (acc) => acc.account.data.parsed.info.tokenAmount.amount !== '0'
      );

      return nonZeroHolders.length;
    } catch {
      // Final fallback to getTokenLargestAccounts (capped at 20)
      return this.getHolderCountFallback(mintAddress);
    }
  }

  /**
   * Get holder count from Birdeye API
   * SECURITY: P1-2 - External API for accurate holder counts
   */
  private async getHolderCountFromBirdeye(mintAddress: string): Promise<number> {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      return 0; // No API key configured
    }

    try {
      const response = await fetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${mintAddress}`,
        {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        return 0;
      }

      interface BirdeyeResponse {
        success: boolean;
        data?: {
          holder?: number;
          uniqueWallet24h?: number;
        };
      }
      const data = (await response.json()) as BirdeyeResponse;

      if (data.success && data.data?.holder) {
        console.log(`[SolanaAnalyzer] Birdeye holder count: ${data.data.holder}`);
        return data.data.holder;
      }

      return 0;
    } catch (error) {
      console.warn('[SolanaAnalyzer] Birdeye API error:', error);
      return 0;
    }
  }

  /**
   * Fallback holder count using getTokenLargestAccounts
   * Note: This is capped at 20, use only as last resort
   */
  private async getHolderCountFallback(mintAddress: string): Promise<number> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenLargestAccounts',
          params: [mintAddress],
        }),
      });

      interface HolderResponse {
        result?: {
          value?: Array<{ amount: string }>;
        };
      }
      const data = (await response.json()) as HolderResponse;
      const accounts = data.result?.value || [];

      const nonZeroHolders = accounts.filter((acc) => acc.amount !== '0');

      // Log warning if we hit the 20 cap
      if (nonZeroHolders.length >= 20) {
        console.warn(`[SolanaAnalyzer] Holder count may be underestimated (capped at 20)`);
      }

      return nonZeroHolders.length;
    } catch (error) {
      console.error('[SolanaAnalyzer] Error getting holder count:', error);
      return 0;
    }
  }

  /**
   * Calculate token safety score (0-35)
   * SECURITY: P1-1 - Normalized to match EVM 7-category scoring (0-35 scale)
   *
   * Categories (5 points each):
   * 1. Sellability (5) - Authority checks
   * 2. Supply Integrity (5) - Mint authority
   * 3. Liquidity Control (5) - Liquidity depth
   * 4. Distribution (5) - Holder count
   * 5. Deployer Provenance (5) - Bonding curve progress
   * 6. Post-Launch Controls (5) - Freeze authority
   * 7. Execution Risk (5) - Graduated status
   */
  private calculateScore(params: {
    isRenounced: boolean;
    isMintAuthorityNull: boolean;
    isFreezeAuthorityNull: boolean;
    bondingCurveProgress: number;
    liquidity: number;
    holders: number;
    graduated: boolean;
  }): number {
    let score = 0;

    // Category 1: Sellability (5 points) - based on freeze authority
    if (params.isFreezeAuthorityNull) score += 5;
    else score += 0; // Can't sell if freeze authority exists

    // Category 2: Supply Integrity (5 points) - based on mint authority
    if (params.isMintAuthorityNull) score += 5;
    else if (params.bondingCurveProgress < 100) score += 3; // Pre-graduation tokens have mint authority
    else score += 0;

    // Category 3: Liquidity Control (5 points)
    if (params.liquidity >= 10) score += 5;
    else if (params.liquidity >= 5) score += 4;
    else if (params.liquidity >= 2) score += 3;
    else if (params.liquidity >= 1) score += 2;
    else if (params.liquidity >= 0.5) score += 1;

    // Category 4: Distribution (5 points) - based on holder count
    if (params.holders >= 100) score += 5;
    else if (params.holders >= 50) score += 4;
    else if (params.holders >= 20) score += 3;
    else if (params.holders >= 10) score += 2;
    else if (params.holders >= 5) score += 1;

    // Category 5: Deployer Provenance (5 points) - based on bonding curve progress
    if (params.bondingCurveProgress >= 80) score += 5;
    else if (params.bondingCurveProgress >= 60) score += 4;
    else if (params.bondingCurveProgress >= 40) score += 3;
    else if (params.bondingCurveProgress >= 20) score += 2;
    else if (params.bondingCurveProgress >= 10) score += 1;

    // Category 6: Post-Launch Controls (5 points) - renounced = safer
    if (params.isRenounced) score += 5;
    else if (params.isMintAuthorityNull) score += 3;
    else if (params.isFreezeAuthorityNull) score += 2;

    // Category 7: Execution Risk (5 points) - graduated = proven
    if (params.graduated) score += 5;
    else if (params.bondingCurveProgress >= 70) score += 3;
    else if (params.liquidity >= 2) score += 2;

    return Math.min(35, score);
  }

  /**
   * Determine if token is safe to trade
   * SECURITY: P1-1 - Updated thresholds for 0-35 scale
   */
  private isSafe(params: {
    isFreezeAuthorityNull: boolean;
    isMintAuthorityNull: boolean;
    bondingCurveProgress: number;
    liquidity: number;
    score: number;
  }): boolean {
    // Must not have freeze authority
    if (!params.isFreezeAuthorityNull) {
      return false;
    }

    // Pump.fun tokens start with mint authority, it's renounced on graduation
    // So for bonding curve tokens, we accept non-null mint authority

    // Need minimum liquidity
    if (params.liquidity < 0.5) {
      return false;
    }

    // Need minimum score (15/35 = ~42%, equivalent to old 30/100)
    // Using SCORE_SKIP threshold from scorer.ts
    if (params.score < 15) {
      return false;
    }

    return true;
  }

  /**
   * Check if token is from a known launchpad
   */
  async identifyLaunchpad(mintAddress: string): Promise<string | null> {
    // In production, would check:
    // 1. If there's a bonding curve PDA for pump.fun
    // 2. Check transaction history for known program interactions
    // 3. Check metadata for known launchpad signatures

    // For now, try to find pump.fun bonding curve
    try {
      // Derive bonding curve PDA
      // This is a placeholder - actual implementation needs proper PDA derivation
      return 'pump.fun'; // Default assumption for now
    } catch {
      return null;
    }
  }

  /**
   * Check if token is a known scam/honeypot
   * Uses blacklists and pattern detection
   */
  async isKnownScam(mintAddress: string): Promise<boolean> {
    // In production, would check:
    // 1. Local blacklist
    // 2. External API (if available)
    // 3. Pattern matching (suspicious names, etc.)

    return false;
  }

  /**
   * Verify the token was created by pump.fun program
   */
  async verifyPumpFunOrigin(mintAddress: string): Promise<boolean> {
    try {
      // Get the mint account's creation transaction
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            mintAddress,
            { limit: 1 },
          ],
        }),
      });

      interface SignaturesResponse {
        result?: Array<{ signature: string }>;
      }
      const data = (await response.json()) as SignaturesResponse;
      const signatures = data.result || [];

      if (signatures.length === 0) {
        return false;
      }

      // Get the first (creation) transaction
      const creationTx = await this.getTransaction(signatures[0].signature);
      if (!creationTx) {
        return false;
      }

      // Check if pump.fun program was involved
      const programIds = creationTx.accountKeys || [];
      return programIds.some(
        (key) => key === PROGRAM_IDS.PUMP_FUN
      );
    } catch (error) {
      console.error('[SolanaAnalyzer] Error verifying pump.fun origin:', error);
      return false;
    }
  }

  /**
   * Get transaction details
   */
  private async getTransaction(signature: string): Promise<{ accountKeys: string[] } | null> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
          ],
        }),
      });

      interface TxResponse {
        result?: {
          transaction?: {
            message?: {
              accountKeys?: Array<{ pubkey?: string } | string>;
            };
          };
        };
      }
      const data = (await response.json()) as TxResponse;
      const tx = data.result;
      if (!tx?.transaction?.message?.accountKeys) {
        return null;
      }
      // Normalize account keys to strings
      const accountKeys = tx.transaction.message.accountKeys.map((k) =>
        typeof k === 'string' ? k : (k.pubkey || '')
      );
      return { accountKeys };
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const solanaAnalyzer = new SolanaAnalyzer();

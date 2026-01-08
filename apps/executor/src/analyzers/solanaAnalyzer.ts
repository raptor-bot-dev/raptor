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
        } else if (score < 40) {
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
   * Get approximate holder count for a token
   */
  async getHolderCount(mintAddress: string): Promise<number> {
    try {
      // Use getTokenLargestAccounts as a proxy for holder count
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

      // Filter out zero balances
      const nonZeroHolders = accounts.filter(
        (acc) => acc.amount !== '0'
      );

      // This returns up to 20 largest holders
      // In production, would use a proper indexer for accurate count
      return nonZeroHolders.length;
    } catch (error) {
      console.error('[SolanaAnalyzer] Error getting holder count:', error);
      return 0;
    }
  }

  /**
   * Calculate token safety score (0-100)
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

    // Authority checks (40 points max)
    if (params.isMintAuthorityNull) score += 20;
    if (params.isFreezeAuthorityNull) score += 20;

    // Liquidity (25 points max)
    if (params.liquidity >= 10) score += 25;
    else if (params.liquidity >= 5) score += 20;
    else if (params.liquidity >= 2) score += 15;
    else if (params.liquidity >= 1) score += 10;
    else if (params.liquidity >= 0.5) score += 5;

    // Bonding curve progress (15 points max)
    // Higher progress = more community interest
    if (params.bondingCurveProgress >= 80) score += 15;
    else if (params.bondingCurveProgress >= 60) score += 12;
    else if (params.bondingCurveProgress >= 40) score += 8;
    else if (params.bondingCurveProgress >= 20) score += 4;

    // Holders (10 points max)
    if (params.holders >= 100) score += 10;
    else if (params.holders >= 50) score += 8;
    else if (params.holders >= 20) score += 5;
    else if (params.holders >= 10) score += 3;

    // Graduation bonus (10 points)
    // Graduated tokens have proven some level of success
    if (params.graduated) score += 10;

    return Math.min(100, score);
  }

  /**
   * Determine if token is safe to trade
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

    // Need minimum score
    if (params.score < 30) {
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

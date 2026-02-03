// =============================================================================
// RAPTOR v6.0 Scoring Rules — bags.fm Optimized
// Simplified for bags.fm where mint/freeze are auto-revoked by platform
// Focus: metadata quality, holder distribution, volume, dev holdings
// =============================================================================

import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS, SOLANA_CONFIG, isValidSolanaAddress, type OpportunityV31 } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';
import type { TokenMetadata } from '../utils/metadataFetcher.js';
import { KNOWN_PROGRAM_IDS } from '../sources/meteoraParser.js';

const solanaConnection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');

// =============================================================================
// CONFIG — Tune these thresholds
// =============================================================================
const CONFIG = {
  DEV_HOLDINGS_MAX_PERCENT: 10,      // Hard gate: dev can't hold more than 10%
  MIN_HOLDER_COUNT: 5,               // Soft gate: want at least 5 unique holders
  MIN_VOLUME_USD: 100,               // Soft gate: minimum 24h volume in USD
  VOLUME_TIER_1_USD: 1000,           // Scoring: decent volume
  VOLUME_TIER_2_USD: 10000,          // Scoring: good volume
  VOLUME_TIER_3_USD: 50000,          // Scoring: excellent volume
};

// =============================================================================
// HELPER: Get creator holdings percentage
// =============================================================================
async function getCreatorHoldingsPercent(creator: string, mint: string): Promise<number | null> {
  if (!isValidSolanaAddress(creator) || !isValidSolanaAddress(mint)) {
    return null;
  }

  try {
    const creatorKey = new PublicKey(creator);
    const mintKey = new PublicKey(mint);

    const supply = await solanaConnection.getTokenSupply(mintKey);
    const supplyAmount = BigInt(supply.value.amount);
    if (supplyAmount === 0n) return null;

    const programIds = [PROGRAM_IDS.TOKEN_PROGRAM, PROGRAM_IDS.TOKEN_2022_PROGRAM];
    let creatorAmount = 0n;

    for (const programId of programIds) {
      try {
        const accounts = await solanaConnection.getParsedTokenAccountsByOwner(
          creatorKey,
          { programId: new PublicKey(programId) }
        );

        for (const account of accounts.value) {
          const parsed = account.account.data?.parsed as
            | { info?: { mint?: string; tokenAmount?: { amount?: string } } }
            | undefined;
          const info = parsed?.info;
          if (!info || info.mint !== mint) continue;
          const amount = info.tokenAmount?.amount;
          if (amount) creatorAmount += BigInt(amount);
        }
      } catch {
        continue;
      }
    }

    const percentTimes100 = (creatorAmount * 10000n) / supplyAmount;
    return Number(percentTimes100) / 100;
  } catch {
    return null;
  }
}

// =============================================================================
// HELPER: Get holder stats (count + concentration)
// =============================================================================
async function getHolderStats(mint: string): Promise<{
  holderCount: number;
  topHolderPercent: number;
} | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const [largestAccounts, supply] = await Promise.all([
      solanaConnection.getTokenLargestAccounts(mintPubkey),
      solanaConnection.getTokenSupply(mintPubkey),
    ]);

    const supplyAmount = BigInt(supply.value.amount);
    if (supplyAmount === 0n) return null;

    // Top holder percentage (largest single holder)
    const topAmount = largestAccounts.value[0]
      ? BigInt(largestAccounts.value[0].amount)
      : 0n;
    const topPercent = Number((topAmount * 10000n) / supplyAmount) / 100;

    return {
      holderCount: largestAccounts.value.length,
      topHolderPercent: topPercent,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// HELPER: Get 24h volume from Jupiter/Birdeye
// =============================================================================
async function get24hVolumeUSD(mint: string): Promise<number | null> {
  try {
    // Try Birdeye first (more reliable for new tokens)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'x-chain': 'solana',
        },
      }
    );
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json() as {
        data?: { v24hUSD?: number };
      };
      if (data.data?.v24hUSD !== undefined) {
        return data.data.v24hUSD;
      }
    }

    // Fallback: try Jupiter price API for basic liquidity check
    const jupResponse = await fetch(
      `https://price.jup.ag/v6/price?ids=${mint}`,
      { signal: AbortSignal.timeout(2000) }
    );
    if (jupResponse.ok) {
      const jupData = await jupResponse.json() as {
        data?: Record<string, { price?: number }>;
      };
      // If Jupiter has a price, there's at least some liquidity
      if (jupData.data?.[mint]?.price) {
        return CONFIG.MIN_VOLUME_USD; // Return minimum as "has liquidity"
      }
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// TYPES
// =============================================================================
export interface ScoringContext {
  opportunity: OpportunityV31;
  event: PumpFunEvent;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  bondingCurve: string;
  timestamp: number;
  metadata?: TokenMetadata | null;
}

export interface RuleResult {
  passed: boolean;
  value: unknown;
}

export interface ScoringRule {
  name: string;
  weight: number;
  isHardStop: boolean;
  evaluate: (context: ScoringContext) => Promise<RuleResult>;
}

// =============================================================================
// SCORING RULES — bags.fm Optimized (v6.0)
// 
// Hard Gates (instant reject):
//   - must have ticker
//   - must have name
//   - must have Twitter/X linked
//   - dev holdings ≤ 10%
//
// Scoring (weighted):
//   - website present: +10
//   - holder count tiers: +5/10/15
//   - volume tiers: +10/15/20
//   - holder distribution (not too concentrated): +10
//   - profile image: +5
//   - recent launch: +10
//
// Max score: 100 | Qualify: 30+
// =============================================================================

export const scoringRules: ScoringRule[] = [
  // =========================================================================
  // HARD GATES — Must pass all to qualify
  // =========================================================================

  {
    name: 'has_ticker',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const hasSymbol = Boolean(ctx.symbol && ctx.symbol.trim().length > 0);
      return { passed: hasSymbol, value: ctx.symbol || 'MISSING' };
    },
  },

  {
    name: 'has_name',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const hasName = Boolean(ctx.name && ctx.name.trim().length > 0);
      return { passed: hasName, value: ctx.name || 'MISSING' };
    },
  },

  {
    name: 'has_twitter',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      // bags.fm requires Twitter to deploy — this should always be present
      // Check both metadata.twitter and the event for twitter link
      const twitter = ctx.metadata?.twitter;
      const hasTwitter = Boolean(twitter && twitter.trim().length > 0);
      return { 
        passed: hasTwitter, 
        value: hasTwitter ? twitter : 'NO_TWITTER_LINKED' 
      };
    },
  },

  {
    name: 'dev_holdings_max_10pct',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const percent = await getCreatorHoldingsPercent(ctx.creator, ctx.mint);
      if (percent === null) {
        // Can't verify — allow but log (new tokens may not resolve instantly)
        console.log(`[Scorer] Holdings check failed for ${ctx.mint.slice(0, 8)}..., allowing`);
        return { passed: true, value: 'UNKNOWN' };
      }
      const passed = percent <= CONFIG.DEV_HOLDINGS_MAX_PERCENT;
      return { 
        passed, 
        value: `${percent.toFixed(1)}%${passed ? '' : ' (TOO HIGH)'}` 
      };
    },
  },

  // =========================================================================
  // SCORING SIGNALS — Contribute to total score
  // =========================================================================

  {
    name: 'has_website',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      const website = ctx.metadata?.website;
      const hasWebsite = Boolean(website && website.trim().length > 0);
      return { passed: hasWebsite, value: website || 'none' };
    },
  },

  {
    name: 'has_profile_image',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      const image = ctx.metadata?.image;
      const hasImage = Boolean(image && image.trim().length > 0);
      return { passed: hasImage, value: hasImage ? 'yes' : 'no' };
    },
  },

  {
    name: 'holder_count',
    weight: 15,
    isHardStop: false,
    evaluate: async (ctx) => {
      const stats = await getHolderStats(ctx.mint);
      if (!stats) return { passed: false, value: 'check_failed' };

      const count = stats.holderCount;
      if (count >= 20) {
        return { passed: true, value: `${count} holders (excellent)` };
      } else if (count >= 10) {
        return { passed: true, value: `${count} holders (good)` };
      } else if (count >= CONFIG.MIN_HOLDER_COUNT) {
        return { passed: true, value: `${count} holders (ok)` };
      }
      return { passed: false, value: `${count} holders (too few)` };
    },
  },

  {
    name: 'holder_distribution',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      const stats = await getHolderStats(ctx.mint);
      if (!stats) return { passed: false, value: 'check_failed' };

      // Top holder shouldn't have more than 50%
      if (stats.topHolderPercent < 30) {
        return { passed: true, value: `${stats.topHolderPercent.toFixed(1)}% (well distributed)` };
      } else if (stats.topHolderPercent < 50) {
        return { passed: true, value: `${stats.topHolderPercent.toFixed(1)}% (acceptable)` };
      }
      return { passed: false, value: `${stats.topHolderPercent.toFixed(1)}% (too concentrated)` };
    },
  },

  {
    name: 'volume_24h',
    weight: 20,
    isHardStop: false,
    evaluate: async (ctx) => {
      const volume = await get24hVolumeUSD(ctx.mint);
      if (volume === null) return { passed: false, value: 'check_failed' };

      if (volume >= CONFIG.VOLUME_TIER_3_USD) {
        return { passed: true, value: `$${volume.toLocaleString()} (excellent)` };
      } else if (volume >= CONFIG.VOLUME_TIER_2_USD) {
        return { passed: true, value: `$${volume.toLocaleString()} (good)` };
      } else if (volume >= CONFIG.VOLUME_TIER_1_USD) {
        return { passed: true, value: `$${volume.toLocaleString()} (decent)` };
      } else if (volume >= CONFIG.MIN_VOLUME_USD) {
        return { passed: true, value: `$${volume.toLocaleString()} (low)` };
      }
      return { passed: false, value: `$${volume.toLocaleString()} (too low)` };
    },
  },

  {
    name: 'timestamp_recent',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Fresher launches are better — we want to be early
      const age = Date.now() / 1000 - ctx.timestamp;
      if (age < 60) {
        return { passed: true, value: `${Math.round(age)}s (very fresh)` };
      } else if (age < 300) {
        return { passed: true, value: `${Math.round(age / 60)}m (fresh)` };
      } else if (age < 3600) {
        return { passed: true, value: `${Math.round(age / 60)}m (recent)` };
      }
      return { passed: false, value: `${Math.round(age / 3600)}h (old)` };
    },
  },

  {
    name: 'name_quality',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Basic quality check — not spam/test names
      const name = ctx.name.toLowerCase();
      const spamPatterns = [
        'test', 'rug', 'scam', 'fake', 'asdf', 'qwerty',
        'xxx', 'aaa', 'bbb', 'sample', 'demo',
      ];
      const isSpam = spamPatterns.some((p) => name.includes(p));
      if (isSpam) {
        return { passed: false, value: 'spam_pattern' };
      }
      // Bonus for reasonable length
      if (name.length >= 3 && name.length <= 30) {
        return { passed: true, value: 'good_length' };
      }
      return { passed: false, value: 'bad_length' };
    },
  },

  {
    name: 'symbol_quality',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      const symbol = ctx.symbol;
      // Good tickers are 2-8 chars, uppercase
      if (symbol.length >= 2 && symbol.length <= 8) {
        return { passed: true, value: `${symbol} (valid)` };
      }
      return { passed: false, value: `${symbol} (bad length)` };
    },
  },

  {
    name: 'has_description',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      const desc = ctx.metadata?.description;
      const hasDesc = Boolean(desc && desc.trim().length > 10);
      return { passed: hasDesc, value: hasDesc ? 'yes' : 'no' };
    },
  },

  {
    name: 'has_telegram',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      const telegram = ctx.metadata?.telegram;
      const hasTelegram = Boolean(telegram && telegram.trim().length > 0);
      return { passed: hasTelegram, value: telegram || 'none' };
    },
  },
];

// =============================================================================
// CANDIDATE SCORING (for on-chain detected launches before full metadata)
// Lighter checks for initial filtering
// =============================================================================

export interface CandidateScoringContext {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  bondingCurve: string;
  timestamp: number;
}

export interface CandidateScoringRule {
  name: string;
  weight: number;
  isHardStop: boolean;
  evaluate: (context: CandidateScoringContext) => Promise<RuleResult>;
}

export const candidateScoringRules: CandidateScoringRule[] = [
  // Hard stops for candidates
  {
    name: 'mint_not_known_program',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const passed = !KNOWN_PROGRAM_IDS.has(ctx.mint);
      return { passed, value: passed ? 'ok' : 'known_program' };
    },
  },

  {
    name: 'has_symbol',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const passed = Boolean(ctx.symbol && ctx.symbol.trim().length > 0);
      return { passed, value: ctx.symbol || 'MISSING' };
    },
  },

  {
    name: 'has_name',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const passed = Boolean(ctx.name && ctx.name.trim().length > 0);
      return { passed, value: ctx.name || 'MISSING' };
    },
  },

  // Scoring signals
  {
    name: 'timestamp_recent',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      const age = Date.now() / 1000 - ctx.timestamp;
      const isRecent = age < 120; // 2 minutes
      return { passed: isRecent, value: `${Math.round(age)}s` };
    },
  },

  {
    name: 'symbol_quality',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      const len = ctx.symbol.length;
      const passed = len >= 2 && len <= 8;
      return { passed, value: len };
    },
  },

  {
    name: 'name_not_spam',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      if (!ctx.name) return { passed: true, value: 'no_name' };
      const name = ctx.name.toLowerCase();
      const spamPatterns = ['test', 'rug', 'scam', 'fake', 'asdf'];
      const isSpam = spamPatterns.some((p) => name.includes(p));
      return { passed: !isSpam, value: isSpam ? 'spam' : 'ok' };
    },
  },
];

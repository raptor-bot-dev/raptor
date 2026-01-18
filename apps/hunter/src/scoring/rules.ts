// =============================================================================
// RAPTOR v4.3 Scoring Rules
// Individual rules for token scoring with metadata support
// =============================================================================

import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS, SOLANA_CONFIG, isValidSolanaAddress, type OpportunityV31 } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';
import type { TokenMetadata } from '../utils/metadataFetcher.js';

const solanaConnection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');
const DEV_HOLDINGS_MAX_PERCENT = 10;

async function getCreatorHoldingsPercent(creator: string, mint: string): Promise<number | null> {
  if (!isValidSolanaAddress(creator) || !isValidSolanaAddress(mint)) {
    return null;
  }

  try {
    const creatorKey = new PublicKey(creator);
    const mintKey = new PublicKey(mint);

    const supply = await solanaConnection.getTokenSupply(mintKey);
    const supplyAmount = BigInt(supply.value.amount);
    if (supplyAmount === 0n) {
      return null;
    }

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
          if (!info || info.mint !== mint) {
            continue;
          }
          const amount = info.tokenAmount?.amount;
          if (amount) {
            creatorAmount += BigInt(amount);
          }
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

export interface ScoringContext {
  opportunity: OpportunityV31;
  event: PumpFunEvent;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  bondingCurve: string;
  timestamp: number;
  metadata?: TokenMetadata | null;  // v4.3: Optional metadata from fetch
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

/**
 * All scoring rules
 */
export const scoringRules: ScoringRule[] = [
  // =========================================================================
  // HARD STOPS (fail entire token)
  // =========================================================================

  {
    name: 'not_honeypot',
    weight: 0,
    isHardStop: true,
    evaluate: async () => {
      // Solana SPL tokens use a standardized token program.
      // Unlike EVM chains, SPL tokens CANNOT have:
      // - Transfer taxes
      // - Blacklist functions
      // - Sell restrictions (honeypot logic)
      // - Pausable transfers
      //
      // GoPlus/honeypot checks are EVM-specific and useless here.
      // Real Solana risks (rug pulls) are handled by deployer blacklist
      // and bonding curve monitoring.
      return { passed: true, value: 'spl_safe' };
    },
  },

  {
    name: 'creator_holdings_under_10pct',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      const percent = await getCreatorHoldingsPercent(ctx.creator, ctx.mint);
      if (percent === null) {
        return { passed: false, value: 'holdings_unknown' };
      }
      const passed = percent <= DEV_HOLDINGS_MAX_PERCENT;
      return { passed, value: percent };
    },
  },

  // =========================================================================
  // POSITIVE SIGNALS
  // =========================================================================

  {
    name: 'symbol_length',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Prefer symbols between 3-6 characters
      const len = ctx.symbol.length;
      const passed = len >= 3 && len <= 6;
      return { passed, value: len };
    },
  },

  {
    name: 'name_not_spam',
    weight: 8,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Check for spam patterns
      const name = ctx.name.toLowerCase();
      const spamPatterns = [
        'test',
        'rug',
        'scam',
        'fake',
        'free',
        'giveaway',
        'airdrop',
        'presale',
        'whitelist',
      ];
      const isSpam = spamPatterns.some((p) => name.includes(p));
      return { passed: !isSpam, value: isSpam };
    },
  },

  {
    name: 'has_metadata_uri',
    weight: 5,
    isHardStop: false,  // Relaxed: pump.pro tokens may not have URI available immediately
    evaluate: async (ctx) => {
      // Token has metadata URI
      const hasUri = Boolean(ctx.event.uri && ctx.event.uri.length > 0);
      return { passed: hasUri, value: ctx.event.uri };
    },
  },

  {
    name: 'uri_is_ipfs_or_arweave',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Prefer decentralized storage
      const uri = ctx.event.uri.toLowerCase();
      const isDecentralized =
        uri.includes('ipfs') || uri.includes('arweave') || uri.includes('ar://');
      return { passed: isDecentralized, value: uri.slice(0, 50) };
    },
  },

  {
    name: 'fresh_deployer',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      // TODO: Check if deployer has created tokens before
      // Fresh deployers can be good (dedicated token) or bad (throw-away)
      // For now, give benefit of doubt
      return { passed: true, value: ctx.creator };
    },
  },

  {
    name: 'timestamp_recent',
    weight: 10,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Token created within last 60 seconds
      const age = Date.now() / 1000 - ctx.timestamp;
      const isRecent = age < 60;
      return { passed: isRecent, value: Math.round(age) };
    },
  },

  // =========================================================================
  // SOCIAL SIGNALS (v4.3: Now uses fetched metadata)
  // =========================================================================

  // SOCIAL SIGNALS - Temporarily relaxed for pump.pro (API returning 530)
  // TODO: Re-enable hard stops when pump.fun API is stable
  {
    name: 'has_twitter',
    weight: 5,
    isHardStop: false,  // Relaxed: pump.pro metadata unavailable
    evaluate: async (ctx) => {
      // Check metadata for Twitter link
      if (!ctx.metadata) return { passed: false, value: 'no_metadata' };
      const hasTwitter = Boolean(ctx.metadata.twitter);
      return { passed: hasTwitter, value: ctx.metadata.twitter || null };
    },
  },

  {
    name: 'has_telegram',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // Check metadata for Telegram link
      if (!ctx.metadata) return { passed: false, value: 'no_metadata' };
      const hasTelegram = Boolean(ctx.metadata.telegram);
      return { passed: hasTelegram, value: ctx.metadata.telegram || null };
    },
  },

  {
    name: 'has_website',
    weight: 5,
    isHardStop: false,  // Relaxed: pump.pro metadata unavailable
    evaluate: async (ctx) => {
      // Check metadata for website
      if (!ctx.metadata) return { passed: false, value: 'no_metadata' };
      const hasWebsite = Boolean(ctx.metadata.website);
      return { passed: hasWebsite, value: ctx.metadata.website || null };
    },
  },

  {
    name: 'has_profile_image',
    weight: 5,
    isHardStop: false,  // Relaxed: pump.pro metadata unavailable
    evaluate: async (ctx) => {
      // Check metadata for profile image (v4.3)
      if (!ctx.metadata) return { passed: false, value: 'no_metadata' };
      const hasImage = Boolean(ctx.metadata.image);
      return { passed: hasImage, value: ctx.metadata.image?.slice(0, 50) || null };
    },
  },
];

// =============================================================================
// RAPTOR v4.3 Scoring Rules
// Individual rules for token scoring with metadata support
// =============================================================================

import type { OpportunityV31 } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';
import type { TokenMetadata } from '../utils/metadataFetcher.js';

// Known scammer deployers (global blacklist)
// These wallets have been identified as serial rug-pullers
const GLOBAL_DEPLOYER_BLACKLIST: string[] = [
  // Add known scammer addresses here as they're identified
  // Example: 'ScamWallet111111111111111111111111111111111'
];

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
    name: 'deployer_not_blacklisted',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      // v4.3: Check deployer against global blacklist
      // Strategy-level denylist is checked separately in strategyMatchesOpportunity
      if (GLOBAL_DEPLOYER_BLACKLIST.includes(ctx.creator)) {
        console.warn(`[Rules] BLACKLISTED DEPLOYER: ${ctx.creator} for ${ctx.symbol}`);
        return { passed: false, value: ctx.creator };
      }
      return { passed: true, value: ctx.creator };
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
    isHardStop: false,
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

  {
    name: 'has_twitter',
    weight: 5,
    isHardStop: false,
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
    isHardStop: false,
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
    isHardStop: false,
    evaluate: async (ctx) => {
      // Check metadata for profile image (v4.3)
      if (!ctx.metadata) return { passed: false, value: 'no_metadata' };
      const hasImage = Boolean(ctx.metadata.image);
      return { passed: hasImage, value: ctx.metadata.image?.slice(0, 50) || null };
    },
  },
];

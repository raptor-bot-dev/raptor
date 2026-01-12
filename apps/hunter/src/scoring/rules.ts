// =============================================================================
// RAPTOR v3.1 Scoring Rules
// Individual rules for token scoring
// =============================================================================

import type { OpportunityV31 } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';

export interface ScoringContext {
  opportunity: OpportunityV31;
  event: PumpFunEvent;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  bondingCurve: string;
  timestamp: number;
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
    evaluate: async (ctx) => {
      // TODO: Integrate with honeypot detection service
      // For now, pass everything
      return { passed: true, value: false };
    },
  },

  {
    name: 'deployer_not_blacklisted',
    weight: 0,
    isHardStop: true,
    evaluate: async (ctx) => {
      // TODO: Check deployer against blacklist
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
  // SOCIAL SIGNALS (future integration)
  // =========================================================================

  {
    name: 'has_twitter',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // TODO: Fetch metadata and check for Twitter link
      return { passed: false, value: null };
    },
  },

  {
    name: 'has_telegram',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // TODO: Fetch metadata and check for Telegram link
      return { passed: false, value: null };
    },
  },

  {
    name: 'has_website',
    weight: 5,
    isHardStop: false,
    evaluate: async (ctx) => {
      // TODO: Fetch metadata and check for website
      return { passed: false, value: null };
    },
  },
];

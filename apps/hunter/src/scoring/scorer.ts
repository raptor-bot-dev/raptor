// =============================================================================
// RAPTOR v6.0 Token Scorer — bags.fm Optimized
// Scores tokens based on metadata quality, holder distribution, volume
// Assumes bags.fm handles mint/freeze revocation automatically
// =============================================================================

import type { OpportunityV31, LaunchCandidate } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';
import { scoringRules, candidateScoringRules, type ScoringRule, type CandidateScoringContext } from './rules.js';
import type { TokenMetadata } from '../utils/metadataFetcher.js';

export interface ScoringReason {
  rule: string;
  value: unknown;
  passed: boolean;
  weight: number;
  isHardStop?: boolean;
}

export interface ScoringResult {
  totalScore: number;
  maxScore: number;
  qualified: boolean;
  reasons: ScoringReason[];
  hardStopTriggered: boolean;
  hardStopReason?: string;
}

// Minimum score to qualify an opportunity (v6.0: bags.fm optimized)
// Max possible: 90 points (if all scoring signals pass)
// 30+ = qualifies, 50+ = strong (full position)
const MIN_QUALIFICATION_SCORE = 30;

// Lower threshold for on-chain candidates (fewer signals available)
const MIN_CANDIDATE_QUALIFICATION_SCORE = 10;

/**
 * Score a token opportunity
 * @param opportunity - The opportunity record
 * @param event - The pump.fun event data
 * @param metadata - Optional metadata from URI fetch (v4.3)
 */
export async function scoreOpportunity(
  opportunity: OpportunityV31,
  event: PumpFunEvent,
  metadata?: TokenMetadata | null
): Promise<ScoringResult> {
  const reasons: ScoringReason[] = [];
  let totalScore = 0;
  let maxScore = 0;
  let hardStopTriggered = false;
  let hardStopReason: string | undefined;

  // Context object for rules (v4.3: includes metadata)
  const context = {
    opportunity,
    event,
    mint: opportunity.token_mint,
    name: event.name,
    symbol: event.symbol,
    creator: event.creator,
    bondingCurve: event.bondingCurve,
    timestamp: event.timestamp,
    metadata,  // v4.3: Pass metadata to rules
  };

  // Evaluate each rule
  for (const rule of scoringRules) {
    try {
      const result = await rule.evaluate(context);

      reasons.push({
        rule: rule.name,
        value: result.value,
        passed: result.passed,
        weight: rule.weight,
      });

      if (result.passed) {
        totalScore += rule.weight;
      }

      maxScore += rule.weight;

      // Check for hard stops
      if (rule.isHardStop && !result.passed) {
        hardStopTriggered = true;
        hardStopReason = rule.name;
        break;
      }
    } catch (error) {
      console.error(`[Scorer] Rule ${rule.name} error:`, error);
      // Skip failed rules but continue scoring
    }
  }

  return {
    totalScore,
    maxScore,
    qualified: !hardStopTriggered && totalScore >= MIN_QUALIFICATION_SCORE,
    reasons,
    hardStopTriggered,
    hardStopReason,
  };
}

/**
 * Score a launch candidate from on-chain detection
 * Uses a reduced rule set since on-chain detections may lack name/symbol/metadata
 */
export async function scoreLaunchCandidate(
  candidate: LaunchCandidate
): Promise<ScoringResult> {
  const reasons: ScoringReason[] = [];
  let totalScore = 0;
  let maxScore = 0;
  let hardStopTriggered = false;
  let hardStopReason: string | undefined;

  const payload = candidate.raw_payload as Record<string, unknown> | null;
  const onchain = (payload?.onchain ?? {}) as Record<string, unknown>;

  const context: CandidateScoringContext = {
    mint: candidate.mint,
    name: candidate.name ?? '',
    symbol: candidate.symbol ?? '',
    creator: (onchain.creator as string) ?? '',
    bondingCurve: (onchain.bonding_curve as string) ?? '',
    timestamp: new Date(candidate.first_seen_at).getTime() / 1000,
  };

  for (const rule of candidateScoringRules) {
    try {
      const result = await rule.evaluate(context);

      reasons.push({
        rule: rule.name,
        value: result.value,
        passed: result.passed,
        weight: rule.weight,
        isHardStop: rule.isHardStop,
      });

      if (result.passed) {
        totalScore += rule.weight;
      }

      maxScore += rule.weight;

      if (rule.isHardStop && !result.passed) {
        hardStopTriggered = true;
        hardStopReason = rule.name;
        break;
      }
    } catch (error) {
      console.error(`[Scorer] Candidate rule ${rule.name} error:`, error);
    }
  }

  return {
    totalScore,
    maxScore,
    qualified: !hardStopTriggered && totalScore >= MIN_CANDIDATE_QUALIFICATION_SCORE,
    reasons,
    hardStopTriggered,
    hardStopReason,
  };
}

// =============================================================================
// RAPTOR v3.1 Token Scorer
// Scores token opportunities based on multiple factors
// =============================================================================

import type { OpportunityV31 } from '@raptor/shared';
import type { PumpFunEvent } from '../monitors/pumpfun.js';
import { scoringRules, type ScoringRule } from './rules.js';

export interface ScoringReason {
  rule: string;
  value: unknown;
  passed: boolean;
  weight: number;
}

export interface ScoringResult {
  totalScore: number;
  maxScore: number;
  qualified: boolean;
  reasons: ScoringReason[];
  hardStopTriggered: boolean;
  hardStopReason?: string;
}

// Minimum score to qualify an opportunity
const MIN_QUALIFICATION_SCORE = 23;

/**
 * Score a token opportunity
 */
export async function scoreOpportunity(
  opportunity: OpportunityV31,
  event: PumpFunEvent
): Promise<ScoringResult> {
  const reasons: ScoringReason[] = [];
  let totalScore = 0;
  let maxScore = 0;
  let hardStopTriggered = false;
  let hardStopReason: string | undefined;

  // Context object for rules
  const context = {
    opportunity,
    event,
    mint: opportunity.token_mint,
    name: event.name,
    symbol: event.symbol,
    creator: event.creator,
    bondingCurve: event.bondingCurve,
    timestamp: event.timestamp,
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

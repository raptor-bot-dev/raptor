// =============================================================================
// RAPTOR v3.1 Idempotency System
// Stable, deterministic key generation for deduplication
// =============================================================================

import crypto from 'crypto';
import type { Chain, ExitTrigger } from './types.js';

type Mode = 'MANUAL' | 'AUTO' | 'EXIT';
type Action = 'BUY' | 'SELL';

/**
 * Key Format:
 * RAPTOR:V3:<MODE>:<CHAIN>:<ACTION>:<MINT>:<SCOPE>:<IDENTIFIER>:<HASH>
 *
 * | Component | Description |
 * |-----------|-------------|
 * | MODE | `MANUAL`, `AUTO`, or `EXIT` |
 * | CHAIN | `sol`, `eth`, `base`, `bsc` |
 * | ACTION | `BUY` or `SELL` |
 * | MINT | Token mint address |
 * | SCOPE | User ID or Strategy ID |
 * | IDENTIFIER | Stable event identifier |
 * | HASH | SHA256 prefix of normalized payload |
 */

/**
 * Generate a 16-character hash from input string
 */
function sha16(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Canonicalize an object to a deterministic JSON string
 * Objects are sorted by key, arrays maintain order
 */
function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`).join(',')}}`;
}

/**
 * Convert SOL to lamports (rounded to integer)
 */
function lamports(amountSol: number): number {
  return Math.round(amountSol * 1e9);
}

/**
 * AUTO BUY: Strategy + Opportunity
 * Dedupe: same opportunity + same strategy = one job
 */
export function idKeyAutoBuy(params: {
  chain: Chain;
  mint: string;
  strategyId: string;
  opportunityId: string;
  amountSol: number;
  slippageBps: number;
}): string {
  const payload = {
    opportunityId: params.opportunityId,
    amountLamports: lamports(params.amountSol),
    slippageBps: params.slippageBps,
  };
  const fp = sha16(canonicalize(payload));
  return `RAPTOR:V3:AUTO:${params.chain}:BUY:${params.mint}:${params.strategyId}:opp:${params.opportunityId}:${fp}`;
}

/**
 * AUTO SELL (Exit trigger): Position + Trigger type
 * Dedupe: same position + same trigger = one sell job
 */
export function idKeyExitSell(params: {
  chain: Chain;
  mint: string;
  positionId: string;
  trigger: ExitTrigger;
  sellPercent?: number;
}): string {
  const payload = {
    positionId: params.positionId,
    trigger: params.trigger,
    sellPercent: params.sellPercent ?? 100,
  };
  const fp = sha16(canonicalize(payload));
  return `RAPTOR:V3:EXIT:${params.chain}:SELL:${params.mint}:pos:${params.positionId}:trg:${params.trigger}:${fp}`;
}

/**
 * MANUAL BUY: User + Telegram event ID
 * Dedupe: same button press = one trade
 */
export function idKeyManualBuy(params: {
  chain: Chain;
  userId: number;
  mint: string;
  tgEventId: string | number;  // callbackQuery.id or message.message_id
  amountSol: number;
  slippageBps: number;
}): string {
  const payload = {
    tgEventId: String(params.tgEventId),
    amountLamports: lamports(params.amountSol),
    slippageBps: params.slippageBps,
  };
  const fp = sha16(canonicalize(payload));
  return `RAPTOR:V3:MANUAL:${params.chain}:BUY:${params.mint}:u:${params.userId}:tg:${params.tgEventId}:${fp}`;
}

/**
 * MANUAL SELL: User + Position + Telegram event ID
 */
export function idKeyManualSell(params: {
  chain: Chain;
  userId: number;
  mint: string;
  positionId: string;
  tgEventId: string | number;
  sellPercent?: number;
}): string {
  const payload = {
    tgEventId: String(params.tgEventId),
    positionId: params.positionId,
    sellPercent: params.sellPercent ?? 100,
  };
  const fp = sha16(canonicalize(payload));
  return `RAPTOR:V3:MANUAL:${params.chain}:SELL:${params.mint}:u:${params.userId}:pos:${params.positionId}:tg:${params.tgEventId}:${fp}`;
}

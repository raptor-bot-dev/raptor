// =============================================================================
// RAPTOR Hunter Observer: Telegram Message Formatters
// Formats events as Telegram HTML messages for the observability channel
// =============================================================================

export interface DetectionEvent {
  mint: string;
  creator: string;
  bondingCurve: string;
  signature: string;
  slot: number;
  source: string;
  timestamp: number;
  // Enrichment (optional — may not be available for brand new tokens)
  name?: string | null;
  symbol?: string | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
}

export interface ScoringEvent {
  mint: string;
  symbol: string | null;
  name: string | null;
  score: number;
  maxScore: number;
  qualified: boolean;
  hardStop: string | null;
  rules: Array<{ rule: string; passed: boolean; weight: number; value: unknown; isHardStop?: boolean }>;
  decision: 'ACCEPT' | 'REJECT';
}

export interface TradeResultEvent {
  mint: string;
  symbol: string | null;
  action: 'BUY' | 'SELL';
  amountSol: number;
  txHash: string | null;
  success: boolean;
  error?: string;
}

function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatDetection(event: DetectionEvent): string {
  const latency = Math.round((Date.now() - event.timestamp) / 1000);
  const lines: string[] = [
    `<b>🦖 LAUNCH DETECTED</b>`,
    ``,
  ];

  // Token line — only if name or symbol available
  if (event.symbol || event.name) {
    const parts: string[] = [];
    if (event.symbol) parts.push(`$${event.symbol}`);
    if (event.name) parts.push(event.name);
    lines.push(`Token: <b>${parts.join(' — ')}</b>`);
  }

  lines.push(
    `Mint: <a href="${solscanToken(event.mint)}">${event.mint}</a>`,
    `Creator: <code>${event.creator}</code>`,
    `Curve: <code>${event.bondingCurve}</code>`,
    ``,
  );

  // Market data line — only if available
  if (event.marketCapUsd || event.liquidityUsd) {
    const mcParts: string[] = [];
    if (event.marketCapUsd) mcParts.push(`MC: ${formatUsd(event.marketCapUsd)}`);
    if (event.liquidityUsd) mcParts.push(`Liq: ${formatUsd(event.liquidityUsd)}`);
    lines.push(mcParts.join(' | '));
  }

  lines.push(
    `Source: ${event.source}`,
    `Slot: ${event.slot} | Latency: ${latency}s`,
    ``,
    `<a href="${solscanToken(event.mint)}">Solscan</a> | <a href="${solscanTx(event.signature)}">View TX</a>`,
  );

  return lines.join('\n');
}

export function formatScoring(event: ScoringEvent): string {
  const icon = event.qualified ? '🦕' : '💀';
  const label = event.qualified ? 'QUALIFIED' : 'REJECTED';

  const lines: string[] = [
    `<b>${icon} ${label}</b> (${event.score}/${event.maxScore})`,
    ``,
  ];

  // Token line — only if name or symbol available
  if (event.symbol || event.name) {
    const parts: string[] = [];
    if (event.symbol) parts.push(`$${event.symbol}`);
    if (event.name) parts.push(event.name);
    lines.push(`Token: <b>${parts.join(' — ')}</b>`);
  }

  lines.push(
    `Mint: <a href="${solscanToken(event.mint)}">${event.mint}</a>`,
    ``,
    `Rules:`,
  );

  for (const r of event.rules) {
    if (r.isHardStop && !r.passed) {
      lines.push(` 🚫 ${r.rule}  <b>HARD STOP</b>`);
    } else if (r.passed && r.weight > 0) {
      lines.push(` ✅ ${r.rule}  +${r.weight}`);
    } else {
      lines.push(` ⬜ ${r.rule}`);
    }
  }

  lines.push(``, `Decision: <b>${event.decision}</b>`);

  if (event.qualified) {
    lines.push(``, `<a href="${solscanToken(event.mint)}">Solscan</a>`);
  }

  return lines.join('\n');
}

export function formatTradeResult(event: TradeResultEvent): string {
  const icon = event.success ? '✅' : '❌';
  const status = event.success ? 'SUCCESS' : 'FAILED';
  const tokenLabel = event.symbol || event.mint.slice(0, 12) + '...';

  const lines = [
    `<b>${icon} ${event.action} ${status}</b>`,
    ``,
    `Token: ${tokenLabel}`,
    `Amount: ${event.amountSol} SOL`,
  ];

  if (event.txHash) {
    lines.push(`<a href="${solscanTx(event.txHash)}">View TX</a>`);
  }

  if (event.error) {
    lines.push(`Error: ${event.error}`);
  }

  return lines.join('\n');
}

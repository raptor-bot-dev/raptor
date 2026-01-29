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
}

export interface ScoringEvent {
  mint: string;
  symbol: string | null;
  score: number;
  maxScore: number;
  qualified: boolean;
  hardStop: string | null;
  rules: Array<{ rule: string; passed: boolean; weight: number; value: unknown }>;
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

export function formatDetection(event: DetectionEvent): string {
  const age = Math.round((Date.now() - event.timestamp) / 1000);
  return [
    `<b>🔍 LAUNCH DETECTED</b>`,
    ``,
    `Mint: <a href="${solscanToken(event.mint)}">${event.mint.slice(0, 16)}...</a>`,
    `Creator: <code>${event.creator.slice(0, 16)}...</code>`,
    `Curve: <code>${event.bondingCurve.slice(0, 16)}...</code>`,
    `Source: ${event.source}`,
    `Slot: ${event.slot} | Age: ${age}s`,
    `<a href="${solscanTx(event.signature)}">View TX</a>`,
  ].join('\n');
}

export function formatScoring(event: ScoringEvent): string {
  const icon = event.qualified ? '✅' : '❌';
  const label = event.qualified ? 'PASS' : 'FAIL';
  const tokenLabel = event.symbol || event.mint.slice(0, 12) + '...';

  const ruleLines = event.rules.map((r) => {
    const status = r.passed ? '✓' : '✗';
    const pts = r.passed && r.weight > 0 ? ` +${r.weight}` : '';
    return `  ${status} ${r.rule}${pts}`;
  });

  const lines = [
    `<b>${icon} SCORING: ${label}</b> (${event.score}/${event.maxScore})`,
    ``,
    `Token: ${tokenLabel}`,
    ...ruleLines,
  ];

  if (event.hardStop) {
    lines.push(``, `Hard stop: ${event.hardStop}`);
  }

  lines.push(``, `Decision: <b>${event.decision}</b>`);

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

/**
 * Global UI wrapper for Telegram bot messages.
 *
 * Goal: enforce consistent typography and spacing without rewriting every command.
 *
 * We only wrap Markdown (v1) payloads. We intentionally do not touch MarkdownV2
 * to avoid escaping bugs, and we do not override HTML screens that are already
 * bespoke (e.g. /start, /menu).
 */

const WRAP_LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const BRAND = '🦅 *RAPTOR*';

export function shouldWrapTelegramText(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;

  // Only wrap methods that contain a main `text` field.
  if (typeof payload.text !== 'string') return false;

  // Skip service messages and very short responses.
  const text = payload.text.trim();
  if (text.length < 24) return false;

  // Don't touch HTML or MarkdownV2 screens.
  if (payload.parse_mode === 'HTML' || payload.parse_mode === 'MarkdownV2') return false;

  // Avoid double-wrapping.
  if (text.includes(BRAND) && text.includes(WRAP_LINE)) return false;

  // Avoid wrapping code-heavy dumps.
  if (text.includes('```')) return false;

  return true;
}

export function wrapTelegramMarkdown(text: string): string {
  const trimmed = text.trim();
  return `${BRAND}\n${WRAP_LINE}\n\n${trimmed}\n\n${WRAP_LINE}`;
}

export function clampTelegramText(text: string, max = 4096): string {
  if (text.length <= max) return text;
  // Keep the top content (users care about decisions/outputs first).
  return text.slice(0, Math.max(0, max - 24)) + '\n\n…(truncated)';
}

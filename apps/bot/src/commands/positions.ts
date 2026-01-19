import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import { getRecentPositions, type RecentPosition } from '@raptor/shared';

type PositionFilter = 'all' | 'manual' | 'hunt';

/**
 * Positions command - Show recent positions with filter tabs
 * v5.0: Added filtering for manual vs hunt trades
 */
export async function positionsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  await showPositions(ctx, 'all');
}

/**
 * Show positions with filter (for command and callbacks)
 */
export async function showPositions(
  ctx: MyContext,
  filter: PositionFilter = 'all',
  edit: boolean = false
) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Fetch positions from last 24 hours, limit 15
    const positions = await getRecentPositions(user.id, 24, 15, 0);

    // Apply filter
    const filteredPositions = filterPositions(positions, filter);

    // Build message
    const message = formatPositionsMessage(filteredPositions, filter);

    // Build keyboard with filter tabs and view buttons
    const keyboard = buildPositionsKeyboard(filteredPositions, filter);

    if (edit) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error('[Positions] Error fetching positions:', error);
    const errorMsg = '❌ Error fetching positions. Please try again.';
    if (edit) {
      await ctx.editMessageText(errorMsg);
    } else {
      await ctx.reply(errorMsg);
    }
  }
}

/**
 * Filter positions by source
 */
function filterPositions(
  positions: RecentPosition[],
  filter: PositionFilter
): RecentPosition[] {
  if (filter === 'all') return positions;

  return positions.filter((pos) => {
    const source = (pos.source || '').toLowerCase();
    if (filter === 'manual') {
      return source === 'manual' || source === 'snipe';
    }
    if (filter === 'hunt') {
      return source === 'hunt' || source === 'auto';
    }
    return true;
  });
}

/**
 * Format positions message
 */
function formatPositionsMessage(
  positions: RecentPosition[],
  filter: PositionFilter
): string {
  const filterLabel =
    filter === 'all' ? 'All' : filter === 'manual' ? 'Manual' : 'Hunt';

  if (positions.length === 0) {
    return (
      `📊 *Positions — ${filterLabel}*\n\n` +
      '_No positions found_\n\n' +
      'Paste any token address to buy manually,\n' +
      'or enable Hunt for auto-trading.'
    );
  }

  let message = `📊 *Positions — ${filterLabel}*\n\n`;

  for (const pos of positions) {
    const pnlEmoji =
      pos.unrealized_pnl_percent >= 20
        ? '🟢'
        : pos.unrealized_pnl_percent >= 0
          ? '🟡'
          : '🔴';
    const pnlSign = pos.unrealized_pnl_percent >= 0 ? '+' : '';
    const statusIcon =
      pos.status === 'ACTIVE' ? '🟢' : pos.status === 'CLOSING' ? '🟠' : '⚪';

    const age = getTimeAgo(new Date(pos.created_at));
    const sourceLabel = getSourceLabel(pos.source);

    message += `${statusIcon} *${pos.token_symbol || 'UNKNOWN'}*\n`;
    message += `   ${pos.amount_in.toFixed(4)} SOL → ${pnlEmoji} ${pnlSign}${pos.unrealized_pnl_percent?.toFixed(1) || '0.0'}%\n`;
    message += `   ${sourceLabel} • ${age}\n`;

    if (pos.has_monitor) {
      message += `   📊 _Monitor active_\n`;
    }
    message += '\n';
  }

  return message;
}

/**
 * Get human-readable source label
 */
function getSourceLabel(source: string | undefined): string {
  const s = (source || '').toLowerCase();
  if (s === 'manual' || s === 'snipe') return '🎯 Manual';
  if (s === 'hunt' || s === 'auto') return '🦖 Hunt';
  return '📊 Trade';
}

/**
 * Build keyboard with filter tabs and view buttons
 */
function buildPositionsKeyboard(
  positions: RecentPosition[],
  currentFilter: PositionFilter
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Filter tabs row
  const allMarker = currentFilter === 'all' ? ' ✓' : '';
  const manualMarker = currentFilter === 'manual' ? ' ✓' : '';
  const huntMarker = currentFilter === 'hunt' ? ' ✓' : '';

  keyboard
    .text(`All${allMarker}`, 'positions_filter_all')
    .text(`Manual${manualMarker}`, 'positions_filter_manual')
    .text(`Hunt${huntMarker}`, 'positions_filter_hunt')
    .row();

  // Add View buttons for positions with monitors (max 5)
  let buttonCount = 0;
  for (const pos of positions) {
    if (pos.has_monitor && pos.token_address && buttonCount < 5) {
      keyboard
        .text(`📊 ${pos.token_symbol || 'View'}`, `view_monitor:${pos.token_address}`)
        .row();
      buttonCount++;
    }
  }

  // Add refresh and back buttons
  keyboard
    .text('🔄 Refresh', `positions_filter_${currentFilter}`)
    .text('← Menu', 'back_to_menu');

  return keyboard;
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// apps/bot/src/ui/notifications/generic.ts
// Generic notification - Terminal-style fallback for unknown notification types
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  btn,
  homeBtn,
  escapeHtml,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Render a generic notification with terminal-style formatting
 * Used as fallback for unknown notification types
 *
 * Template:
 * 🦖 <b>RAPTOR | {TYPE}</b>
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Field:</b> value
 * <b>Field:</b> value
 * ...
 */
export function renderGenericNotification(
  type: string,
  payload: Record<string, unknown>
): Panel {
  const lines: string[] = [];

  // Extract and display payload fields in a readable format
  for (const [key, value] of Object.entries(payload)) {
    const formattedKey = formatFieldName(key);
    const formattedValue = formatFieldValue(value);

    if (formattedValue.length > 60) {
      // Long values get their own code block
      lines.push(stat(formattedKey, ''));
      lines.push(`   └─ ${code(formattedValue.slice(0, 60) + '...')}`);
    } else {
      lines.push(stat(formattedKey, formattedValue));
    }
  }

  // If no payload, show a message
  if (Object.keys(payload).length === 0) {
    lines.push('No additional details available.');
  }

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  // Use the notification type as title
  const title = type.replace(/_/g, ' ');
  return panel(title, lines, buttons);
}

/**
 * Format a field name for display
 * Converts snake_case to Title Case
 */
function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a field value for display
 */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    // Format numbers nicely
    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }
    return value.toFixed(6);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    // For objects, show a compact representation
    try {
      const str = JSON.stringify(value);
      if (str.length > 100) {
        return str.slice(0, 97) + '...';
      }
      return str;
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

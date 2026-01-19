// apps/bot/src/ui/callbackIds.ts
// Centralized callback IDs per MUST_READ/PROMPT.md specification
// All callback routing should use these constants for consistency

/**
 * Callback ID constants organized by feature area
 * Format: {category}:{action} or {category}:{action}:{param}
 */
export const CB = {
  // --- Home ---
  HOME: {
    OPEN: 'home:open',
    REFRESH: 'home:refresh',
  },

  // --- Autohunt ---
  HUNT: {
    ARM: 'hunt:arm',
    DISARM: 'hunt:disarm',
    CONFIRM_ARM: 'hunt:confirm_arm',
    CONFIRM_DISARM: 'hunt:confirm_disarm',
    CANCEL: 'hunt:cancel',
  },

  // --- Settings ---
  SETTINGS: {
    OPEN: 'settings:open',
    EDIT_TRADE_SIZE: 'settings:edit_trade_size',
    EDIT_MAX_POSITIONS: 'settings:edit_max_positions',
    EDIT_TP: 'settings:edit_tp',
    EDIT_SL: 'settings:edit_sl',
    EDIT_SLIPPAGE: 'settings:edit_slippage',
    EDIT_PRIORITY: 'settings:edit_priority',
    EDIT_SNIPE_MODE: 'settings:edit_snipe_mode',
    SET_SNIPE_MODE_SPEED: 'settings:set_snipe_mode_speed',
    SET_SNIPE_MODE_QUALITY: 'settings:set_snipe_mode_quality',
    EDIT_FILTER_MODE: 'settings:edit_filter_mode',
    SET_FILTER_MODE_STRICT: 'settings:set_filter_mode_strict',
    SET_FILTER_MODE_MODERATE: 'settings:set_filter_mode_moderate',
    SET_FILTER_MODE_LIGHT: 'settings:set_filter_mode_light',
    TOGGLE_MEV: 'settings:toggle_mev',
    BACK_HOME: 'settings:back_home',
  },

  // --- Positions ---
  POSITIONS: {
    OPEN: 'positions:open',
    REFRESH: 'positions:refresh',
  },

  // --- Single Position (with dynamic ID) ---
  // Usage: CB.position.details(positionId)
  POSITION: {
    // Build callback with position ID
    details: (id: string) => `position:details:${id}`,
    chart: (id: string) => `position:chart:${id}`,
    emergencySell: (id: string) => `position:emergency_sell:${id}`,
    confirmEmergencySell: (id: string) => `position:confirm_emergency_sell:${id}`,
    cancelEmergencySell: (id: string) => `position:cancel_emergency_sell:${id}`,
    viewEntryTx: (id: string) => `position:view_entry_tx:${id}`,
    back: (id: string) => `position:back:${id}`,
  },

  // --- Withdraw ---
  WITHDRAW: {
    OPEN: 'withdraw:open',
    SET_DESTINATION: 'withdraw:set_destination',
    AMOUNT_SOL: 'withdraw:amount_sol',
    AMOUNT_PCT: 'withdraw:amount_pct',
    CONFIRM: 'withdraw:confirm',
    CANCEL: 'withdraw:cancel',
    BACK: 'withdraw:back',
  },

  // --- Help ---
  HELP: {
    OPEN: 'help:open',
    BACK: 'help:back',
  },

  // --- Links (optional - can also use URL buttons) ---
  LINK: {
    tx: (sig: string) => `link:tx:${sig}`,
    chart: (mint: string) => `link:chart:${mint}`,
  },
} as const;

/**
 * Parse a callback ID to extract the prefix and parameters
 * Returns { prefix, params } where params is an array of path segments after prefix
 */
export function parseCallback(data: string): {
  prefix: string;
  params: string[];
} {
  const parts = data.split(':');
  const prefix = parts.slice(0, 2).join(':');
  const params = parts.slice(2);
  return { prefix, params };
}

/**
 * Check if callback matches a pattern
 * Supports wildcards: 'position:details:*' matches 'position:details:abc123'
 */
export function matchCallback(data: string, pattern: string): boolean {
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // Remove '*'
    return data.startsWith(prefix);
  }
  return data === pattern;
}

/**
 * Extract position ID from position callbacks
 * Returns null if not a position callback
 */
export function extractPositionId(data: string): string | null {
  if (!data.startsWith('position:')) return null;
  const parts = data.split(':');
  return parts.length >= 3 ? parts[2] : null;
}

/**
 * Callback prefix constants for routing
 */
export const CALLBACK_PREFIXES = {
  HOME: 'home:',
  HUNT: 'hunt:',
  SETTINGS: 'settings:',
  POSITIONS: 'positions:',
  POSITION: 'position:',
  WITHDRAW: 'withdraw:',
  HELP: 'help:',
  LINK: 'link:',
} as const;

/**
 * Session step constants for text input flows
 */
export const SESSION_STEPS = {
  // Settings edits
  AWAITING_TRADE_SIZE: 'awaiting_trade_size',
  AWAITING_MAX_POSITIONS: 'awaiting_max_positions',
  AWAITING_TP_PERCENT: 'awaiting_tp_percent',
  AWAITING_SL_PERCENT: 'awaiting_sl_percent',
  AWAITING_SLIPPAGE_BPS: 'awaiting_slippage_bps',
  AWAITING_PRIORITY_SOL: 'awaiting_priority_sol',

  // Withdraw flow
  AWAITING_WITHDRAWAL_AMOUNT: 'awaiting_withdrawal_amount',
  AWAITING_WITHDRAWAL_PERCENT: 'awaiting_withdrawal_percent',
  AWAITING_WITHDRAWAL_ADDRESS: 'awaiting_withdrawal_address',
  AWAITING_WITHDRAWAL_CONFIRM: 'awaiting_withdrawal_confirm',
} as const;

export type SessionStep = (typeof SESSION_STEPS)[keyof typeof SESSION_STEPS];

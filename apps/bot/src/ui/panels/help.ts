// apps/bot/src/ui/panels/help.ts
// HELP panel - Command reference and support info
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  section,
  stat,
  btn,
  homeBtn,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Render the HELP panel
 */
export function renderHelp(): Panel {
  const lines: string[] = [
    section('Commands'),
    '/start - Open home panel',
    '/help - Show this help',
    '',
    section('Autohunt'),
    'Arm - Enable automatic trading',
    'Disarm - Disable new trades',
    '',
    section('Positions'),
    'View open positions (max 2)',
    'Emergency Sell - Close immediately',
    'Chart - View on Dexscreener',
    '',
    section('Settings'),
    'Configure trade size, TP/SL, limits',
    '',
    section('Withdraw'),
    'Withdraw SOL or % of balance',
    'Set destination address first',
    '',
    section('Links'),
    'TX links open Solscan',
    'Chart links open Dexscreener',
  ];

  const buttons: Button[][] = [
    [homeBtn()],
  ];

  return panel('HELP', lines, buttons);
}

/**
 * Render quick tips panel (optional)
 */
export function renderQuickTips(): Panel {
  const lines: string[] = [
    section('Quick Tips'),
    '',
    stat('1', 'Set your trade size before arming'),
    stat('2', 'Start with conservative TP/SL (e.g., TP 50%, SL 20%)'),
    stat('3', 'Use Emergency Sell if market moves against you'),
    stat('4', 'Limit positions to manage risk (max 5)'),
    stat('5', 'Set a withdrawal destination before withdrawing'),
  ];

  const buttons: Button[][] = [
    [
      btn('Help', CB.HELP.OPEN),
      homeBtn(),
    ],
  ];

  return panel('QUICK TIPS', lines, buttons);
}

/**
 * Render about panel
 */
export function renderAbout(): Panel {
  const lines: string[] = [
    section('RAPTOR Bot'),
    '',
    'Automated Solana trading on Bags.fm launches',
    '',
    stat('Version', '3.0.0'),
    stat('Network', 'Solana Mainnet'),
    '',
    'Use at your own risk.',
    'Crypto trading involves significant risk.',
  ];

  const buttons: Button[][] = [
    [
      btn('Help', CB.HELP.OPEN),
      homeBtn(),
    ],
  ];

  return panel('ABOUT', lines, buttons);
}

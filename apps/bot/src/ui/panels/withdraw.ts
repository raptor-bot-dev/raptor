// apps/bot/src/ui/panels/withdraw.ts
// WITHDRAW panels - Withdrawal flow
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  formatSol,
  btn,
  homeBtn,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for withdraw home panel
 */
export interface WithdrawData {
  walletAddress: string;
  balanceSol: number;
  bufferSol: number;
  maxWithdrawSol: number;
  destinationAddress?: string;
}

/**
 * Render the WITHDRAW home panel
 *
 * Template:
 * 🦖 <b>RAPTOR | WITHDRAW</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>From:</b> <code>{wallet}</code>
 * <b>Balance:</b> {bal} SOL
 * <b>Fee Buffer:</b> {buffer} SOL
 * <b>Max Withdraw:</b> {max} SOL
 * <b>Destination:</b> <code>{destOrUnset}</code>
 */
export function renderWithdraw(data: WithdrawData): Panel {
  const lines: string[] = [
    `${stat('From', '')}`,
    code(data.walletAddress),
    stat('Balance', `${formatSol(data.balanceSol)} SOL`),
    stat('Fee Buffer', `${formatSol(data.bufferSol)} SOL`),
    stat('Max Withdraw', `${formatSol(data.maxWithdrawSol)} SOL`),
    stat('Destination', ''),
    data.destinationAddress ? code(data.destinationAddress) : 'Not set',
  ];

  const buttons: Button[][] = [
    [
      btn('Set Destination', CB.WITHDRAW.SET_DESTINATION),
      btn('Withdraw SOL', CB.WITHDRAW.AMOUNT_SOL),
      btn('Withdraw %', CB.WITHDRAW.AMOUNT_PCT),
    ],
    [
      btn('Back', CB.HOME.OPEN),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW', lines, buttons);
}

/**
 * Render destination address prompt
 */
export function renderWithdrawSetDestination(currentDest?: string): Panel {
  const lines: string[] = [
    'Enter the destination Solana address.',
    'This is where your SOL will be sent.',
  ];

  if (currentDest) {
    lines.push(stat('Current', ''));
    lines.push(code(currentDest));
  }

  const buttons: Button[][] = [
    [
      btn('Cancel', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('SET DESTINATION', lines, buttons);
}

/**
 * Render SOL amount input prompt
 */
export function renderWithdrawSolPrompt(maxWithdrawSol: number): Panel {
  const lines: string[] = [
    `Enter amount in SOL.`,
    `Maximum: ${formatSol(maxWithdrawSol)} SOL`,
    'Example: 0.15',
  ];

  const buttons: Button[][] = [
    [
      btn('Cancel', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW SOL', lines, buttons);
}

/**
 * Render percent input prompt
 */
export function renderWithdrawPercentPrompt(): Panel {
  const lines: string[] = [
    'Enter percent (1-100).',
    'This will withdraw that percentage of available balance.',
    'Example: 25',
  ];

  const buttons: Button[][] = [
    [
      btn('Cancel', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW %', lines, buttons);
}

/**
 * Data for withdraw confirmation
 */
export interface WithdrawConfirmData {
  toAddress: string;
  amountSol: number;
  estimatedFeeSol: number;
  receiveApproxSol: number;
}

/**
 * Render withdrawal confirmation panel
 *
 * Template:
 * 🦖 <b>RAPTOR | CONFIRM WITHDRAW</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>To:</b> <code>{dest}</code>
 * <b>Amount:</b> {amt} SOL
 * └─ Est Fees: {fees} SOL
 * <b>Receive:</b> ~{recv} SOL
 */
export function renderWithdrawConfirm(data: WithdrawConfirmData): Panel {
  const lines: string[] = [
    stat('To', ''),
    code(data.toAddress),
    stat('Amount', `${formatSol(data.amountSol)} SOL`),
    join(`Est Fees: ${formatSol(data.estimatedFeeSol)} SOL`),
    stat('Receive', `~${formatSol(data.receiveApproxSol)} SOL`),
  ];

  const buttons: Button[][] = [
    [
      btn('Confirm', CB.WITHDRAW.CONFIRM),
      btn('Cancel', CB.WITHDRAW.CANCEL),
    ],
    [
      btn('Back', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('CONFIRM WITHDRAW', lines, buttons);
}

/**
 * Render withdrawal success
 */
export function renderWithdrawSuccess(
  amountSol: number,
  toAddress: string,
  txSig?: string
): Panel {
  const lines: string[] = [
    stat('Status', 'Success'),
    stat('Amount', `${formatSol(amountSol)} SOL`),
    stat('To', ''),
    code(toAddress),
  ];

  if (txSig) {
    lines.push(stat('TX', txSig.slice(0, 16) + '...'));
  }

  const buttons: Button[][] = [];

  // If we have txSig, add View TX button
  // Note: For URL buttons, we'd need to import solscanTxUrl
  // For simplicity, using callback that can redirect

  buttons.push([
    btn('Withdraw More', CB.WITHDRAW.OPEN),
    homeBtn(),
  ]);

  return panel('WITHDRAW SUCCESS', lines, buttons);
}

/**
 * Render withdrawal error
 */
export function renderWithdrawError(reason: string): Panel {
  const lines: string[] = [
    stat('Status', 'Failed'),
    stat('Reason', reason),
    'Please check your balance and try again.',
  ];

  const buttons: Button[][] = [
    [
      btn('Try Again', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW ERROR', lines, buttons);
}

/**
 * Render no destination set error
 */
export function renderWithdrawNoDestination(): Panel {
  const lines: string[] = [
    'No destination address set.',
    'Please set a destination address first.',
  ];

  const buttons: Button[][] = [
    [
      btn('Set Destination', CB.WITHDRAW.SET_DESTINATION),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW', lines, buttons);
}

/**
 * Render invalid amount error
 */
export function renderWithdrawInvalidAmount(reason: string): Panel {
  const lines: string[] = [
    stat('Error', reason),
    'Please enter a valid amount.',
  ];

  const buttons: Button[][] = [
    [
      btn('Try Again', CB.WITHDRAW.OPEN),
      homeBtn(),
    ],
  ];

  return panel('WITHDRAW', lines, buttons);
}

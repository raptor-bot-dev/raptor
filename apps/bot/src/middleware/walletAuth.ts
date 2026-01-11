/**
 * Wallet Authorization Middleware for RAPTOR Bot
 *
 * SECURITY: Verifies wallet ownership before sensitive operations
 * like export, delete, or activate.
 */

import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getWalletByIndex, type UserWallet } from '@raptor/shared';
import { parseWalletIndex, isValidChain } from '../utils/validation.js';

/**
 * Result of wallet authorization check
 */
export interface WalletAuthResult {
  authorized: boolean;
  wallet?: UserWallet;
  error?: string;
}

/**
 * Verify that the current user owns the specified wallet
 * Returns the wallet if authorized, null otherwise
 */
export async function verifyWalletOwnership(
  ctx: MyContext,
  chain: string,
  walletIndexStr: string
): Promise<WalletAuthResult> {
  const user = ctx.from;
  if (!user) {
    return { authorized: false, error: 'No user context' };
  }

  // Validate chain parameter
  if (!isValidChain(chain)) {
    console.warn(`[WalletAuth] Invalid chain: ${chain} from user ${user.id}`);
    return { authorized: false, error: 'Invalid chain' };
  }

  // Validate wallet index
  const walletIndex = parseWalletIndex(walletIndexStr);
  if (walletIndex === null) {
    console.warn(`[WalletAuth] Invalid wallet index: ${walletIndexStr} from user ${user.id}`);
    return { authorized: false, error: 'Invalid wallet index' };
  }

  try {
    // Fetch wallet from database
    const wallet = await getWalletByIndex(user.id, chain as Chain, walletIndex);

    if (!wallet) {
      console.warn(`[WalletAuth] Wallet not found: ${chain}:${walletIndex} for user ${user.id}`);
      return { authorized: false, error: 'Wallet not found' };
    }

    // Verify ownership - CRITICAL CHECK
    if (wallet.tg_id !== user.id) {
      // Security incident - someone trying to access another user's wallet
      console.error(
        `[SECURITY] User ${user.id} attempted to access wallet belonging to user ${wallet.tg_id}. ` +
        `Chain: ${chain}, Index: ${walletIndex}`
      );
      return { authorized: false, error: 'Access denied' };
    }

    return { authorized: true, wallet };
  } catch (error) {
    console.error('[WalletAuth] Database error:', error);
    return { authorized: false, error: 'Database error' };
  }
}

/**
 * Wrapper that handles unauthorized access with user feedback
 */
export async function requireWalletOwnership(
  ctx: MyContext,
  chain: string,
  walletIndexStr: string,
  onAuthorized: (wallet: UserWallet) => Promise<void>
): Promise<boolean> {
  const result = await verifyWalletOwnership(ctx, chain, walletIndexStr);

  if (!result.authorized) {
    await ctx.answerCallbackQuery({
      text: result.error || 'Access denied',
      show_alert: true,
    });
    return false;
  }

  await onAuthorized(result.wallet!);
  return true;
}

/**
 * Parse wallet callback data safely
 * Format: prefix_chain_index (e.g., wallet_export_sol_1)
 */
export function parseWalletCallback(
  data: string,
  prefix: string
): { chain: string; indexStr: string } | null {
  if (!data.startsWith(prefix)) return null;

  const parts = data.replace(prefix, '').split('_');
  if (parts.length !== 2) return null;

  const [chain, indexStr] = parts;

  // Basic validation
  if (!chain || !indexStr) return null;

  return { chain, indexStr };
}

/**
 * Log security-relevant wallet operations
 */
export function logWalletOperation(
  userId: number,
  operation: 'export' | 'delete' | 'activate' | 'create' | 'deposit' | 'withdraw_start' | 'withdraw_amount' | 'withdraw_custom',
  chain: Chain,
  walletIndex: number,
  success: boolean
): void {
  const level = success ? 'info' : 'warn';
  console[level](
    `[WalletAudit] User ${userId} - ${operation} wallet ${chain}:${walletIndex} - ${success ? 'SUCCESS' : 'FAILED'}`
  );
}

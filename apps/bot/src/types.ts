import type { Context, SessionFlavor } from 'grammy';
import type { Chain } from '@raptor/shared';

// Custom strategy step type for dynamic field prompts
export type CustomStrategyStep = `awaiting_custom_${string}`;

export interface SessionData {
  step:
    | 'awaiting_withdrawal_amount'
    | 'awaiting_withdrawal_address'
    | 'awaiting_withdrawal_confirm'
    | 'awaiting_delete_confirmation'
    | 'awaiting_custom_tp'
    | 'awaiting_custom_sl'
    | 'awaiting_custom_maxhold'
    | 'awaiting_custom_value'
    | 'awaiting_send_amount'
    | 'awaiting_send_confirm'
    | 'awaiting_sell_tokens'
    | 'awaiting_sell_percent'
    | 'awaiting_sell_ca'  // v3.2: For /sell command flow
    | 'awaiting_manual_slippage'   // v3.3: Manual settings custom slippage
    | 'awaiting_manual_priority'   // v3.3: Manual settings custom priority
    | 'awaiting_manual_buyamts'    // v3.3: Manual settings custom buy amounts
    | 'awaiting_custom_buy_amount' // v3.4: Custom buy amount input
    | CustomStrategyStep
    | null;
  pendingWithdrawal: {
    chain: Chain;
    walletIndex: number;
    amount?: string;
    address?: string;
  } | null;
  pendingSend?: {
    toAddress: string;
    chain: Chain;
    amount?: string;
    tokenAddress?: string;
  };
  pendingWalletDelete?: {
    walletId: number;
    chain: Chain;
  };
  awaitingImport?: Chain;
  pendingSellMint?: string;
  // v3.4: Custom buy amount pending data
  pendingBuy?: {
    chain: Chain;
    mint: string;
  };
}

export type MyContext = Context & SessionFlavor<SessionData>;

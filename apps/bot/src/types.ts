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
}

export type MyContext = Context & SessionFlavor<SessionData>;

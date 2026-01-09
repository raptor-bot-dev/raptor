import type { Context, SessionFlavor } from 'grammy';
import type { Chain } from '@raptor/shared';

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
    | null;
  pendingWithdrawal: {
    chain: Chain;
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
}

export type MyContext = Context & SessionFlavor<SessionData>;

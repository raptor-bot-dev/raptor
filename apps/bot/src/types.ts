import type { Context, SessionFlavor } from 'grammy';

export interface SessionData {
  step:
    | 'awaiting_withdrawal_amount'
    | 'awaiting_withdrawal_address'
    | 'awaiting_withdrawal_confirm'
    | null;
  pendingWithdrawal: {
    chain: 'bsc' | 'base';
    amount: string;
    address?: string;
  } | null;
}

export type MyContext = Context & SessionFlavor<SessionData>;

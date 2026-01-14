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
    | 'awaiting_chain_buy_slip'    // v3.5: Chain-specific buy slippage
    | 'awaiting_chain_sell_slip'   // v3.5: Chain-specific sell slippage
    | 'awaiting_chain_gas'         // v3.5: Chain-specific gas price
    | 'awaiting_chain_priority'    // v3.5: Chain-specific priority fee
    | 'awaiting_wallet_rename'     // v4.1: Wallet rename input
    | 'awaiting_send_address'      // v4.1: Send destination address
    | 'awaiting_send_token_ca'     // v4.1: Send token contract address
    | 'awaiting_manual_buy_slip'   // v4.3: Custom buy slippage input
    | 'awaiting_manual_sell_slip'  // v4.3: Custom sell slippage input
    | 'awaiting_manual_buy_tip'    // v4.3: Custom buy tip input
    | 'awaiting_manual_sell_tip'   // v4.3: Custom sell tip input
    | CustomStrategyStep
    | null;
  chainSettingsTarget?: string;  // v3.5: Target chain for settings input
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
    sendType?: 'native' | 'token';  // v4.1: Type of send operation
  };
  pendingRename?: {  // v4.1: Wallet rename data
    chain: Chain;
    walletIndex: number;
  };
  pendingWalletDelete?: {
    walletId: number;
    chain: Chain;
  };
  awaitingImport?: Chain;
  pendingSellMint?: string;
  pendingSellChain?: Chain;  // v3.5: Chain for pending sell
  // v3.4: Custom buy amount pending data
  pendingBuy?: {
    chain: Chain;
    mint: string;
  };
}

export type MyContext = Context & SessionFlavor<SessionData>;

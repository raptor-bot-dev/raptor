// Core types used across all apps

export interface User {
  tg_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  created_at: string;
  last_login: string | null;
}

export interface UserBalance {
  id: number;
  tg_id: number;
  chain: 'bsc' | 'base' | 'eth';
  deposited: string;
  current_value: string;
  deposit_address: string;
  updated_at: string;
}

export interface Position {
  id: number;
  tg_id: number;
  chain: 'bsc' | 'base' | 'eth';
  token_address: string;
  token_symbol: string;
  amount_in: string;
  tokens_held: string;
  entry_price: string;
  current_price: string;
  unrealized_pnl: string;
  unrealized_pnl_percent: number;
  take_profit_percent: number;
  stop_loss_percent: number;
  source: string;
  score: number;
  status: 'ACTIVE' | 'CLOSED' | 'PENDING';
  created_at: string;
  closed_at: string | null;
}

export interface Trade {
  id: number;
  tg_id: number;
  position_id: number | null;
  chain: 'bsc' | 'base' | 'eth';
  token_address: string;
  token_symbol: string;
  type: 'BUY' | 'SELL';
  amount_in: string;
  amount_out: string;
  price: string;
  pnl: string | null;
  pnl_percent: number | null;
  source: string;
  tx_hash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  created_at: string;
}

export interface Opportunity {
  id: string;
  chain: 'bsc' | 'base';
  token: string;
  name: string;
  symbol: string;
  launchpad: string;
  liquidity: bigint;
  buy_tax: number;
  sell_tax: number;
  score: number;
  recommended_size: bigint;
  timestamp: number;
  expires_at: number;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wssUrl: string;
  nativeToken: string;
  wrappedNative: string;
  explorerUrl: string;
  maxGasPrice: bigint;
  minPositionSize: bigint;
  maxPositionSize: bigint;
  maxPoolPercent: number;
  launchpads: LaunchpadConfig[];
  dexes: DexConfig[];
}

export interface LaunchpadConfig {
  name: string;
  factory: string;
  type: 'BONDING_CURVE' | 'DIRECT_LP';
  eventSignature: string;
}

export interface DexConfig {
  name: string;
  router: string;
  factory: string;
  type: 'V2' | 'V3';
}

export type AlertType =
  | 'POSITION_OPENED'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'DEPOSIT_CONFIRMED'
  | 'WITHDRAWAL_SENT'
  | 'DAILY_SUMMARY';

export interface Alert {
  type: AlertType;
  tg_id: number;
  data: Record<string, unknown>;
  created_at: string;
}

export interface TokenAnalysis {
  safe: boolean;
  reason?: string;
  liquidity: bigint;
  buyTax: number;
  sellTax: number;
  isHoneypot: boolean;
  hasBlacklist: boolean;
  canSell: boolean;
}

export interface UserStats {
  deposited: number;
  currentValue: number;
  totalPnl: number;
  pnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
}

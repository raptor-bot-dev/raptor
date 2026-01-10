// Core types used across all apps

// Chain types - all supported chains
export type EVMChain = 'bsc' | 'base' | 'eth';
export type Chain = EVMChain | 'sol';

// Mode types - trading modes
export type TradingMode = 'pool' | 'solo' | 'snipe';

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
  chain: Chain;
  mode: TradingMode;
  deposited: string;
  current_value: string;
  deposit_address: string;
  updated_at: string;
}

export interface Position {
  id: number;
  tg_id: number;
  chain: Chain;
  mode: TradingMode;
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
  program_id?: string; // Solana program ID (pump.fun, Raydium, etc.)
  created_at: string;
  closed_at: string | null;
  // v2.2 strategy fields
  strategy?: 'MICRO_SCALP' | 'STANDARD' | 'MOON_BAG' | 'DCA_EXIT' | 'TRAILING';
  peak_price?: string;
  trailing_stop_price?: string;
  partial_exit_taken?: boolean;
  exit_levels_hit?: number;
  moon_bag_amount?: string;
  deployer_address?: string;
}

export interface Trade {
  id: number;
  tg_id: number;
  position_id: number | null;
  chain: Chain;
  mode: TradingMode;
  token_address: string;
  token_symbol: string;
  type: 'BUY' | 'SELL';
  amount_in: string;
  amount_out: string;
  price: string;
  pnl: string | null;
  pnl_percent: number | null;
  fee_amount: string;
  source: string;
  tx_hash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  created_at: string;
}

export interface Opportunity {
  id: string;
  chain: Chain;
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

export interface PrivateRpcConfig {
  enabled: boolean;
  type: 'flashbots' | 'bloxroute' | 'mevblocker' | 'custom';
  endpoint: string;
  authHeader?: string;
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
  privateRpc?: PrivateRpcConfig;
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
  | 'TRAILING_STOP'
  | 'DCA_EXIT'
  | 'MOON_BAG_EXIT'
  | 'MAX_HOLD_TIME'
  | 'DEPOSIT_PENDING'
  | 'DEPOSIT_CONFIRMED'
  | 'WITHDRAWAL_SENT'
  | 'DAILY_SUMMARY'
  | 'HONEYPOT_ALERT'
  | 'LOW_SCORE_WARNING'
  | 'GRADUATION';

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
  totalFeesPaid: number;
}

// Solana-specific configuration
export interface SolanaConfig {
  cluster: 'mainnet-beta' | 'devnet';
  rpcUrl: string;
  wssUrl: string;
  nativeToken: string;
  minPositionSize: number; // in SOL
  maxPositionSize: number; // in SOL
  maxPoolPercent: number;
  launchpads: SolanaLaunchpadConfig[];
  dexes: SolanaDexConfig[];
}

export interface SolanaLaunchpadConfig {
  name: string;
  programId: string;
  type: 'BONDING_CURVE' | 'DIRECT_LP';
}

export interface SolanaDexConfig {
  name: string;
  programId: string;
  type: 'AMM' | 'CLMM' | 'AGGREGATOR';
}

// Fee tracking
export interface Fee {
  id: number;
  trade_id: number | null;
  tg_id: number;
  chain: Chain;
  amount: string;
  token: string;
  created_at: string;
}

// Snipe request for manual sniping mode
export type SnipeStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface SnipeRequest {
  id: number;
  tg_id: number;
  chain: Chain;
  token_address: string;
  amount: string;
  take_profit_percent: number;
  stop_loss_percent: number;
  skip_safety_check: boolean;
  position_id: number | null;
  status: SnipeStatus;
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
}

// User mode preferences per chain
export interface UserModePreference {
  id: number;
  tg_id: number;
  chain: Chain;
  default_mode: TradingMode;
  created_at: string;
  updated_at: string;
}

// Deposit/Withdrawal with fees
export interface Deposit {
  id: number;
  tg_id: number;
  chain: Chain;
  amount: string;
  tx_hash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  created_at: string;
}

export interface Withdrawal {
  id: number;
  tg_id: number;
  chain: Chain;
  amount: string;
  fee_amount: string;
  to_address: string;
  tx_hash: string | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  created_at: string;
}

// Core types used across all apps

// Chain types - all supported chains
export type EVMChain = 'bsc' | 'base' | 'eth';
export type Chain = EVMChain | 'sol';

// Mode types - trading modes (legacy, use StrategyKind for v3.1)
export type TradingMode = 'pool' | 'solo' | 'snipe';

// =============================================================================
// RAPTOR v3.1 Types
// =============================================================================

/** Strategy mode: MANUAL (user-initiated) or AUTO (hunter-initiated) */
export type StrategyKind = 'MANUAL' | 'AUTO';

/** Risk profile for auto strategies */
export type RiskProfile = 'SAFE' | 'BALANCED' | 'DEGEN';

/** Trade job status in the queue */
export type JobStatus = 'QUEUED' | 'LEASED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';

/** Execution status for budget tracking */
export type ExecutionStatus = 'RESERVED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'CANCELED';

/** Opportunity status in the pipeline */
export type OpportunityStatus = 'NEW' | 'QUALIFIED' | 'REJECTED' | 'EXPIRED' | 'EXECUTING' | 'COMPLETED';

/** Opportunity outcome after all jobs complete */
export type OpportunityOutcome = 'SUCCESS' | 'FAILED' | 'MIXED';

/** Position status */
export type PositionStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

/** Exit trigger types */
export type ExitTrigger = 'TP' | 'SL' | 'TRAIL' | 'MAXHOLD' | 'EMERGENCY' | 'MANUAL';

/** Trade action */
export type TradeAction = 'BUY' | 'SELL';

/** Trade mode for reserve_trade_budget */
export type TradeMode = 'MANUAL' | 'AUTO';

/** Cooldown types */
export type CooldownType = 'MINT' | 'USER_MINT' | 'DEPLOYER';

/** Notification types */
export type NotificationType =
  | 'TRADE_DONE'
  | 'TRADE_FAILED'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TRAILING_STOP'
  | 'MAX_HOLD'
  | 'OPPORTUNITY_FOUND'
  | 'BUDGET_WARNING'
  | 'CIRCUIT_BREAKER'
  // v3.1 additions for Bot notifications
  | 'BUY_CONFIRMED'
  | 'BUY_FAILED'
  | 'SELL_CONFIRMED'
  | 'SELL_FAILED'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'TRAILING_STOP_HIT'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'OPPORTUNITY_DETECTED';

// =============================================================================
// v3.1 Table Types
// =============================================================================

/** Strategy configuration (MANUAL or AUTO) */
export interface Strategy {
  id: string;
  user_id: number;
  kind: StrategyKind;
  name: string;
  enabled: boolean;
  auto_execute: boolean;
  chain: Chain;
  risk_profile: RiskProfile;

  // Position limits
  max_positions: number;
  max_per_trade_sol: number;
  max_daily_sol: number;
  max_open_exposure_sol: number;

  // Execution params
  slippage_bps: number;
  priority_fee_lamports: number | null;

  // Exit strategy
  take_profit_percent: number;
  stop_loss_percent: number;
  max_hold_minutes: number;

  // Trailing stop
  trailing_enabled: boolean;
  trailing_activation_percent: number | null;
  trailing_distance_percent: number | null;

  // DCA
  dca_enabled: boolean;
  dca_levels: Array<{ sell_percent: number; at_profit_percent: number }>;

  // Moon bag
  moon_bag_percent: number;

  // Filters for auto strategies
  min_score: number;
  min_liquidity_sol: number;
  allowed_launchpads: string[];

  // Cooldown
  cooldown_seconds: number;

  // Blocklists
  token_allowlist: string[];
  token_denylist: string[];
  deployer_denylist: string[];

  created_at: string;
  updated_at: string;
}

/** Detected token opportunity */
export interface OpportunityV31 {
  id: string;
  chain: Chain;
  source: string;
  token_mint: string;
  token_name: string | null;
  token_symbol: string | null;
  detected_at: string;

  // Scoring
  score: number | null;
  reasons: Array<{ rule: string; value: unknown; passed: boolean; weight: number }> | null;
  raw_data: Record<string, unknown> | null;

  // Status
  status: OpportunityStatus;
  status_reason: string | null;
  outcome: OpportunityOutcome | null;

  // Source-specific
  deployer: string | null;
  bonding_curve: string | null;
  initial_liquidity_sol: number | null;
  bonding_progress_percent: number | null;

  // Matched strategies
  matched_strategy_ids: string[] | null;

  // Timestamps
  qualified_at: string | null;
  expired_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Trade job in the queue */
export interface TradeJob {
  id: string;
  strategy_id: string;
  user_id: number;
  opportunity_id: string | null;
  chain: Chain;
  action: TradeAction;
  idempotency_key: string;
  payload: TradeJobPayload;
  priority: number;
  status: JobStatus;

  // Lease
  lease_owner: string | null;
  lease_expires_at: string | null;

  // Retry
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;

  // Timestamps
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Trade job payload */
export interface TradeJobPayload {
  mint: string;
  amount_sol?: number;
  position_id?: string;
  sell_percent?: number;
  slippage_bps: number;
  priority_fee_lamports?: number;
  trigger?: ExitTrigger;
  trigger_price?: number;
}

/** Execution record (spend ledger) */
export interface Execution {
  id: string;
  mode: TradeMode;
  user_id: number;
  strategy_id: string;
  job_id: string | null;
  chain: Chain;
  action: TradeAction;
  token_mint: string;
  amount_in_sol: number;
  idempotency_key: string | null;
  status: ExecutionStatus;

  // Transaction
  tx_sig: string | null;
  tokens_out: number | null;
  price_per_token: number | null;

  // Timing
  submitted_at: string | null;
  confirmed_at: string | null;

  // Error
  error: string | null;
  error_code: string | null;
  result: Record<string, unknown> | null;

  created_at: string;
  updated_at: string;
}

/** Position (v3.1 updated) */
export interface PositionV31 {
  id: string;
  user_id: number;
  strategy_id: string;
  opportunity_id: string | null;
  chain: Chain;
  token_mint: string;
  token_symbol: string | null;
  token_name: string | null;

  // Entry
  entry_execution_id: string | null;
  entry_tx_sig: string | null;
  entry_cost_sol: number;
  entry_price: number;
  size_tokens: number;

  // Current state
  current_price: number | null;
  peak_price: number | null;
  current_value_sol: number | null;
  unrealized_pnl_sol: number | null;
  unrealized_pnl_percent: number | null;
  price_updated_at: string | null;

  // Exit
  exit_execution_id: string | null;
  exit_tx_sig: string | null;
  exit_price: number | null;
  exit_trigger: ExitTrigger | null;
  realized_pnl_sol: number | null;
  realized_pnl_percent: number | null;

  // Status
  status: PositionStatus;
  opened_at: string;
  closed_at: string | null;

  created_at: string;
  updated_at: string;
}

/** Notification for Telegram delivery */
export interface Notification {
  id: string;
  user_id: number;
  type: NotificationType;
  payload: Record<string, unknown>;

  // Delivery
  delivered_at: string | null;
  delivery_attempts: number;
  last_error: string | null;
  next_attempt_at: string;

  // Claiming
  claimed_by: string | null;
  claimed_at: string | null;

  created_at: string;
}

/** Safety controls (global and per-user) */
export interface SafetyControls {
  id: string;
  scope: 'GLOBAL' | string; // 'GLOBAL' or user_id as string

  trading_paused: boolean;
  auto_execute_enabled: boolean;
  manual_trading_enabled: boolean;

  // Circuit breaker
  consecutive_failures: number;
  circuit_breaker_threshold: number;
  circuit_open_until: string | null;

  created_at: string;
  updated_at: string;
}

/** Cooldown for rate limiting */
export interface Cooldown {
  chain: Chain;
  cooldown_type: CooldownType;
  target: string;
  cooldown_until: string;
  reason: string | null;
}

// =============================================================================
// RPC Function Types
// =============================================================================

/** Result from reserve_trade_budget RPC */
export interface ReserveBudgetResult {
  allowed: boolean;
  reason?: string;
  reservation_id?: string;
  execution_id?: string; // Alias for reservation_id
}

/** Result from finalize_job RPC */
export interface FinalizeJobResult extends TradeJob {}

// =============================================================================
// Legacy Types (kept for backwards compatibility)
// =============================================================================

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

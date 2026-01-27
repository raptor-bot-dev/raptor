/**
 * RAPTOR Database Types (Phase 0 Fresh Schema)
 *
 * These types match the fresh database schema for the Bags.fm/Meteora revamp.
 * Generated to match supabase/migrations/20260127000000_phase0_fresh_schema.sql
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================================================
// Enums (matching CHECK constraints)
// ============================================================================

export type UserTier = 'free' | 'premium' | 'vip';
export type AllowlistMode = 'off' | 'partners_only' | 'custom';
export type LaunchSource = 'bags' | 'pumpfun';
export type DiscoveryMethod = 'telegram' | 'onchain';
export type CandidateStatus = 'new' | 'accepted' | 'rejected' | 'expired';
export type LifecycleState = 'PRE_GRADUATION' | 'POST_GRADUATION' | 'CLOSED';
export type PricingSource = 'BONDING_CURVE' | 'AMM_POOL';
export type TriggerState = 'MONITORING' | 'TRIGGERED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
export type ExitTrigger = 'TP' | 'SL' | 'TRAIL' | 'MAXHOLD' | 'EMERGENCY' | 'MANUAL' | 'GRADUATION';
export type TradeSide = 'BUY' | 'SELL';
export type ExecutionStatus = 'pending' | 'sent' | 'confirmed' | 'failed';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

// ============================================================================
// Table Types
// ============================================================================

export interface User {
  id: string;
  created_at: string;
  telegram_chat_id: number;
  telegram_username: string | null;
  tier: UserTier;
  is_banned: boolean;
  banned_at: string | null;
  banned_reason: string | null;
  last_active_at: string | null;
}

export interface UserInsert {
  id?: string;
  created_at?: string;
  telegram_chat_id: number;
  telegram_username?: string | null;
  tier?: UserTier;
  is_banned?: boolean;
  banned_at?: string | null;
  banned_reason?: string | null;
  last_active_at?: string | null;
}

export interface UserUpdate {
  telegram_chat_id?: number;
  telegram_username?: string | null;
  tier?: UserTier;
  is_banned?: boolean;
  banned_at?: string | null;
  banned_reason?: string | null;
  last_active_at?: string | null;
}

export interface Wallet {
  id: string;
  user_id: string;
  pubkey: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface WalletInsert {
  id?: string;
  user_id: string;
  pubkey: string;
  label?: string | null;
  is_active?: boolean;
  created_at?: string;
}

export interface WalletUpdate {
  label?: string | null;
  is_active?: boolean;
}

export interface Settings {
  user_id: string;
  slippage_bps: number;
  max_positions: number;
  max_trades_per_hour: number;
  max_buy_amount_sol: number;
  allowlist_mode: AllowlistMode;
  kill_switch: boolean;
  updated_at: string;
}

export interface SettingsInsert {
  user_id: string;
  slippage_bps?: number;
  max_positions?: number;
  max_trades_per_hour?: number;
  max_buy_amount_sol?: number;
  allowlist_mode?: AllowlistMode;
  kill_switch?: boolean;
  updated_at?: string;
}

export interface SettingsUpdate {
  slippage_bps?: number;
  max_positions?: number;
  max_trades_per_hour?: number;
  max_buy_amount_sol?: number;
  allowlist_mode?: AllowlistMode;
  kill_switch?: boolean;
  updated_at?: string;
}

export interface LaunchCandidate {
  id: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  launch_source: LaunchSource;
  discovery_method: DiscoveryMethod;
  first_seen_at: string;
  raw_payload: Json | null;
  status: CandidateStatus;
  status_reason: string | null;
  processed_at: string | null;
}

export interface LaunchCandidateInsert {
  id?: string;
  mint: string;
  symbol?: string | null;
  name?: string | null;
  launch_source: LaunchSource;
  discovery_method: DiscoveryMethod;
  first_seen_at?: string;
  raw_payload?: Json | null;
  status?: CandidateStatus;
  status_reason?: string | null;
  processed_at?: string | null;
}

export interface LaunchCandidateUpdate {
  symbol?: string | null;
  name?: string | null;
  raw_payload?: Json | null;
  status?: CandidateStatus;
  status_reason?: string | null;
  processed_at?: string | null;
}

export interface Position {
  id: string;
  user_id: string;
  wallet_id: string | null;
  mint: string;
  symbol: string | null;
  name: string | null;
  lifecycle_state: LifecycleState;
  pricing_source: PricingSource;
  router_used: string | null;
  entry_price: number;
  entry_cost_sol: number;
  size_tokens: number;
  current_price: number | null;
  current_value_sol: number | null;
  peak_price: number | null;
  exit_price: number | null;
  exit_value_sol: number | null;
  exit_trigger: ExitTrigger | null;
  realized_pnl_sol: number | null;
  realized_pnl_percent: number | null;
  tp_percent: number | null;
  sl_percent: number | null;
  tp_price: number | null;
  sl_price: number | null;
  trailing_enabled: boolean;
  trailing_activation_percent: number | null;
  trailing_distance_percent: number | null;
  trigger_state: TriggerState;
  trigger_error: string | null;
  opened_at: string;
  closed_at: string | null;
  price_updated_at: string | null;
  launch_candidate_id: string | null;
  entry_execution_id: string | null;
  exit_execution_id: string | null;
  bonding_curve: string | null;
  metadata: Json | null;
}

export interface PositionInsert {
  id?: string;
  user_id: string;
  wallet_id?: string | null;
  mint: string;
  symbol?: string | null;
  name?: string | null;
  lifecycle_state?: LifecycleState;
  pricing_source?: PricingSource;
  router_used?: string | null;
  entry_price: number;
  entry_cost_sol: number;
  size_tokens: number;
  current_price?: number | null;
  current_value_sol?: number | null;
  peak_price?: number | null;
  exit_price?: number | null;
  exit_value_sol?: number | null;
  exit_trigger?: ExitTrigger | null;
  realized_pnl_sol?: number | null;
  realized_pnl_percent?: number | null;
  tp_percent?: number | null;
  sl_percent?: number | null;
  tp_price?: number | null;
  sl_price?: number | null;
  trailing_enabled?: boolean;
  trailing_activation_percent?: number | null;
  trailing_distance_percent?: number | null;
  trigger_state?: TriggerState;
  trigger_error?: string | null;
  opened_at?: string;
  closed_at?: string | null;
  price_updated_at?: string | null;
  launch_candidate_id?: string | null;
  entry_execution_id?: string | null;
  exit_execution_id?: string | null;
  bonding_curve?: string | null;
  metadata?: Json | null;
}

export interface PositionUpdate {
  wallet_id?: string | null;
  symbol?: string | null;
  name?: string | null;
  lifecycle_state?: LifecycleState;
  pricing_source?: PricingSource;
  router_used?: string | null;
  current_price?: number | null;
  current_value_sol?: number | null;
  peak_price?: number | null;
  exit_price?: number | null;
  exit_value_sol?: number | null;
  exit_trigger?: ExitTrigger | null;
  realized_pnl_sol?: number | null;
  realized_pnl_percent?: number | null;
  tp_percent?: number | null;
  sl_percent?: number | null;
  tp_price?: number | null;
  sl_price?: number | null;
  trailing_enabled?: boolean;
  trailing_activation_percent?: number | null;
  trailing_distance_percent?: number | null;
  trigger_state?: TriggerState;
  trigger_error?: string | null;
  closed_at?: string | null;
  price_updated_at?: string | null;
  exit_execution_id?: string | null;
  bonding_curve?: string | null;
  metadata?: Json | null;
}

export interface Execution {
  id: string;
  idempotency_key: string;
  user_id: string;
  position_id: string | null;
  mint: string;
  side: TradeSide;
  requested_amount_sol: number | null;
  requested_tokens: number | null;
  slippage_bps: number | null;
  filled_amount_sol: number | null;
  filled_tokens: number | null;
  price_per_token: number | null;
  signature: string | null;
  status: ExecutionStatus;
  error_code: string | null;
  error_detail: string | null;
  router_used: string | null;
  quote_response: Json | null;
  created_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
}

export interface ExecutionInsert {
  id?: string;
  idempotency_key: string;
  user_id: string;
  position_id?: string | null;
  mint: string;
  side: TradeSide;
  requested_amount_sol?: number | null;
  requested_tokens?: number | null;
  slippage_bps?: number | null;
  filled_amount_sol?: number | null;
  filled_tokens?: number | null;
  price_per_token?: number | null;
  signature?: string | null;
  status?: ExecutionStatus;
  error_code?: string | null;
  error_detail?: string | null;
  router_used?: string | null;
  quote_response?: Json | null;
  created_at?: string;
  sent_at?: string | null;
  confirmed_at?: string | null;
}

export interface ExecutionUpdate {
  position_id?: string | null;
  filled_amount_sol?: number | null;
  filled_tokens?: number | null;
  price_per_token?: number | null;
  signature?: string | null;
  status?: ExecutionStatus;
  error_code?: string | null;
  error_detail?: string | null;
  router_used?: string | null;
  quote_response?: Json | null;
  sent_at?: string | null;
  confirmed_at?: string | null;
}

export interface NotificationOutbox {
  id: string;
  user_id: string;
  type: string;
  payload: Json;
  status: NotificationStatus;
  attempts: number;
  max_attempts: number;
  sending_expires_at: string | null;
  worker_id: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface NotificationOutboxInsert {
  id?: string;
  user_id: string;
  type: string;
  payload: Json;
  status?: NotificationStatus;
  attempts?: number;
  max_attempts?: number;
  sending_expires_at?: string | null;
  worker_id?: string | null;
  last_error?: string | null;
  created_at?: string;
  sent_at?: string | null;
}

export interface NotificationOutboxUpdate {
  status?: NotificationStatus;
  attempts?: number;
  sending_expires_at?: string | null;
  worker_id?: string | null;
  last_error?: string | null;
  sent_at?: string | null;
}

// ============================================================================
// RPC Function Types
// ============================================================================

export interface TriggerExitResult {
  triggered: boolean;
  reason?: string;
  position_id?: string;
  trigger?: string;
  current_state?: string;
}

// ============================================================================
// Database Interface (Supabase Generated Style)
// ============================================================================

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      wallets: {
        Row: Wallet;
        Insert: WalletInsert;
        Update: WalletUpdate;
      };
      settings: {
        Row: Settings;
        Insert: SettingsInsert;
        Update: SettingsUpdate;
      };
      launch_candidates: {
        Row: LaunchCandidate;
        Insert: LaunchCandidateInsert;
        Update: LaunchCandidateUpdate;
      };
      positions: {
        Row: Position;
        Insert: PositionInsert;
        Update: PositionUpdate;
      };
      executions: {
        Row: Execution;
        Insert: ExecutionInsert;
        Update: ExecutionUpdate;
      };
      notifications_outbox: {
        Row: NotificationOutbox;
        Insert: NotificationOutboxInsert;
        Update: NotificationOutboxUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_notifications: {
        Args: { p_worker_id: string; p_limit?: number; p_lease_seconds?: number };
        Returns: NotificationOutbox[];
      };
      mark_notification_delivered: {
        Args: { p_notification_id: string };
        Returns: void;
      };
      mark_notification_failed: {
        Args: { p_notification_id: string; p_error: string };
        Returns: void;
      };
      trigger_exit_atomically: {
        Args: { p_position_id: string; p_trigger: string; p_trigger_price: number };
        Returns: TriggerExitResult;
      };
      mark_position_executing: {
        Args: { p_position_id: string };
        Returns: boolean;
      };
      mark_trigger_completed: {
        Args: { p_position_id: string };
        Returns: boolean;
      };
      mark_trigger_failed: {
        Args: { p_position_id: string; p_error?: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_tier: UserTier;
      allowlist_mode: AllowlistMode;
      launch_source: LaunchSource;
      discovery_method: DiscoveryMethod;
      candidate_status: CandidateStatus;
      lifecycle_state: LifecycleState;
      pricing_source: PricingSource;
      trigger_state: TriggerState;
      exit_trigger: ExitTrigger;
      trade_side: TradeSide;
      execution_status: ExecutionStatus;
      notification_status: NotificationStatus;
    };
  };
}

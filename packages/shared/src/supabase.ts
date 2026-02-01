import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createPgAdapter } from './pg-adapter.js';
import type { PgAdapter } from './pg-adapter.js';
import type {
  User,
  UserBalance,
  Position,
  Trade,
  UserStats,
  Fee,
  SnipeRequest,
  SnipeStatus,
  Chain,
  TradingMode,
  UserModePreference,
} from './types.js';

// ---------------------------------------------------------------------------
// Client initialisation: DATABASE_URL → pg-adapter, else → @supabase/supabase-js
// ---------------------------------------------------------------------------

type AnyClient = SupabaseClient | PgAdapter;

let _client: AnyClient | null = null;

function getClient(): AnyClient {
  if (!_client) {
    if (process.env.DATABASE_URL) {
      _client = createPgAdapter();
    } else {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('DATABASE_URL or SUPABASE_URL+SUPABASE_SERVICE_KEY must be set');
      }

      _client = createClient(supabaseUrl, supabaseKey);
    }
  }
  return _client;
}

// Export getter for supabase client (backwards compatibility)
// The Proxy ensures every property access goes through getClient(),
// which returns either a real SupabaseClient or a PgAdapter.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getClient();
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// User functions
export async function getUser(tgId: number): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_chat_id', tgId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  // Backwards-compat mapping (legacy User type expects tg_id + last_login).
  return {
    tg_id: data.telegram_chat_id,
    username: data.telegram_username ?? null,
    first_name: null,
    photo_url: null,
    created_at: data.created_at,
    last_login: data.last_active_at ?? null,
  } as unknown as User;
}

export async function upsertUser(user: {
  tg_id: number;
  username?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
}): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        telegram_chat_id: user.tg_id,
        telegram_username: user.username ?? null,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_chat_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return {
    tg_id: data.telegram_chat_id,
    username: data.telegram_username ?? null,
    first_name: null,
    photo_url: null,
    created_at: data.created_at,
    last_login: data.last_active_at ?? null,
  } as unknown as User;
}

// Balance functions
// AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
// These functions are guarded to return safe defaults instead of crashing.
export async function getUserBalances(tgId: number): Promise<UserBalance[]> {
  console.warn('[DEPRECATED] getUserBalances: user_balances table does not exist in Phase 0 schema');
  return [];
}

/**
 * Get user balance for a specific chain
 * AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
 */
export async function getUserBalance(tgId: number, chain: Chain): Promise<UserBalance | null> {
  console.warn('[DEPRECATED] getUserBalance: user_balances table does not exist in Phase 0 schema');
  return null;
}

/**
 * AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
 */
export async function getOrCreateBalance(
  tgId: number,
  chain: Chain,
  depositAddress: string,
  mode: TradingMode = 'pool'
): Promise<UserBalance> {
  console.warn('[DEPRECATED] getOrCreateBalance: user_balances table does not exist in Phase 0 schema');
  return {
    tg_id: tgId,
    chain,
    mode,
    deposited: '0',
    current_value: '0',
    deposit_address: depositAddress,
  } as unknown as UserBalance;
}

/**
 * AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
 */
export async function updateBalance(
  tgId: number,
  chain: Chain,
  updates: { deposited?: string; current_value?: string },
  mode: TradingMode = 'pool'
): Promise<UserBalance> {
  console.warn('[DEPRECATED] updateBalance: user_balances table does not exist in Phase 0 schema');
  return {} as unknown as UserBalance;
}

// Position functions
export async function getActivePositions(tgId: number): Promise<Position[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('tg_id', tgId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getAllActivePositions(): Promise<Position[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('status', 'ACTIVE');

  if (error) throw error;
  return data || [];
}

export async function createPosition(position: {
  tg_id: number;
  chain: Chain;
  mode: TradingMode;
  token_address: string;
  token_symbol: string;
  amount_in: string;
  tokens_held: string;
  entry_price: string;
  take_profit_percent: number;
  stop_loss_percent: number;
  source: string;
  score: number;
  program_id?: string; // Solana program ID
}): Promise<Position> {
  const { data, error } = await supabase
    .from('positions')
    .insert({
      ...position,
      current_price: position.entry_price,
      unrealized_pnl: '0',
      unrealized_pnl_percent: 0,
      status: 'ACTIVE',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePosition(
  positionId: number,
  updates: {
    current_price?: string;
    unrealized_pnl?: string;
    unrealized_pnl_percent?: number;
    // v2.2 strategy fields
    peak_price?: string;
    trailing_stop_price?: string;
    partial_exit_taken?: boolean;
    exit_levels_hit?: number;
    moon_bag_amount?: string;
    tokens_held?: string;
    status?: 'ACTIVE' | 'CLOSED' | 'PENDING';
  }
): Promise<Position> {
  const { data, error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', positionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function closePosition(
  positionId: number,
  exitData: {
    exit_price: string;
    pnl: string;
    pnl_percent: number;
  }
): Promise<Position> {
  const { data, error } = await supabase
    .from('positions')
    .update({
      current_price: exitData.exit_price,
      unrealized_pnl: exitData.pnl,
      unrealized_pnl_percent: exitData.pnl_percent,
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
    })
    .eq('id', positionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Trade functions
// AUDIT FIX (C-2): trades table does not exist in Phase 0 schema.
// These functions are guarded to return safe defaults.
export async function getRecentTrades(tgId: number, limit = 20): Promise<Trade[]> {
  console.warn('[DEPRECATED] getRecentTrades: trades table does not exist in Phase 0 schema');
  return [];
}

export async function getTradesPaginated(
  tgId: number,
  limit = 20,
  offset = 0
): Promise<{ trades: Trade[]; total: number }> {
  console.warn('[DEPRECATED] getTradesPaginated: trades table does not exist in Phase 0 schema');
  return { trades: [], total: 0 };
}

export async function recordTrade(trade: {
  tg_id: number;
  position_id?: number | null;
  chain: Chain;
  mode: TradingMode;
  token_address: string;
  token_symbol: string;
  type: 'BUY' | 'SELL';
  amount_in: string;
  amount_out: string;
  price: string;
  pnl?: string | null;
  pnl_percent?: number | null;
  fee_amount: string;
  source: string;
  tx_hash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
}): Promise<Trade> {
  console.warn('[DEPRECATED] recordTrade: trades table does not exist in Phase 0 schema');
  return {} as unknown as Trade;
}

export async function updateTradeStatus(
  tradeId: number,
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
): Promise<Trade> {
  console.warn('[DEPRECATED] updateTradeStatus: trades table does not exist in Phase 0 schema');
  return {} as unknown as Trade;
}

// Stats functions
export async function getUserStats(tgId: number): Promise<UserStats> {
  // Revamp: no custodial deposits table; compute stats from CLOSED positions only.
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) {
    return {
      deposited: 0,
      currentValue: 0,
      totalPnl: 0,
      pnlPercent: 0,
      totalTrades: 0,
      winningTrades: 0,
      winRate: 0,
      totalFeesPaid: 0,
    };
  }

  const { data: closed, error } = await supabase
    .from('positions')
    .select('entry_cost_sol, realized_pnl_sol')
    .eq('user_id', userUuid)
    .eq('lifecycle_state', 'CLOSED');

  if (error) throw error;

  const rows = closed || [];
  const totalTrades = rows.length;
  const winningTrades = rows.filter((r: any) => Number(r.realized_pnl_sol ?? 0) > 0).length;
  const totalEntry = rows.reduce((sum: number, r: any) => sum + Number(r.entry_cost_sol ?? 0), 0);
  const totalPnl = rows.reduce((sum: number, r: any) => sum + Number(r.realized_pnl_sol ?? 0), 0);

  return {
    deposited: 0,
    currentValue: 0,
    totalPnl,
    pnlPercent: totalEntry > 0 ? (totalPnl / totalEntry) * 100 : 0,
    totalTrades,
    winningTrades,
    winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    totalFeesPaid: 0,
  };
}

// Allocations
// AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
export async function getUserAllocations(
  chain: Chain,
  mode: TradingMode = 'pool'
): Promise<Map<number, bigint>> {
  console.warn('[DEPRECATED] getUserAllocations: user_balances table does not exist in Phase 0 schema');
  return new Map();
}

// ============================================================================
// Fee Functions
// ============================================================================

// AUDIT FIX (C-4): fees table does not exist in Phase 0 schema.
export async function recordFee(fee: {
  trade_id?: number | null;
  tg_id: number;
  chain: Chain;
  amount: string;
  token: string;
}): Promise<Fee> {
  console.warn('[DEPRECATED] recordFee: fees table does not exist in Phase 0 schema');
  return {} as unknown as Fee;
}

export async function getUserFees(tgId: number, chain?: Chain): Promise<Fee[]> {
  console.warn('[DEPRECATED] getUserFees: fees table does not exist in Phase 0 schema');
  return [];
}

export async function getTotalFees(chain?: Chain): Promise<number> {
  console.warn('[DEPRECATED] getTotalFees: fees table does not exist in Phase 0 schema');
  return 0;
}

// ============================================================================
// Snipe Request Functions
// ============================================================================

// AUDIT FIX (C-5): snipe_requests table does not exist in Phase 0 schema.
// All snipe_requests functions are guarded to return safe defaults.
export async function createSnipeRequest(request: {
  tg_id: number;
  chain: Chain;
  token_address: string;
  amount: string;
  take_profit_percent?: number;
  stop_loss_percent?: number;
  skip_safety_check?: boolean;
}): Promise<SnipeRequest> {
  console.warn('[DEPRECATED] createSnipeRequest: snipe_requests table does not exist in Phase 0 schema');
  return {} as unknown as SnipeRequest;
}

export async function getSnipeRequest(id: number): Promise<SnipeRequest | null> {
  console.warn('[DEPRECATED] getSnipeRequest: snipe_requests table does not exist in Phase 0 schema');
  return null;
}

export async function getUserSnipeRequests(
  tgId: number,
  status?: SnipeStatus
): Promise<SnipeRequest[]> {
  console.warn('[DEPRECATED] getUserSnipeRequests: snipe_requests table does not exist in Phase 0 schema');
  return [];
}

export async function getPendingSnipeRequests(chain?: Chain): Promise<SnipeRequest[]> {
  console.warn('[DEPRECATED] getPendingSnipeRequests: snipe_requests table does not exist in Phase 0 schema');
  return [];
}

export async function updateSnipeRequestStatus(
  id: number,
  status: SnipeStatus,
  updates?: {
    position_id?: number;
    error_message?: string;
  }
): Promise<SnipeRequest> {
  console.warn('[DEPRECATED] updateSnipeRequestStatus: snipe_requests table does not exist in Phase 0 schema');
  return {} as unknown as SnipeRequest;
}

// ============================================================================
// Mode Preference Functions
// ============================================================================

// AUDIT FIX (C-6): user_mode_preferences table does not exist in Phase 0 schema.
export async function getUserModePreference(
  tgId: number,
  chain: Chain
): Promise<TradingMode> {
  return 'pool'; // Default mode — table doesn't exist
}

export async function setUserModePreference(
  tgId: number,
  chain: Chain,
  mode: TradingMode
): Promise<UserModePreference> {
  console.warn('[DEPRECATED] setUserModePreference: user_mode_preferences table does not exist in Phase 0 schema');
  return {} as unknown as UserModePreference;
}

// ============================================================================
// Position Functions by Mode
// ============================================================================

export async function getActivePositionsByMode(
  tgId: number,
  mode: TradingMode
): Promise<Position[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('tg_id', tgId)
    .eq('mode', mode)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getPositionByToken(
  tgId: number,
  chain: Chain,
  tokenAddress: string
): Promise<Position | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('token_address', tokenAddress)
    .eq('status', 'ACTIVE')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Get all active positions for a user
 */
export async function getUserPositions(tgId: number): Promise<Position[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('tg_id', tgId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get a single position by ID
 */
export async function getPosition(positionId: number): Promise<Position | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Update TP/SL for a position
 */
export async function updatePositionTpSl(
  positionId: number,
  updates: { take_profit_percent?: number; stop_loss_percent?: number }
): Promise<void> {
  const { error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', positionId);

  if (error) throw error;
}

// ============================================================================
// Balance Functions by Mode
// ============================================================================

// AUDIT FIX (C-3): user_balances table does not exist in Phase 0 schema.
export async function getUserBalancesByMode(
  tgId: number,
  mode: TradingMode
): Promise<UserBalance[]> {
  console.warn('[DEPRECATED] getUserBalancesByMode: user_balances table does not exist in Phase 0 schema');
  return [];
}

// ============================================================================
// User Wallet Functions (Self-Custodial v2.3 - Multi-Wallet Support)
// ============================================================================

export interface UserWallet {
  id: string;
  tg_id: number;
  chain: Chain;
  wallet_index: number;
  wallet_label: string | null;
  is_active: boolean;
  solana_address: string;
  public_key?: string; // v3.1: alias for solana_address
  solana_private_key_encrypted: Record<string, unknown>;
  created_at: string;
  backup_exported_at: string | null;
}

function mapWalletRowToUserWallet(tgId: number, row: Record<string, any>): UserWallet {
  const pubkey = (row.pubkey ?? row.solana_address ?? '') as string;
  return {
    id: String(row.id),
    tg_id: tgId,
    chain: (row.chain ?? 'sol') as Chain,
    wallet_index: Number(row.wallet_index ?? 1),
    wallet_label: (row.label ?? row.wallet_label ?? null) as string | null,
    is_active: Boolean(row.is_active),
    solana_address: pubkey,
    public_key: pubkey || undefined,
    solana_private_key_encrypted: (row.solana_private_key_encrypted ?? {}) as Record<string, unknown>,
    created_at: String(row.created_at ?? new Date().toISOString()),
    backup_exported_at: (row.backup_exported_at ?? null) as string | null,
  };
}

export interface CustomStrategy {
  // Core settings
  take_profit_percent: number;
  stop_loss_percent: number;
  max_hold_minutes: number;
  // Trailing stop
  trailing_enabled: boolean;
  trailing_activation_percent: number;
  trailing_distance_percent: number;
  // DCA Ladder
  dca_enabled: boolean;
  dca_levels: Array<{ sell_percent: number; at_profit_percent: number }>;
  // Moon bag
  moon_bag_percent: number;
  // Filters
  min_liquidity_usd: number;
  max_market_cap_usd: number;
  min_score: number;
  max_buy_tax_percent: number;
  max_sell_tax_percent: number;
  // Protection
  anti_rug_enabled: boolean;
  anti_mev_enabled: boolean;
  auto_approve_enabled: boolean;
  // Execution
  slippage_percent: number;
  gas_priority: 'low' | 'medium' | 'high' | 'turbo';
  retry_failed: boolean;
  // Notifications
  entry_alert: boolean;
  exit_alert: boolean;
  tp_sl_alert: boolean;
}

/**
 * Get all wallets for a user (Solana-only)
 */
export async function getUserWallets(tgId: number): Promise<UserWallet[]> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return [];

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userUuid)
    .eq('chain', 'sol')
    .order('wallet_index');

  if (error) throw error;
  return (data || []).map((row) => mapWalletRowToUserWallet(tgId, row as Record<string, any>));
}

/**
 * Get all wallets for a user on a specific chain
 */
export async function getUserWalletsForChain(tgId: number, chain: Chain): Promise<UserWallet[]> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return [];

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .order('wallet_index');

  if (error) throw error;
  return (data || []).map((row) => mapWalletRowToUserWallet(tgId, row as Record<string, any>));
}

/**
 * Get active wallet for a user on a specific chain
 */
export async function getActiveWallet(tgId: number, chain: Chain): Promise<UserWallet | null> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return null;

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? mapWalletRowToUserWallet(tgId, data as Record<string, any>) : null;
}

/**
 * Get a specific wallet by chain and index
 */
export async function getWalletByIndex(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<UserWallet | null> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return null;

  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? mapWalletRowToUserWallet(tgId, data as Record<string, any>) : null;
}

/**
 * Check if user has any wallet on any chain
 */
export async function userHasWallet(tgId: number): Promise<boolean> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return false;

  const { count, error } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userUuid);

  if (error) throw error;
  return (count || 0) > 0;
}

/**
 * Get wallet count for a user on a specific chain
 */
export async function getWalletCount(tgId: number, chain: Chain): Promise<number> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return 0;

  const { count, error } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userUuid)
    .eq('chain', chain);

  if (error) throw error;
  return count || 0;
}

/**
 * Create a new wallet for a user on a specific chain
 * Automatically assigns the next available wallet_index
 */
export async function createWallet(wallet: {
  tg_id: number;
  chain: Chain;
  address: string;
  private_key_encrypted: Record<string, unknown>;
  wallet_label?: string;
}): Promise<UserWallet> {
  // Ensure user exists (Phase-0 users table)
  await upsertUser({ tg_id: wallet.tg_id });
  const userUuid = await getUserUuidFromTgId(wallet.tg_id);
  if (!userUuid) {
    throw new Error('Failed to resolve user UUID');
  }

  const { data: existingWallets, error: existingError } = await supabase
    .from('wallets')
    .select('wallet_index,is_active')
    .eq('user_id', userUuid)
    .eq('chain', wallet.chain);

  if (existingError) throw existingError;

  const usedIndexes = new Set<number>((existingWallets || []).map((w: any) => Number(w.wallet_index)));
  let walletIndex: number | null = null;
  for (let i = 1; i <= 5; i++) {
    if (!usedIndexes.has(i)) {
      walletIndex = i;
      break;
    }
  }

  if (!walletIndex) {
    throw new Error(`Maximum 5 wallets per chain reached for ${wallet.chain}`);
  }

  const hasActive = (existingWallets || []).some((w: any) => Boolean(w.is_active));
  const label = wallet.wallet_label || `Wallet #${walletIndex}`;

  const { data, error } = await supabase
    .from('wallets')
    .insert({
      user_id: userUuid,
      chain: wallet.chain,
      wallet_index: walletIndex,
      label,
      is_active: !hasActive,
      pubkey: wallet.address,
      solana_private_key_encrypted: wallet.private_key_encrypted,
    })
    .select()
    .single();

  if (error) throw error;
  return mapWalletRowToUserWallet(wallet.tg_id, data as Record<string, any>);
}

/**
 * Delete a wallet (with validation)
 */
export async function deleteWallet(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<void> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) {
    throw new Error('User not found');
  }

  // First check if wallet exists and belongs to user
  const wallet = await getWalletByIndex(tgId, chain, walletIndex);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Don't allow deleting the only active wallet
  const allWallets = await getUserWalletsForChain(tgId, chain);
  if (allWallets.length === 1) {
    throw new Error('Cannot delete the only wallet on this chain');
  }

  // If deleting active wallet, set another one as active
  if (wallet.is_active) {
    const newActive = allWallets.find((w) => w.wallet_index !== walletIndex);
    if (newActive) {
      await setActiveWallet(tgId, chain, newActive.wallet_index);
    }
  }

  const { error } = await supabase
    .from('wallets')
    .delete()
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex);

  if (error) throw error;
}

/**
 * Set a wallet as the active wallet for a chain
 */
export async function setActiveWallet(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<void> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) {
    throw new Error('User not found');
  }

  // First, deactivate all wallets for this chain
  const { error: deactivateError } = await supabase
    .from('wallets')
    .update({ is_active: false })
    .eq('user_id', userUuid)
    .eq('chain', chain);

  if (deactivateError) throw deactivateError;

  // Then activate the selected wallet
  const { error: activateError } = await supabase
    .from('wallets')
    .update({ is_active: true })
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex);

  if (activateError) throw activateError;
}

/**
 * Update wallet label
 */
export async function updateWalletLabel(
  tgId: number,
  chain: Chain,
  walletIndex: number,
  label: string
): Promise<UserWallet> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) {
    throw new Error('User not found');
  }

  const { data, error } = await supabase
    .from('wallets')
    .update({ label })
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex)
    .select()
    .single();

  if (error) throw error;
  return mapWalletRowToUserWallet(tgId, data as Record<string, any>);
}

/**
 * Mark that a user has exported their backup keys for a specific wallet
 */
export async function markWalletBackupExported(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<void> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) {
    throw new Error('User not found');
  }

  const { error } = await supabase
    .from('wallets')
    .update({ backup_exported_at: new Date().toISOString() })
    .eq('user_id', userUuid)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex);

  if (error) throw error;
}

/**
 * Get or create a user's first wallet for a chain
 * Used for initial wallet setup during onboarding
 */
export async function getOrCreateFirstWallet(
  tgId: number,
  chain: Chain,
  createKeypair: () => { publicKey: string; privateKeyEncrypted: Record<string, unknown> }
): Promise<{ wallet: UserWallet; isNew: boolean }> {
  // Check for existing wallets on this chain
  const existingWallets = await getUserWalletsForChain(tgId, chain);
  if (existingWallets.length > 0) {
    // Return active wallet or first wallet
    const activeWallet = existingWallets.find((w) => w.is_active) || existingWallets[0];
    return { wallet: activeWallet, isNew: false };
  }

  // Generate new keypair
  const keypair = createKeypair();

  // Create wallet
  const wallet = await createWallet({
    tg_id: tgId,
    chain,
    address: keypair.publicKey,
    private_key_encrypted: keypair.privateKeyEncrypted,
    wallet_label: 'Wallet #1',
  });

  return { wallet, isNew: true };
}

/**
 * Get wallet by Solana address
 */
export async function getWalletBySolanaAddress(address: string): Promise<UserWallet | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*, users(telegram_chat_id)')
    .eq('pubkey', address)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  const tgId = Number((data as any)?.users?.telegram_chat_id ?? 0);
  if (!tgId) return null;
  return mapWalletRowToUserWallet(tgId, data as unknown as Record<string, any>);
}

/**
 * Get wallet by EVM address (checks all EVM chains)
 */
export async function getWalletByEvmAddress(address: string): Promise<UserWallet | null> {
  // Solana-only build: no EVM wallets.
  return null;
}

// ============================================================================
// Legacy function for backwards compatibility (deprecated)
// ============================================================================

/**
 * @deprecated Use getUserWallets or getActiveWallet instead
 */
export async function getUserWallet(tgId: number): Promise<UserWallet | null> {
  // Returns the first active wallet found (Solana preferred for backwards compat)
  const solWallet = await getActiveWallet(tgId, 'sol');
  if (solWallet) return solWallet;

  const wallets = await getUserWallets(tgId);
  return wallets[0] || null;
}

/**
 * @deprecated Use createWallet instead
 */
export async function createUserWallet(wallet: {
  tg_id: number;
  solana_address: string;
  solana_private_key_encrypted: Record<string, unknown>;
  evm_address: string;
  evm_private_key_encrypted: Record<string, unknown>;
}): Promise<UserWallet> {
  // Create Solana wallet
  const solWallet = await createWallet({
    tg_id: wallet.tg_id,
    chain: 'sol',
    address: wallet.solana_address,
    private_key_encrypted: wallet.solana_private_key_encrypted,
  });

  return solWallet;
}

/**
 * @deprecated Use getOrCreateFirstWallet for each chain instead
 */
export async function getOrCreateUserWallet(
  tgId: number,
  createKeypairs: () => {
    solana: { publicKey: string; privateKeyEncrypted: Record<string, unknown> };
  }
): Promise<{ wallet: UserWallet; isNew: boolean }> {
  // Check for existing wallets
  const hasWallet = await userHasWallet(tgId);
  if (hasWallet) {
    const wallet = await getUserWallet(tgId);
    return { wallet: wallet!, isNew: false };
  }

  // Generate keypairs and create wallets
  const keypairs = createKeypairs();

  // Create Solana wallet
  const solWallet = await createWallet({
    tg_id: tgId,
    chain: 'sol',
    address: keypairs.solana.publicKey,
    private_key_encrypted: keypairs.solana.privateKeyEncrypted,
  });

  return { wallet: solWallet, isNew: true };
}

/**
 * @deprecated Use markWalletBackupExported instead
 */
export async function markBackupExported(tgId: number): Promise<void> {
  const userUuid = await getUserUuidFromTgId(tgId);
  if (!userUuid) return;

  // Mark all wallets as exported
  const { error } = await supabase
    .from('wallets')
    .update({ backup_exported_at: new Date().toISOString() })
    .eq('user_id', userUuid);

  if (error) throw error;
}

// =====================
// User Settings (P0-2 Production Fix)
// =====================

/**
 * User settings stored in database for persistence
 * SECURITY: P0-2 - Settings must persist across bot restarts
 */
export interface UserSettings {
  tg_id: number;
  hunt_settings: Record<string, unknown>;
  gas_settings: Record<string, unknown>;
  slippage_settings: Record<string, unknown>;
  strategy_settings: Record<string, unknown>;
  updated_at: string;
}

/**
 * Get user settings from database
 */
export async function getUserSettings(tgId: number): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('tg_id', tgId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    // Table might not exist yet - return null gracefully
    if (error.code === '42P01') return null;
    console.error('[Supabase] getUserSettings error:', error);
    return null;
  }
  return data;
}

/**
 * Save user settings to database
 */
export async function saveUserSettings(
  tgId: number,
  settings: Partial<Omit<UserSettings, 'tg_id' | 'updated_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      tg_id: tgId,
      ...settings,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'tg_id',
    });

  if (error) {
    // Table might not exist yet - log but don't throw
    if (error.code === '42P01') {
      console.warn('[Supabase] user_settings table not found - settings not persisted');
      return;
    }
    console.error('[Supabase] saveUserSettings error:', error);
  }
}

/**
 * Get hunt settings for a user
 */
export async function getHuntSettings(tgId: number): Promise<Record<string, unknown> | null> {
  const settings = await getUserSettings(tgId);
  return settings?.hunt_settings || null;
}

/**
 * Save hunt settings for a user
 */
export async function saveHuntSettings(tgId: number, huntSettings: Record<string, unknown>): Promise<void> {
  await saveUserSettings(tgId, { hunt_settings: huntSettings });
}

/**
 * Get gas settings for a user
 */
export async function getGasSettings(tgId: number): Promise<Record<string, unknown> | null> {
  const settings = await getUserSettings(tgId);
  return settings?.gas_settings || null;
}

/**
 * Save gas settings for a user
 */
export async function saveGasSettings(tgId: number, gasSettings: Record<string, unknown>): Promise<void> {
  await saveUserSettings(tgId, { gas_settings: gasSettings });
}

/**
 * Get slippage settings for a user
 */
export async function getSlippageSettings(tgId: number): Promise<Record<string, unknown> | null> {
  const settings = await getUserSettings(tgId);
  return settings?.slippage_settings || null;
}

/**
 * Save slippage settings for a user
 */
export async function saveSlippageSettings(tgId: number, slippageSettings: Record<string, unknown>): Promise<void> {
  await saveUserSettings(tgId, { slippage_settings: slippageSettings });
}

/**
 * Get strategy settings for a user
 */
export async function getStrategySettings(tgId: number): Promise<Record<string, unknown> | null> {
  const settings = await getUserSettings(tgId);
  return settings?.strategy_settings || null;
}

/**
 * Save strategy settings for a user
 */
export async function saveStrategySettings(tgId: number, strategySettings: Record<string, unknown>): Promise<void> {
  await saveUserSettings(tgId, { strategy_settings: strategySettings });
}

// =============================================================================
// RAPTOR v3.1 RPC Wrappers
// =============================================================================

import type {
  Strategy,
  TradeJob,
  Execution,
  OpportunityV31,
  Notification as NotificationV31,
  SafetyControls,
  PositionV31,
  ReserveBudgetResult,
  TradeMode,
  TradeAction,
  JobStatus,
  ExecutionStatus,
  ExitTrigger,
} from './types.js';

// ============================================================================
// Strategy Functions
// ============================================================================

/**
 * Get all strategies for a user
 */
export async function getStrategies(userId: number): Promise<Strategy[]> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get a specific strategy by ID
 */
export async function getStrategy(strategyId: string): Promise<Strategy | null> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', strategyId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Get user's manual strategy for a chain (or create if missing)
 */
export async function getOrCreateManualStrategy(userId: number, chain: Chain): Promise<Strategy> {
  // Check for existing
  const { data: existing } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'MANUAL')
    .eq('chain', chain)
    .single();

  if (existing) return existing;

  // Create new manual strategy with defaults
  const { data, error } = await supabase
    .from('strategies')
    .insert({
      user_id: userId,
      kind: 'MANUAL',
      name: `Manual ${chain.toUpperCase()}`,
      chain,
      enabled: true,
      auto_execute: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get user's AUTO strategy for a chain (or create if missing)
 * v4.3: Used by hunt.ts to sync UI settings to execution strategy
 */
export async function getOrCreateAutoStrategy(userId: number, chain: Chain): Promise<Strategy> {
  const baseDefaults = {
    enabled: false,
    auto_execute: true,
    risk_profile: 'BALANCED' as const,
    // Position limits
    max_positions: 2,
    max_per_trade_sol: 0.1,
    max_daily_sol: 0.3,
    max_open_exposure_sol: 0.2,
    // Execution params (hunt defaults)
    slippage_bps: 1500, // 15% for hunt
    priority_fee_lamports: 1000000, // 0.001 SOL
    // Exit strategy
    take_profit_percent: 50,
    stop_loss_percent: 30,
    max_hold_minutes: 240, // 4 hours
    // Trailing stop
    trailing_enabled: true,
    trailing_activation_percent: 30,
    trailing_distance_percent: 20,
    // DCA
    dca_enabled: false,
    dca_levels: [],
    // Moon bag
    moon_bag_percent: 25,
	    // Filters
	    min_score: 10,
	    min_liquidity_sol: 0,
	    // Revamp: BAGS-only discovery/execution.
	    allowed_launchpads: ['bags'],
	    // Cooldown
	    cooldown_seconds: 300,
    // Blocklists
    token_allowlist: [],
    token_denylist: [],
    deployer_denylist: [],
    // v4.3: Snipe mode
    snipe_mode: 'quality' as const,
    // v4.4: Filter mode
    filter_mode: 'moderate' as const,
  };

  // Check for existing AUTO strategy
  const { data: existing } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'AUTO')
    .eq('chain', chain)
    .single();

  if (existing) {
    const defaultName = `Auto Hunt (${chain.toUpperCase()})`;
    const isPristine =
      !existing.enabled &&
      existing.name === defaultName &&
      existing.created_at === existing.updated_at;

    if (isPristine) {
      return updateStrategy(existing.id, baseDefaults);
    }

    return existing;
  }

  // Create new AUTO strategy with hunt defaults
  const { data, error } = await supabase
    .from('strategies')
    .insert({
      user_id: userId,
      kind: 'AUTO',
      name: `Auto Hunt (${chain.toUpperCase()})`,
      chain,
      ...baseDefaults,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all enabled auto strategies that match a chain
 */
export async function getEnabledAutoStrategies(chain: Chain): Promise<Strategy[]> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('kind', 'AUTO')
    .eq('chain', chain)
    .eq('enabled', true)
    .eq('auto_execute', true);

  if (error) throw error;
  return data || [];
}

/**
 * Get user's default strategy for a chain (MANUAL or first AUTO)
 */
export async function getUserDefaultStrategy(userId: number, chain: Chain): Promise<Strategy | null> {
  // First try to find a MANUAL strategy
  const { data: manual } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'MANUAL')
    .eq('chain', chain)
    .single();

  if (manual) return manual;

  // Otherwise return first enabled AUTO strategy
  const { data: auto } = await supabase
    .from('strategies')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'AUTO')
    .eq('chain', chain)
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  return auto || null;
}

/**
 * Update a strategy
 */
export async function updateStrategy(
  strategyId: string,
  updates: Partial<Omit<Strategy, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<Strategy> {
  const { data, error } = await supabase
    .from('strategies')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', strategyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// Trade Budget RPC
// ============================================================================

/**
 * Reserve trade budget atomically
 * Checks all safety controls, limits, and cooldowns before reserving
 * allowRetry: reuse FAILED executions for retryable job attempts
 */
export async function reserveTradeBudget(params: {
  mode: TradeMode;
  userId: number;
  strategyId: string;
  chain: Chain;
  action: TradeAction;
  tokenMint: string;
  amountSol: number;
  positionId?: string;
  idempotencyKey: string;
  allowRetry?: boolean;
}): Promise<ReserveBudgetResult> {
  // SAFETY (F-008): Gate all budget reservations behind global safety controls.
  // This prevents bypasses from alternate/manual code paths that still call reserveTradeBudget.
  const controls = await getGlobalSafetyControls();
  if (!controls) {
    return { allowed: false, reason: 'Safety controls unavailable' };
  }
  if (controls.trading_paused) {
    return { allowed: false, reason: 'Trading is paused' };
  }
  if (controls.circuit_open_until && new Date(controls.circuit_open_until) > new Date()) {
    return { allowed: false, reason: 'Circuit breaker is open' };
  }
  if (params.mode === 'AUTO' && !controls.auto_execute_enabled) {
    return { allowed: false, reason: 'Auto-execution disabled by safety controls' };
  }
  if (params.mode === 'MANUAL' && !controls.manual_trading_enabled) {
    return { allowed: false, reason: 'Manual trading disabled by safety controls' };
  }

  // Ensure user exists + resolve UUID (Phase-0 users table)
  await upsertUser({ tg_id: params.userId });
  const userUuid = await getUserUuidFromTgId(params.userId);
  if (!userUuid) {
    return { allowed: false, reason: 'User not found' };
  }

  const positionId =
    params.positionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.positionId)
      ? params.positionId
      : null;

  // Attempt to insert execution row (idempotency anchor)
  const { data: inserted, error: insertError } = await supabase
    .from('executions')
    .insert({
      idempotency_key: params.idempotencyKey,
      user_id: userUuid,
      position_id: positionId,
      mint: params.tokenMint,
      side: params.action,
      requested_amount_sol: params.amountSol,
    })
    .select('id,status')
    .single();

  if (!insertError && inserted) {
    return { allowed: true, reservation_id: inserted.id, execution_id: inserted.id };
  }

  // Duplicate idempotency_key: return the existing execution id (fail-closed by default)
  const msg = (insertError as any)?.message || '';
  const code = (insertError as any)?.code || '';
  const isDuplicate = code === '23505' || msg.toLowerCase().includes('duplicate');
  if (!isDuplicate) {
    throw insertError;
  }

  const { data: existing, error: existingError } = await supabase
    .from('executions')
    .select('id,status')
    .eq('idempotency_key', params.idempotencyKey)
    .single();

  if (existingError) throw existingError;
  if (!existing) {
    return { allowed: false, reason: 'Already executed' };
  }

  // Allow retry only if the prior execution failed.
  if (existing.status === 'failed' && (params.allowRetry ?? false)) {
    const { error: resetError } = await supabase
      .from('executions')
      .update({
        status: 'pending',
        error_code: null,
        error_detail: null,
        signature: null,
        filled_amount_sol: null,
        filled_tokens: null,
        price_per_token: null,
        sent_at: null,
        confirmed_at: null,
      })
      .eq('id', existing.id);

    if (resetError) throw resetError;
    return { allowed: true, reservation_id: existing.id, execution_id: existing.id };
  }

  return { allowed: false, reason: 'Already executed', reservation_id: existing.id, execution_id: existing.id };
}

// ============================================================================
// Trade Job Functions
// ============================================================================

/**
 * Claim trade jobs for processing via SKIP LOCKED leasing.
 * Atomically claims up to `limit` jobs, including stale lease takeover.
 */
export async function claimTradeJobs(
  workerId: string,
  limit: number = 5,
  leaseSeconds: number = 30,
  chain?: Chain
): Promise<TradeJob[]> {
  const { data, error } = await supabase.rpc('claim_trade_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
    p_chain: chain || 'sol',
  });

  if (error) throw error;

  // RPC returns JSONB array, parse into TradeJob[]
  const jobs = data as unknown;
  if (!Array.isArray(jobs)) return [];
  return jobs as TradeJob[];
}

/**
 * Mark a job as running (increments attempts)
 */
export async function markJobRunning(jobId: string, workerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_job_running', {
    p_job_id: jobId,
    p_worker_id: workerId,
  });

  if (error) throw error;
  return data as boolean;
}

/**
 * Extend the lease on a job (heartbeat)
 */
export async function extendLease(
  jobId: string,
  workerId: string,
  extensionSeconds: number = 30
): Promise<boolean> {
  const { data, error } = await supabase.rpc('extend_lease', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_extension_seconds: extensionSeconds,
  });

  if (error) throw error;
  return data as boolean;
}

/**
 * Finalize a job (DONE, FAILED, or CANCELED)
 */
export async function finalizeJob(params: {
  jobId: string;
  workerId: string;
  status: 'DONE' | 'FAILED' | 'CANCELED';
  retryable: boolean;
  error?: string;
}): Promise<TradeJob | null> {
  const { data, error } = await supabase.rpc('finalize_job', {
    p_job_id: params.jobId,
    p_worker_id: params.workerId,
    p_status: params.status,
    p_retryable: params.retryable,
    p_error: params.error || null,
  });

  if (error) throw error;
  return data as TradeJob | null;
}

/**
 * Create a trade job
 */
export async function createTradeJob(job: {
  strategyId: string;
  userId: number;
  opportunityId?: string;
  chain: Chain;
  action: TradeAction;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority?: number;
}): Promise<TradeJob> {
  const { data, error } = await supabase
    .from('trade_jobs')
    .insert({
      strategy_id: job.strategyId,
      user_id: job.userId,
      opportunity_id: job.opportunityId || null,
      chain: job.chain,
      action: job.action,
      idempotency_key: job.idempotencyKey,
      payload: job.payload,
      priority: job.priority ?? 100,
    })
    .select()
    .single();

  if (error) {
    // Handle duplicate key (job already exists)
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('trade_jobs')
        .select('*')
        .eq('idempotency_key', job.idempotencyKey)
        .single();
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

// ============================================================================
// Launch Candidate Functions (Candidate Consumer Loop)
// ============================================================================

/**
 * Launch candidate as stored in the database
 */
export interface LaunchCandidate {
  id: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  launch_source: 'bags' | 'pumpfun';
  discovery_method: 'telegram' | 'onchain';
  first_seen_at: string;
  raw_payload: Record<string, unknown> | null;
  status: 'new' | 'accepted' | 'rejected' | 'expired';
  status_reason: string | null;
  processed_at: string | null;
}

/**
 * Get new launch candidates for processing
 * Returns candidates with status='new' that haven't expired
 */
export async function getNewCandidates(
  limit: number,
  maxAgeSeconds: number
): Promise<LaunchCandidate[]> {
  const minFirstSeen = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from('launch_candidates')
    .select('*')
    .eq('status', 'new')
    .gte('first_seen_at', minFirstSeen)
    .order('first_seen_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[getNewCandidates] Error:', error.message);
    return [];
  }
  return data as LaunchCandidate[];
}

/**
 * Update launch candidate status
 */
export async function updateCandidateStatus(
  candidateId: string,
  status: 'accepted' | 'rejected' | 'expired',
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from('launch_candidates')
    .update({
      status,
      status_reason: reason || null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  if (error) {
    console.error('[updateCandidateStatus] Error:', error.message);
    throw error;
  }
}

/**
 * Expire stale candidates (older than maxAgeSeconds with status='new')
 * Returns the number of expired candidates
 */
export async function expireStaleCandidates(maxAgeSeconds: number): Promise<number> {
  const cutoffTime = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from('launch_candidates')
    .update({
      status: 'expired',
      status_reason: 'stale_candidate',
      processed_at: new Date().toISOString(),
    })
    .eq('status', 'new')
    .lt('first_seen_at', cutoffTime)
    .select('id');

  if (error) {
    console.error('[expireStaleCandidates] Error:', error.message);
    return 0;
  }
  return data?.length || 0;
}

// ============================================================================
// Execution Functions
// ============================================================================

/**
 * Update an execution record after trade
 */
export async function updateExecution(params: {
  executionId: string;
  status: ExecutionStatus;
  txSig?: string;
  tokensOut?: number;
  pricePerToken?: number;
  error?: string;
  errorCode?: string;
  result?: Record<string, unknown>;
}): Promise<Execution | null> {
  const statusMap: Record<ExecutionStatus, 'pending' | 'sent' | 'confirmed' | 'failed'> = {
    RESERVED: 'pending',
    SUBMITTED: 'sent',
    CONFIRMED: 'confirmed',
    FAILED: 'failed',
    CANCELED: 'failed',
  };

  const mappedStatus = statusMap[params.status];

  const updates: Record<string, unknown> = {
    status: mappedStatus,
  };

  if (params.txSig) {
    updates.signature = params.txSig;
  }
  if (params.tokensOut !== undefined) {
    // Store as filled_tokens for compatibility (SELL may represent SOL received).
    updates.filled_tokens = params.tokensOut;
  }
  if (params.pricePerToken !== undefined) {
    updates.price_per_token = params.pricePerToken;
  }
  if (params.error !== undefined) {
    updates.error_detail = params.error;
  }
  if (params.errorCode !== undefined) {
    updates.error_code = params.errorCode;
  }
  if (params.result !== undefined) {
    updates.quote_response = params.result;
  }

  if (mappedStatus === 'sent') {
    updates.sent_at = new Date().toISOString();
  }
  if (mappedStatus === 'confirmed') {
    updates.confirmed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('executions')
    .update(updates)
    .eq('id', params.executionId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as Execution | null) || null;
}

/**
 * Get execution by ID
 */
export async function getExecution(executionId: string): Promise<Execution | null> {
  const { data, error } = await supabase
    .from('executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

// ============================================================================
// Position Functions (v3.1)
// ============================================================================

function mapPositionRowToV31(row: Record<string, any>): PositionV31 {
  const userChatId = Number(row.users?.telegram_chat_id ?? 0);
  const metadata = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, any>) : {};

  const entryCostSol = row.entry_cost_sol !== null && row.entry_cost_sol !== undefined ? Number(row.entry_cost_sol) : 0;
  const currentValueSol =
    row.current_value_sol !== null && row.current_value_sol !== undefined ? Number(row.current_value_sol) : null;

  const unrealizedPnlSol = currentValueSol !== null ? currentValueSol - entryCostSol : null;
  const unrealizedPnlPercent =
    currentValueSol !== null && entryCostSol > 0 ? ((currentValueSol - entryCostSol) / entryCostSol) * 100 : 0;

  // NOTE: Phase-0 schema uses `positions.id` as UUID primary key.
  // We map it to `uuid_id` for backwards-compatible call sites.
  return {
    id: 0,
    uuid_id: String(row.id),
    tg_id: userChatId,
    strategy_id: (metadata.strategy_id ?? '00000000-0000-0000-0000-000000000000') as string,
    opportunity_id: (row.launch_candidate_id ?? null) as string | null,
    chain: 'sol',
    token_mint: String(row.mint),
    token_symbol: (row.symbol ?? null) as string | null,
    token_name: (row.name ?? null) as string | null,

    entry_execution_id: (row.entry_execution_id ?? null) as string | null,
    entry_tx_sig: ((row.entry_tx_sig ?? metadata.entry_tx_sig) ?? null) as string | null,
    entry_cost_sol: entryCostSol,
    entry_price: Number(row.entry_price ?? 0),
    size_tokens: Number(row.size_tokens ?? 0),

    current_price: row.current_price !== null && row.current_price !== undefined ? Number(row.current_price) : null,
    peak_price: row.peak_price !== null && row.peak_price !== undefined ? Number(row.peak_price) : null,
    current_value_sol: currentValueSol,
    unrealized_pnl_sol: unrealizedPnlSol,
    unrealized_pnl_percent: unrealizedPnlPercent,
    price_updated_at: (row.price_updated_at ?? null) as string | null,

    exit_execution_id: (row.exit_execution_id ?? null) as string | null,
    exit_tx_sig: ((row.exit_tx_sig ?? metadata.exit_tx_sig) ?? null) as string | null,
    exit_price: row.exit_price !== null && row.exit_price !== undefined ? Number(row.exit_price) : null,
    exit_trigger: (row.exit_trigger ?? null) as any,
    realized_pnl_sol: row.realized_pnl_sol !== null && row.realized_pnl_sol !== undefined ? Number(row.realized_pnl_sol) : null,
    realized_pnl_percent:
      row.realized_pnl_percent !== null && row.realized_pnl_percent !== undefined ? Number(row.realized_pnl_percent) : null,

    trigger_state: (row.trigger_state ?? 'MONITORING') as any,
    tp_price: row.tp_price !== null && row.tp_price !== undefined ? Number(row.tp_price) : null,
    sl_price: row.sl_price !== null && row.sl_price !== undefined ? Number(row.sl_price) : null,
    bonding_curve: (row.bonding_curve ?? null) as string | null,
    triggered_at: null,

    token_decimals: metadata.token_decimals ?? null,
    entry_mc_sol: metadata.entry_mc_sol ?? null,
    entry_mc_usd: metadata.entry_mc_usd ?? null,

    status: row.lifecycle_state === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
    opened_at: String(row.opened_at ?? row.created_at ?? new Date().toISOString()),
    closed_at: (row.closed_at ?? null) as string | null,

    lifecycle_state: (row.lifecycle_state ?? 'PRE_GRADUATION') as any,
    pricing_source: (row.pricing_source ?? 'BONDING_CURVE') as any,
    graduated_at: (row.graduated_at ?? null) as string | null,
    pool_address: (row.pool_address ?? null) as string | null,

    created_at: String(row.opened_at ?? row.created_at ?? new Date().toISOString()),
    updated_at: String(row.price_updated_at ?? row.opened_at ?? row.created_at ?? new Date().toISOString()),
  } as unknown as PositionV31;
}

/**
 * Get all open positions for the hunter to monitor
 * WARNING: Returns ALL open positions - use getUserOpenPositions for user-specific queries
 */
export async function getOpenPositions(chain?: Chain): Promise<PositionV31[]> {
  // New schema uses lifecycle_state instead of status
  // New schema is Solana-only, no chain column needed
  const query = supabase
    .from('positions')
    .select('*, users(telegram_chat_id)')
    .neq('lifecycle_state', 'CLOSED');

  // Ignore chain parameter - new schema is Solana-only

  const { data, error } = await query;

  if (error) throw error;
  return (data || []).map((row) => mapPositionRowToV31(row as Record<string, any>));
}

/**
 * M-2: Get open positions for a specific user (server-side filtering)
 * Use this instead of getOpenPositions() when querying for a specific user's positions
 */
export async function getUserOpenPositions(userId: number, chain?: Chain): Promise<PositionV31[]> {
  // SECURITY (F-009): Must be server-side filtered to prevent cross-user data leaks.
  // Preferred (Phase-0 schema): positions.user_id UUID referencing users.id, keyed by users.telegram_chat_id.
  // Fallback (legacy v3.1 schema): positions.tg_id BIGINT.

  // Ignore chain parameter - Solana-only in revamp path.

  // Attempt Phase-0 schema first (UUID user_id)
  const userUuid = await getUserUuidFromTgId(userId);
  if (userUuid) {
    const { data, error } = await supabase
      .from('positions')
      .select('*, users(telegram_chat_id)')
      .eq('user_id', userUuid)
      .neq('lifecycle_state', 'CLOSED')
      .order('opened_at', { ascending: false });

    if (!error) {
      return (data || []).map((row) => mapPositionRowToV31(row as Record<string, any>));
    }

    // If schema doesn't support user_id/lifecycle_state, fall through to legacy filter.
    const msg = (error as { message?: string } | null)?.message || '';
    if (!msg.toLowerCase().includes('column') && !msg.toLowerCase().includes('does not exist')) {
      throw error;
    }
  }

  // No user row (or schema mismatch): fail closed to avoid leaking other users' positions.
  return [];
}

/**
 * Get closed positions for a specific user (for PnL calculation)
 */
export async function getClosedPositions(userId: number, chain?: Chain): Promise<PositionV31[]> {
  // SECURITY (F-009): Must be server-side filtered to prevent cross-user data leaks.
  // Preferred (Phase-0 schema): positions.user_id UUID referencing users.id.
  // Fallback (legacy v3.1 schema): positions.tg_id BIGINT.

  // Ignore chain parameter - Solana-only in revamp path.

  const userUuid = await getUserUuidFromTgId(userId);
  if (userUuid) {
    const { data, error } = await supabase
      .from('positions')
      .select('*, users(telegram_chat_id)')
      .eq('user_id', userUuid)
      .eq('lifecycle_state', 'CLOSED')
      .order('closed_at', { ascending: false });

    if (!error) {
      return (data || []).map((row) => mapPositionRowToV31(row as Record<string, any>));
    }

    const msg = (error as { message?: string } | null)?.message || '';
    if (!msg.toLowerCase().includes('column') && !msg.toLowerCase().includes('does not exist')) {
      throw error;
    }
  }

  return [];
}

/**
 * Get a position by ID
 */
export async function getPositionById(positionId: string): Promise<PositionV31 | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*, users(telegram_chat_id)')
    .eq('id', positionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? mapPositionRowToV31(data as Record<string, any>) : null;
}

/**
 * Get a position by UUID (v3.1 standard)
 * Use this for TP/SL engine operations instead of getPositionById
 */
export async function getPositionByUuid(uuidId: string): Promise<PositionV31 | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*, users(telegram_chat_id)')
    .eq('id', uuidId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? mapPositionRowToV31(data as Record<string, any>) : null;
}

/**
 * Close a position by UUID (v3.1 standard)
 * Use this for TP/SL engine exit operations
 */
export async function closePositionByUuid(
  uuidId: string,
  closeData: {
    exitPrice: number;
    exitValueSol: number;
    closeReason: string;
    exitTxSig?: string;
    exitTrigger?: string;
    realizedPnlSol?: number;
    realizedPnlPercent?: number;
  }
): Promise<PositionV31> {
  const { data, error } = await supabase
    .from('positions')
    .update({
      lifecycle_state: 'CLOSED',
      exit_price: closeData.exitPrice,
      exit_value_sol: closeData.exitValueSol,
      close_reason: closeData.closeReason,
      exit_tx_sig: closeData.exitTxSig || null,
      exit_trigger: closeData.exitTrigger || null,
      realized_pnl_sol: closeData.realizedPnlSol ?? null,
      realized_pnl_percent: closeData.realizedPnlPercent ?? null,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', uuidId)
    .select()
    .single();

  if (error) throw error;
  return mapPositionRowToV31(data as Record<string, any>);
}

/**
 * Create a new position
 * FIX: Use tg_id (not user_id), set trigger_state, tp_price, sl_price, bonding_curve
 */
export async function createPositionV31(position: {
  userId: number;
  strategyId: string;
  opportunityId?: string;
  chain: Chain;
  tokenMint: string;
  tokenSymbol?: string;
  tokenName?: string;
  entryExecutionId?: string;
  entryTxSig?: string;
  entryCostSol: number;
  entryPrice: number;
  sizeTokens: number;
  // TP/SL engine fields (Phase B audit fix)
  tpPercent?: number;
  slPercent?: number;
  bondingCurve?: string;
  // Display accuracy fields (Audit Round 4)
  tokenDecimals?: number;
  entryMcSol?: number;
  entryMcUsd?: number;
}): Promise<PositionV31> {
  // Compute TP/SL prices at creation time (immutable for position lifetime)
  const tpPrice = position.tpPercent && position.entryPrice > 0
    ? position.entryPrice * (1 + position.tpPercent / 100)
    : null;
  const slPrice = position.slPercent && position.entryPrice > 0
    ? position.entryPrice * (1 - position.slPercent / 100)
    : null;

  await upsertUser({ tg_id: position.userId });
  const userUuid = await getUserUuidFromTgId(position.userId);
  if (!userUuid) {
    throw new Error('User not found');
  }

  const inferredSource =
    position.strategyId === '00000000-0000-0000-0000-000000000000' ? 'manual' : 'hunt';

  const { data, error } = await supabase
    .from('positions')
    .insert({
      user_id: userUuid,
      mint: position.tokenMint,
      symbol: position.tokenSymbol || null,
      name: position.tokenName || null,
      lifecycle_state: 'PRE_GRADUATION',
      pricing_source: 'BONDING_CURVE',
      router_used: 'BagsTradeRouter',
      entry_execution_id: position.entryExecutionId || null,
      entry_tx_sig: position.entryTxSig || null,
      entry_cost_sol: position.entryCostSol,
      entry_price: position.entryPrice,
      size_tokens: position.sizeTokens,
      current_price: position.entryPrice,
      current_value_sol: position.entryCostSol,
      peak_price: position.entryPrice,
      tp_percent: position.tpPercent ?? null,
      sl_percent: position.slPercent ?? null,
      tp_price: tpPrice,
      sl_price: slPrice,
      trigger_state: 'MONITORING',
      bonding_curve: position.bondingCurve || null,
      launch_candidate_id: position.opportunityId || null,
      metadata: {
        source: inferredSource,
        strategy_id: position.strategyId,
        token_decimals: position.tokenDecimals ?? null,
        entry_mc_sol: position.entryMcSol ?? null,
        entry_mc_usd: position.entryMcUsd ?? null,
      },
    })
    .select('*, users(telegram_chat_id)')
    .single();

  if (error) throw error;
  return mapPositionRowToV31(data as Record<string, any>);
}

/**
 * Update position price data
 */
export async function updatePositionPrice(
  positionId: string,
  currentPrice: number,
  peakPrice?: number
): Promise<void> {
  const updates: Record<string, unknown> = {
    current_price: currentPrice,
    price_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (peakPrice !== undefined) {
    updates.peak_price = peakPrice;
  }

  const { error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', positionId);

  if (error) throw error;
}

/**
 * Update position price by UUID (v3.1 standard)
 * Use this for TP/SL engine operations instead of updatePositionPrice
 */
export async function updatePositionPriceByUuid(
  uuidId: string,
  currentPrice: number,
  peakPrice?: number
): Promise<void> {
  const updates: Record<string, unknown> = {
    current_price: currentPrice,
    price_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (peakPrice !== undefined) {
    updates.peak_price = peakPrice;
  }

  const { error } = await supabase
    .from('positions')
    .update(updates)
    .eq('id', uuidId);

  if (error) throw error;
}

/**
 * Close a position
 */
export async function closePositionV31(params: {
  positionId: string;
  exitExecutionId?: string;
  exitTxSig?: string;
  exitPrice: number;
  exitTrigger: ExitTrigger;
  realizedPnlSol: number;
  realizedPnlPercent: number;
}): Promise<PositionV31> {
  const { data, error } = await supabase
    .from('positions')
    .update({
      lifecycle_state: 'CLOSED',
      exit_execution_id: params.exitExecutionId || null,
      exit_tx_sig: params.exitTxSig || null,
      exit_price: params.exitPrice,
      exit_trigger: params.exitTrigger,
      realized_pnl_sol: params.realizedPnlSol,
      realized_pnl_percent: params.realizedPnlPercent,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.positionId)
    .select('*, users(telegram_chat_id)')
    .single();

  if (error) throw error;
  return mapPositionRowToV31(data as Record<string, any>);
}

// ============================================================================
// TP/SL Engine State Machine Functions (Phase B Audit Fix)
// ============================================================================

/**
 * Result from trigger_exit_atomically RPC
 */
export interface TriggerClaimResult {
  triggered: boolean;
  reason?: string;
  position_id?: string;
  trigger?: string;
  current_state?: string;
}

/**
 * Atomically claim a trigger for a position (MONITORING → TRIGGERED)
 * This is the first step in the exit state machine.
 * Returns { triggered: true } if claim succeeded, otherwise { triggered: false, reason: ... }
 */
export async function triggerExitAtomically(
  positionId: string,
  trigger: ExitTrigger,
  triggerPrice: number
): Promise<TriggerClaimResult> {
  const { data, error } = await supabase.rpc('trigger_exit_atomically', {
    p_position_id: positionId,
    p_trigger: trigger,
    p_trigger_price: triggerPrice,
  });

  if (error) {
    console.error('[triggerExitAtomically] Error:', error);
    return { triggered: false, reason: error.message };
  }

  // RPC returns JSONB which is parsed as object
  return data as TriggerClaimResult;
}

/**
 * Mark a position as executing (TRIGGERED → EXECUTING)
 * Called before sending the sell transaction
 */
export async function markPositionExecuting(positionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_position_executing', {
    p_position_id: positionId,
  });

  if (error) {
    console.error('[markPositionExecuting] Error:', error);
    return false;
  }
  return data === true;
}

/**
 * Mark a trigger as completed (EXECUTING → COMPLETED)
 * Called after successful sell execution
 */
export async function markTriggerCompleted(positionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_trigger_completed', {
    p_position_id: positionId,
  });

  if (error) {
    console.error('[markTriggerCompleted] Error:', error);
    return false;
  }
  return data === true;
}

/**
 * Mark a trigger as failed (EXECUTING → FAILED)
 * Called after failed sell execution, allows retry
 */
export async function markTriggerFailed(positionId: string, errorMsg?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_trigger_failed', {
    p_position_id: positionId,
    p_error: errorMsg || null,
  });

  if (error) {
    console.error('[markTriggerFailed] Error:', error);
    return false;
  }
  return data === true;
}

// ============================================================================
// Opportunity Functions
// ============================================================================

/**
 * Get an opportunity by ID
 */
export async function getOpportunityById(opportunityId: string): Promise<OpportunityV31 | null> {
  // Revamp pipeline: CandidateConsumer uses launch_candidates as the opportunity source.
  const { data, error } = await supabase
    .from('launch_candidates')
    .select('*')
    .eq('id', opportunityId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  const payload = data.raw_payload && typeof data.raw_payload === 'object' ? (data.raw_payload as any) : {};
  const onchain = payload?.onchain || {};

  return {
    id: data.id,
    chain: 'sol',
    source: data.launch_source,
    token_mint: data.mint,
    token_name: data.name ?? null,
    token_symbol: data.symbol ?? null,
    detected_at: data.first_seen_at,
    score: null,
    reasons: null,
    raw_data: (data.raw_payload as any) ?? null,
    status: 'NEW',
    status_reason: data.status_reason ?? null,
    outcome: null,
    deployer: onchain?.creator ?? null,
    bonding_curve: onchain?.bonding_curve ?? null,
    initial_liquidity_sol: null,
    bonding_progress_percent: null,
    matched_strategy_ids: null,
    qualified_at: null,
    expired_at: null,
    completed_at: null,
    created_at: data.first_seen_at,
    updated_at: data.processed_at ?? data.first_seen_at,
  } as OpportunityV31;
}

/**
 * Create or update an opportunity
 * AUDIT FIX (C-1): opportunities table does not exist in Phase 0 schema.
 */
export async function upsertOpportunity(opp: {
  chain: Chain;
  source: string;
  tokenMint: string;
  tokenName?: string;
  tokenSymbol?: string;
  score?: number;
  reasons?: Array<{ rule: string; value: unknown; passed: boolean; weight: number }>;
  rawData?: Record<string, unknown>;
  deployer?: string;
  bondingCurve?: string;
  initialLiquiditySol?: number;
}): Promise<OpportunityV31> {
  console.warn('[DEPRECATED] upsertOpportunity: opportunities table does not exist in Phase 0 schema. Use launch_candidates instead.');
  return {} as unknown as OpportunityV31;
}

/**
 * Update opportunity status
 * AUDIT FIX (C-1): opportunities table does not exist in Phase 0 schema.
 */
export async function updateOpportunityStatus(
  opportunityId: string,
  status: 'NEW' | 'QUALIFIED' | 'REJECTED' | 'EXPIRED' | 'EXECUTING' | 'COMPLETED',
  reason?: string
): Promise<void> {
  console.warn('[DEPRECATED] updateOpportunityStatus: opportunities table does not exist in Phase 0 schema');
}

// ============================================================================
// Notification Functions
// ============================================================================

/**
 * Claim notifications for delivery (v2: includes telegram_chat_id via JOIN)
 */
export async function claimNotifications(
  workerId: string,
  limit: number = 20
): Promise<NotificationV31[]> {
  const { data, error } = await supabase.rpc('claim_notifications', {
    p_worker_id: workerId,
    p_limit: limit,
  });

  if (error) throw error;

  // RPC returns JSONB array with telegram_chat_id included
  const notifications = data as unknown;
  if (!Array.isArray(notifications)) return [];
  return notifications as NotificationV31[];
}

/**
 * Mark notification as delivered via RPC
 */
export async function markNotificationDelivered(notificationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_delivered', {
    p_notification_id: notificationId,
  });

  if (error) throw error;
}

/**
 * Mark notification delivery failed via RPC (atomic with retry logic)
 */
export async function markNotificationFailed(
  notificationId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_failed', {
    p_notification_id: notificationId,
    p_error: errorMessage,
  });

  if (error) throw error;
}

/**
 * Look up user UUID from Telegram chat ID
 */
async function getUserUuidFromTgId(tgId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_chat_id', tgId)
    .single();

  if (error || !data) return null;
  return data.id;
}

/**
 * Create a notification in the outbox for delivery
 * Resolves Telegram ID → user UUID, then inserts into notifications_outbox
 */
export async function createNotification(notification: {
  userId: number;
  type: string;
  payload: Record<string, unknown>;
}): Promise<NotificationV31 | null> {
  // Resolve tg_id → user UUID
  const userUuid = await getUserUuidFromTgId(notification.userId);
  if (!userUuid) {
    console.warn(`[createNotification] No user found for tg_id=${notification.userId}`);
    return null;
  }

  const { data, error } = await supabase
    .from('notifications_outbox')
    .insert({
      user_id: userUuid,
      type: notification.type,
      payload: notification.payload,
    })
    .select()
    .single();

  if (error) {
    console.error('[createNotification] Insert failed:', error.message);
    return null;
  }

  return data as unknown as NotificationV31;
}

// ============================================================================
// Safety Control Functions
// ============================================================================

/**
 * Get global safety controls
 */
export async function getGlobalSafetyControls(): Promise<SafetyControls | null> {
  const { data, error } = await supabase
    .from('safety_controls')
    .select('*')
    .eq('scope', 'GLOBAL')
    .maybeSingle();

  if (error) {
    console.error('[getGlobalSafetyControls] Error:', error.message);
    // SAFETY (F-008): Fail closed on control read errors.
    return null;
  }

  return data as SafetyControls | null;
}

/**
 * Get user-specific safety controls
 */
export async function getUserSafetyControls(userId: string): Promise<SafetyControls | null> {
  const { data, error } = await supabase
    .from('safety_controls')
    .select('*')
    .eq('scope', userId)
    .maybeSingle();

  if (error) {
    console.error('[getUserSafetyControls] Error:', error.message);
    return null;
  }

  return data as SafetyControls | null;
}

/**
 * Check if trading is paused globally
 */
export async function isTradingPaused(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  // SAFETY (F-008): Fail closed (pause) if controls can't be read.
  return controls ? controls.trading_paused : true;
}

/**
 * Check if circuit breaker is open
 */
export async function isCircuitOpen(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  // SAFETY (F-008): Fail closed (treat as open) if controls can't be read.
  if (!controls) return true;
  if (!controls.circuit_open_until) return false;
  return new Date(controls.circuit_open_until) > new Date();
}

/**
 * Check if auto-execution is enabled globally (safety controls).
 * SAFETY (F-008): Fail closed if controls can't be read.
 */
export async function isAutoExecuteEnabledBySafetyControls(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  if (!controls) return false;
  if (controls.trading_paused) return false;
  return controls.auto_execute_enabled;
}

/**
 * Check if manual trading is enabled globally (safety controls).
 * SAFETY (F-008): Fail closed if controls can't be read.
 */
export async function isManualTradingEnabledBySafetyControls(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  if (!controls) return false;
  if (controls.trading_paused) return false;
  return controls.manual_trading_enabled;
}

/**
 * Increment consecutive failure count for circuit breaker
 * Opens circuit if threshold is exceeded
 */
export async function recordExecutionFailure(scope: string = 'GLOBAL'): Promise<void> {
  // First, get current state
  const { data: current, error: fetchError } = await supabase
    .from('safety_controls')
    .select('consecutive_failures, circuit_breaker_threshold')
    .eq('scope', scope)
    .maybeSingle();

  if (fetchError) {
    console.error('[recordExecutionFailure] Fetch error:', fetchError.message);
    return;
  }

  const failures = (current?.consecutive_failures ?? 0) + 1;
  const threshold = current?.circuit_breaker_threshold ?? 5;

  // If exceeding threshold, open circuit for 60 seconds
  const circuitOpenUntil = failures >= threshold
    ? new Date(Date.now() + 60000).toISOString()
    : null;

  const { error } = await supabase
    .from('safety_controls')
    .update({
      consecutive_failures: failures,
      circuit_open_until: circuitOpenUntil,
      updated_at: new Date().toISOString(),
    })
    .eq('scope', scope);

  if (error) {
    console.error('[recordExecutionFailure] Update error:', error.message);
  } else if (circuitOpenUntil) {
    console.warn(`[SafetyControls] Circuit breaker opened (${failures} failures, scope: ${scope})`);
  }
}

/**
 * Reset consecutive failure count on successful execution
 */
export async function recordExecutionSuccess(scope: string = 'GLOBAL'): Promise<void> {
  const { error } = await supabase
    .from('safety_controls')
    .update({
      consecutive_failures: 0,
      circuit_open_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('scope', scope);

  if (error) {
    console.error('[recordExecutionSuccess] Error:', error.message);
  }
}

/**
 * Pause or unpause trading globally
 */
export async function setTradingPaused(paused: boolean): Promise<void> {
  const { error } = await supabase
    .from('safety_controls')
    .update({
      trading_paused: paused,
      updated_at: new Date().toISOString(),
    })
    .eq('scope', 'GLOBAL');

  if (error) {
    throw error;
  }
  console.log(`[SafetyControls] Trading ${paused ? 'PAUSED' : 'RESUMED'} globally`);
}

// ============================================================================
// Cooldown Functions
// ============================================================================

/**
 * Set a cooldown
 */
export async function setCooldown(params: {
  chain: Chain;
  cooldownType: 'MINT' | 'USER_MINT' | 'DEPLOYER';
  target: string;
  durationSeconds: number;
  reason?: string;
}): Promise<void> {
  const cooldownUntil = new Date(Date.now() + params.durationSeconds * 1000).toISOString();

  const { error } = await supabase
    .from('cooldowns')
    .upsert(
      {
        chain: params.chain,
        cooldown_type: params.cooldownType,
        target: params.target,
        cooldown_until: cooldownUntil,
        reason: params.reason || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chain,cooldown_type,target' }
    );

  if (error) throw error;
}

/**
 * Check if a cooldown is active
 */
export async function isCooldownActive(
  chain: Chain,
  cooldownType: 'MINT' | 'USER_MINT' | 'DEPLOYER',
  target: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('cooldowns')
    .select('cooldown_until')
    .eq('chain', chain)
    .eq('cooldown_type', cooldownType)
    .eq('target', target)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return false;
    throw error;
  }

  return data ? new Date(data.cooldown_until) > new Date() : false;
}

// ============================================================================
// Maintenance Functions
// ============================================================================

/**
 * Cleanup stale executions (STUBBED - RPC doesn't exist in new schema)
 * TODO: Implement using new executions table directly
 */
export async function cleanupStaleExecutions(staleMinutes: number = 5): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('executions')
    .update({
      status: 'failed',
      error_code: 'STALE',
      error_detail: 'stale_execution',
    })
    .in('status', ['pending', 'sent'])
    .is('signature', null)
    .lt('created_at', cutoff)
    .select('id');

  if (error) throw error;
  return data?.length || 0;
}

// ============================================================================
// Trade Monitor Functions (v3.1)
// ============================================================================

import type {
  TradeMonitor,
  TradeMonitorInput,
  MonitorUpdateData,
  RecentPosition,
} from './types.js';

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapTradeMonitorRow(row: Record<string, any>): TradeMonitor {
  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    chat_id: Number(row.chat_id),
    message_id: Number(row.message_id),
    position_id: row.position_id ? String(row.position_id) : null,

    entry_price_sol: toNumberOrNull(row.entry_price_sol),
    entry_amount_sol: toNumberOrNull(row.entry_amount_sol),
    entry_tokens: toNumberOrNull(row.entry_tokens),
    entry_market_cap_usd: toNumberOrNull(row.entry_market_cap_usd),

    current_price_sol: toNumberOrNull(row.current_price_sol),
    current_tokens: toNumberOrNull(row.current_tokens),
    current_value_sol: toNumberOrNull(row.current_value_sol),
    pnl_sol: toNumberOrNull(row.pnl_sol),
    pnl_percent: toNumberOrNull(row.pnl_percent),
    market_cap_usd: toNumberOrNull(row.market_cap_usd),
    liquidity_usd: toNumberOrNull(row.liquidity_usd),
    volume_24h_usd: toNumberOrNull(row.volume_24h_usd),

    refresh_count: Number(row.refresh_count ?? 0),
  } as TradeMonitor;
}

function mapRecentPositionRow(row: Record<string, any>): RecentPosition {
  return {
    ...row,
    id: String(row.id),
    entry_price: Number(row.entry_price ?? 0),
    amount_in: Number(row.amount_in ?? 0),
    tokens_held: Number(row.tokens_held ?? 0),
    unrealized_pnl_percent: Number(row.unrealized_pnl_percent ?? 0),
    has_monitor: Boolean(row.has_monitor),
  } as RecentPosition;
}

/**
 * Create or update a trade monitor
 */
export async function upsertTradeMonitor(input: TradeMonitorInput): Promise<TradeMonitor> {
  const { data, error } = await supabase.rpc('upsert_trade_monitor', {
    p_user_id: input.user_id,
    p_chain: input.chain,
    p_mint: input.mint,
    p_token_symbol: input.token_symbol || null,
    p_token_name: input.token_name || null,
    p_chat_id: input.chat_id,
    p_message_id: input.message_id,
    p_position_id: input.position_id || null,
    p_entry_price_sol: input.entry_price_sol || null,
    p_entry_amount_sol: input.entry_amount_sol || null,
    p_entry_tokens: input.entry_tokens || null,
    p_route_label: input.route_label || null,
    p_ttl_hours: input.ttl_hours || 24,
    p_entry_market_cap_usd: input.entry_market_cap_usd ?? null,
  });

  if (error) throw error;
  return mapTradeMonitorRow(data as Record<string, any>);
}

/**
 * Get monitors that need refreshing
 */
export async function getMonitorsForRefresh(
  batchSize: number = 20,
  minAgeSeconds: number = 15
): Promise<TradeMonitor[]> {
  const { data, error } = await supabase.rpc('get_monitors_for_refresh', {
    p_batch_size: batchSize,
    p_min_age_seconds: minAgeSeconds,
  });

  if (error) throw error;
  const rows = data as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => mapTradeMonitorRow(row as Record<string, any>));
}

/**
 * Update monitor with fresh price data
 */
export async function updateMonitorData(update: MonitorUpdateData): Promise<TradeMonitor> {
  const { data, error } = await supabase.rpc('update_monitor_data', {
    p_monitor_id: update.monitor_id,
    p_current_price_sol: update.current_price_sol,
    p_current_tokens: update.current_tokens,
    p_current_value_sol: update.current_value_sol,
    p_pnl_sol: update.pnl_sol,
    p_pnl_percent: update.pnl_percent,
    p_market_cap_usd: update.market_cap_usd || null,
    p_liquidity_usd: update.liquidity_usd || null,
    p_volume_24h_usd: update.volume_24h_usd || null,
  });

  if (error) throw error;
  return mapTradeMonitorRow(data as Record<string, any>);
}

/**
 * Reset monitor TTL (on manual refresh)
 */
export async function resetMonitorTTL(
  monitorId: number,
  ttlHours: number = 24
): Promise<TradeMonitor> {
  const { data, error } = await supabase.rpc('reset_monitor_ttl', {
    p_monitor_id: monitorId,
    p_ttl_hours: ttlHours,
  });

  if (error) throw error;
  return mapTradeMonitorRow(data as Record<string, any>);
}

/**
 * Close a monitor (after sell)
 */
export async function closeMonitor(userId: number, mint: string): Promise<void> {
  const { error } = await supabase.rpc('close_monitor', {
    p_user_id: userId,
    p_mint: mint,
  });

  if (error) throw error;
}

/**
 * Get user's active monitor for a mint
 */
export async function getUserMonitor(
  userId: number,
  mint: string
): Promise<TradeMonitor | null> {
  const { data, error } = await supabase.rpc('get_user_monitor', {
    p_user_id: userId,
    p_mint: mint,
  });

  if (error) throw error;
  return data ? mapTradeMonitorRow(data as Record<string, any>) : null;
}

/**
 * Expire old monitors (maintenance)
 */
export async function expireOldMonitors(): Promise<number> {
  const { data, error } = await supabase.rpc('expire_old_monitors');
  if (error) throw error;
  return (data as number) || 0;
}

/**
 * Get user's recent positions (last 24h by default)
 */
export async function getRecentPositions(
  userId: number,
  hours: number = 24,
  limit: number = 10,
  offset: number = 0
): Promise<RecentPosition[]> {
  const { data, error } = await supabase.rpc('get_recent_positions', {
    p_user_id: userId,
    p_hours: hours,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  const rows = data as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => mapRecentPositionRow(row as Record<string, any>));
}

/**
 * Count user's recent positions for pagination
 */
export async function countRecentPositions(
  userId: number,
  hours: number = 24
): Promise<number> {
  const { data, error } = await supabase.rpc('count_recent_positions', {
    p_user_id: userId,
    p_hours: hours,
  });

  if (error) throw error;
  return data as number;
}

/**
 * Get monitor by ID
 */
export async function getMonitorById(monitorId: number): Promise<TradeMonitor | null> {
  const { data, error } = await supabase
    .from('trade_monitors')
    .select('*')
    .eq('id', monitorId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? mapTradeMonitorRow(data as Record<string, any>) : null;
}

/**
 * Update monitor message_id (after editing message)
 */
export async function updateMonitorMessageId(
  monitorId: number,
  messageId: number
): Promise<void> {
  const { error } = await supabase
    .from('trade_monitors')
    .update({ message_id: messageId })
    .eq('id', monitorId);

  if (error) throw error;
}

// ============================================================================
// View State Management (v3.2 - fixes sell panel revert bug)
// ============================================================================

export type MonitorView = 'MONITOR' | 'SELL' | 'TOKEN';

/**
 * Set the current view for a monitor
 * CRITICAL: This prevents refresh loop from overwriting sell panel
 */
export async function setMonitorView(
  userId: number,
  mint: string,
  view: MonitorView
): Promise<TradeMonitor | null> {
  const { data, error } = await supabase.rpc('set_monitor_view', {
    p_user_id: userId,
    p_mint: mint,
    p_view: view,
  });

  if (error) throw error;
  return data ? mapTradeMonitorRow(data as Record<string, any>) : null;
}

/**
 * Get user's active monitors (up to 5)
 */
export async function getUserActiveMonitors(
  userId: number,
  limit: number = 5
): Promise<TradeMonitor[]> {
  const { data, error } = await supabase
    .from('trade_monitors')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map((row) => mapTradeMonitorRow(row as Record<string, any>));
}

// ============================================================================
// Manual Settings (v3.2 - separated from AutoHunt settings)
// ============================================================================

export interface ManualSettings {
  id: number;
  user_id: number;
  default_slippage_bps: number;
  default_priority_sol: number;
  quick_buy_amounts: number[];
  quick_sell_percents: number[];
  show_usd_values: boolean;
  confirm_large_trades: boolean;
  large_trade_threshold_sol: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get or create manual settings for user
 */
export async function getOrCreateManualSettings(
  userId: number
): Promise<ManualSettings> {
  const { data, error } = await supabase.rpc('get_or_create_manual_settings', {
    p_user_id: userId,
  });

  if (error) throw error;
  return data as ManualSettings;
}

/**
 * Update manual settings
 */
export async function updateManualSettings(params: {
  userId: number;
  slippageBps?: number;
  prioritySol?: number;
  quickBuyAmounts?: number[];
  quickSellPercents?: number[];
}): Promise<ManualSettings> {
  const { data, error } = await supabase.rpc('update_manual_settings', {
    p_user_id: params.userId,
    p_slippage_bps: params.slippageBps || null,
    p_priority_sol: params.prioritySol || null,
    p_quick_buy_amounts: params.quickBuyAmounts ? JSON.stringify(params.quickBuyAmounts) : null,
    p_quick_sell_percents: params.quickSellPercents ? JSON.stringify(params.quickSellPercents) : null,
  });

  if (error) throw error;
  return data as ManualSettings;
}

// ============================================================================
// Chain Settings (v3.5 - per-chain configuration for slippage, gas, anti-MEV)
// ============================================================================

export interface ChainSettings {
  id: number;
  user_id: number;
  chain: string;
  buy_slippage_bps: number;
  sell_slippage_bps: number;
  gas_gwei: number | null;      // EVM only (null for SOL)
  priority_sol: number | null;  // SOL only (null for EVM)
  anti_mev_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get or create chain settings for user
 * Returns settings with chain-specific defaults if not exists
 */
export async function getOrCreateChainSettings(
  userId: number,
  chain: string
): Promise<ChainSettings> {
  const { data, error } = await supabase.rpc('get_or_create_chain_settings', {
    p_user_id: userId,
    p_chain: chain,
  });

  if (error) throw error;
  return data as ChainSettings;
}

/**
 * Update chain settings (only updates non-null parameters)
 */
export async function updateChainSettings(params: {
  userId: number;
  chain: string;
  buySlippageBps?: number;
  sellSlippageBps?: number;
  gasGwei?: number;
  prioritySol?: number;
  antiMevEnabled?: boolean;
}): Promise<ChainSettings> {
  const { data, error } = await supabase.rpc('update_chain_settings', {
    p_user_id: params.userId,
    p_chain: params.chain,
    p_buy_slippage_bps: params.buySlippageBps ?? null,
    p_sell_slippage_bps: params.sellSlippageBps ?? null,
    p_gas_gwei: params.gasGwei ?? null,
    p_priority_sol: params.prioritySol ?? null,
    p_anti_mev_enabled: params.antiMevEnabled ?? null,
  });

  if (error) throw error;
  return data as ChainSettings;
}

/**
 * Reset chain settings to defaults
 */
export async function resetChainSettings(
  userId: number,
  chain: string
): Promise<ChainSettings> {
  const { data, error } = await supabase.rpc('reset_chain_settings', {
    p_user_id: userId,
    p_chain: chain,
  });

  if (error) throw error;
  return data as ChainSettings;
}

// ============================================================================
// Phase 3: Graduation Monitor Functions
// ============================================================================

/**
 * Atomically transition a position from PRE_GRADUATION to POST_GRADUATION.
 * This is called when a token's bonding curve is complete (graduated to AMM).
 * Returns true if the transition occurred, false if position was already graduated/closed.
 */
export async function graduatePositionAtomically(
  positionId: string,
  poolAddress: string | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc('graduate_position_atomically', {
    p_position_id: positionId,
    p_pool_address: poolAddress,
  });

  if (error) {
    console.error('[graduatePositionAtomically] Error:', error);
    return false;
  }
  return data === true;
}

/**
 * Get all unique mints that have open pre-graduation positions.
 * Used by GraduationMonitorLoop to batch bonding curve checks.
 */
export async function getGraduationMonitoringMints(): Promise<{ mint: string; position_count: number }[]> {
  const { data, error } = await supabase.rpc('get_graduation_monitoring_mints');

  if (error) {
    console.error('[getGraduationMonitoringMints] Error:', error);
    return [];
  }
  return (data || []) as { mint: string; position_count: number }[];
}

/**
 * Get all open pre-graduation positions for a specific mint.
 * Used to graduate all positions when a token graduates.
 */
export async function getPreGraduationPositionsByMint(mint: string): Promise<PositionV31[]> {
  const { data, error } = await supabase.rpc('get_pre_graduation_positions_by_mint', {
    p_mint: mint,
  });

  if (error) {
    console.error('[getPreGraduationPositionsByMint] Error:', error);
    return [];
  }
  return (data || []) as PositionV31[];
}

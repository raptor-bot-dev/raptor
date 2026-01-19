import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

// Lazy-load Supabase client to allow tests without credentials
let _supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// Export getter for supabase client (backwards compatibility)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getSupabaseClient();
    return (client as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// User functions
export async function getUser(tgId: number): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('tg_id', tgId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function upsertUser(user: {
  tg_id: number;
  username?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
}): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .upsert({
      ...user,
      last_login: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Balance functions
export async function getUserBalances(tgId: number): Promise<UserBalance[]> {
  const { data, error } = await supabase
    .from('user_balances')
    .select('*')
    .eq('tg_id', tgId);

  if (error) throw error;
  return data || [];
}

/**
 * Get user balance for a specific chain
 * SECURITY: v2.3.1 - Used for withdrawal validation
 */
export async function getUserBalance(tgId: number, chain: Chain): Promise<UserBalance | null> {
  const { data, error } = await supabase
    .from('user_balances')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw error;
  }
  return data || null;
}

export async function getOrCreateBalance(
  tgId: number,
  chain: Chain,
  depositAddress: string,
  mode: TradingMode = 'pool'
): Promise<UserBalance> {
  const { data: existing } = await supabase
    .from('user_balances')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('mode', mode)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('user_balances')
    .insert({
      tg_id: tgId,
      chain,
      mode,
      deposited: '0',
      current_value: '0',
      deposit_address: depositAddress,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateBalance(
  tgId: number,
  chain: Chain,
  updates: { deposited?: string; current_value?: string },
  mode: TradingMode = 'pool'
): Promise<UserBalance> {
  const { data, error } = await supabase
    .from('user_balances')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('mode', mode)
    .select()
    .single();

  if (error) throw error;
  return data;
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
export async function getRecentTrades(tgId: number, limit = 20): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('tg_id', tgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getTradesPaginated(
  tgId: number,
  limit = 20,
  offset = 0
): Promise<{ trades: Trade[]; total: number }> {
  const from = Math.max(0, offset);
  const to = from + Math.max(1, limit) - 1;

  const { data, error, count } = await supabase
    .from('trades')
    .select('*', { count: 'exact' })
    .eq('tg_id', tgId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { trades: data || [], total: count || 0 };
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
  const { data, error } = await supabase
    .from('trades')
    .insert(trade)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTradeStatus(
  tradeId: number,
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
): Promise<Trade> {
  const { data, error } = await supabase
    .from('trades')
    .update({ status })
    .eq('id', tradeId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Stats functions
export async function getUserStats(tgId: number): Promise<UserStats> {
  // Get balances
  const { data: balances } = await supabase
    .from('user_balances')
    .select('deposited, current_value')
    .eq('tg_id', tgId);

  // Get trade stats
  const { data: trades } = await supabase
    .from('trades')
    .select('pnl, type, fee_amount')
    .eq('tg_id', tgId)
    .eq('status', 'CONFIRMED');

  // Get total fees from fees table
  const { data: fees } = await supabase
    .from('fees')
    .select('amount')
    .eq('tg_id', tgId);

  const totalDeposited =
    balances?.reduce((sum, b) => sum + parseFloat(b.deposited), 0) || 0;
  const currentValue =
    balances?.reduce((sum, b) => sum + parseFloat(b.current_value), 0) || 0;
  const sellTrades = trades?.filter((t) => t.type === 'SELL') || [];
  const totalTrades = sellTrades.length;
  const winningTrades = sellTrades.filter(
    (t) => parseFloat(t.pnl || '0') > 0
  ).length;
  const totalFeesPaid =
    fees?.reduce((sum, f) => sum + parseFloat(f.amount), 0) || 0;

  return {
    deposited: totalDeposited,
    currentValue,
    totalPnl: currentValue - totalDeposited,
    pnlPercent:
      totalDeposited > 0
        ? ((currentValue - totalDeposited) / totalDeposited) * 100
        : 0,
    totalTrades,
    winningTrades,
    winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    totalFeesPaid,
  };
}

// Allocations
export async function getUserAllocations(
  chain: Chain,
  mode: TradingMode = 'pool'
): Promise<Map<number, bigint>> {
  const { data, error } = await supabase
    .from('user_balances')
    .select('tg_id, current_value')
    .eq('chain', chain)
    .eq('mode', mode)
    .gt('current_value', '0');

  if (error) throw error;

  const allocations = new Map<number, bigint>();
  for (const balance of data || []) {
    const value = BigInt(Math.floor(parseFloat(balance.current_value) * 1e18));
    if (value > 0n) {
      allocations.set(balance.tg_id, value);
    }
  }
  return allocations;
}

// ============================================================================
// Fee Functions
// ============================================================================

export async function recordFee(fee: {
  trade_id?: number | null;
  tg_id: number;
  chain: Chain;
  amount: string;
  token: string;
}): Promise<Fee> {
  const { data, error } = await supabase
    .from('fees')
    .insert(fee)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserFees(tgId: number, chain?: Chain): Promise<Fee[]> {
  let query = supabase.from('fees').select('*').eq('tg_id', tgId);

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getTotalFees(chain?: Chain): Promise<number> {
  let query = supabase.from('fees').select('amount');

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data?.reduce((sum, f) => sum + parseFloat(f.amount), 0) || 0;
}

// ============================================================================
// Snipe Request Functions
// ============================================================================

export async function createSnipeRequest(request: {
  tg_id: number;
  chain: Chain;
  token_address: string;
  amount: string;
  take_profit_percent?: number;
  stop_loss_percent?: number;
  skip_safety_check?: boolean;
}): Promise<SnipeRequest> {
  const { data, error } = await supabase
    .from('snipe_requests')
    .insert({
      ...request,
      take_profit_percent: request.take_profit_percent ?? 50,
      stop_loss_percent: request.stop_loss_percent ?? 30,
      skip_safety_check: request.skip_safety_check ?? false,
      status: 'PENDING',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSnipeRequest(id: number): Promise<SnipeRequest | null> {
  const { data, error } = await supabase
    .from('snipe_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function getUserSnipeRequests(
  tgId: number,
  status?: SnipeStatus
): Promise<SnipeRequest[]> {
  let query = supabase
    .from('snipe_requests')
    .select('*')
    .eq('tg_id', tgId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function getPendingSnipeRequests(chain?: Chain): Promise<SnipeRequest[]> {
  let query = supabase
    .from('snipe_requests')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true });

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function updateSnipeRequestStatus(
  id: number,
  status: SnipeStatus,
  updates?: {
    position_id?: number;
    error_message?: string;
  }
): Promise<SnipeRequest> {
  const updateData: Record<string, unknown> = { status };

  if (updates?.position_id !== undefined) {
    updateData.position_id = updates.position_id;
  }
  if (updates?.error_message !== undefined) {
    updateData.error_message = updates.error_message;
  }
  if (status === 'COMPLETED' || status === 'FAILED') {
    updateData.executed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('snipe_requests')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================================
// Mode Preference Functions
// ============================================================================

export async function getUserModePreference(
  tgId: number,
  chain: Chain
): Promise<TradingMode> {
  const { data, error } = await supabase
    .from('user_mode_preferences')
    .select('default_mode')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return 'pool'; // Default to pool mode
    throw error;
  }
  return data.default_mode as TradingMode;
}

export async function setUserModePreference(
  tgId: number,
  chain: Chain,
  mode: TradingMode
): Promise<UserModePreference> {
  const { data, error } = await supabase
    .from('user_mode_preferences')
    .upsert({
      tg_id: tgId,
      chain,
      default_mode: mode,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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

export async function getUserBalancesByMode(
  tgId: number,
  mode: TradingMode
): Promise<UserBalance[]> {
  const { data, error } = await supabase
    .from('user_balances')
    .select('*')
    .eq('tg_id', tgId)
    .eq('mode', mode);

  if (error) throw error;
  return data || [];
}

// ============================================================================
// User Wallet Functions (Self-Custodial v2.3 - Multi-Wallet Support)
// ============================================================================

export interface UserWallet {
  id: number;
  tg_id: number;
  chain: Chain;
  wallet_index: number;
  wallet_label: string | null;
  is_active: boolean;
  solana_address: string;
  public_key?: string; // v3.1: alias for solana_address
  solana_private_key_encrypted: Record<string, unknown>;
  evm_address: string;
  evm_private_key_encrypted: Record<string, unknown>;
  created_at: string;
  backup_exported_at: string | null;
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
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', 'sol')  // Solana-only build
    .order('wallet_index');

  if (error) throw error;
  return data || [];
}

/**
 * Get all wallets for a user on a specific chain
 */
export async function getUserWalletsForChain(tgId: number, chain: Chain): Promise<UserWallet[]> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .order('wallet_index');

  if (error) throw error;
  return data || [];
}

/**
 * Get active wallet for a user on a specific chain
 */
export async function getActiveWallet(tgId: number, chain: Chain): Promise<UserWallet | null> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Get a specific wallet by chain and index
 */
export async function getWalletByIndex(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<UserWallet | null> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Check if user has any wallet on any chain
 */
export async function userHasWallet(tgId: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('user_wallets')
    .select('*', { count: 'exact', head: true })
    .eq('tg_id', tgId);

  if (error) throw error;
  return (count || 0) > 0;
}

/**
 * Get wallet count for a user on a specific chain
 */
export async function getWalletCount(tgId: number, chain: Chain): Promise<number> {
  const { count, error } = await supabase
    .from('user_wallets')
    .select('*', { count: 'exact', head: true })
    .eq('tg_id', tgId)
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
  // v3.4.1 FIX: Ensure user exists before creating wallet (FK constraint)
  // This handles cases where user skipped /start and went directly to wallet creation
  await upsertUser({ tg_id: wallet.tg_id });

  // Get the count of existing wallets for this chain
  const existingCount = await getWalletCount(wallet.tg_id, wallet.chain);

  if (existingCount >= 5) {
    throw new Error(`Maximum 5 wallets per chain reached for ${wallet.chain}`);
  }

  // v3.4.2 FIX: Find first available slot 1-5 instead of MAX+1
  // This handles gaps from deleted wallets (e.g., indexes 2,3,4,5 -> new wallet gets index 1)
  const { data: existingWallets } = await supabase
    .from('user_wallets')
    .select('wallet_index')
    .eq('tg_id', wallet.tg_id)
    .eq('chain', wallet.chain);

  const usedIndexes = new Set(existingWallets?.map(w => w.wallet_index) || []);

  // Find first available index 1-5
  let walletIndex = 1;
  while (usedIndexes.has(walletIndex) && walletIndex <= 5) {
    walletIndex++;
  }

  if (walletIndex > 5) {
    throw new Error(`Maximum 5 wallets per chain reached for ${wallet.chain}`);
  }
  const isFirstWallet = existingCount === 0;
  const isSolana = wallet.chain === 'sol';

  const { data, error } = await supabase
    .from('user_wallets')
    .insert({
      tg_id: wallet.tg_id,
      chain: wallet.chain,
      wallet_index: walletIndex,
      wallet_label: wallet.wallet_label || `Wallet #${walletIndex}`,
      is_active: isFirstWallet, // First wallet is active by default
      solana_address: isSolana ? wallet.address : '',
      solana_private_key_encrypted: isSolana ? wallet.private_key_encrypted : {},
      evm_address: isSolana ? '' : wallet.address,
      evm_private_key_encrypted: isSolana ? {} : wallet.private_key_encrypted,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a wallet (with validation)
 */
export async function deleteWallet(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<void> {
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
    .from('user_wallets')
    .delete()
    .eq('tg_id', tgId)
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
  // First, deactivate all wallets for this chain
  const { error: deactivateError } = await supabase
    .from('user_wallets')
    .update({ is_active: false })
    .eq('tg_id', tgId)
    .eq('chain', chain);

  if (deactivateError) throw deactivateError;

  // Then activate the selected wallet
  const { error: activateError } = await supabase
    .from('user_wallets')
    .update({ is_active: true })
    .eq('tg_id', tgId)
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
  const { data, error } = await supabase
    .from('user_wallets')
    .update({ wallet_label: label })
    .eq('tg_id', tgId)
    .eq('chain', chain)
    .eq('wallet_index', walletIndex)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mark that a user has exported their backup keys for a specific wallet
 */
export async function markWalletBackupExported(
  tgId: number,
  chain: Chain,
  walletIndex: number
): Promise<void> {
  const { error } = await supabase
    .from('user_wallets')
    .update({ backup_exported_at: new Date().toISOString() })
    .eq('tg_id', tgId)
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
    .from('user_wallets')
    .select('*')
    .eq('solana_address', address)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Get wallet by EVM address (checks all EVM chains)
 */
export async function getWalletByEvmAddress(address: string): Promise<UserWallet | null> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('evm_address', address)
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
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
  // Mark all wallets as exported
  const { error } = await supabase
    .from('user_wallets')
    .update({ backup_exported_at: new Date().toISOString() })
    .eq('tg_id', tgId);

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
    min_score: 30,
    min_liquidity_sol: 0,
    allowed_launchpads: ['pump.fun'],
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
  idempotencyKey: string;
  allowRetry?: boolean;
}): Promise<ReserveBudgetResult> {
  const { data, error } = await supabase.rpc('reserve_trade_budget', {
    p_mode: params.mode,
    p_user_id: params.userId,
    p_strategy_id: params.strategyId,
    p_chain: params.chain,
    p_action: params.action,
    p_token_mint: params.tokenMint,
    p_amount_sol: params.amountSol,
    p_idempotency_key: params.idempotencyKey,
    p_allow_retry: params.allowRetry ?? false,
  });

  if (error) throw error;
  return data as ReserveBudgetResult;
}

// ============================================================================
// Trade Job Functions
// ============================================================================

/**
 * Claim trade jobs for processing (lease-based)
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
    p_chain: chain || null,
  });

  if (error) throw error;
  return (data || []) as TradeJob[];
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
  const { data, error } = await supabase.rpc('update_execution', {
    p_execution_id: params.executionId,
    p_status: params.status,
    p_tx_sig: params.txSig || null,
    p_tokens_out: params.tokensOut || null,
    p_price_per_token: params.pricePerToken || null,
    p_error: params.error || null,
    p_error_code: params.errorCode || null,
    p_result: params.result || null,
  });

  if (error) throw error;
  return data as Execution | null;
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

/**
 * Get all open positions for the hunter to monitor
 * WARNING: Returns ALL open positions - use getUserOpenPositions for user-specific queries
 */
export async function getOpenPositions(chain?: Chain): Promise<PositionV31[]> {
  let query = supabase
    .from('positions')
    .select('*')
    .eq('status', 'OPEN');

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data || []) as PositionV31[];
}

/**
 * M-2: Get open positions for a specific user (server-side filtering)
 * Use this instead of getOpenPositions() when querying for a specific user's positions
 */
export async function getUserOpenPositions(userId: number, chain?: Chain): Promise<PositionV31[]> {
  let query = supabase
    .from('positions')
    .select('*')
    .eq('tg_id', userId)  // Fix: positions table uses tg_id, not user_id
    .eq('status', 'OPEN');

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as PositionV31[];
}

/**
 * Get closed positions for a specific user (for PnL calculation)
 */
export async function getClosedPositions(userId: number, chain?: Chain): Promise<PositionV31[]> {
  let query = supabase
    .from('positions')
    .select('*')
    .eq('tg_id', userId)  // Fix: positions table uses tg_id, not user_id
    .eq('status', 'CLOSED');

  if (chain) {
    query = query.eq('chain', chain);
  }

  const { data, error } = await query.order('closed_at', { ascending: false });

  if (error) throw error;
  return (data || []) as PositionV31[];
}

/**
 * Get a position by ID
 */
export async function getPositionById(positionId: string): Promise<PositionV31 | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as PositionV31;
}

/**
 * Get a position by UUID (v3.1 standard)
 * Use this for TP/SL engine operations instead of getPositionById
 */
export async function getPositionByUuid(uuidId: string): Promise<PositionV31 | null> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('uuid_id', uuidId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as PositionV31;
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
      status: 'CLOSED',
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
    .eq('uuid_id', uuidId)
    .select()
    .single();

  if (error) throw error;
  return data as PositionV31;
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
}): Promise<PositionV31> {
  // Compute TP/SL prices at creation time (immutable for position lifetime)
  const tpPrice = position.tpPercent && position.entryPrice > 0
    ? position.entryPrice * (1 + position.tpPercent / 100)
    : null;
  const slPrice = position.slPercent && position.entryPrice > 0
    ? position.entryPrice * (1 - position.slPercent / 100)
    : null;

  const { data, error } = await supabase
    .from('positions')
    .insert({
      tg_id: position.userId,  // FIX: was user_id, table uses tg_id
      strategy_id: position.strategyId,
      opportunity_id: position.opportunityId || null,
      chain: position.chain,
      token_address: position.tokenMint,  // FIX: required column (same as mint on Solana)
      token_mint: position.tokenMint,
      token_symbol: position.tokenSymbol || 'Unknown',  // FIX: NOT NULL column
      token_name: position.tokenName || null,
      entry_execution_id: position.entryExecutionId || null,
      entry_tx_sig: position.entryTxSig || null,
      entry_cost_sol: position.entryCostSol,
      entry_price: position.entryPrice,
      size_tokens: position.sizeTokens,
      current_price: position.entryPrice,
      // Legacy columns (NOT NULL constraints)
      amount_in: position.entryCostSol,
      tokens_held: position.sizeTokens,
      source: 'auto',
      mode: 'snipe',
      strategy: 'STANDARD',
      status: 'ACTIVE',  // FIX: was 'OPEN', constraint requires 'ACTIVE'|'CLOSED'|'PENDING'
      opened_at: new Date().toISOString(),
      // TP/SL engine fields (Phase B audit fix)
      trigger_state: 'MONITORING',
      tp_price: tpPrice,
      sl_price: slPrice,
      bonding_curve: position.bondingCurve || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
    .eq('uuid_id', uuidId);

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
  // Use uuid_id for consistent ID handling across the codebase
  const { data, error } = await supabase
    .from('positions')
    .update({
      status: 'CLOSED',
      exit_execution_id: params.exitExecutionId || null,
      exit_tx_sig: params.exitTxSig || null,
      exit_price: params.exitPrice,
      exit_trigger: params.exitTrigger,
      realized_pnl_sol: params.realizedPnlSol,
      realized_pnl_percent: params.realizedPnlPercent,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('uuid_id', params.positionId)
    .select()
    .single();

  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as OpportunityV31;
}

/**
 * Create or update an opportunity
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
  const { data, error } = await supabase
    .from('opportunities')
    .upsert({
      chain: opp.chain,
      source: opp.source,
      token_mint: opp.tokenMint,
      token_name: opp.tokenName || null,
      token_symbol: opp.tokenSymbol || null,
      score: opp.score || null,
      reasons: opp.reasons || null,
      raw_data: opp.rawData || null,
      deployer: opp.deployer || null,
      bonding_curve: opp.bondingCurve || null,
      initial_liquidity_sol: opp.initialLiquiditySol || null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'chain,source,token_mint',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update opportunity status
 */
export async function updateOpportunityStatus(
  opportunityId: string,
  status: 'NEW' | 'QUALIFIED' | 'REJECTED' | 'EXPIRED' | 'EXECUTING' | 'COMPLETED',
  reason?: string
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    status_reason: reason || null,
    updated_at: new Date().toISOString(),
  };

  if (status === 'QUALIFIED') {
    updates.qualified_at = new Date().toISOString();
  } else if (status === 'EXPIRED') {
    updates.expired_at = new Date().toISOString();
  } else if (status === 'COMPLETED') {
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('opportunities')
    .update(updates)
    .eq('id', opportunityId);

  if (error) throw error;
}

// ============================================================================
// Notification Functions
// ============================================================================

/**
 * Claim notifications for delivery
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
  return (data || []) as NotificationV31[];
}

/**
 * Mark notification as delivered
 */
export async function markNotificationDelivered(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({
      delivered_at: new Date().toISOString(),
    })
    .eq('id', notificationId);

  if (error) throw error;
}

/**
 * Mark notification delivery failed
 * FIX: Use RPC for atomic increment (was broken inline supabase.rpc call)
 * FIX: Use delivery_error column (was last_error which doesn't exist)
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
 * Create a notification
 */
export async function createNotification(notification: {
  userId: number;
  type: string;
  payload: Record<string, unknown>;
}): Promise<NotificationV31> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: notification.userId,
      type: notification.type,
      payload: notification.payload,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

/**
 * Check if trading is paused globally
 */
export async function isTradingPaused(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  return controls?.trading_paused ?? false;
}

/**
 * Check if circuit breaker is open
 */
export async function isCircuitOpen(): Promise<boolean> {
  const controls = await getGlobalSafetyControls();
  if (!controls?.circuit_open_until) return false;
  return new Date(controls.circuit_open_until) > new Date();
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
  const { error } = await supabase.rpc('set_cooldown', {
    p_chain: params.chain,
    p_cooldown_type: params.cooldownType,
    p_target: params.target,
    p_duration_seconds: params.durationSeconds,
    p_reason: params.reason || null,
  });

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
 * Cleanup stale executions
 */
export async function cleanupStaleExecutions(staleMinutes: number = 5): Promise<number> {
  const { data, error } = await supabase.rpc('cleanup_stale_executions', {
    p_stale_minutes: staleMinutes,
  });

  if (error) throw error;
  return data as number;
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
  });

  if (error) throw error;
  return data as TradeMonitor;
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
  return (data || []) as TradeMonitor[];
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
  return data as TradeMonitor;
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
  return data as TradeMonitor;
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
  return data as TradeMonitor | null;
}

/**
 * Expire old monitors (maintenance)
 */
export async function expireOldMonitors(): Promise<number> {
  const { data, error } = await supabase.rpc('expire_old_monitors');

  if (error) throw error;
  return data as number;
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
  return (data || []) as RecentPosition[];
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
  return data as TradeMonitor;
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
  return data as TradeMonitor | null;
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
  return (data || []) as TradeMonitor[];
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

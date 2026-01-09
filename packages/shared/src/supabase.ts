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
 * Get all wallets for a user
 */
export async function getUserWallets(tgId: number): Promise<UserWallet[]> {
  const { data, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('tg_id', tgId)
    .order('chain')
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
  // Get the count of existing wallets for this chain
  const existingCount = await getWalletCount(wallet.tg_id, wallet.chain);

  if (existingCount >= 5) {
    throw new Error(`Maximum 5 wallets per chain reached for ${wallet.chain}`);
  }

  const walletIndex = existingCount + 1;
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

  // Create EVM wallets for all EVM chains using the same address/key
  for (const chain of ['bsc', 'base', 'eth'] as Chain[]) {
    await createWallet({
      tg_id: wallet.tg_id,
      chain,
      address: wallet.evm_address,
      private_key_encrypted: wallet.evm_private_key_encrypted,
    });
  }

  return solWallet;
}

/**
 * @deprecated Use getOrCreateFirstWallet for each chain instead
 */
export async function getOrCreateUserWallet(
  tgId: number,
  createKeypairs: () => {
    solana: { publicKey: string; privateKeyEncrypted: Record<string, unknown> };
    evm: { publicKey: string; privateKeyEncrypted: Record<string, unknown> };
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

  // Create EVM wallets for all chains
  for (const chain of ['bsc', 'base', 'eth'] as Chain[]) {
    await createWallet({
      tg_id: tgId,
      chain,
      address: keypairs.evm.publicKey,
      private_key_encrypted: keypairs.evm.privateKeyEncrypted,
    });
  }

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

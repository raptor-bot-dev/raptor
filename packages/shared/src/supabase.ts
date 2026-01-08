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

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

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

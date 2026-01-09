export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export interface Database {
    public: {
        Tables: {
            users: {
                Row: {
                    tg_id: number;
                    username: string | null;
                    first_name: string | null;
                    photo_url: string | null;
                    created_at: string;
                    last_login: string | null;
                };
                Insert: {
                    tg_id: number;
                    username?: string | null;
                    first_name?: string | null;
                    photo_url?: string | null;
                    created_at?: string;
                    last_login?: string | null;
                };
                Update: {
                    tg_id?: number;
                    username?: string | null;
                    first_name?: string | null;
                    photo_url?: string | null;
                    created_at?: string;
                    last_login?: string | null;
                };
            };
            user_balances: {
                Row: {
                    id: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    deposited: string;
                    current_value: string;
                    deposit_address: string;
                    updated_at: string;
                };
                Insert: {
                    id?: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    deposited?: string;
                    current_value?: string;
                    deposit_address: string;
                    updated_at?: string;
                };
                Update: {
                    id?: number;
                    tg_id?: number;
                    chain?: 'bsc' | 'base' | 'eth';
                    deposited?: string;
                    current_value?: string;
                    deposit_address?: string;
                    updated_at?: string;
                };
            };
            positions: {
                Row: {
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
                };
                Insert: {
                    id?: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    token_address: string;
                    token_symbol: string;
                    amount_in: string;
                    tokens_held: string;
                    entry_price: string;
                    current_price: string;
                    unrealized_pnl?: string;
                    unrealized_pnl_percent?: number;
                    take_profit_percent?: number;
                    stop_loss_percent?: number;
                    source: string;
                    score?: number;
                    status?: 'ACTIVE' | 'CLOSED' | 'PENDING';
                    created_at?: string;
                    closed_at?: string | null;
                };
                Update: {
                    id?: number;
                    tg_id?: number;
                    chain?: 'bsc' | 'base' | 'eth';
                    token_address?: string;
                    token_symbol?: string;
                    amount_in?: string;
                    tokens_held?: string;
                    entry_price?: string;
                    current_price?: string;
                    unrealized_pnl?: string;
                    unrealized_pnl_percent?: number;
                    take_profit_percent?: number;
                    stop_loss_percent?: number;
                    source?: string;
                    score?: number;
                    status?: 'ACTIVE' | 'CLOSED' | 'PENDING';
                    created_at?: string;
                    closed_at?: string | null;
                };
            };
            trades: {
                Row: {
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
                };
                Insert: {
                    id?: number;
                    tg_id: number;
                    position_id?: number | null;
                    chain: 'bsc' | 'base' | 'eth';
                    token_address: string;
                    token_symbol: string;
                    type: 'BUY' | 'SELL';
                    amount_in: string;
                    amount_out: string;
                    price: string;
                    pnl?: string | null;
                    pnl_percent?: number | null;
                    source: string;
                    tx_hash: string;
                    status?: 'PENDING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                };
                Update: {
                    id?: number;
                    tg_id?: number;
                    position_id?: number | null;
                    chain?: 'bsc' | 'base' | 'eth';
                    token_address?: string;
                    token_symbol?: string;
                    type?: 'BUY' | 'SELL';
                    amount_in?: string;
                    amount_out?: string;
                    price?: string;
                    pnl?: string | null;
                    pnl_percent?: number | null;
                    source?: string;
                    tx_hash?: string;
                    status?: 'PENDING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                };
            };
            deposits: {
                Row: {
                    id: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    amount: string;
                    tx_hash: string;
                    from_address: string;
                    status: 'PENDING' | 'CONFIRMED' | 'FAILED';
                    created_at: string;
                    confirmed_at: string | null;
                };
                Insert: {
                    id?: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    amount: string;
                    tx_hash: string;
                    from_address: string;
                    status?: 'PENDING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                    confirmed_at?: string | null;
                };
                Update: {
                    id?: number;
                    tg_id?: number;
                    chain?: 'bsc' | 'base' | 'eth';
                    amount?: string;
                    tx_hash?: string;
                    from_address?: string;
                    status?: 'PENDING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                    confirmed_at?: string | null;
                };
            };
            withdrawals: {
                Row: {
                    id: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    amount: string;
                    to_address: string;
                    tx_hash: string | null;
                    status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED';
                    created_at: string;
                    processed_at: string | null;
                };
                Insert: {
                    id?: number;
                    tg_id: number;
                    chain: 'bsc' | 'base' | 'eth';
                    amount: string;
                    to_address: string;
                    tx_hash?: string | null;
                    status?: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                    processed_at?: string | null;
                };
                Update: {
                    id?: number;
                    tg_id?: number;
                    chain?: 'bsc' | 'base' | 'eth';
                    amount?: string;
                    to_address?: string;
                    tx_hash?: string | null;
                    status?: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED';
                    created_at?: string;
                    processed_at?: string | null;
                };
            };
            user_settings: {
                Row: {
                    tg_id: number;
                    alerts_enabled: boolean;
                    daily_summary_enabled: boolean;
                    min_position_alert: string;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    tg_id: number;
                    alerts_enabled?: boolean;
                    daily_summary_enabled?: boolean;
                    min_position_alert?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: {
                    tg_id?: number;
                    alerts_enabled?: boolean;
                    daily_summary_enabled?: boolean;
                    min_position_alert?: string;
                    created_at?: string;
                    updated_at?: string;
                };
            };
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
        Enums: Record<string, never>;
    };
}

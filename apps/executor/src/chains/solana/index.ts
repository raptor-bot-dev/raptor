/**
 * Solana Executor Exports
 * For bot integration
 *
 * Phase 2: Added SwapRouter exports for venue-agnostic routing
 */

export { SolanaExecutor, solanaExecutor } from './solanaExecutor.js';
export type {
  SolanaTradeResult,
  SolanaTokenInfo,
} from './solanaExecutor.js';

// Phase 2: Export router types for venue-agnostic swap execution
export {
  RouterFactory,
  createRouterFactory,
  JupiterRouter,
  BagsTradeRouter,
  type SwapRouter,
  type SwapIntent,
  type SwapQuote,
  type SwapResult,
  type ExecuteOptions,
  type LifecycleState,
  type TradeSide,
} from '../../routers/index.js';

// Re-export for convenience (deprecated - prefer RouterFactory)
export { PumpFunClient } from './pumpFun.js';

// Re-export Jupiter client for price queries
export { JupiterClient, jupiter } from './jupiter.js';

// v3.5: Export Jito client for anti-MEV
export { JitoClient, createJitoClient } from './jitoClient.js';
export { HeliusSender, createHeliusSender } from './heliusSender.js';

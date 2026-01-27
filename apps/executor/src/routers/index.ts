// =============================================================================
// RAPTOR Phase 2: Router Module Exports
// =============================================================================

// SwapRouter interface and types
export {
  type SwapRouter,
  type SwapIntent,
  type SwapQuote,
  type SwapResult,
  type ExecuteOptions,
  type LifecycleState,
  type TradeSide,
  type BagsTradeRouterConfig,
  type JupiterRouterConfig,
  type RouterFactoryConfig,
} from './swapRouter.js';

// Router implementations
export { JupiterRouter } from './jupiterRouter.js';
export { BagsTradeRouter } from './bagsTradeRouter.js';

// Router factory
export {
  RouterFactory,
  createRouterFactory,
  type SwapExecutionOptions,
  type FullSwapResult,
} from './routerFactory.js';

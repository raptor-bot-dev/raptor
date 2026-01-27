// =============================================================================
// RAPTOR Phase 1: Discovery Sources
// Exports for launchpad discovery layer
// =============================================================================

// Parser
export {
  parseBagsMessage,
  isValidMintAddress,
  type BagsSignal,
  type BagsParseResult,
} from './bagsParser.js';

// Deduplicator
export {
  BagsDeduplicator,
  type DeduplicatorConfig,
} from './bagsDeduplicator.js';

// Source
export {
  BagsSource,
  createBagsSourceFromEnv,
  type BagsSourceConfig,
  type BagsSignalHandler,
} from './bagsSource.js';

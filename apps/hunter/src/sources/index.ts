// =============================================================================
// RAPTOR Phase 1-4: Discovery Sources
// Exports for launchpad discovery layer
// =============================================================================

// =============================================================================
// Phase 1: Bags.fm Telegram Source
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

// =============================================================================
// Phase 4: Meteora On-Chain Source
// =============================================================================

// Heuristic parser (log-pattern matching)
export {
  parseMeteoraLogs,
  isCreateInstruction,
  extractAddressesFromLogs,
  validateCreateEvent,
  type MeteoraCreateEvent,
  type MeteoraParseResult,
} from './meteoraParser.js';

// IDL-based instruction decoder (F-005b)
export {
  METEORA_DISCRIMINATORS,
  METEORA_DBC_PROGRAM_ID,
  INIT_POOL_ACCOUNT_INDICES,
  isInitializePoolInstruction,
  isSwapInstruction,
  isMigrationInstruction,
  getInitPoolType,
  decodeInitPoolInstruction,
  findAndDecodeCreateInstruction,
  validateDecodedEvent,
} from './meteoraInstructionDecoder.js';

// Source
export {
  MeteoraOnChainSource,
  type MeteoraOnChainSignal,
  type MeteoraOnChainConfig,
  type MeteoraSignalHandler,
} from './meteoraOnChainSource.js';

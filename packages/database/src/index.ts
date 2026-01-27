/**
 * RAPTOR Database Package
 *
 * Exports database types and utilities for the Phase 0 fresh schema.
 */

// Re-export all types from the types module
export * from './types.js';

export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

// =============================================================================
// RAPTOR Phase 3: Graduation Handler
// Handles position transitions when tokens graduate from bonding curve to AMM
// =============================================================================

import {
  graduatePositionAtomically,
  getPreGraduationPositionsByMint,
  type PositionV31,
} from '@raptor/shared';

/**
 * Result of a graduation attempt
 */
export interface GraduationResult {
  graduated: boolean;
  positionId: string;
  reason?: string;
}

/**
 * Graduate a single position atomically.
 * This transitions the position from PRE_GRADUATION to POST_GRADUATION.
 *
 * @param position The position to graduate
 * @param poolAddress Optional AMM pool address (if known)
 * @returns Result indicating success or failure
 */
export async function graduatePosition(
  position: PositionV31,
  poolAddress: string | null = null
): Promise<GraduationResult> {
  const positionId = position.uuid_id;

  // Skip if already graduated or closed
  if (position.lifecycle_state !== 'PRE_GRADUATION') {
    return {
      graduated: false,
      positionId,
      reason: `already_${position.lifecycle_state.toLowerCase()}`,
    };
  }

  try {
    const graduated = await graduatePositionAtomically(positionId, poolAddress);

    if (!graduated) {
      return {
        graduated: false,
        positionId,
        reason: 'already_transitioned',
      };
    }

    console.log(
      `[GRADUATION] Position ${positionId.slice(0, 8)}... graduated to POST_GRADUATION` +
        (poolAddress ? ` (pool: ${poolAddress.slice(0, 12)}...)` : '')
    );

    return {
      graduated: true,
      positionId,
    };
  } catch (error) {
    console.error(`[GRADUATION] Failed to graduate position ${positionId}:`, error);
    return {
      graduated: false,
      positionId,
      reason: `error: ${(error as Error).message}`,
    };
  }
}

/**
 * Graduate all positions for a given mint.
 * Called when a token's bonding curve completes (token graduates to AMM).
 *
 * @param mint The token mint address
 * @param poolAddress Optional AMM pool address
 * @returns Array of graduation results
 */
export async function graduateAllPositionsForMint(
  mint: string,
  poolAddress: string | null = null
): Promise<GraduationResult[]> {
  const positions = await getPreGraduationPositionsByMint(mint);

  if (positions.length === 0) {
    return [];
  }

  console.log(
    `[GRADUATION] Graduating ${positions.length} position(s) for mint ${mint.slice(0, 12)}...`
  );

  const results = await Promise.all(
    positions.map((position) => graduatePosition(position, poolAddress))
  );

  const graduatedCount = results.filter((r) => r.graduated).length;
  console.log(
    `[GRADUATION] Graduated ${graduatedCount}/${positions.length} positions for mint ${mint.slice(0, 12)}...`
  );

  return results;
}

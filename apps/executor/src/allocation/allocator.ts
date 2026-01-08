import { getUserAllocations as getDbAllocations } from '@raptor/shared';

export interface AllocationStrategy {
  type: 'equal' | 'proportional' | 'priority';
  maxUsers?: number;
  minAllocation?: bigint;
}

const DEFAULT_STRATEGY: AllocationStrategy = {
  type: 'proportional',
  maxUsers: 100,
  minAllocation: BigInt(1e16), // 0.01 ETH/BNB minimum
};

export async function getUserAllocations(
  chain: 'bsc' | 'base',
  strategy: AllocationStrategy = DEFAULT_STRATEGY
): Promise<Map<number, bigint>> {
  // Get raw allocations from database
  const rawAllocations = await getDbAllocations(chain);

  // Filter out allocations below minimum
  const filtered = new Map<number, bigint>();
  for (const [tgId, amount] of rawAllocations) {
    if (amount >= (strategy.minAllocation || 0n)) {
      filtered.set(tgId, amount);
    }
  }

  // Apply strategy
  switch (strategy.type) {
    case 'equal':
      return equalAllocations(filtered, strategy.maxUsers);
    case 'proportional':
      return proportionalAllocations(filtered, strategy.maxUsers);
    case 'priority':
      return priorityAllocations(filtered, strategy.maxUsers);
    default:
      return filtered;
  }
}

function equalAllocations(
  allocations: Map<number, bigint>,
  maxUsers?: number
): Map<number, bigint> {
  // Limit to max users if specified
  const entries = Array.from(allocations.entries());
  const limited = maxUsers ? entries.slice(0, maxUsers) : entries;

  // Calculate equal share
  const totalFunds = limited.reduce((sum, [, amount]) => sum + amount, 0n);
  const equalShare = totalFunds / BigInt(limited.length || 1);

  // Return equal allocations
  const result = new Map<number, bigint>();
  for (const [tgId] of limited) {
    result.set(tgId, equalShare);
  }

  return result;
}

function proportionalAllocations(
  allocations: Map<number, bigint>,
  maxUsers?: number
): Map<number, bigint> {
  // Sort by allocation size (largest first)
  const entries = Array.from(allocations.entries())
    .sort((a, b) => (b[1] > a[1] ? 1 : -1));

  // Limit to max users
  const limited = maxUsers ? entries.slice(0, maxUsers) : entries;

  // Return proportional allocations (unchanged from input)
  return new Map(limited);
}

function priorityAllocations(
  allocations: Map<number, bigint>,
  maxUsers?: number
): Map<number, bigint> {
  // Priority goes to largest depositors first
  const entries = Array.from(allocations.entries())
    .sort((a, b) => (b[1] > a[1] ? 1 : -1));

  // Limit to max users
  const limited = maxUsers ? entries.slice(0, maxUsers) : entries;

  return new Map(limited);
}

export function calculateOptimalAllocation(
  totalPool: bigint,
  liquidity: bigint,
  maxPoolPercent: number
): bigint {
  // Don't take more than maxPoolPercent of liquidity
  const maxFromLiquidity = (liquidity * BigInt(maxPoolPercent)) / 100n;

  // Use the smaller of pool size or max from liquidity
  return totalPool < maxFromLiquidity ? totalPool : maxFromLiquidity;
}

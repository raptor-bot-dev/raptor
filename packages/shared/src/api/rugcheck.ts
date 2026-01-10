/**
 * RugCheck API for RAPTOR
 *
 * Free Solana-specific security API:
 * - Mint/freeze authority status
 * - LP burned percentage
 * - Top holder analysis
 * - Risk scoring
 *
 * Docs: https://api.rugcheck.xyz/
 */

// RugCheck API endpoint
const RUGCHECK_API = 'https://api.rugcheck.xyz/v1';

// Cache
const cache = new Map<string, { data: RugCheckResult; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface RugCheckResult {
  mint: string;
  tokenName: string;
  tokenSymbol: string;

  // Authority status
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isMintable: boolean;
  isFreezable: boolean;

  // Supply info
  totalSupply: number;
  circulatingSupply: number;

  // LP info
  lpLocked: boolean;
  lpLockedPercent: number;
  lpBurned: boolean;
  lpBurnedPercent: number;

  // Top holders
  topHolders: {
    address: string;
    percent: number;
    isInsider: boolean;
  }[];
  top10HoldersPercent: number;

  // Creator info
  creator: string;
  creatorBalance: number;
  creatorPercent: number;

  // Market info
  markets: {
    name: string;
    address: string;
    liquidity: number;
  }[];

  // Risk assessment
  riskLevel: 'good' | 'low' | 'medium' | 'high' | 'critical';
  riskScore: number; // 0-100, higher is safer
  risks: string[];
  warnings: string[];
}

/**
 * Get token security from RugCheck
 */
export async function getTokenSecurity(
  mint: string
): Promise<RugCheckResult | null> {
  const cacheKey = mint;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  try {
    const response = await fetch(`${RUGCHECK_API}/tokens/${mint}/report`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(`[RugCheck] API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const result = parseRugCheckResponse(data, mint);

    cache.set(cacheKey, {
      data: result,
      expiry: Date.now() + CACHE_TTL,
    });

    return result;
  } catch (error) {
    console.error('[RugCheck] Fetch error:', error);
    return null;
  }
}

/**
 * Get quick risk score (faster, less data)
 */
export async function getQuickRisk(
  mint: string
): Promise<{ score: number; level: string } | null> {
  try {
    const response = await fetch(`${RUGCHECK_API}/tokens/${mint}/report/summary`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const score = Number(data.score || 0);

    let level = 'critical';
    if (score >= 80) level = 'good';
    else if (score >= 60) level = 'low';
    else if (score >= 40) level = 'medium';
    else if (score >= 20) level = 'high';

    return { score, level };
  } catch {
    return null;
  }
}

/**
 * Parse RugCheck API response
 */
function parseRugCheckResponse(
  data: Record<string, unknown>,
  mint: string
): RugCheckResult {
  const risks: string[] = [];
  const warnings: string[] = [];
  let riskScore = 100;

  // Token info
  const tokenMeta = data.tokenMeta as Record<string, unknown> || {};
  const tokenName = String(tokenMeta.name || 'Unknown');
  const tokenSymbol = String(tokenMeta.symbol || '???');

  // Authority status
  const mintAuthority = data.mintAuthority as string | null;
  const freezeAuthority = data.freezeAuthority as string | null;
  const isMintable = mintAuthority !== null;
  const isFreezable = freezeAuthority !== null;

  if (isMintable) {
    risks.push('⚠️ Mint authority enabled (supply can increase)');
    riskScore -= 20;
  }

  if (isFreezable) {
    risks.push('⚠️ Freeze authority enabled (tokens can be frozen)');
    riskScore -= 15;
  }

  // Supply
  const totalSupply = Number(data.totalSupply || 0);
  const circulatingSupply = Number(data.circulatingSupply || totalSupply);

  // LP info
  const markets = (data.markets || []) as Array<Record<string, unknown>>;
  const lpInfo = {
    locked: false,
    lockedPercent: 0,
    burned: false,
    burnedPercent: 0,
  };

  const parsedMarkets: RugCheckResult['markets'] = [];
  for (const m of markets) {
    const lp = m.lp as Record<string, unknown> || {};
    if (lp.lpLockedPct) {
      lpInfo.locked = true;
      lpInfo.lockedPercent = Math.max(lpInfo.lockedPercent, Number(lp.lpLockedPct));
    }
    if (lp.lpBurnedPct) {
      lpInfo.burned = true;
      lpInfo.burnedPercent = Math.max(lpInfo.burnedPercent, Number(lp.lpBurnedPct));
    }
    parsedMarkets.push({
      name: String(m.marketType || 'Unknown'),
      address: String(m.pubkey || ''),
      liquidity: Number((lp as Record<string, unknown>).quoteUSD || 0),
    });
  }

  if (!lpInfo.locked && !lpInfo.burned) {
    warnings.push('ℹ️ LP not locked or burned');
    riskScore -= 10;
  }

  // Top holders
  const topHolders = (data.topHolders || []) as Array<Record<string, unknown>>;
  const parsedHolders: RugCheckResult['topHolders'] = [];
  let top10Percent = 0;

  for (let i = 0; i < Math.min(topHolders.length, 10); i++) {
    const h = topHolders[i];
    const percent = Number(h.pct || 0);
    top10Percent += percent;
    parsedHolders.push({
      address: String(h.address || ''),
      percent,
      isInsider: Boolean(h.insider),
    });
  }

  if (top10Percent > 50) {
    risks.push(`⚠️ Top 10 holders own ${top10Percent.toFixed(1)}%`);
    riskScore -= 15;
  }

  // Creator info
  const creator = String(data.creator || '');
  const creatorHolding = topHolders.find(h => h.address === creator) as Record<string, unknown> | undefined;
  const creatorPercent = creatorHolding ? Number(creatorHolding.pct || 0) : 0;

  if (creatorPercent > 10) {
    warnings.push(`ℹ️ Creator holds ${creatorPercent.toFixed(1)}%`);
    if (creatorPercent > 30) {
      riskScore -= 10;
    }
  }

  // Risk flags from API
  const riskFlags = (data.risks || []) as Array<Record<string, unknown>>;
  for (const flag of riskFlags) {
    const level = String(flag.level || '').toLowerCase();
    const name = String(flag.name || 'Unknown risk');
    const description = String(flag.description || '');

    if (level === 'critical' || level === 'danger') {
      risks.push(`🚨 ${name}: ${description}`);
      riskScore -= 30;
    } else if (level === 'warn') {
      risks.push(`⚠️ ${name}: ${description}`);
      riskScore -= 10;
    } else {
      warnings.push(`ℹ️ ${name}`);
    }
  }

  // Determine risk level
  riskScore = Math.max(0, Math.min(100, riskScore));
  let riskLevel: RugCheckResult['riskLevel'];

  if (riskScore >= 80) riskLevel = 'good';
  else if (riskScore >= 60) riskLevel = 'low';
  else if (riskScore >= 40) riskLevel = 'medium';
  else if (riskScore >= 20) riskLevel = 'high';
  else riskLevel = 'critical';

  return {
    mint,
    tokenName,
    tokenSymbol,
    mintAuthority,
    freezeAuthority,
    isMintable,
    isFreezable,
    totalSupply,
    circulatingSupply,
    lpLocked: lpInfo.locked,
    lpLockedPercent: lpInfo.lockedPercent,
    lpBurned: lpInfo.burned,
    lpBurnedPercent: lpInfo.burnedPercent,
    topHolders: parsedHolders,
    top10HoldersPercent: top10Percent,
    creator,
    creatorBalance: 0,
    creatorPercent,
    markets: parsedMarkets,
    riskLevel,
    riskScore,
    risks,
    warnings,
  };
}

/**
 * Get risk badge for display
 */
export function getRiskBadge(result: RugCheckResult | null): {
  emoji: string;
  label: string;
  color: string;
} {
  if (!result) {
    return { emoji: '❓', label: 'Unverified', color: 'gray' };
  }

  switch (result.riskLevel) {
    case 'good':
      return { emoji: '✅', label: 'Good', color: 'green' };
    case 'low':
      return { emoji: '🟢', label: 'Low Risk', color: 'green' };
    case 'medium':
      return { emoji: '🟡', label: 'Medium Risk', color: 'yellow' };
    case 'high':
      return { emoji: '🟠', label: 'High Risk', color: 'orange' };
    case 'critical':
      return { emoji: '🔴', label: 'Critical Risk', color: 'red' };
    default:
      return { emoji: '❓', label: 'Unknown', color: 'gray' };
  }
}

/**
 * Format authority status
 */
export function formatAuthorities(result: RugCheckResult): string {
  const lines: string[] = [];

  if (result.isMintable) {
    lines.push('⚠️ Mintable: YES');
  } else {
    lines.push('✅ Mintable: NO');
  }

  if (result.isFreezable) {
    lines.push('⚠️ Freezable: YES');
  } else {
    lines.push('✅ Freezable: NO');
  }

  if (result.lpBurned) {
    lines.push(`🔥 LP Burned: ${result.lpBurnedPercent.toFixed(1)}%`);
  } else if (result.lpLocked) {
    lines.push(`🔒 LP Locked: ${result.lpLockedPercent.toFixed(1)}%`);
  } else {
    lines.push('⚠️ LP: Not locked/burned');
  }

  return lines.join('\n');
}

/**
 * Clear cache
 */
export function clearCache(): void {
  cache.clear();
}

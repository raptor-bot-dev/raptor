/**
 * GoPlus Security API for RAPTOR
 *
 * Free API for token security scanning:
 * - Honeypot detection
 * - Contract security analysis
 * - Ownership analysis
 * - Trading tax analysis
 *
 * Docs: https://docs.gopluslabs.io/
 */

import type { Chain } from '../types.js';

const GOPLUS_API = 'https://api.gopluslabs.io/api/v1';

// Chain IDs for GoPlus
const CHAIN_IDS: Record<Chain, string> = {
  sol: 'solana',
  bsc: '56',
  base: '8453',
  eth: '1',
};

// Cache for security results
const cache = new Map<string, { data: GoPlusSecurityResult; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export interface GoPlusSecurityResult {
  // Basic info
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string;
  holderCount: number;

  // Ownership
  isOpenSource: boolean;
  isProxy: boolean;
  isMintable: boolean;
  canTakeBackOwnership: boolean;
  ownerChangeBalance: boolean;
  hiddenOwner: boolean;
  selfDestruct: boolean;
  externalCall: boolean;

  // Trading
  buyTax: number;
  sellTax: number;
  cannotBuy: boolean;
  cannotSellAll: boolean;
  isHoneypot: boolean;
  transferPausable: boolean;
  tradingCooldown: boolean;
  isAntiWhale: boolean;
  antiWhaleModifiable: boolean;
  slippageModifiable: boolean;
  isBlacklisted: boolean;
  isWhitelisted: boolean;
  personalSlippageModifiable: boolean;

  // Liquidity
  lpHolderCount: number;
  lpTotalSupply: string;
  lpHolders: { address: string; percent: number; isLocked: boolean; isContract: boolean }[];

  // Top holders
  holders: { address: string; percent: number; isLocked: boolean; isContract: boolean }[];

  // Creator info
  creatorAddress: string;
  creatorPercent: number;
  ownerAddress: string;
  ownerPercent: number;

  // Risk score (calculated)
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  riskScore: number; // 0-100, higher is safer
  risks: string[];
}

/**
 * Get token security info from GoPlus (EVM chains)
 */
export async function getTokenSecurity(
  address: string,
  chain: Chain
): Promise<GoPlusSecurityResult | null> {
  const cacheKey = `${chain}:${address.toLowerCase()}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  try {
    const chainId = CHAIN_IDS[chain];

    // Different endpoint for Solana
    const url = chain === 'sol'
      ? `${GOPLUS_API}/solana/token_security?contract_addresses=${address}`
      : `${GOPLUS_API}/token_security/${chainId}?contract_addresses=${address}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[GoPlus] API error: ${response.status}`);
      return null;
    }

    const json = await response.json() as {
      code: number;
      result: Record<string, unknown>;
    };

    if (json.code !== 1 || !json.result) {
      return null;
    }

    const data = json.result[address.toLowerCase()] as Record<string, unknown>;
    if (!data) {
      return null;
    }

    const result = parseGoPlusResponse(data, chain);

    cache.set(cacheKey, {
      data: result,
      expiry: Date.now() + CACHE_TTL,
    });

    return result;
  } catch (error) {
    console.error('[GoPlus] Fetch error:', error);
    return null;
  }
}

/**
 * Parse GoPlus API response into our format
 */
function parseGoPlusResponse(
  data: Record<string, unknown>,
  chain: Chain
): GoPlusSecurityResult {
  const risks: string[] = [];
  let riskScore = 100;

  // Parse basic info
  const tokenName = String(data.token_name || 'Unknown');
  const tokenSymbol = String(data.token_symbol || '???');
  const totalSupply = String(data.total_supply || '0');
  const holderCount = parseInt(String(data.holder_count || '0'));

  // Parse booleans (GoPlus returns "0" or "1" strings)
  const toBool = (val: unknown): boolean => val === '1' || val === 1 || val === true;

  const isOpenSource = toBool(data.is_open_source);
  const isProxy = toBool(data.is_proxy);
  const isMintable = toBool(data.is_mintable);
  const canTakeBackOwnership = toBool(data.can_take_back_ownership);
  const ownerChangeBalance = toBool(data.owner_change_balance);
  const hiddenOwner = toBool(data.hidden_owner);
  const selfDestruct = toBool(data.selfdestruct);
  const externalCall = toBool(data.external_call);
  const isHoneypot = toBool(data.is_honeypot);
  const transferPausable = toBool(data.transfer_pausable);
  const tradingCooldown = toBool(data.trading_cooldown);
  const isAntiWhale = toBool(data.is_anti_whale);
  const antiWhaleModifiable = toBool(data.anti_whale_modifiable);
  const slippageModifiable = toBool(data.slippage_modifiable);
  const isBlacklisted = toBool(data.is_blacklisted);
  const isWhitelisted = toBool(data.is_whitelisted);
  const personalSlippageModifiable = toBool(data.personal_slippage_modifiable);
  const cannotBuy = toBool(data.cannot_buy);
  const cannotSellAll = toBool(data.cannot_sell_all);

  // Parse taxes
  const buyTax = parseFloat(String(data.buy_tax || '0')) * 100;
  const sellTax = parseFloat(String(data.sell_tax || '0')) * 100;

  // Calculate risks
  if (isHoneypot) {
    risks.push('🚨 HONEYPOT DETECTED');
    riskScore = 0;
  }

  if (cannotBuy) {
    risks.push('⛔ Cannot buy');
    riskScore -= 50;
  }

  if (cannotSellAll) {
    risks.push('⛔ Cannot sell all');
    riskScore -= 30;
  }

  if (isMintable) {
    risks.push('⚠️ Mintable (unlimited supply)');
    riskScore -= 15;
  }

  if (hiddenOwner) {
    risks.push('⚠️ Hidden owner');
    riskScore -= 15;
  }

  if (canTakeBackOwnership) {
    risks.push('⚠️ Can reclaim ownership');
    riskScore -= 15;
  }

  if (ownerChangeBalance) {
    risks.push('⚠️ Owner can modify balances');
    riskScore -= 20;
  }

  if (transferPausable) {
    risks.push('⚠️ Transfers can be paused');
    riskScore -= 10;
  }

  if (buyTax > 10) {
    risks.push(`⚠️ High buy tax: ${buyTax.toFixed(1)}%`);
    riskScore -= Math.min(buyTax, 30);
  }

  if (sellTax > 10) {
    risks.push(`⚠️ High sell tax: ${sellTax.toFixed(1)}%`);
    riskScore -= Math.min(sellTax, 30);
  }

  if (!isOpenSource && chain !== 'sol') {
    risks.push('⚠️ Contract not verified');
    riskScore -= 10;
  }

  if (isProxy) {
    risks.push('ℹ️ Proxy contract');
    riskScore -= 5;
  }

  if (isBlacklisted) {
    risks.push('⚠️ Has blacklist function');
    riskScore -= 10;
  }

  // Parse LP holders
  const lpHolders: GoPlusSecurityResult['lpHolders'] = [];
  if (Array.isArray(data.lp_holders)) {
    for (const h of data.lp_holders as Array<Record<string, unknown>>) {
      lpHolders.push({
        address: String(h.address || ''),
        percent: parseFloat(String(h.percent || '0')) * 100,
        isLocked: toBool(h.is_locked),
        isContract: toBool(h.is_contract),
      });
    }
  }

  // Parse token holders
  const holders: GoPlusSecurityResult['holders'] = [];
  if (Array.isArray(data.holders)) {
    for (const h of data.holders as Array<Record<string, unknown>>) {
      holders.push({
        address: String(h.address || ''),
        percent: parseFloat(String(h.percent || '0')) * 100,
        isLocked: toBool(h.is_locked),
        isContract: toBool(h.is_contract),
      });
    }
  }

  // Check holder concentration
  const topHolderPercent = holders[0]?.percent || 0;
  if (topHolderPercent > 50) {
    risks.push(`⚠️ Top holder owns ${topHolderPercent.toFixed(1)}%`);
    riskScore -= 15;
  }

  // Determine risk level
  riskScore = Math.max(0, Math.min(100, riskScore));
  let riskLevel: GoPlusSecurityResult['riskLevel'];

  if (riskScore >= 80) riskLevel = 'safe';
  else if (riskScore >= 60) riskLevel = 'low';
  else if (riskScore >= 40) riskLevel = 'medium';
  else if (riskScore >= 20) riskLevel = 'high';
  else riskLevel = 'critical';

  return {
    tokenName,
    tokenSymbol,
    totalSupply,
    holderCount,
    isOpenSource,
    isProxy,
    isMintable,
    canTakeBackOwnership,
    ownerChangeBalance,
    hiddenOwner,
    selfDestruct,
    externalCall,
    buyTax,
    sellTax,
    cannotBuy,
    cannotSellAll,
    isHoneypot,
    transferPausable,
    tradingCooldown,
    isAntiWhale,
    antiWhaleModifiable,
    slippageModifiable,
    isBlacklisted,
    isWhitelisted,
    personalSlippageModifiable,
    lpHolderCount: parseInt(String(data.lp_holder_count || '0')),
    lpTotalSupply: String(data.lp_total_supply || '0'),
    lpHolders,
    holders,
    creatorAddress: String(data.creator_address || ''),
    creatorPercent: parseFloat(String(data.creator_percent || '0')) * 100,
    ownerAddress: String(data.owner_address || ''),
    ownerPercent: parseFloat(String(data.owner_percent || '0')) * 100,
    riskLevel,
    riskScore,
    risks,
  };
}

/**
 * Get risk emoji and label
 */
export function getRiskBadge(security: GoPlusSecurityResult | null): {
  emoji: string;
  label: string;
  color: string;
} {
  if (!security) {
    return { emoji: '❓', label: 'Unverified', color: 'gray' };
  }

  if (security.isHoneypot) {
    return { emoji: '🚨', label: 'HONEYPOT', color: 'red' };
  }

  switch (security.riskLevel) {
    case 'safe':
      return { emoji: '✅', label: 'Safe', color: 'green' };
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
 * Clear cache
 */
export function clearCache(): void {
  cache.clear();
}

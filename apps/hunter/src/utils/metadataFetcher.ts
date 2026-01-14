// =============================================================================
// RAPTOR v4.3 Metadata Fetcher
// Fetches and parses token metadata from IPFS, Arweave, or HTTP URIs
// =============================================================================

export interface TokenMetadata {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  // Raw JSON for extensibility
  raw?: Record<string, unknown>;
}

// IPFS gateways to try (in order of preference)
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

// Arweave gateway
const ARWEAVE_GATEWAY = 'https://arweave.net/';

/**
 * Convert URI to a fetchable HTTP URL
 */
function resolveUri(uri: string): string[] {
  const trimmed = uri.trim();

  // IPFS protocol
  if (trimmed.startsWith('ipfs://')) {
    const hash = trimmed.replace('ipfs://', '');
    return IPFS_GATEWAYS.map((gw) => `${gw}${hash}`);
  }

  // Arweave protocol
  if (trimmed.startsWith('ar://')) {
    const hash = trimmed.replace('ar://', '');
    return [`${ARWEAVE_GATEWAY}${hash}`];
  }

  // Already HTTP(S)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return [trimmed];
  }

  // Assume IPFS hash if no protocol
  if (/^[a-zA-Z0-9]{46,}$/.test(trimmed)) {
    return IPFS_GATEWAYS.map((gw) => `${gw}${trimmed}`);
  }

  // Unknown format - try as-is
  return [trimmed];
}

/**
 * Extract social links from metadata JSON
 * Handles various formats used by different token creators
 */
function extractSocialLinks(data: Record<string, unknown>): {
  twitter?: string;
  telegram?: string;
  website?: string;
} {
  const result: { twitter?: string; telegram?: string; website?: string } = {};

  // Twitter - check multiple possible field names
  const twitterFields = ['twitter', 'x', 'twitter_url', 'twitterUrl', 'social_twitter'];
  for (const field of twitterFields) {
    if (data[field] && typeof data[field] === 'string') {
      result.twitter = data[field] as string;
      break;
    }
  }

  // Also check nested 'socials' or 'links' objects
  const socials = data.socials || data.links || data.social;
  if (socials && typeof socials === 'object') {
    const s = socials as Record<string, unknown>;
    if (!result.twitter && (s.twitter || s.x)) {
      result.twitter = (s.twitter || s.x) as string;
    }
    if (s.telegram) {
      result.telegram = s.telegram as string;
    }
    if (s.website || s.web || s.homepage) {
      result.website = (s.website || s.web || s.homepage) as string;
    }
  }

  // Telegram - check multiple possible field names
  const telegramFields = ['telegram', 'tg', 'telegram_url', 'telegramUrl', 'social_telegram'];
  for (const field of telegramFields) {
    if (!result.telegram && data[field] && typeof data[field] === 'string') {
      result.telegram = data[field] as string;
      break;
    }
  }

  // Website - check multiple possible field names
  const websiteFields = ['website', 'web', 'homepage', 'url', 'external_url', 'externalUrl'];
  for (const field of websiteFields) {
    if (!result.website && data[field] && typeof data[field] === 'string') {
      result.website = data[field] as string;
      break;
    }
  }

  return result;
}

/**
 * Fetch token metadata from URI with timeout
 *
 * @param uri - The metadata URI (can be ipfs://, ar://, or https://)
 * @param timeoutMs - Maximum time to wait for fetch (default: 2000ms)
 * @returns Parsed metadata or null if fetch fails/times out
 */
export async function fetchMetadata(
  uri: string,
  timeoutMs: number = 2000
): Promise<TokenMetadata | null> {
  if (!uri || uri.length === 0) {
    return null;
  }

  const urls = resolveUri(uri);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try each URL until one works
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'RAPTOR/4.3',
          },
        });

        if (!response.ok) {
          continue; // Try next gateway
        }

        const data = await response.json() as Record<string, unknown>;

        // Extract standard fields
        const metadata: TokenMetadata = {
          name: typeof data.name === 'string' ? data.name : undefined,
          symbol: typeof data.symbol === 'string' ? data.symbol : undefined,
          description: typeof data.description === 'string' ? data.description : undefined,
          image: typeof data.image === 'string' ? data.image : undefined,
          raw: data,
        };

        // Extract social links
        const socialLinks = extractSocialLinks(data);
        metadata.twitter = socialLinks.twitter;
        metadata.telegram = socialLinks.telegram;
        metadata.website = socialLinks.website;

        return metadata;
      } catch (err) {
        // If aborted, stop trying
        if ((err as Error).name === 'AbortError') {
          throw err;
        }
        // Otherwise try next URL
        continue;
      }
    }

    // All URLs failed
    return null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.log(`[MetadataFetcher] Timeout after ${timeoutMs}ms for: ${uri.slice(0, 50)}...`);
    } else {
      console.error('[MetadataFetcher] Error:', err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if metadata has social presence
 * Useful for quick quality check
 */
export function hasSocialPresence(metadata: TokenMetadata | null): {
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  hasImage: boolean;
  socialScore: number;
} {
  if (!metadata) {
    return {
      hasTwitter: false,
      hasTelegram: false,
      hasWebsite: false,
      hasImage: false,
      socialScore: 0,
    };
  }

  const hasTwitter = Boolean(metadata.twitter);
  const hasTelegram = Boolean(metadata.telegram);
  const hasWebsite = Boolean(metadata.website);
  const hasImage = Boolean(metadata.image);

  // Each social link is worth 5 points (matches scoring weights)
  const socialScore =
    (hasTwitter ? 5 : 0) +
    (hasTelegram ? 5 : 0) +
    (hasWebsite ? 5 : 0) +
    (hasImage ? 5 : 0);

  return {
    hasTwitter,
    hasTelegram,
    hasWebsite,
    hasImage,
    socialScore,
  };
}

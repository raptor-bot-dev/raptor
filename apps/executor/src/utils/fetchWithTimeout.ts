/**
 * Fetch with timeout helper to prevent hanging on slow APIs or RPC endpoints
 *
 * @param url - The URL to fetch
 * @param options - Fetch request options
 * @param timeoutMs - Timeout in milliseconds (default 5000ms)
 * @returns Promise resolving to the Response
 * @throws Error with name 'AbortError' if timeout is reached
 */
export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

/**
 * Fetch with retry and exponential backoff for handling transient DNS/network failures
 * Useful for cloud environments like Railway where DNS resolution can be flaky
 *
 * @param url - The URL to fetch
 * @param options - Fetch request options
 * @param timeoutMs - Timeout per request in milliseconds (default 5000ms)
 * @param maxRetries - Maximum number of retries (default 3)
 * @param baseDelayMs - Base delay between retries in milliseconds (default 500ms)
 * @returns Promise resolving to the Response
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 5000,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError.message || '';
      const cause = (lastError as Error & { cause?: Error }).cause;
      const causeMessage = cause?.message || '';

      // Check if it's a DNS/network error worth retrying
      const isNetworkError =
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('getaddrinfo') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        causeMessage.includes('ENOTFOUND') ||
        causeMessage.includes('getaddrinfo');

      // Don't retry non-network errors
      if (!isNetworkError && lastError.name !== 'AbortError') {
        throw lastError;
      }

      // Don't retry if we've exhausted retries
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      console.log(`[fetchWithRetry] Attempt ${attempt + 1} failed for ${new URL(url).hostname}, retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

/**
 * Helper to create a timeout promise that rejects after specified time
 *
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Error message to throw (default 'Timeout')
 * @returns Promise that rejects with Error after timeout
 */
export function createTimeout(timeoutMs: number, errorMessage: string = 'Timeout'): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
}

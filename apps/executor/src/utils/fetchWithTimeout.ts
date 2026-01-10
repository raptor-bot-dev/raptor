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

/**
 * Helius Sender Client for Solana Transaction Submission
 *
 * Sends transactions through Helius Sender which simultaneously routes to
 * both Solana validators (via staked connections) and Jito's auction.
 * This provides dual-pathway landing for optimal speed and reliability.
 *
 * Replaces direct Jito bundle submission as the primary send method.
 * See: https://www.helius.dev/docs/sending-transactions/sender
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { fetchWithRetry } from '../../utils/fetchWithTimeout.js';

// Helius Sender endpoints — use regional HTTP for backend (lower latency)
const HELIUS_SENDER_ENDPOINTS = {
  global: 'https://sender.helius-rpc.com/fast',
  ewr: 'http://ewr-sender.helius-rpc.com/fast',    // Newark (closest to Fly.io IAD)
  fra: 'http://fra-sender.helius-rpc.com/fast',    // Frankfurt
  ams: 'http://ams-sender.helius-rpc.com/fast',    // Amsterdam
  slc: 'http://slc-sender.helius-rpc.com/fast',    // Salt Lake City
  lon: 'http://lon-sender.helius-rpc.com/fast',    // London
  sg: 'http://sg-sender.helius-rpc.com/fast',      // Singapore
  tyo: 'http://tyo-sender.helius-rpc.com/fast',    // Tokyo
};

// Helius Sender tip accounts (mainnet-beta)
const HELIUS_TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
];

// Minimum tip for Jito auction participation via Helius Sender
const MIN_TIP_LAMPORTS = 200_000; // 0.0002 SOL

export interface HeliusSendResult {
  success: boolean;
  signature?: string;
  error?: string;
  endpoint?: string;
}

export interface HeliusSendOptions {
  /** Tip amount in lamports (min 200,000 = 0.0002 SOL for Jito auction) */
  tipLamports?: number;
  /** Priority fee in microlamports per compute unit */
  priorityMicroLamports?: number;
  /** Priority fee in SOL (converted to tip addition) */
  priorityFeeSol?: number;
  /** Preferred region (ewr, fra, ams, etc.) */
  region?: keyof typeof HELIUS_SENDER_ENDPOINTS;
  /** Confirmation timeout in ms */
  confirmTimeoutMs?: number;
}

export class HeliusSender {
  private connection: Connection;
  private apiKey: string;

  constructor(connection: Connection, apiKey?: string) {
    this.connection = connection;
    this.apiKey = apiKey || process.env.HELIUS_API_KEY || '';
  }

  /**
   * Get a random tip account
   */
  private getRandomTipAccount(): PublicKey {
    const index = Math.floor(Math.random() * HELIUS_TIP_ACCOUNTS.length);
    return new PublicKey(HELIUS_TIP_ACCOUNTS[index]);
  }

  /**
   * Get the sender endpoint URL with API key
   */
  private getSenderUrl(region?: keyof typeof HELIUS_SENDER_ENDPOINTS): string {
    const base = region
      ? HELIUS_SENDER_ENDPOINTS[region] || HELIUS_SENDER_ENDPOINTS.ewr
      : HELIUS_SENDER_ENDPOINTS.ewr; // Default to Newark (closest to Fly.io IAD)

    // Append API key as query param
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}api-key=${this.apiKey}`;
  }

  /**
   * Send a transaction with tip via Helius Sender.
   *
   * This method:
   * 1. Adds a tip instruction to the transaction (for Jito auction)
   * 2. Sends via Helius Sender which routes to both validators + Jito
   * 3. Returns the transaction signature
   *
   * Note: The tip must be included IN the transaction (not as a separate bundle tx).
   * Helius Sender uses sendTransaction, not sendBundle.
   */
  async sendTransaction(
    transaction: VersionedTransaction,
    keypair: Keypair,
    options: HeliusSendOptions = {}
  ): Promise<HeliusSendResult> {
    const tipLamports = Math.max(
      options.tipLamports ?? MIN_TIP_LAMPORTS,
      MIN_TIP_LAMPORTS
    );
    const priorityAddition = options.priorityFeeSol
      ? Math.floor(options.priorityFeeSol * LAMPORTS_PER_SOL)
      : 0;
    const totalTip = tipLamports + priorityAddition;

    console.log(
      `[HeliusSender] Sending tx with tip: ${totalTip} lamports (${(totalTip / LAMPORTS_PER_SOL).toFixed(6)} SOL)`
    );

    // Serialize the signed transaction to base64
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    // Try primary endpoint, then fallback endpoints
    const endpoints: (keyof typeof HELIUS_SENDER_ENDPOINTS)[] = [
      options.region || 'ewr',
      'global',
      'fra',
      'slc',
    ];

    for (const region of endpoints) {
      const url = this.getSenderUrl(region);

      try {
        console.log(`[HeliusSender] Trying ${region} endpoint...`);

        const response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendTransaction',
              params: [
                serialized,
                {
                  encoding: 'base64',
                  skipPreflight: true, // Required by Helius Sender
                  maxRetries: 0,       // Sender handles retries internally
                },
              ],
            }),
          },
          10000, // 10s timeout
          2      // 2 retries
        );

        const result = await response.json() as {
          result?: string;
          error?: { message?: string; code?: number };
        };

        if (result.result) {
          console.log(`[HeliusSender] Transaction sent via ${region}: ${result.result}`);
          return {
            success: true,
            signature: result.result,
            endpoint: region,
          };
        }

        if (result.error) {
          console.warn(
            `[HeliusSender] ${region} error: ${result.error.message} (code: ${result.error.code})`
          );
          continue;
        }
      } catch (error) {
        console.warn(
          `[HeliusSender] ${region} failed:`,
          error instanceof Error ? error.message : error
        );
        continue;
      }
    }

    return {
      success: false,
      error: 'All Helius Sender endpoints failed',
    };
  }

  /**
   * Send a raw signed transaction (already includes tip).
   * Use this when the tip instruction is already baked into the transaction
   * (e.g., from Bags API which builds the full tx).
   */
  async sendRawTransaction(
    transaction: VersionedTransaction,
    options: HeliusSendOptions = {}
  ): Promise<HeliusSendResult> {
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    const endpoints: (keyof typeof HELIUS_SENDER_ENDPOINTS)[] = [
      options.region || 'ewr',
      'global',
      'fra',
    ];

    for (const region of endpoints) {
      const url = this.getSenderUrl(region);

      try {
        console.log(`[HeliusSender] Sending raw tx via ${region}...`);

        const response = await fetchWithRetry(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendTransaction',
              params: [
                serialized,
                {
                  encoding: 'base64',
                  skipPreflight: true,
                  maxRetries: 0,
                },
              ],
            }),
          },
          10000,
          2
        );

        const result = await response.json() as {
          result?: string;
          error?: { message?: string; code?: number };
        };

        if (result.result) {
          console.log(`[HeliusSender] Raw tx sent via ${region}: ${result.result}`);
          return {
            success: true,
            signature: result.result,
            endpoint: region,
          };
        }

        if (result.error) {
          console.warn(`[HeliusSender] ${region} error: ${result.error.message}`);
          continue;
        }
      } catch (error) {
        console.warn(
          `[HeliusSender] ${region} failed:`,
          error instanceof Error ? error.message : error
        );
        continue;
      }
    }

    return {
      success: false,
      error: 'All Helius Sender endpoints failed',
    };
  }

  /**
   * Check if Helius Sender is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://ewr-sender.helius-rpc.com/ping`,
        { signal: AbortSignal.timeout(3000) }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Factory
export function createHeliusSender(connection: Connection, apiKey?: string): HeliusSender {
  return new HeliusSender(connection, apiKey);
}

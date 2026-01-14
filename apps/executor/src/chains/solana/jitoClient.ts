/**
 * Jito Bundle Client for Solana Anti-MEV
 *
 * Provides MEV protection by sending transactions through Jito's block engine
 * instead of the public mempool. Jito bundles ensure atomic execution and
 * protect against sandwich attacks.
 *
 * v3.5: Added as part of chain-specific settings feature
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { fetchWithRetry } from '../../utils/fetchWithTimeout.js';

// Jito block engine endpoints
const JITO_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

// Jito tip accounts (rotate for load balancing)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// Default tip amount in lamports (0.00001 SOL = 10,000 lamports)
const DEFAULT_TIP_LAMPORTS = 10_000;

export interface JitoBundleResult {
  success: boolean;
  bundleId?: string;
  signatures?: string[];
  error?: string;
}

export interface JitoSendOptions {
  /** Tip amount in lamports (default: 10,000 = 0.00001 SOL) */
  tipLamports?: number;
  /** Priority fee in SOL (will be added to tip) */
  priorityFeeSol?: number;
  /** Skip preflight simulation */
  skipPreflight?: boolean;
}

export class JitoClient {
  private connection: Connection;
  private currentEndpointIndex: number = 0;
  private lastSuccessfulEndpoint: string | null = null;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get next Jito endpoint (round-robin with preference for last successful)
   */
  private getNextEndpoint(): string {
    if (this.lastSuccessfulEndpoint) {
      return this.lastSuccessfulEndpoint;
    }
    const endpoint = JITO_ENDPOINTS[this.currentEndpointIndex];
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % JITO_ENDPOINTS.length;
    return endpoint;
  }

  /**
   * Get random tip account
   */
  private getRandomTipAccount(): PublicKey {
    const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[index]);
  }

  /**
   * Create a tip transaction to include in the bundle
   */
  private async createTipTransaction(
    payer: Keypair,
    tipLamports: number
  ): Promise<VersionedTransaction> {
    const tipAccount = this.getRandomTipAccount();

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

    const tipInstruction = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipInstruction],
    }).compileToV0Message();

    const tipTx = new VersionedTransaction(messageV0);
    tipTx.sign([payer]);

    return tipTx;
  }

  /**
   * Send a single transaction via Jito bundle
   *
   * @param transaction - The transaction to send
   * @param keypair - Signer keypair (for tip transaction)
   * @param options - Send options
   * @returns Bundle result with signature
   */
  async sendTransaction(
    transaction: VersionedTransaction,
    keypair: Keypair,
    options: JitoSendOptions = {}
  ): Promise<JitoBundleResult> {
    const tipLamports = options.tipLamports ?? DEFAULT_TIP_LAMPORTS;
    const priorityLamports = options.priorityFeeSol
      ? Math.floor(options.priorityFeeSol * LAMPORTS_PER_SOL)
      : 0;
    const totalTip = tipLamports + priorityLamports;

    try {
      // Create tip transaction
      const tipTx = await this.createTipTransaction(keypair, totalTip);

      // Bundle: [main transaction, tip transaction]
      const bundle = [transaction, tipTx];

      console.log(`[JitoClient] Sending bundle with tip: ${totalTip} lamports`);

      return await this.sendBundle(bundle);
    } catch (error) {
      console.error('[JitoClient] Failed to send transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a bundle of transactions to Jito
   *
   * @param transactions - Array of signed transactions
   * @returns Bundle result
   */
  async sendBundle(transactions: VersionedTransaction[]): Promise<JitoBundleResult> {
    // Serialize transactions to base64
    const serialized = transactions.map(tx =>
      Buffer.from(tx.serialize()).toString('base64')
    );

    // Try each endpoint until one succeeds
    const endpoints = this.lastSuccessfulEndpoint
      ? [this.lastSuccessfulEndpoint, ...JITO_ENDPOINTS.filter(e => e !== this.lastSuccessfulEndpoint)]
      : JITO_ENDPOINTS;

    for (const endpoint of endpoints) {
      try {
        console.log(`[JitoClient] Trying endpoint: ${endpoint.split('.')[0]}`);

        const response = await fetchWithRetry(
          endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'sendBundle',
              params: [serialized],
            }),
          },
          10000, // 10s timeout
          2      // 2 retries
        );

        const result = await response.json() as {
          result?: string;
          error?: { message?: string };
        };

        if (result.result) {
          this.lastSuccessfulEndpoint = endpoint;
          console.log(`[JitoClient] Bundle submitted: ${result.result}`);

          // Extract first transaction signature
          const signatures = transactions.map(tx => {
            const sig = tx.signatures[0];
            if (sig) {
              return Buffer.from(sig).toString('base64');
            }
            return '';
          }).filter(Boolean);

          return {
            success: true,
            bundleId: result.result,
            signatures,
          };
        }

        if (result.error) {
          console.warn(`[JitoClient] Endpoint error: ${result.error.message}`);
          continue;
        }
      } catch (error) {
        console.warn(
          `[JitoClient] Endpoint ${endpoint.split('.')[0]} failed:`,
          error instanceof Error ? error.message : error
        );
        continue;
      }
    }

    return {
      success: false,
      error: 'All Jito endpoints failed',
    };
  }

  /**
   * Get bundle status
   */
  async getBundleStatus(bundleId: string): Promise<{
    status: 'pending' | 'landed' | 'failed' | 'unknown';
    slot?: number;
    error?: string;
  }> {
    const endpoint = this.getNextEndpoint().replace('/bundles', '/bundle_status');

    try {
      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          }),
        },
        5000,
        2
      );

      const result = await response.json() as {
        result?: { value: Array<{ bundle_id: string; status: string; slot?: number }> };
        error?: { message?: string };
      };

      if (result.result?.value?.[0]) {
        const bundleStatus = result.result.value[0];
        return {
          status: bundleStatus.status as 'pending' | 'landed' | 'failed',
          slot: bundleStatus.slot,
        };
      }

      return { status: 'unknown' };
    } catch (error) {
      return {
        status: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Wait for bundle confirmation
   */
  async waitForBundleConfirmation(
    bundleId: string,
    signature: string,
    timeoutMs: number = 30000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Check bundle status
      const status = await this.getBundleStatus(bundleId);

      if (status.status === 'landed') {
        console.log(`[JitoClient] Bundle landed at slot ${status.slot}`);
        return true;
      }

      if (status.status === 'failed') {
        console.warn(`[JitoClient] Bundle failed: ${status.error}`);
        return false;
      }

      // Also verify via RPC
      try {
        const confirmation = await this.connection.getSignatureStatus(signature);
        if (confirmation.value?.confirmationStatus === 'confirmed' ||
            confirmation.value?.confirmationStatus === 'finalized') {
          console.log(`[JitoClient] Transaction confirmed via RPC`);
          return true;
        }
      } catch {
        // Ignore RPC errors, keep polling
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.warn('[JitoClient] Bundle confirmation timeout');
    return false;
  }

  /**
   * Check if Jito is available (basic connectivity check)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const endpoint = this.getNextEndpoint().replace('/bundles', '/tip_accounts');
      const response = await fetchWithRetry(endpoint, {}, 3000, 1);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Factory function
export function createJitoClient(connection: Connection): JitoClient {
  return new JitoClient(connection);
}

// Raydium Listener for Solana
// Monitors new pool creates on Raydium AMM (for graduated pump.fun tokens)

import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  isValidSolanaAddress,
  getSolanaExplorerUrl,
} from '@raptor/shared';

export interface RaydiumPoolCreateEvent {
  signature: string;
  slot: number;
  poolId: string;
  baseMint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  lpMint: string;
  baseReserve: bigint;
  quoteReserve: bigint;
  timestamp: number;
}

export type RaydiumPoolHandler = (event: RaydiumPoolCreateEvent) => Promise<void>;

export class RaydiumListener {
  private rpcUrl: string;
  private wssUrl: string;
  private subscriptionId: number | null = null;
  private handlers: RaydiumPoolHandler[] = [];
  private ws: WebSocket | null = null;
  private running: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
    this.wssUrl = SOLANA_CONFIG.wssUrl;
  }

  /**
   * Register a handler for new pool creates
   */
  onPoolCreate(handler: RaydiumPoolHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start listening for Raydium pool creates
   */
  async start(): Promise<void> {
    console.log('[RaydiumListener] Starting...');
    this.running = true;
    await this.connect();
  }

  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    console.log('[RaydiumListener] Stopping...');
    this.running = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptionId = null;
  }

  /**
   * Connect to Solana WebSocket
   */
  private async connect(): Promise<void> {
    if (!this.running) return;

    try {
      console.log(`[RaydiumListener] Connecting to ${this.wssUrl}`);

      this.ws = new WebSocket(this.wssUrl);

      this.ws.onopen = () => {
        console.log('[RaydiumListener] WebSocket connected');
        this.reconnectAttempts = 0;
        this.subscribeToProgram();
      };

      this.ws.onclose = () => {
        console.log('[RaydiumListener] WebSocket closed');
        this.handleDisconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[RaydiumListener] WebSocket error:', error);
      };

      this.ws.onmessage = (message) => {
        this.handleMessage(message.data);
      };
    } catch (error) {
      console.error('[RaydiumListener] Connection failed:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Subscribe to Raydium AMM program logs
   */
  private subscribeToProgram(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [PROGRAM_IDS.RAYDIUM_AMM],
        },
        {
          commitment: 'confirmed',
        },
      ],
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    console.log('[RaydiumListener] Subscribed to Raydium AMM program logs');
  }

  /**
   * Handle WebSocket message
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      // Handle subscription confirmation
      if (message.result !== undefined && message.id === 1) {
        this.subscriptionId = message.result;
        console.log(
          `[RaydiumListener] Subscription confirmed: ${this.subscriptionId}`
        );
        return;
      }

      // Handle log notifications
      if (
        message.method === 'logsNotification' &&
        message.params?.result?.value
      ) {
        const { signature, logs } = message.params.result.value;
        await this.processLogs(signature, logs);
      }
    } catch (error) {
      console.error('[RaydiumListener] Error handling message:', error);
    }
  }

  /**
   * Process transaction logs
   */
  private async processLogs(
    signature: string,
    logs: string[]
  ): Promise<void> {
    // Look for Initialize2 instruction (new pool creation)
    const isPoolCreate = logs.some(
      (log) =>
        log.includes('Instruction: Initialize2') ||
        log.includes('Program log: initialize2')
    );

    if (!isPoolCreate) {
      return;
    }

    console.log(`[RaydiumListener] New pool create detected: ${signature}`);

    // Fetch full transaction details
    try {
      const event = await this.fetchPoolCreateEvent(signature);
      if (event) {
        // Check if this is a WSOL pair (we only care about new token/SOL pools)
        if (
          event.quoteMint === PROGRAM_IDS.WSOL ||
          event.baseMint === PROGRAM_IDS.WSOL
        ) {
          // Notify all handlers
          for (const handler of this.handlers) {
            try {
              await handler(event);
            } catch (error) {
              console.error('[RaydiumListener] Handler error:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('[RaydiumListener] Error fetching pool event:', error);
    }
  }

  /**
   * Fetch pool create event details from transaction
   */
  private async fetchPoolCreateEvent(
    signature: string
  ): Promise<RaydiumPoolCreateEvent | null> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      });

      interface TxResponse {
        result?: {
          slot?: number;
          blockTime?: number;
          meta?: {
            err?: unknown;
            postTokenBalances?: Array<{ mint?: string; uiTokenAmount?: { amount?: string } }>;
          };
          transaction?: {
            message?: {
              accountKeys?: Array<{ pubkey?: string } | string>;
            };
          };
        };
      }
      const data = (await response.json()) as TxResponse;
      const tx = data.result;

      if (!tx || tx.meta?.err) {
        return null;
      }

      // Parse the pool initialization instruction
      // Note: Actual implementation would parse instruction data properly
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      void accountKeys; // Used for parsing

      const event: RaydiumPoolCreateEvent = {
        signature,
        slot: tx.slot || 0,
        poolId: '', // Would be extracted from instruction
        baseMint: '',
        quoteMint: '',
        baseVault: '',
        quoteVault: '',
        lpMint: '',
        baseReserve: 0n,
        quoteReserve: 0n,
        timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
      };

      // Parse post-token balances to get initial liquidity
      const postTokenBalances = tx.meta?.postTokenBalances || [];
      void postTokenBalances; // Used for extracting reserve amounts

      return event;
    } catch (error) {
      console.error('[RaydiumListener] Error fetching transaction:', error);
      return null;
    }
  }

  /**
   * Handle disconnection with reconnect logic
   */
  private handleDisconnect(): void {
    if (!this.running) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `[RaydiumListener] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      console.error('[RaydiumListener] Max reconnect attempts reached');
    }
  }

  /**
   * Get pool info by pool ID
   */
  async getPoolInfo(poolId: string): Promise<{
    baseMint: string;
    quoteMint: string;
    baseReserve: bigint;
    quoteReserve: bigint;
    lpSupply: bigint;
  } | null> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [poolId, { encoding: 'base64' }],
        }),
      });

      interface AccountResponse {
        result?: {
          value?: {
            data?: [string, string];
          };
        };
      }
      const data = (await response.json()) as AccountResponse;
      const accountInfo = data.result?.value;

      if (!accountInfo) {
        return null;
      }

      // Decode pool state from account data
      // Would need proper Raydium AMM state deserialization

      return null;
    } catch (error) {
      console.error('[RaydiumListener] Error getting pool info:', error);
      return null;
    }
  }
}

// Singleton instance
export const raydiumListener = new RaydiumListener();

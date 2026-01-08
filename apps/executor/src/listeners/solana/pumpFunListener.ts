// Pump.fun Listener for Solana
// Monitors new token creates on pump.fun bonding curves

import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  isValidSolanaAddress,
  getPumpFunUrl,
  getSolanaExplorerUrl,
} from '@raptor/shared';

export interface PumpFunCreateEvent {
  signature: string;
  slot: number;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurve: string;
  creator: string;
  timestamp: number;
}

export type PumpFunCreateHandler = (event: PumpFunCreateEvent) => Promise<void>;

export class PumpFunListener {
  private rpcUrl: string;
  private wssUrl: string;
  private subscriptionId: number | null = null;
  private handlers: PumpFunCreateHandler[] = [];
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
   * Register a handler for new token creates
   */
  onTokenCreate(handler: PumpFunCreateHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start listening for pump.fun token creates
   */
  async start(): Promise<void> {
    console.log('[PumpFunListener] Starting...');
    this.running = true;
    await this.connect();
  }

  /**
   * Stop listening
   */
  async stop(): Promise<void> {
    console.log('[PumpFunListener] Stopping...');
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
      console.log(`[PumpFunListener] Connecting to ${this.wssUrl}`);

      // Note: In Node.js, you'd use the 'ws' package
      // This is a simplified version for the structure
      this.ws = new WebSocket(this.wssUrl);

      this.ws.onopen = () => {
        console.log('[PumpFunListener] WebSocket connected');
        this.reconnectAttempts = 0;
        this.subscribeToProgram();
      };

      this.ws.onclose = () => {
        console.log('[PumpFunListener] WebSocket closed');
        this.handleDisconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[PumpFunListener] WebSocket error:', error);
      };

      this.ws.onmessage = (message) => {
        this.handleMessage(message.data);
      };
    } catch (error) {
      console.error('[PumpFunListener] Connection failed:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Subscribe to pump.fun program logs
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
          mentions: [PROGRAM_IDS.PUMP_FUN],
        },
        {
          commitment: 'confirmed',
        },
      ],
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    console.log('[PumpFunListener] Subscribed to pump.fun program logs');
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
          `[PumpFunListener] Subscription confirmed: ${this.subscriptionId}`
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
      console.error('[PumpFunListener] Error handling message:', error);
    }
  }

  /**
   * Process transaction logs
   */
  private async processLogs(
    signature: string,
    logs: string[]
  ): Promise<void> {
    // Look for Create instruction
    const isCreate = logs.some(
      (log) =>
        log.includes('Instruction: Create') ||
        log.includes('Program log: Create')
    );

    if (!isCreate) {
      return;
    }

    console.log(`[PumpFunListener] New token create detected: ${signature}`);

    // Fetch full transaction details
    try {
      const event = await this.fetchCreateEvent(signature);
      if (event) {
        // Notify all handlers
        for (const handler of this.handlers) {
          try {
            await handler(event);
          } catch (error) {
            console.error('[PumpFunListener] Handler error:', error);
          }
        }
      }
    } catch (error) {
      console.error('[PumpFunListener] Error fetching create event:', error);
    }
  }

  /**
   * Fetch create event details from transaction
   */
  private async fetchCreateEvent(
    signature: string
  ): Promise<PumpFunCreateEvent | null> {
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
          meta?: { err?: unknown };
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

      // Parse the create instruction
      // Note: Actual implementation would parse the instruction data
      // to extract mint, name, symbol, etc.

      const firstKey = tx.transaction?.message?.accountKeys?.[0];
      const creator = typeof firstKey === 'string' ? firstKey : (firstKey?.pubkey || '');

      const event: PumpFunCreateEvent = {
        signature,
        slot: tx.slot || 0,
        mint: '', // Would be extracted from instruction
        name: '',
        symbol: '',
        uri: '',
        bondingCurve: '',
        creator,
        timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
      };

      // Parse account keys to find the mint
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      for (const key of accountKeys) {
        const pubkey = typeof key === 'string' ? key : (key.pubkey || '');
        if (isValidSolanaAddress(pubkey)) {
          // The new mint is typically one of the first accounts
          // Would need proper instruction parsing in production
        }
      }

      return event;
    } catch (error) {
      console.error('[PumpFunListener] Error fetching transaction:', error);
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
        `[PumpFunListener] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      console.error('[PumpFunListener] Max reconnect attempts reached');
    }
  }
}

// Singleton instance
export const pumpFunListener = new PumpFunListener();

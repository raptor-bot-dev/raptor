// Raydium Listener for Solana
// Monitors new pool creates on Raydium AMM (for graduated pump.fun tokens)

import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  isValidSolanaAddress,
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

// Initialize2 instruction discriminator for Raydium AMM
const INITIALIZE2_DISCRIMINATOR = Buffer.from([1]); // Raydium uses simple u8 discriminators

export class RaydiumListener {
  private rpcUrl: string;
  private wssUrl: string;
  private connection: Connection;
  private subscriptionId: number | null = null;
  private handlers: RaydiumPoolHandler[] = [];
  private ws: WebSocket | null = null;
  private running: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 3000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pendingPings: number = 0;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
    this.wssUrl = SOLANA_CONFIG.wssUrl;
    this.connection = new Connection(this.rpcUrl, 'confirmed');
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

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

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

      this.ws.on('open', () => {
        console.log('[RaydiumListener] WebSocket connected');
        this.reconnectAttempts = 0;
        this.pendingPings = 0;
        this.subscribeToProgram();
        this.startHeartbeat();
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[RaydiumListener] WebSocket closed: ${code} - ${reason.toString()}`);
        this.stopHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[RaydiumListener] WebSocket error:', error.message);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('pong', () => {
        this.pendingPings = 0;
      });
    } catch (error) {
      console.error('[RaydiumListener] Connection failed:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this.pendingPings >= 2) {
        console.warn('[RaydiumListener] Connection unresponsive, reconnecting...');
        this.ws.terminate();
        return;
      }

      this.ws.ping();
      this.pendingPings++;
    }, 30000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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
        const { signature, logs, err } = message.params.result.value;

        // Skip failed transactions
        if (err) return;

        await this.processLogs(signature, logs || []);
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
        log.includes('Program log: initialize2') ||
        log.includes('Program log: ray_log')
    );

    if (!isPoolCreate) {
      return;
    }

    console.log(`[RaydiumListener] New pool create detected: ${signature}`);

    // Fetch full transaction details
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const event = await this.fetchPoolCreateEvent(signature);
        if (event) {
          // Check if this is a WSOL pair (we only care about new token/SOL pools)
          if (
            event.quoteMint === PROGRAM_IDS.WSOL ||
            event.baseMint === PROGRAM_IDS.WSOL
          ) {
            console.log(`[RaydiumListener] SOL pair pool: ${event.poolId}`);

            // Notify all handlers
            for (const handler of this.handlers) {
              try {
                await handler(event);
              } catch (error) {
                console.error('[RaydiumListener] Handler error:', error);
              }
            }
          }
          return;
        }
      } catch (error) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    console.warn(`[RaydiumListener] Failed to parse pool event: ${signature}`);
  }

  /**
   * Fetch pool create event details from transaction
   */
  private async fetchPoolCreateEvent(
    signature: string
  ): Promise<RaydiumPoolCreateEvent | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || tx.meta?.err) {
        return null;
      }

      const message = tx.transaction.message;
      const accountKeys = message.staticAccountKeys || [];

      // Find the Raydium AMM instruction
      const instructions = message.compiledInstructions || [];

      for (const ix of instructions) {
        const programId = accountKeys[ix.programIdIndex];
        if (programId?.toBase58() === PROGRAM_IDS.RAYDIUM_AMM) {
          // Raydium AMM Initialize2 has many accounts
          // Layout varies but typically:
          // [0] = tokenProgram, [1] = splAssociatedTokenAccount, [2] = systemProgram,
          // [3] = rent, [4] = ammId, [5] = ammAuthority, [6] = ammOpenOrders,
          // [7] = lpMint, [8] = coinMint, [9] = pcMint, [10] = coinVault,
          // [11] = pcVault, [12] = targetOrders, [13] = config, [14] = feeDestination,
          // [15] = marketProgram, [16] = market, [17] = userWallet, [18] = userTokenCoin,
          // [19] = userTokenPc, [20] = userTokenLp
          const accountIndexes = ix.accountKeyIndexes || [];

          if (accountIndexes.length >= 12) {
            const poolId = accountKeys[accountIndexes[4]]?.toBase58() || '';
            const lpMint = accountKeys[accountIndexes[7]]?.toBase58() || '';
            const baseMint = accountKeys[accountIndexes[8]]?.toBase58() || '';
            const quoteMint = accountKeys[accountIndexes[9]]?.toBase58() || '';
            const baseVault = accountKeys[accountIndexes[10]]?.toBase58() || '';
            const quoteVault = accountKeys[accountIndexes[11]]?.toBase58() || '';

            // Parse initial reserves from postTokenBalances
            let baseReserve = 0n;
            let quoteReserve = 0n;

            const postTokenBalances = tx.meta?.postTokenBalances || [];
            for (const balance of postTokenBalances) {
              const mint = balance.mint;
              const amount = BigInt(balance.uiTokenAmount?.amount || '0');
              if (mint === baseMint) baseReserve = amount;
              if (mint === quoteMint) quoteReserve = amount;
            }

            return {
              signature,
              slot: tx.slot,
              poolId,
              baseMint,
              quoteMint,
              baseVault,
              quoteVault,
              lpMint,
              baseReserve,
              quoteReserve,
              timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
            };
          }
        }
      }

      return null;
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
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

      console.log(
        `[RaydiumListener] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error('[RaydiumListener] Max reconnect attempts reached');
      // Reset and try again after a longer delay
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connect();
      }, 60000);
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
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolId));

      if (!accountInfo) {
        return null;
      }

      // Decode Raydium AMM pool state
      // This requires proper state deserialization - simplified here
      // In production, would use proper Raydium SDK or manual deserialization

      return null;
    } catch (error) {
      console.error('[RaydiumListener] Error getting pool info:', error);
      return null;
    }
  }

  /**
   * Check if listener is running
   */
  isRunning(): boolean {
    return this.running && this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const raydiumListener = new RaydiumListener();

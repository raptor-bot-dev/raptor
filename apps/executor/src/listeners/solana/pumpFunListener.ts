// Pump.fun Listener for Solana
// Monitors new token creates on pump.fun bonding curves

import WebSocket from 'ws';
import { PublicKey, Connection } from '@solana/web3.js';
import {
  SOLANA_CONFIG,
  PROGRAM_IDS,
  isValidSolanaAddress,
} from '@raptor/shared';
import { deriveBondingCurvePDA } from '../../chains/solana/pumpFun.js';

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

// pump.fun Create instruction discriminator
const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

export class PumpFunListener {
  private rpcUrl: string;
  private wssUrl: string;
  private connection: Connection;
  private subscriptionId: number | null = null;
  private handlers: PumpFunCreateHandler[] = [];
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
      console.log(`[PumpFunListener] Connecting to ${this.wssUrl}`);

      this.ws = new WebSocket(this.wssUrl);

      this.ws.on('open', () => {
        console.log('[PumpFunListener] WebSocket connected');
        this.reconnectAttempts = 0;
        this.pendingPings = 0;
        this.subscribeToProgram();
        this.startHeartbeat();
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[PumpFunListener] WebSocket closed: ${code} - ${reason.toString()}`);
        this.stopHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[PumpFunListener] WebSocket error:', error.message);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('pong', () => {
        this.pendingPings = 0;
      });
    } catch (error) {
      console.error('[PumpFunListener] Connection failed:', error);
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
        console.warn('[PumpFunListener] Connection unresponsive, reconnecting...');
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
        const { signature, logs, err } = message.params.result.value;

        // Skip failed transactions
        if (err) return;

        await this.processLogs(signature, logs || []);
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
    // Look for Create instruction - pump.fun uses specific log patterns
    const isCreate = logs.some(
      (log) =>
        log.includes('Program log: Instruction: Create') ||
        log.includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke') &&
        logs.some(l => l.includes('InitializeMint'))
    );

    if (!isCreate) {
      return;
    }

    console.log(`[PumpFunListener] New token create detected: ${signature}`);

    // Fetch full transaction details with retries
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const event = await this.fetchCreateEvent(signature);
        if (event && event.mint) {
          console.log(`[PumpFunListener] Token: ${event.symbol} (${event.mint})`);

          // Notify all handlers
          for (const handler of this.handlers) {
            try {
              await handler(event);
            } catch (error) {
              console.error('[PumpFunListener] Handler error:', error);
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

    console.warn(`[PumpFunListener] Failed to parse create event: ${signature}`);
  }

  /**
   * Fetch create event details from transaction
   */
  private async fetchCreateEvent(
    signature: string
  ): Promise<PumpFunCreateEvent | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || tx.meta?.err) {
        return null;
      }

      // Get account keys from the transaction
      const message = tx.transaction.message;
      const accountKeys = message.staticAccountKeys || [];

      // Find the pump.fun program instruction
      const instructions = message.compiledInstructions || [];
      let createInstructionData: Buffer | null = null;
      let createInstructionAccounts: number[] = [];

      for (const ix of instructions) {
        const programId = accountKeys[ix.programIdIndex];
        if (programId?.toBase58() === PROGRAM_IDS.PUMP_FUN) {
          const data = Buffer.from(ix.data);
          // Check for Create discriminator
          if (data.slice(0, 8).equals(CREATE_DISCRIMINATOR)) {
            createInstructionData = data;
            createInstructionAccounts = [...ix.accountKeyIndexes];
            break;
          }
        }
      }

      if (!createInstructionData || createInstructionAccounts.length < 3) {
        return null;
      }

      // Parse instruction data
      // Layout: discriminator (8) + name (string) + symbol (string) + uri (string)
      let offset = 8;

      // Read name (length-prefixed string)
      const nameLen = createInstructionData.readUInt32LE(offset);
      offset += 4;
      const name = createInstructionData.slice(offset, offset + nameLen).toString('utf8');
      offset += nameLen;

      // Read symbol (length-prefixed string)
      const symbolLen = createInstructionData.readUInt32LE(offset);
      offset += 4;
      const symbol = createInstructionData.slice(offset, offset + symbolLen).toString('utf8');
      offset += symbolLen;

      // Read uri (length-prefixed string)
      const uriLen = createInstructionData.readUInt32LE(offset);
      offset += 4;
      const uri = createInstructionData.slice(offset, offset + uriLen).toString('utf8');

      // Extract addresses from account keys
      // pump.fun Create instruction account layout:
      // [0] = mint, [1] = mintAuthority, [2] = bondingCurve, [3] = associatedBondingCurve,
      // [4] = global, [5] = mplTokenMetadata, [6] = metadata, [7] = user, ...
      const mint = accountKeys[createInstructionAccounts[0]]?.toBase58() || '';
      const bondingCurve = accountKeys[createInstructionAccounts[2]]?.toBase58() || '';
      const creator = accountKeys[createInstructionAccounts[7]]?.toBase58() || '';

      return {
        signature,
        slot: tx.slot,
        mint,
        name,
        symbol,
        uri,
        bondingCurve,
        creator,
        timestamp: tx.blockTime || Math.floor(Date.now() / 1000),
      };
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
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

      console.log(
        `[PumpFunListener] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error('[PumpFunListener] Max reconnect attempts reached');
      // Reset and try again after a longer delay
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connect();
      }, 60000);
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
export const pumpFunListener = new PumpFunListener();

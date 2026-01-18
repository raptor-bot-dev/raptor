// =============================================================================
// RAPTOR v3.1 Pump.fun Monitor
// WebSocket listener for new token creates on pump.fun
// =============================================================================

import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import { SOLANA_CONFIG, PROGRAM_IDS, isValidSolanaAddress } from '@raptor/shared';

export interface PumpFunEvent {
  signature: string;
  slot: number;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurve: string;
  creator: string;
  timestamp: number;
  /** True if token was created in mayhem mode (November 2025 pump.fun update) */
  isMayhemMode: boolean;
}

export type PumpFunEventHandler = (event: PumpFunEvent) => Promise<void>;

// pump.fun Create instruction discriminators
// Legacy: sha256("global:create")[0..8]
const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
// Current (2025+): sha256("global:create_v2")[0..8]
const CREATE_V2_DISCRIMINATOR = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

export class PumpFunMonitor {
  private rpcUrl: string;
  private wssUrl: string;
  private connection: Connection;
  private ws: WebSocket | null = null;
  private running = false;
  private handlers: PumpFunEventHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pendingPings = 0;

  constructor() {
    this.rpcUrl = SOLANA_CONFIG.rpcUrl;
    this.wssUrl = SOLANA_CONFIG.wssUrl;
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  /**
   * Register a handler for new token creates
   */
  onTokenCreate(handler: PumpFunEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    console.log('[PumpFunMonitor] Starting...');
    this.running = true;
    await this.connect();
  }

  /**
   * Stop the monitor
   */
  async stop(): Promise<void> {
    console.log('[PumpFunMonitor] Stopping...');
    this.running = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Connect to Solana WebSocket
   */
  private async connect(): Promise<void> {
    if (!this.running) return;

    try {
      console.log(`[PumpFunMonitor] Connecting to ${this.wssUrl}`);

      this.ws = new WebSocket(this.wssUrl);

      this.ws.on('open', () => {
        console.log('[PumpFunMonitor] WebSocket connected');
        this.reconnectAttempts = 0;
        this.pendingPings = 0;
        this.subscribe();
        this.startHeartbeat();
      });

      this.ws.on('close', (code, reason) => {
        console.log(
          `[PumpFunMonitor] WebSocket closed: ${code} - ${reason.toString()}`
        );
        this.stopHeartbeat();
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[PumpFunMonitor] WebSocket error:', error.message);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('pong', () => {
        this.pendingPings = 0;
      });
    } catch (error) {
      console.error('[PumpFunMonitor] Connection failed:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Subscribe to pump.fun program logs
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [PROGRAM_IDS.PUMP_FUN] },
        { commitment: 'confirmed' },
      ],
    };

    this.ws.send(JSON.stringify(message));
    console.log('[PumpFunMonitor] Subscribed to pump.fun logs');
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (this.pendingPings >= 2) {
        console.warn('[PumpFunMonitor] Connection unresponsive, reconnecting');
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
   * Handle WebSocket message
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      // Subscription confirmation
      if (message.result !== undefined && message.id === 1) {
        console.log(`[PumpFunMonitor] Subscription ID: ${message.result}`);
        return;
      }

      // Log notification
      if (
        message.method === 'logsNotification' &&
        message.params?.result?.value
      ) {
        const { signature, logs, err } = message.params.result.value;
        if (err) return;

        await this.processLogs(signature, logs || []);
      }
    } catch (error) {
      console.error('[PumpFunMonitor] Message handling error:', error);
    }
  }

  /**
   * Process transaction logs for Create events
   */
  private async processLogs(
    signature: string,
    logs: string[]
  ): Promise<void> {
    // Look for Create instruction
    const isCreate = logs.some(
      (log) =>
        log.includes('Program log: Instruction: Create') ||
        (log.includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') &&
          logs.some((l) => l.includes('InitializeMint')))
    );

    if (!isCreate) return;

    console.log(`[PumpFunMonitor] New token detected: ${signature}`);

    // Fetch transaction details with retries
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const event = await this.fetchCreateEvent(signature);
        if (event && event.mint) {
          console.log(`[PumpFunMonitor] Token: ${event.symbol} (${event.mint})`);

          // Notify handlers
          for (const handler of this.handlers) {
            try {
              await handler(event);
            } catch (error) {
              console.error('[PumpFunMonitor] Handler error:', error);
            }
          }
          return;
        }
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    console.warn(`[PumpFunMonitor] Failed to parse: ${signature}`);
  }

  /**
   * Fetch Create event details from transaction
   */
  private async fetchCreateEvent(
    signature: string
  ): Promise<PumpFunEvent | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx) {
        console.debug(`[PumpFunMonitor] TX not found: ${signature.slice(0, 20)}...`);
        return null;
      }
      if (tx.meta?.err) {
        console.debug(`[PumpFunMonitor] TX has error: ${signature.slice(0, 20)}...`);
        return null;
      }

      const message = tx.transaction.message;

      // Handle both versioned (v0) and legacy transactions
      // Versioned: staticAccountKeys, compiledInstructions
      // Legacy: accountKeys, instructions
      const isVersioned = 'staticAccountKeys' in message;

      // For versioned transactions, we need to include loaded addresses from ALTs
      let accountKeys: PublicKey[];
      if (isVersioned) {
        const staticKeys = (message as { staticAccountKeys: PublicKey[] }).staticAccountKeys;
        // Include addresses loaded from Address Lookup Tables
        const loadedWritable = tx.meta?.loadedAddresses?.writable || [];
        const loadedReadonly = tx.meta?.loadedAddresses?.readonly || [];
        accountKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
      } else {
        accountKeys = (message as { accountKeys: PublicKey[] }).accountKeys || [];
      }

      // Get instructions - handle both versioned and legacy format
      type LegacyInstruction = { programIdIndex: number; accounts: number[]; data: string };
      type VersionedInstruction = { programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array };

      const rawInstructions = isVersioned
        ? (message as { compiledInstructions: VersionedInstruction[] }).compiledInstructions || []
        : (message as { instructions: LegacyInstruction[] }).instructions || [];

      console.log(`[PumpFunMonitor] TX ${signature.slice(0, 12)}... versioned=${isVersioned}, ${rawInstructions.length} ix, ${accountKeys.length} accounts`);

      // Find pump.fun Create instruction
      let createData: Buffer | null = null;
      let createAccounts: number[] = [];

      // Log all program IDs for debugging
      const programIds = rawInstructions.map(ix => accountKeys[ix.programIdIndex]?.toBase58() || 'null');
      console.log(`[PumpFunMonitor] Program IDs: ${programIds.join(', ')}`);

      const foundDiscriminators: string[] = [];
      for (const ix of rawInstructions) {
        const programId = accountKeys[ix.programIdIndex];
        if (programId?.toBase58() === PROGRAM_IDS.PUMP_FUN) {
          // Handle data format: Uint8Array for versioned, base58 string for legacy
          const data = isVersioned
            ? Buffer.from((ix as VersionedInstruction).data)
            : Buffer.from((ix as LegacyInstruction).data, 'base64');

          // Log discriminator for debugging
          const disc = data.slice(0, 8);
          foundDiscriminators.push(`[${Array.from(disc).join(',')}]`);

          // Check for both legacy create and current create_v2
          if (disc.equals(CREATE_DISCRIMINATOR) || disc.equals(CREATE_V2_DISCRIMINATOR)) {
            createData = data;
            // Handle account indexes: accountKeyIndexes for versioned, accounts for legacy
            createAccounts = isVersioned
              ? [...(ix as VersionedInstruction).accountKeyIndexes]
              : [...(ix as LegacyInstruction).accounts];
            break;
          }
        }
      }

      // Log found discriminators if no Create found
      if (!createData && foundDiscriminators.length > 0) {
        console.log(`[PumpFunMonitor] pump.fun discriminators in TX: ${foundDiscriminators.join(', ')}`);
      }

      if (!createData || createAccounts.length < 3) {
        console.log(`[PumpFunMonitor] No Create instruction found in TX ${signature.slice(0, 12)}... (createData: ${!!createData}, accounts: ${createAccounts.length})`);
        return null;
      }

      // Parse instruction data
      let offset = 8;

      const nameLen = createData.readUInt32LE(offset);
      offset += 4;
      const name = createData.slice(offset, offset + nameLen).toString('utf8');
      offset += nameLen;

      const symbolLen = createData.readUInt32LE(offset);
      offset += 4;
      const symbol = createData
        .slice(offset, offset + symbolLen)
        .toString('utf8');
      offset += symbolLen;

      const uriLen = createData.readUInt32LE(offset);
      offset += 4;
      const uri = createData.slice(offset, offset + uriLen).toString('utf8');
      offset += uriLen;

      // Try to parse mayhem mode flag (November 2025 pump.fun update)
      // If there's more data after uri, the next byte is is_mayhem_mode
      let isMayhemMode = false;
      if (offset < createData.length) {
        isMayhemMode = createData.readUInt8(offset) === 1;
      }

      // Extract addresses
      const mint = accountKeys[createAccounts[0]]?.toBase58() || '';
      const bondingCurve = accountKeys[createAccounts[2]]?.toBase58() || '';
      const creator = accountKeys[createAccounts[7]]?.toBase58() || '';

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
        isMayhemMode,
      };
    } catch (error) {
      console.error('[PumpFunMonitor] Fetch error:', error);
      return null;
    }
  }

  /**
   * Handle disconnection with reconnect
   */
  private handleDisconnect(): void {
    if (!this.running) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = 3000 * Math.min(this.reconnectAttempts, 5);

      console.log(
        `[PumpFunMonitor] Reconnecting in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => this.connect(), delay);
    } else {
      console.error('[PumpFunMonitor] Max reconnect attempts reached');
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connect();
      }, 60000);
    }
  }
}

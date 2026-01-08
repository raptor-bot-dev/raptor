// Private RPC module for MEV-protected transaction submission
// Supports Flashbots (ETH/Base) and bloXroute (BSC)

import { ethers, TransactionRequest, TransactionResponse } from 'ethers';
import type { ChainConfig, PrivateRpcConfig } from '@raptor/shared';

// JSON-RPC response types
interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: {
    code: number;
    message: string;
  };
}

export interface PrivateTransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  bundleHash?: string; // For Flashbots bundle submission
}

export interface FlashbotsBundle {
  signedTransactions: string[];
  blockNumber: number;
  minTimestamp?: number;
  maxTimestamp?: number;
}

export class PrivateRpcClient {
  private config: ChainConfig;
  private privateConfig: PrivateRpcConfig | undefined;
  private provider: ethers.JsonRpcProvider;
  private privateProvider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet;

  constructor(
    config: ChainConfig,
    provider: ethers.JsonRpcProvider,
    wallet: ethers.Wallet
  ) {
    this.config = config;
    this.privateConfig = config.privateRpc;
    this.provider = provider;
    this.wallet = wallet;

    // Initialize private provider if enabled
    if (this.privateConfig?.enabled) {
      const fetchOptions: RequestInit = {};

      // Add auth header for bloXroute
      if (this.privateConfig.authHeader) {
        fetchOptions.headers = {
          'Authorization': this.privateConfig.authHeader,
        };
      }

      this.privateProvider = new ethers.JsonRpcProvider(
        this.privateConfig.endpoint,
        this.config.chainId,
        { staticNetwork: true }
      );
    }
  }

  /**
   * Check if private RPC is enabled and available
   */
  isEnabled(): boolean {
    return !!this.privateConfig?.enabled && !!this.privateProvider;
  }

  /**
   * Get the appropriate provider (private if enabled, public otherwise)
   */
  getProvider(): ethers.JsonRpcProvider {
    return this.privateProvider || this.provider;
  }

  /**
   * Submit a transaction through the private RPC
   * Falls back to public RPC if private fails
   */
  async sendTransaction(
    signedTx: string,
    options?: { fallbackToPublic?: boolean }
  ): Promise<PrivateTransactionResult> {
    const fallbackToPublic = options?.fallbackToPublic ?? true;

    // If private RPC not enabled, use public
    if (!this.isEnabled()) {
      return this.sendViaPublic(signedTx);
    }

    try {
      const result = await this.sendViaPrivate(signedTx);
      if (result.success) {
        return result;
      }

      // Fall back to public if private fails and fallback enabled
      if (fallbackToPublic) {
        console.warn(
          `[PrivateRpc] Private submission failed: ${result.error}, falling back to public`
        );
        return this.sendViaPublic(signedTx);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PrivateRpc] Error: ${errorMessage}`);

      if (fallbackToPublic) {
        return this.sendViaPublic(signedTx);
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send transaction via private RPC
   */
  private async sendViaPrivate(signedTx: string): Promise<PrivateTransactionResult> {
    if (!this.privateProvider || !this.privateConfig) {
      return { success: false, error: 'Private RPC not configured' };
    }

    try {
      switch (this.privateConfig.type) {
        case 'flashbots':
          return await this.sendViaFlashbots(signedTx);
        case 'bloxroute':
          return await this.sendViaBloXroute(signedTx);
        case 'mevblocker':
          return await this.sendViaMevBlocker(signedTx);
        default:
          return await this.sendViaCustom(signedTx);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send via Flashbots Protect RPC
   * https://docs.flashbots.net/flashbots-protect/rpc/quick-start
   */
  private async sendViaFlashbots(signedTx: string): Promise<PrivateTransactionResult> {
    console.log(`[PrivateRpc] Sending via Flashbots...`);

    try {
      // Flashbots Protect accepts standard eth_sendRawTransaction
      const response = await fetch(this.privateConfig!.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const result = await response.json() as JsonRpcResponse;

      if (result.error) {
        return {
          success: false,
          error: result.error.message || 'Flashbots submission failed',
        };
      }

      console.log(`[PrivateRpc] Flashbots tx submitted: ${result.result}`);

      return {
        success: true,
        txHash: result.result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Flashbots error: ${errorMessage}` };
    }
  }

  /**
   * Send via bloXroute
   * https://docs.bloxroute.com/apis/frontrunning-protection
   */
  private async sendViaBloXroute(signedTx: string): Promise<PrivateTransactionResult> {
    console.log(`[PrivateRpc] Sending via bloXroute...`);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authorization header if provided
      if (this.privateConfig!.authHeader) {
        headers['Authorization'] = this.privateConfig!.authHeader;
      }

      const response = await fetch(this.privateConfig!.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const result = await response.json() as JsonRpcResponse;

      if (result.error) {
        return {
          success: false,
          error: result.error.message || 'bloXroute submission failed',
        };
      }

      console.log(`[PrivateRpc] bloXroute tx submitted: ${result.result}`);

      return {
        success: true,
        txHash: result.result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `bloXroute error: ${errorMessage}` };
    }
  }

  /**
   * Send via MEV Blocker (alternative to Flashbots)
   * https://mevblocker.io/
   */
  private async sendViaMevBlocker(signedTx: string): Promise<PrivateTransactionResult> {
    console.log(`[PrivateRpc] Sending via MEV Blocker...`);

    try {
      const response = await fetch(this.privateConfig!.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const result = await response.json() as JsonRpcResponse;

      if (result.error) {
        return {
          success: false,
          error: result.error.message || 'MEV Blocker submission failed',
        };
      }

      console.log(`[PrivateRpc] MEV Blocker tx submitted: ${result.result}`);

      return {
        success: true,
        txHash: result.result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `MEV Blocker error: ${errorMessage}` };
    }
  }

  /**
   * Send via custom private RPC endpoint
   */
  private async sendViaCustom(signedTx: string): Promise<PrivateTransactionResult> {
    console.log(`[PrivateRpc] Sending via custom endpoint...`);

    try {
      const txResponse = await this.privateProvider!.broadcastTransaction(signedTx);
      console.log(`[PrivateRpc] Custom tx submitted: ${txResponse.hash}`);

      return {
        success: true,
        txHash: txResponse.hash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Custom RPC error: ${errorMessage}` };
    }
  }

  /**
   * Send via public RPC (fallback)
   */
  private async sendViaPublic(signedTx: string): Promise<PrivateTransactionResult> {
    console.log(`[PrivateRpc] Sending via public RPC...`);

    try {
      const txResponse = await this.provider.broadcastTransaction(signedTx);
      console.log(`[PrivateRpc] Public tx submitted: ${txResponse.hash}`);

      return {
        success: true,
        txHash: txResponse.hash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Public RPC error: ${errorMessage}` };
    }
  }

  /**
   * Build and sign a transaction
   */
  async buildAndSignTransaction(
    tx: TransactionRequest
  ): Promise<{ signedTx: string; hash: string }> {
    // Get nonce from public provider (more reliable)
    const nonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');

    // Build transaction with proper gas settings
    const populatedTx = await this.wallet.populateTransaction({
      ...tx,
      nonce,
      chainId: this.config.chainId,
    });

    // Sign the transaction
    const signedTx = await this.wallet.signTransaction(populatedTx);
    const hash = ethers.keccak256(signedTx);

    return { signedTx, hash };
  }

  /**
   * Execute a full transaction flow: build, sign, and send via private RPC
   */
  async executeTransaction(
    tx: TransactionRequest,
    options?: { fallbackToPublic?: boolean }
  ): Promise<PrivateTransactionResult & { response?: TransactionResponse }> {
    try {
      // Build and sign
      const { signedTx } = await this.buildAndSignTransaction(tx);

      // Send via private RPC
      const result = await this.sendTransaction(signedTx, options);

      if (result.success && result.txHash) {
        // Wait for transaction to appear in the mempool/be mined
        const response = await this.provider.getTransaction(result.txHash);
        return { ...result, response: response || undefined };
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check transaction status
   */
  async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed' | 'not_found';
    blockNumber?: number;
    confirmations?: number;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (!receipt) {
        // Check if transaction exists but is pending
        const tx = await this.provider.getTransaction(txHash);
        if (tx) {
          return { status: 'pending' };
        }
        return { status: 'not_found' };
      }

      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      if (receipt.status === 1) {
        return {
          status: 'confirmed',
          blockNumber: receipt.blockNumber,
          confirmations,
        };
      } else {
        return {
          status: 'failed',
          blockNumber: receipt.blockNumber,
          confirmations,
        };
      }
    } catch {
      return { status: 'not_found' };
    }
  }
}

/**
 * Factory function to create private RPC client for a chain
 */
export function createPrivateRpcClient(
  config: ChainConfig,
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet
): PrivateRpcClient {
  return new PrivateRpcClient(config, provider, wallet);
}

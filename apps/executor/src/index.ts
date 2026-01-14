/**
 * RAPTOR Execution Engine v4.0
 * Solana-only build
 */

import { Connection } from '@solana/web3.js';
import { SOLANA_CONFIG } from '@raptor/shared';

// Export Solana executor for bot integration
export { SolanaExecutor, solanaExecutor, JupiterClient, jupiter } from './chains/solana/index.js';
export type { SolanaTradeResult, SolanaTokenInfo } from './chains/solana/index.js';

async function validateStartupConfiguration(): Promise<void> {
  console.log('🔍 Validating configuration...');

  // Required environment variables for executor service
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'SOLANA_EXECUTOR_PRIVATE_KEY',
    'SOLANA_RPC_URL',
  ];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`❌ FATAL: Required environment variable ${envVar} not set`);
    }
  }

  // Validate RPC URL uses HTTPS
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl?.startsWith('https://') && !rpcUrl?.startsWith('wss://')) {
    throw new Error(`❌ FATAL: SOLANA_RPC_URL must use HTTPS or WSS protocol`);
  }

  // Prevent devnet/testnet in production
  if (process.env.NODE_ENV === 'production') {
    if (rpcUrl.includes('devnet') || rpcUrl.includes('testnet')) {
      throw new Error('❌ FATAL: Devnet/testnet endpoint detected in production!');
    }
  }

  console.log('✅ Configuration validated');
}

async function validateRPCConnectivity(): Promise<void> {
  console.log('🌐 Testing RPC connectivity...');

  // Test Solana RPC
  try {
    const solConnection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');
    const solSlot = await Promise.race([
      solConnection.getSlot(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      )
    ]);
    if (!solSlot) throw new Error('Invalid response');
    console.log(`  ✓ Solana RPC healthy (slot: ${solSlot})`);
  } catch (error) {
    throw new Error(`❌ Solana RPC unreachable: ${(error as Error).message}`);
  }

  console.log('✅ RPC endpoint validated');
}

async function main() {
  console.log('========================================');
  console.log('RAPTOR Execution Engine v4.0');
  console.log('Solana-only build');
  console.log('========================================');

  // Validate configuration
  await validateStartupConfiguration();
  await validateRPCConnectivity();

  console.log('✅ RAPTOR Execution Engine ready');
  console.log('   - Solana executor available for bot integration');

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
}

main().catch(console.error);

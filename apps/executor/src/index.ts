import { Connection } from '@solana/web3.js';
import { ethers } from 'ethers';
import { BSC_CONFIG, BASE_CONFIG, ETH_CONFIG, SOLANA_CONFIG } from '@raptor/shared';
import { ChainExecutor } from './chains/chainExecutor.js';
import { FourMemeListener } from './listeners/fourMeme.js';
import { BasePumpListener } from './listeners/basePump.js';
import { PositionManager } from './execution/positionManager.js';

// Export Solana executor for bot integration
export { SolanaExecutor, solanaExecutor, JupiterClient, jupiter } from './chains/solana/index.js';
export type { SolanaTradeResult, SolanaTokenInfo } from './chains/solana/index.js';

// Export EVM chain executor
export { ChainExecutor } from './chains/chainExecutor.js';

// Export listeners
export { FourMemeListener } from './listeners/fourMeme.js';
export { BasePumpListener } from './listeners/basePump.js';

// Export position management
export { PositionManager } from './execution/positionManager.js';

async function validateStartupConfiguration(): Promise<void> {
  console.log('🔍 Validating configuration...');

  // Required environment variables for executor service
  // Note: TELEGRAM_BOT_TOKEN is only required by the bot service, not executor
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'EXECUTOR_PRIVATE_KEY',
    'SOLANA_EXECUTOR_PRIVATE_KEY',
    'SOLANA_RPC_URL',
    'BSC_RPC_URL',
    'BASE_RPC_URL',
    'ETH_RPC_URL',
  ];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`❌ FATAL: Required environment variable ${envVar} not set`);
    }
  }

  // Validate RPC URLs use HTTPS/WSS
  const rpcUrls = [
    { name: 'SOLANA_RPC_URL', value: process.env.SOLANA_RPC_URL },
    { name: 'BSC_RPC_URL', value: process.env.BSC_RPC_URL },
    { name: 'BASE_RPC_URL', value: process.env.BASE_RPC_URL },
    { name: 'ETH_RPC_URL', value: process.env.ETH_RPC_URL },
  ];

  for (const { name, value } of rpcUrls) {
    if (!value?.startsWith('https://') && !value?.startsWith('wss://')) {
      throw new Error(`❌ FATAL: ${name} must use HTTPS or WSS protocol, got: ${value?.slice(0, 20)}...`);
    }
  }

  // Prevent devnet/testnet in production
  if (process.env.NODE_ENV === 'production') {
    const solanaUrl = process.env.SOLANA_RPC_URL || '';
    if (solanaUrl.includes('devnet') || solanaUrl.includes('testnet')) {
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

  // Test EVM chains
  const evmChains = [BSC_CONFIG, BASE_CONFIG, ETH_CONFIG];
  for (const chain of evmChains) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      const blockNumber = await Promise.race([
        provider.getBlockNumber(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);
      if (!blockNumber) throw new Error('Invalid response');
      console.log(`  ✓ ${chain.name} RPC healthy (block: ${blockNumber})`);
    } catch (error) {
      throw new Error(`❌ ${chain.name} RPC unreachable: ${(error as Error).message}`);
    }
  }

  console.log('✅ All RPC endpoints validated');
}

async function main() {
  console.log('🦅 RAPTOR Execution Engine starting...');

  // NEW: Validate configuration first
  await validateStartupConfiguration();
  await validateRPCConnectivity();

  // Validate environment
  if (!process.env.EXECUTOR_PRIVATE_KEY) {
    console.error('ERROR: EXECUTOR_PRIVATE_KEY is required');
    process.exit(1);
  }

  // Initialize chain executors
  const bscExecutor = new ChainExecutor(BSC_CONFIG);
  const baseExecutor = new ChainExecutor(BASE_CONFIG);

  // Initialize listeners
  const fourMeme = new FourMemeListener(bscExecutor);
  const basePump = new BasePumpListener(baseExecutor);

  // Initialize position manager
  const positionManager = new PositionManager([bscExecutor, baseExecutor]);

  // Start all services
  try {
    await Promise.all([
      bscExecutor.start(),
      baseExecutor.start(),
      fourMeme.start(),
      basePump.start(),
      positionManager.start(),
    ]);

    console.log('✅ RAPTOR Execution Engine running');
    console.log(`   - BSC: Monitoring ${BSC_CONFIG.launchpads.length} launchpads`);
    console.log(`   - Base: Monitoring ${BASE_CONFIG.launchpads.length} launchpads`);
  } catch (error) {
    console.error('Failed to start execution engine:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await Promise.all([bscExecutor.stop(), baseExecutor.stop()]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(console.error);

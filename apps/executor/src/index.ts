import { BSC_CONFIG, BASE_CONFIG } from '@raptor/shared';
import { ChainExecutor } from './chains/chainExecutor.js';
import { FourMemeListener } from './listeners/fourMeme.js';
import { BasePumpListener } from './listeners/basePump.js';
import { PositionManager } from './execution/positionManager.js';

async function main() {
  console.log('🦅 RAPTOR Execution Engine starting...');

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

#!/usr/bin/env npx tsx
/**
 * Solana Flow Test Script
 * Tests connection, wallet, PDA derivation, and optionally live trades
 *
 * Usage:
 *   npx tsx apps/executor/src/tests/testSolanaFlow.ts [--mainnet] [--trade]
 *
 * Options:
 *   --mainnet   Use mainnet instead of devnet
 *   --trade     Execute a real test trade (requires SOL in wallet)
 */

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  PUMP_FUN_PROGRAM_ID,
  deriveBondingCurvePDA,
  deriveAssociatedBondingCurve,
  calculateBuyOutput,
  calculateSellOutput,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
  INITIAL_REAL_TOKEN_RESERVES,
  PumpFunClient,
} from '../chains/solana/pumpFun.js';
import { PROGRAM_IDS, SOLANA_CONFIG } from '@raptor/shared';

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

const log = {
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  header: (msg: string) => console.log(`\n${colors.blue}━━━ ${msg} ━━━${colors.reset}`),
};

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  duration?: number;
}

const results: TestResult[] = [];

function recordTest(name: string, passed: boolean, message?: string, duration?: number) {
  results.push({ name, passed, message, duration });
  if (passed) {
    log.success(`${name}${duration ? ` (${duration}ms)` : ''}`);
  } else {
    log.error(`${name}: ${message}`);
  }
}

// ============================================================================
// Test: Connection
// ============================================================================
async function testConnection(connection: Connection, isMainnet: boolean): Promise<boolean> {
  log.header('Testing Connection');

  const start = Date.now();
  try {
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    const version = await connection.getVersion();

    recordTest('Get current slot', true, undefined, Date.now() - start);
    log.info(`  Slot: ${slot}`);
    log.info(`  Block time: ${blockTime ? new Date(blockTime * 1000).toISOString() : 'N/A'}`);
    log.info(`  Version: ${version['solana-core']}`);

    // Check cluster
    const genesisHash = await connection.getGenesisHash();
    const expectedGenesis = isMainnet
      ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' // mainnet
      : 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'; // devnet

    if (genesisHash === expectedGenesis) {
      recordTest(`Cluster verification (${isMainnet ? 'mainnet' : 'devnet'})`, true);
    } else {
      recordTest('Cluster verification', false, `Unexpected genesis hash: ${genesisHash}`);
      return false;
    }

    return true;
  } catch (error) {
    recordTest('Connection test', false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Wallet Loading
// ============================================================================
async function testWallet(connection: Connection): Promise<Keypair | null> {
  log.header('Testing Wallet');

  const privateKey = process.env.SOLANA_EXECUTOR_PRIVATE_KEY;

  if (!privateKey) {
    recordTest('Load wallet from env', false, 'SOLANA_EXECUTOR_PRIVATE_KEY not set');
    log.warn('  Set SOLANA_EXECUTOR_PRIVATE_KEY to test wallet operations');
    return null;
  }

  try {
    const start = Date.now();
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    recordTest('Decode private key', true, undefined, Date.now() - start);

    log.info(`  Public key: ${keypair.publicKey.toBase58()}`);

    // Get balance
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;

    if (balance > 0) {
      recordTest('Check wallet balance', true);
      log.info(`  Balance: ${solBalance.toFixed(4)} SOL`);
    } else {
      recordTest('Check wallet balance', true);
      log.warn(`  Balance: 0 SOL (need SOL for trades)`);
    }

    return keypair;
  } catch (error) {
    recordTest('Load wallet', false, (error as Error).message);
    return null;
  }
}

// ============================================================================
// Test: PDA Derivation
// ============================================================================
async function testPDADerivation(): Promise<boolean> {
  log.header('Testing PDA Derivation');

  // Known pump.fun token for verification (use a real mainnet token)
  const testMints = [
    {
      name: 'Test mint 1',
      mint: 'So11111111111111111111111111111111111111112', // Wrapped SOL (for structure test)
    },
  ];

  try {
    for (const test of testMints) {
      const start = Date.now();
      const mintPubkey = new PublicKey(test.mint);

      // Derive bonding curve PDA
      const [bondingCurve, bump] = deriveBondingCurvePDA(mintPubkey);
      recordTest(`Derive bonding curve PDA (${test.name})`, true, undefined, Date.now() - start);
      log.info(`  Bonding curve: ${bondingCurve.toBase58()}`);
      log.info(`  Bump: ${bump}`);

      // Derive associated bonding curve (note: order is bondingCurve, mint)
      const start2 = Date.now();
      const associatedBC = await deriveAssociatedBondingCurve(bondingCurve, mintPubkey);
      recordTest(`Derive associated bonding curve`, true, undefined, Date.now() - start2);
      log.info(`  Associated BC: ${associatedBC.toBase58()}`);

      // Test user ATA derivation
      const testUser = Keypair.generate().publicKey;
      const userAta = await getAssociatedTokenAddress(mintPubkey, testUser);
      recordTest('Derive user ATA', true);
      log.info(`  User ATA: ${userAta.toBase58()}`);
    }

    return true;
  } catch (error) {
    recordTest('PDA derivation', false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Bonding Curve Math
// ============================================================================
function testBondingCurveMath(): boolean {
  log.header('Testing Bonding Curve Math');

  try {
    // Test buy calculation
    const solIn = 1_000_000_000n; // 1 SOL in lamports
    const tokensOut = calculateBuyOutput(
      solIn,
      VIRTUAL_SOL_RESERVES,
      VIRTUAL_TOKEN_RESERVES
    );

    recordTest('Calculate buy output', true);
    log.info(`  Input: 1 SOL`);
    log.info(`  Output: ${Number(tokensOut) / 1e6} tokens`);

    // Test sell calculation
    const tokensIn = tokensOut / 2n; // Sell half
    const solOut = calculateSellOutput(
      tokensIn,
      VIRTUAL_SOL_RESERVES + solIn,
      VIRTUAL_TOKEN_RESERVES - tokensOut
    );

    recordTest('Calculate sell output', true);
    log.info(`  Input: ${Number(tokensIn) / 1e6} tokens`);
    log.info(`  Output: ${Number(solOut) / 1e9} SOL`);

    // Verify price impact (sell should return less than half due to slippage)
    const priceImpact = (1 - Number(solOut) / (Number(solIn) / 2)) * 100;
    log.info(`  Price impact: ${priceImpact.toFixed(2)}%`);

    if (solOut < solIn / 2n) {
      recordTest('Verify price impact', true);
    } else {
      recordTest('Verify price impact', false, 'Expected price impact not observed');
      return false;
    }

    return true;
  } catch (error) {
    recordTest('Bonding curve math', false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Program ID Verification
// ============================================================================
function testProgramIDs(): boolean {
  log.header('Verifying Program IDs');

  const programChecks = [
    { name: 'Pump.fun Program', id: PROGRAM_IDS.PUMP_FUN, expected: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' },
    { name: 'Pump.fun Global', id: PROGRAM_IDS.PUMP_FUN_GLOBAL, expected: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf' },
    { name: 'Pump.fun Fee', id: PROGRAM_IDS.PUMP_FUN_FEE, expected: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM' },
    { name: 'Raydium AMM', id: PROGRAM_IDS.RAYDIUM_AMM, expected: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' },
    { name: 'Wrapped SOL', id: PROGRAM_IDS.WSOL, expected: 'So11111111111111111111111111111111111111112' },
  ];

  let allPassed = true;

  for (const check of programChecks) {
    if (check.id === check.expected) {
      recordTest(`${check.name}`, true);
      log.info(`  ${check.id}`);
    } else {
      recordTest(`${check.name}`, false, `Expected ${check.expected}, got ${check.id}`);
      allPassed = false;
    }
  }

  return allPassed;
}

// ============================================================================
// Test: Live Trade (Optional, mainnet only)
// ============================================================================
async function testLiveTrade(
  connection: Connection,
  wallet: Keypair,
  testMint: string
): Promise<boolean> {
  log.header('Testing Live Trade (MAINNET)');
  log.warn('This will execute a REAL trade with REAL SOL!');

  // PumpFunClient takes wallet only (uses its own connection)
  const client = new PumpFunClient(wallet);

  try {
    // Use minimal amount (0.001 SOL)
    const testAmount = 1_000_000n; // 0.001 SOL in lamports

    log.info(`  Test mint: ${testMint}`);
    log.info(`  Test amount: 0.001 SOL`);

    // Check balance first
    const balance = await connection.getBalance(wallet.publicKey);
    if (balance < Number(testAmount) + 10_000_000) { // Need extra for fees
      recordTest('Balance check', false, 'Insufficient balance for test trade');
      return false;
    }

    recordTest('Balance check', true);

    // Get current bonding curve state
    const mint = new PublicKey(testMint);
    const [bondingCurve] = deriveBondingCurvePDA(mint);

    const accountInfo = await connection.getAccountInfo(bondingCurve);
    if (!accountInfo) {
      recordTest('Fetch bonding curve', false, 'Bonding curve not found - token may have graduated');
      return false;
    }

    recordTest('Fetch bonding curve', true);
    log.info(`  Bonding curve size: ${accountInfo.data.length} bytes`);

    // Execute buy (throws on failure)
    log.info('  Executing buy...');
    const buyStart = Date.now();

    try {
      const buyResult = await client.buy({
        mint,
        solAmount: testAmount,
        slippageBps: 1000, // 10% slippage for test
        minTokensOut: 0n,
      });

      recordTest('Execute buy', true, undefined, Date.now() - buyStart);
      log.info(`  TX: ${buyResult.signature}`);
      log.info(`  Tokens received: ${buyResult.tokenAmount}`);

      // Wait a bit then try to sell
      log.info('  Waiting 2s before sell...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Execute sell
      log.info('  Executing sell...');
      const sellStart = Date.now();

      try {
        const sellResult = await client.sell({
          mint,
          tokenAmount: buyResult.tokenAmount,
          slippageBps: 1000,
          minSolOut: 0n,
        });

        recordTest('Execute sell', true, undefined, Date.now() - sellStart);
        log.info(`  TX: ${sellResult.signature}`);
        log.info(`  SOL received: ${sellResult.solAmount}`);
      } catch (sellError) {
        recordTest('Execute sell', false, (sellError as Error).message);
      }
    } catch (buyError) {
      recordTest('Execute buy', false, (buyError as Error).message);
      return false;
    }

    return true;
  } catch (error) {
    recordTest('Live trade', false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('\n🦖 RAPTOR Solana Flow Test\n');

  // Parse arguments
  const args = process.argv.slice(2);
  const useMainnet = args.includes('--mainnet');
  const executeTrade = args.includes('--trade');

  // Setup connection
  const rpcUrl = useMainnet
    ? process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    : process.env.SOLANA_DEVNET_RPC_URL || clusterApiUrl('devnet');

  log.info(`Network: ${useMainnet ? 'MAINNET' : 'DEVNET'}`);
  log.info(`RPC: ${rpcUrl}`);

  const connection = new Connection(rpcUrl, 'confirmed');

  // Run tests
  const connectionOk = await testConnection(connection, useMainnet);
  if (!connectionOk) {
    log.error('\nConnection test failed, aborting');
    process.exit(1);
  }

  const wallet = await testWallet(connection);

  testProgramIDs();
  await testPDADerivation();
  testBondingCurveMath();

  // Live trade test (mainnet only, requires --trade flag)
  if (executeTrade && useMainnet && wallet) {
    const testMint = process.env.TEST_PUMP_FUN_MINT;
    if (testMint) {
      await testLiveTrade(connection, wallet, testMint);
    } else {
      log.warn('\nSkipping live trade: TEST_PUMP_FUN_MINT not set');
      log.info('Set TEST_PUMP_FUN_MINT to a pump.fun token address to test');
    }
  } else if (executeTrade && !useMainnet) {
    log.warn('\nSkipping live trade: pump.fun only exists on mainnet');
    log.info('Use --mainnet --trade to execute a real trade');
  }

  // Summary
  log.header('Test Summary');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  Passed: ${colors.green}${passed}${colors.reset}`);
  console.log(`  Failed: ${colors.red}${failed}${colors.reset}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${colors.red}✗${colors.reset} ${r.name}: ${r.message}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

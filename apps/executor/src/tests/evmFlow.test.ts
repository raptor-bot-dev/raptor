#!/usr/bin/env npx tsx
/**
 * EVM Flow Test Script
 * Tests RPC connections, honeypot detection, DEX quotes, and chain config
 *
 * Usage:
 *   npx tsx apps/executor/src/tests/testEVMFlow.ts [--chain bsc|base|eth]
 *
 * Options:
 *   --chain   Specify chain to test (default: all)
 */

import { ethers, Contract } from 'ethers';
import {
  BSC_CONFIG,
  BASE_CONFIG,
  ETH_CONFIG,
  EVM_CHAINS,
  type ChainConfig,
} from '@raptor/shared';
import { HoneypotDetector } from '../analyzers/honeypotDetector.js';

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

// Router ABI for price quotes
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function factory() view returns (address)',
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

// ============================================================================
// Test: RPC Connection
// ============================================================================
async function testConnection(config: ChainConfig): Promise<boolean> {
  log.header(`Testing ${config.name} Connection`);

  try {
    const start = Date.now();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Get network info
    const network = await provider.getNetwork();
    recordTest(`Connect to ${config.name} RPC`, true, undefined, Date.now() - start);
    log.info(`  Chain ID: ${network.chainId}`);

    // Verify chain ID matches config
    if (Number(network.chainId) === config.chainId) {
      recordTest(`Chain ID verification`, true);
    } else {
      recordTest(`Chain ID verification`, false, `Expected ${config.chainId}, got ${network.chainId}`);
      return false;
    }

    // Get block number
    const blockNumber = await provider.getBlockNumber();
    recordTest(`Get block number`, true);
    log.info(`  Block: ${blockNumber}`);

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    recordTest(`Get gas price`, true);
    log.info(`  Gas price: ${gasPrice ? ethers.formatUnits(gasPrice, 'gwei') : 'N/A'} gwei`);

    return true;
  } catch (error) {
    recordTest(`${config.name} connection`, false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Wallet Loading
// ============================================================================
async function testWallet(config: ChainConfig): Promise<ethers.Wallet | null> {
  log.header(`Testing ${config.name} Wallet`);

  const privateKey = process.env.EXECUTOR_PRIVATE_KEY;

  if (!privateKey) {
    recordTest('Load wallet from env', false, 'EXECUTOR_PRIVATE_KEY not set');
    log.warn('  Set EXECUTOR_PRIVATE_KEY to test wallet operations');
    return null;
  }

  try {
    const start = Date.now();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    recordTest('Create wallet instance', true, undefined, Date.now() - start);

    log.info(`  Address: ${wallet.address}`);

    // Get balance
    const balance = await provider.getBalance(wallet.address);
    const formattedBalance = ethers.formatEther(balance);

    if (balance > 0n) {
      recordTest('Check wallet balance', true);
      log.info(`  Balance: ${formattedBalance} ${config.nativeToken}`);
    } else {
      recordTest('Check wallet balance', true);
      log.warn(`  Balance: 0 ${config.nativeToken} (need funds for trades)`);
    }

    return wallet;
  } catch (error) {
    recordTest('Load wallet', false, (error as Error).message);
    return null;
  }
}

// ============================================================================
// Test: DEX Router
// ============================================================================
async function testDexRouter(config: ChainConfig): Promise<boolean> {
  log.header(`Testing ${config.name} DEX Router`);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    for (const dex of config.dexes) {
      if (dex.type !== 'V2') continue; // Only test V2 routers for getAmountsOut

      const start = Date.now();

      // Check router contract exists
      const routerCode = await provider.getCode(dex.router);
      if (routerCode === '0x') {
        recordTest(`${dex.name} router exists`, false, 'No contract at address');
        continue;
      }
      recordTest(`${dex.name} router exists`, true);

      // Test price quote for wrapped native
      const router = new Contract(dex.router, ROUTER_ABI, provider);

      try {
        // Get factory to verify router works
        const factory = await router.factory();
        recordTest(`${dex.name} factory call`, true, undefined, Date.now() - start);
        log.info(`  Factory: ${factory}`);

        // Test getAmountsOut with a known pair (wrapped native -> USDT/USDC)
        const testAmount = ethers.parseEther('1');

        // Common stablecoin addresses
        const stablecoins: Record<number, string> = {
          56: '0x55d398326f99059fF775485246999027B3197955', // BSC USDT
          8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
          1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // ETH USDT
        };

        const stablecoin = stablecoins[config.chainId];
        if (stablecoin) {
          try {
            const path = [config.wrappedNative, stablecoin];
            const amounts = await router.getAmountsOut(testAmount, path);
            const priceUsd = ethers.formatUnits(amounts[1], 6); // Most stablecoins are 6 decimals
            recordTest(`${dex.name} price quote`, true);
            log.info(`  1 ${config.nativeToken} = $${priceUsd}`);
          } catch {
            log.warn(`  Price quote failed (no liquidity or wrong decimals)`);
          }
        }
      } catch (error) {
        recordTest(`${dex.name} router test`, false, (error as Error).message);
      }
    }

    return true;
  } catch (error) {
    recordTest(`${config.name} DEX test`, false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Honeypot Detector
// ============================================================================
async function testHoneypotDetector(config: ChainConfig): Promise<boolean> {
  log.header(`Testing ${config.name} Honeypot Detector`);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Get chain type for honeypot detector
    const chainType = config.name.toLowerCase() === 'bsc' ? 'bsc' :
                      config.name.toLowerCase() === 'base' ? 'base' : 'eth';

    const detector = new HoneypotDetector(provider, chainType as 'bsc' | 'base' | 'eth');

    // Test with a known good token (stablecoin) - these have real liquidity
    const stablecoins: Record<number, { address: string; name: string }> = {
      56: { address: '0x55d398326f99059fF775485246999027B3197955', name: 'USDT' },
      8453: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USDC' },
      1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC' },
    };

    const stable = stablecoins[config.chainId];
    if (stable) {
      // Quick check
      const start = Date.now();
      const quickResult = await detector.quickCheck(stable.address);
      if (quickResult.safe) {
        recordTest(`Quick check ${stable.name}`, true, undefined, Date.now() - start);
      } else {
        recordTest(`Quick check ${stable.name}`, false, quickResult.reason);
      }

      // Full detection on stablecoin
      log.info(`  Running full honeypot detection on ${stable.name}...`);
      const start2 = Date.now();
      const fullResult = await detector.detect(stable.address);
      recordTest(`Full honeypot detection`, !fullResult.isHoneypot, fullResult.reason, Date.now() - start2);

      if (!fullResult.isHoneypot) {
        log.info(`  Buy tax: ${fullResult.buyTax || 0}%`);
        log.info(`  Sell tax: ${fullResult.sellTax || 0}%`);
        log.info(`  Ownership renounced: ${fullResult.isRenounced ? 'Yes' : 'No/Unknown'}`);
      }
    } else {
      log.warn('  No stablecoin configured for this chain');
    }

    return true;
  } catch (error) {
    recordTest(`${config.name} honeypot detector`, false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Test: Private RPC Config
// ============================================================================
function testPrivateRpcConfig(config: ChainConfig): boolean {
  log.header(`Testing ${config.name} Private RPC Config`);

  if (!config.privateRpc) {
    recordTest('Private RPC config', true);
    log.info('  No private RPC configured');
    return true;
  }

  const { enabled, type, endpoint, authHeader } = config.privateRpc;

  recordTest(`Private RPC type: ${type}`, true);
  log.info(`  Enabled: ${enabled}`);
  log.info(`  Endpoint: ${endpoint}`);

  if (type === 'bloxroute') {
    if (authHeader) {
      recordTest('bloXroute auth header', true);
      log.info(`  Auth: ${authHeader.slice(0, 10)}...`);
    } else {
      recordTest('bloXroute auth header', false, 'BLOXROUTE_AUTH_HEADER not set');
      log.warn('  Set BLOXROUTE_AUTH_HEADER for MEV protection on BSC');
    }
  } else if (type === 'flashbots') {
    recordTest('Flashbots config', true);
    log.info('  Flashbots ready (no auth required)');
  }

  return true;
}

// ============================================================================
// Test: Chain Config Verification
// ============================================================================
function testChainConfig(config: ChainConfig): boolean {
  log.header(`Testing ${config.name} Chain Config`);

  // Verify required fields
  const checks = [
    { field: 'chainId', value: config.chainId, valid: config.chainId > 0 },
    { field: 'rpcUrl', value: config.rpcUrl, valid: config.rpcUrl.startsWith('http') },
    { field: 'wrappedNative', value: config.wrappedNative, valid: ethers.isAddress(config.wrappedNative) },
    { field: 'dexes', value: config.dexes.length, valid: config.dexes.length > 0 },
  ];

  let allPassed = true;

  for (const check of checks) {
    if (check.valid) {
      recordTest(`Config: ${check.field}`, true);
      log.info(`  ${check.field}: ${check.value}`);
    } else {
      recordTest(`Config: ${check.field}`, false, 'Invalid or missing');
      allPassed = false;
    }
  }

  // Verify DEX router addresses
  for (const dex of config.dexes) {
    if (ethers.isAddress(dex.router)) {
      recordTest(`DEX: ${dex.name}`, true);
      log.info(`  Router: ${dex.router}`);
    } else {
      recordTest(`DEX: ${dex.name}`, false, 'Invalid router address');
      allPassed = false;
    }
  }

  return allPassed;
}

// ============================================================================
// Test: Token Read (ERC20)
// ============================================================================
async function testTokenRead(config: ChainConfig): Promise<boolean> {
  log.header(`Testing ${config.name} Token Reading`);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Test reading wrapped native token
    const start = Date.now();
    const token = new Contract(config.wrappedNative, ERC20_ABI, provider);

    const [decimals, symbol, name, totalSupply] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.name(),
      token.totalSupply(),
    ]);

    recordTest(`Read W${config.nativeToken} info`, true, undefined, Date.now() - start);
    log.info(`  Name: ${name}`);
    log.info(`  Symbol: ${symbol}`);
    log.info(`  Decimals: ${decimals}`);
    log.info(`  Total Supply: ${ethers.formatUnits(totalSupply, decimals)}`);

    return true;
  } catch (error) {
    recordTest(`${config.name} token read`, false, (error as Error).message);
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('\n🦖 RAPTOR EVM Flow Test\n');

  // Parse arguments
  const args = process.argv.slice(2);
  const chainArg = args.find(a => a.startsWith('--chain='))?.split('=')[1] ||
                   args[args.indexOf('--chain') + 1];

  // Select chains to test
  let chainsToTest: ChainConfig[] = [];

  if (chainArg) {
    const chainMap: Record<string, ChainConfig> = {
      bsc: BSC_CONFIG,
      base: BASE_CONFIG,
      eth: ETH_CONFIG,
      ethereum: ETH_CONFIG,
    };

    const selectedChain = chainMap[chainArg.toLowerCase()];
    if (selectedChain) {
      chainsToTest = [selectedChain];
      log.info(`Testing chain: ${chainArg.toUpperCase()}`);
    } else {
      log.error(`Unknown chain: ${chainArg}`);
      log.info('Available chains: bsc, base, eth');
      process.exit(1);
    }
  } else {
    chainsToTest = [...EVM_CHAINS];
    log.info('Testing all EVM chains: BSC, Base, Ethereum');
  }

  // Run tests for each chain
  for (const config of chainsToTest) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${config.name.toUpperCase()} TESTS`);
    console.log('='.repeat(60));

    // Run all tests for this chain
    testChainConfig(config);
    await testConnection(config);
    await testWallet(config);
    await testDexRouter(config);
    await testTokenRead(config);
    await testHoneypotDetector(config);
    testPrivateRpcConfig(config);
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

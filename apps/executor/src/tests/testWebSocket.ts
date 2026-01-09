#!/usr/bin/env npx tsx
/**
 * WebSocket Connection Test for Solana
 * Tests basic WebSocket connectivity to Solana RPC
 *
 * Usage:
 *   npx tsx apps/executor/src/tests/testWebSocket.ts [--mainnet]
 */

import WebSocket from 'ws';
import { clusterApiUrl } from '@solana/web3.js';
import { PROGRAM_IDS } from '@raptor/shared';

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
};

async function testWebSocket(): Promise<void> {
  console.log('\n🔌 RAPTOR Solana WebSocket Test\n');

  const args = process.argv.slice(2);
  const useMainnet = args.includes('--mainnet');

  // Get WebSocket URL
  let wssUrl: string;
  if (useMainnet) {
    wssUrl = process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com';
  } else {
    wssUrl = process.env.SOLANA_DEVNET_WSS_URL || clusterApiUrl('devnet').replace('https', 'wss');
  }

  log.info(`Network: ${useMainnet ? 'MAINNET' : 'DEVNET'}`);
  log.info(`WSS URL: ${wssUrl}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      log.error('Connection timed out after 15 seconds');
      ws.terminate();
      reject(new Error('Timeout'));
    }, 15000);

    const ws = new WebSocket(wssUrl);
    let subscriptionId: number | null = null;
    let messageCount = 0;

    ws.on('open', () => {
      log.success('WebSocket connected');

      // Subscribe to slot updates (lightweight, always running)
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'slotSubscribe',
      };

      ws.send(JSON.stringify(subscribeMessage));
      log.info('Subscribed to slot updates...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle subscription confirmation
        if (message.result !== undefined && message.id === 1) {
          subscriptionId = message.result;
          log.success(`Subscription confirmed (id: ${subscriptionId})`);
          return;
        }

        // Handle slot notifications
        if (message.method === 'slotNotification' && message.params?.result) {
          messageCount++;
          const { slot, parent, root } = message.params.result;

          if (messageCount === 1) {
            log.success(`Receiving slot notifications`);
            log.info(`  First slot: ${slot}`);
          }

          // After 5 messages, test is complete
          if (messageCount >= 5) {
            log.success(`Received ${messageCount} slot updates`);
            log.info(`  Latest slot: ${slot}`);

            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }
      } catch (error) {
        log.warn(`Parse error: ${(error as Error).message}`);
      }
    });

    ws.on('error', (error) => {
      log.error(`WebSocket error: ${error.message}`);
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', (code, reason) => {
      if (messageCount >= 5) {
        log.success('WebSocket closed cleanly');
      } else {
        log.warn(`WebSocket closed: ${code} - ${reason.toString()}`);
      }
    });
  });
}

// Test pump.fun program subscription (mainnet only)
async function testPumpFunSubscription(): Promise<void> {
  console.log('\n🎯 Testing pump.fun Program Subscription\n');

  const wssUrl = process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com';
  log.info(`WSS URL: ${wssUrl}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      log.warn('No pump.fun activity detected in 30 seconds');
      log.info('This is normal - pump.fun may not have new tokens during test');
      ws.close();
      resolve();
    }, 30000);

    const ws = new WebSocket(wssUrl);
    let subscriptionId: number | null = null;
    let messageCount = 0;

    ws.on('open', () => {
      log.success('WebSocket connected');

      // Subscribe to pump.fun program logs
      const subscribeMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          { mentions: [PROGRAM_IDS.PUMP_FUN] },
          { commitment: 'confirmed' },
        ],
      };

      ws.send(JSON.stringify(subscribeMessage));
      log.info(`Subscribed to pump.fun program: ${PROGRAM_IDS.PUMP_FUN}`);
      log.info('Waiting for activity (up to 30s)...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle subscription confirmation
        if (message.result !== undefined && message.id === 1) {
          subscriptionId = message.result;
          log.success(`Subscription confirmed (id: ${subscriptionId})`);
          return;
        }

        // Handle log notifications
        if (message.method === 'logsNotification' && message.params?.result) {
          messageCount++;
          const { signature, err } = message.params.result.value;

          if (messageCount === 1) {
            log.success('Receiving pump.fun activity!');
          }

          if (!err) {
            log.info(`  TX: ${signature.slice(0, 20)}...`);
          }

          // After 3 messages, test is complete
          if (messageCount >= 3) {
            log.success(`Received ${messageCount} pump.fun transactions`);
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        }
      } catch (error) {
        log.warn(`Parse error: ${(error as Error).message}`);
      }
    });

    ws.on('error', (error) => {
      log.error(`WebSocket error: ${error.message}`);
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      log.info('WebSocket closed');
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const useMainnet = args.includes('--mainnet');

  try {
    // Always test basic slot subscription
    await testWebSocket();

    // Test pump.fun subscription on mainnet only
    if (useMainnet) {
      await testPumpFunSubscription();
    } else {
      log.warn('\nSkipping pump.fun subscription test (mainnet only)');
      log.info('Use --mainnet to test pump.fun listener');
    }

    console.log(`\n${colors.green}All WebSocket tests passed!${colors.reset}\n`);
    process.exit(0);
  } catch (error) {
    console.log(`\n${colors.red}WebSocket tests failed: ${(error as Error).message}${colors.reset}\n`);
    process.exit(1);
  }
}

main();

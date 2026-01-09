/**
 * Backup Command - Export private keys for RAPTOR v2.3
 *
 * Allows users to export their private keys for backup.
 * Keys are shown once and the message auto-deletes after 60 seconds.
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import {
  getUserWallet,
  markBackupExported,
  decryptPrivateKey,
  type EncryptedData,
} from '@raptor/shared';

/**
 * Main backup command
 */
export async function backupCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // Check if user has a wallet
  const wallet = await getUserWallet(user.id);
  if (!wallet) {
    await ctx.reply(
      '❌ You don\'t have a wallet yet.\n\nUse /start to generate your wallet first.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const message = `🔐 *Export Private Keys*

⚠️ *WARNING - READ CAREFULLY:*

• Your private keys give *FULL ACCESS* to your funds
• *NEVER* share them with anyone
• Store them securely (password manager, paper wallet)
• Keys will be shown *ONCE* - save them immediately
• This message will auto-delete after 60 seconds

━━━━━━━━━━━━━━━━━━━━━━

*Your Addresses:*
🟣 Solana: \`${wallet.solana_address}\`
⚪ EVM: \`${wallet.evm_address}\`

━━━━━━━━━━━━━━━━━━━━━━

Tap "Show Keys" to reveal your private keys.`;

  const keyboard = new InlineKeyboard()
    .text('🔓 Show Keys', 'backup_confirm')
    .row()
    .text('❌ Cancel', 'back_to_start');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Handle backup confirmation callback
 */
export async function handleBackupConfirm(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Get user's wallet
    const wallet = await getUserWallet(user.id);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Decrypt private keys
    const solanaKey = decryptPrivateKey(wallet.solana_private_key_encrypted as EncryptedData);
    const evmKey = decryptPrivateKey(wallet.evm_private_key_encrypted as EncryptedData);

    const message = `🔐 *YOUR PRIVATE KEYS*

━━━━━━━━━━━━━━━━━━━━━━

🟣 *Solana (ED25519)*

Address:
\`${wallet.solana_address}\`

Private Key (Base58):
\`${solanaKey}\`

_Import into: Phantom, Solflare_

━━━━━━━━━━━━━━━━━━━━━━

⚪ *EVM (BSC/Base/ETH)*

Address:
\`${wallet.evm_address}\`

Private Key (Hex):
\`${evmKey}\`

_Import into: MetaMask, Trust Wallet_

━━━━━━━━━━━━━━━━━━━━━━

⚠️ *SAVE THESE NOW*
This message will be deleted in 60 seconds.

🚨 *NEVER SHARE THESE KEYS WITH ANYONE*`;

    // Mark backup as exported
    await markBackupExported(user.id);

    // Edit message to show keys
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
    });

    await ctx.answerCallbackQuery({ text: 'Keys revealed - save them now!' });

    // Schedule message deletion after 60 seconds
    const chatId = ctx.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    if (chatId && messageId) {
      setTimeout(async () => {
        try {
          await ctx.api.deleteMessage(chatId, messageId);
        } catch (error) {
          // Message may already be deleted
          console.log('[Backup] Could not delete message, may already be gone');
        }
      }, 60000);
    }

  } catch (error) {
    console.error('[Backup] Error showing keys:', error);
    await ctx.answerCallbackQuery({ text: 'Error decrypting keys' });
  }
}

/**
 * Show wallet info (addresses only, no keys)
 */
export async function showWalletInfo(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const wallet = await getUserWallet(user.id);
  if (!wallet) {
    await ctx.editMessageText(
      '❌ You don\'t have a wallet yet.\n\nUse /start to generate your wallet.',
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  const hasBackup = wallet.backup_exported_at !== null;
  const backupStatus = hasBackup
    ? `✅ Exported on ${new Date(wallet.backup_exported_at!).toLocaleDateString()}`
    : '⚠️ Not backed up yet';

  const message = `🔐 *Your Wallet*

━━━━━━━━━━━━━━━━━━━━━━

🟣 *Solana*
\`${wallet.solana_address}\`

⚪ *EVM (BSC/Base/ETH)*
\`${wallet.evm_address}\`

━━━━━━━━━━━━━━━━━━━━━━

*Backup Status:* ${backupStatus}
*Created:* ${new Date(wallet.created_at).toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━━━━

⚠️ *Important:* Back up your keys to avoid losing access to your funds.`;

  const keyboard = new InlineKeyboard()
    .text('🔐 Export Private Keys', 'backup_start')
    .row()
    .text('← Back', 'back_to_start');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

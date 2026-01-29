// =============================================================================
// RAPTOR Hunter Observer
// Posts real-time observability events to a Telegram channel.
// This is a read-only monitoring feed, not a data pipeline.
//
// - Direct Telegram API calls (not the notification outbox, which is user-scoped)
// - Fire-and-forget: failures are logged but never block the pipeline
// - Rate-limited to avoid Telegram API throttling
// =============================================================================

import {
  formatDetection,
  formatScoring,
  formatTradeResult,
  type DetectionEvent,
  type ScoringEvent,
  type TradeResultEvent,
} from './formatters.js';

export interface ObserverConfig {
  botToken: string;
  channelId: string;
  enabled: boolean;
}

const MAX_MESSAGES_PER_MINUTE = 20;

export class HunterObserver {
  private config: ObserverConfig;
  private messageCount = 0;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(config: ObserverConfig) {
    this.config = config;

    if (config.enabled) {
      // Reset message counter every minute
      this.resetTimer = setInterval(() => {
        this.messageCount = 0;
      }, 60_000);
      // Don't keep process alive just for this timer
      this.resetTimer.unref();

      console.log(`[HunterObserver] Enabled, posting to channel ${config.channelId}`);
    }
  }

  async postDetection(event: DetectionEvent): Promise<void> {
    if (!this.config.enabled) return;
    const text = formatDetection(event);
    await this.sendMessage(text);
  }

  async postScoringResult(event: ScoringEvent): Promise<void> {
    if (!this.config.enabled) return;
    const text = formatScoring(event);
    await this.sendMessage(text);
  }

  async postTradeResult(event: TradeResultEvent): Promise<void> {
    if (!this.config.enabled) return;
    const text = formatTradeResult(event);
    await this.sendMessage(text);
  }

  stop(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
      this.resetTimer = null;
    }
  }

  private async sendMessage(text: string): Promise<void> {
    if (this.messageCount >= MAX_MESSAGES_PER_MINUTE) {
      return; // Rate limited, silently drop
    }

    this.messageCount++;

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.channelId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => 'unknown');
        console.error(`[HunterObserver] Telegram API error ${res.status}: ${body}`);
      }
    } catch (error) {
      console.error('[HunterObserver] Send failed:', (error as Error).message);
    }
  }
}

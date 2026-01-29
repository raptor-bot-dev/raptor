import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleWithdrawInput: vi.fn(async () => true),
}));

vi.mock('../handlers/withdrawHandler.js', () => ({
  handleWithdrawInput: mocks.handleWithdrawInput,
}));

import { handleTextMessage } from '../handlers/messages.js';
import { SESSION_STEPS } from '../ui/callbackIds.js';

describe('withdraw flow routing', () => {
  it('routes panel withdrawal address input to withdrawHandler.handleWithdrawInput', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { text: 'DestinationAddress11111111111111111111111111' },
      session: {
        step: 'awaiting_withdrawal_address',
        pendingWithdrawal: null,
        withdrawUi: 'panel',
      },
    };

    await handleTextMessage(ctx);

    expect(mocks.handleWithdrawInput).toHaveBeenCalledTimes(1);
    expect(mocks.handleWithdrawInput).toHaveBeenCalledWith(
      ctx,
      SESSION_STEPS.AWAITING_WITHDRAWAL_ADDRESS,
      'DestinationAddress11111111111111111111111111'
    );
  });

  it('routes panel withdrawal percent input to withdrawHandler.handleWithdrawInput', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { text: '25' },
      session: {
        step: 'awaiting_withdrawal_percent',
        pendingWithdrawal: { chain: 'sol', walletIndex: 1, address: 'Dest111111111111111111111111111111111' },
        withdrawUi: 'panel',
      },
    };

    await handleTextMessage(ctx);

    expect(mocks.handleWithdrawInput).toHaveBeenCalledWith(
      ctx,
      SESSION_STEPS.AWAITING_WITHDRAWAL_PERCENT,
      '25'
    );
  });
});


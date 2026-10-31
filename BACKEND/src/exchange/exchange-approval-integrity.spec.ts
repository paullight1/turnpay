import { ConfigService } from '@nestjs/config';
import { ExchangeService } from './exchange.service';

describe('Legacy exchange approval is not settlement', () => {
  it('keeps money pending and does not pretend a notification was delivered', async () => {
    const payout = {
      id: 'payout',
      userId: 'user',
      transactionId: 'tx',
      status: 'PENDING_APPROVAL',
      sourceCurrency: 'NGN',
      destinationCurrency: 'GHS',
      sourceAmount: '100.00',
      destinationAmount: '1.00',
      rate: '0.01',
      fee: '0.00',
      destinationBankName: 'Synthetic',
      destinationAccountNumber: '***1234',
      destinationAccountName: 'Synthetic Owner',
      notificationSent: false,
      user: { isSuspended: false },
      transaction: {
        id: 'tx',
        reference: 'legacy-reference',
        status: 'PENDING',
      },
    };
    const db = {
      $transaction: jest.fn(),
      exchangePayout: {
        findUnique: jest.fn().mockResolvedValue(payout),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    db.$transaction.mockImplementation(async (fn) => fn(db));
    const service = new ExchangeService(
      db as never,
      {} as never,
      {} as never,
      new ConfigService(),
      { info: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    await service.approvePayout('payout', 'admin', {
      status: 'APPROVED',
      reason: 'Source funds independently verified',
    });
    expect(db.transaction.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUCCESS' } }),
    );
    expect(db.exchangePayout.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notificationSent: true }),
      }),
    );
  });
});

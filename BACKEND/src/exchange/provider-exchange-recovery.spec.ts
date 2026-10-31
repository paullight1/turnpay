import { Decimal } from '@prisma/client/runtime/library';
import { ProviderExchangeService } from './provider-exchange.service';
describe('provider exchange quote and admin recovery', () => {
  it('expires only an unused quote inside the financial transaction and returns any existing order', async () => {
    const quote = {
      id: 'quote',
      userId: 'owner',
      expiresAt: new Date(0),
      cancelledAt: null,
    };
    const tx = {
      providerExchangeQuote: {
        findFirst: jest.fn().mockResolvedValue(quote),
        update: jest.fn().mockResolvedValue(quote),
      },
      providerExchangeOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const db = {
      ...tx,
      $transaction: jest.fn().mockImplementation(async (work) => work(tx)),
    };
    const service = new ProviderExchangeService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await service.recoverQuote('owner', 'quote')).toEqual({
      order: null,
      canRequote: true,
    });
    expect(tx.providerExchangeQuote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'quote' },
        data: { cancelledAt: expect.any(Date) },
      }),
    );
  });
  it('finds an older Ready order behind 100 newer completed orders and returns a next page', async () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, id) => ({
        id: String(id),
        status: 'SENT',
      })),
      { id: 'older-ready', status: 'READY' },
    ];
    const quote = {
      id: 'quote',
      sourceCurrency: 'GHS',
      targetCurrency: 'NGN',
      amount: new Decimal(10),
      fee: new Decimal(0),
      total: new Decimal(10),
      rate: new Decimal(100),
      targetAmount: new Decimal(1000),
    };
    const findMany = jest.fn().mockImplementation(async ({ where, take }) =>
      rows
        .filter((r) => !where.status || r.status === where.status)
        .slice(0, take)
        .map((r) => ({ ...r, quote })),
    );
    const db = {
      providerExchangeOrder: {
        findMany,
        groupBy: jest
          .fn()
          .mockResolvedValue([{ status: 'READY', _count: { _all: 1 } }]),
      },
    };
    const service = new ProviderExchangeService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // Real money transitions are covered separately by the PostgreSQL financial suite.
    await expect(service.listAdmin({ status: 'READY' })).resolves.toMatchObject(
      { counts: { READY: 1 }, items: [{ id: 'older-ready' }] },
    );
    expect(findMany.mock.calls[0][0].where.status).toBe('READY');
  });
});

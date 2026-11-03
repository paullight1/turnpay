import { ExchangeController } from './exchange.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminUpdateRateDto } from './dto/exchange.dto';

describe('ExchangeController rate updates', () => {
  it.each([
    { from: 'NGN', to: 'GHS', rate: 0.0086, markup: 0 },
    { from: 'GHS', to: 'NGN', rate: 116.28 },
    {
      from: 'NGN',
      to: 'GHS',
      rate: 87,
      quoteBasis: 'SOURCE_PER_TARGET',
    },
  ])('accepts the simplified rate payload: %j', async (payload) => {
    const dto = plainToInstance(AdminUpdateRateDto, payload);
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
  });

  it('applies an admin rate immediately without an approval or reason', async () => {
    const exchangeService = {} as never;
    const setManualRate = jest.fn().mockResolvedValue({
      rate: 0.31,
      inputRate: 0.31,
      quoteBasis: 'TARGET_PER_SOURCE',
      canonicalRate: 0.31,
      markup: 0,
      effectiveRate: 0.31,
    });
    const rateService = { setManualRate } as never;
    const rateAlertService = {} as never;
    const controller = new ExchangeController(
      exchangeService,
      rateService,
      rateAlertService,
    );

    const result = await controller.updateRate(
      { userId: 'admin-1' },
      {
        from: 'NGN',
        to: 'GHS',
        rate: 0.31,
      },
    );

    expect(setManualRate).toHaveBeenCalledWith(
      'NGN',
      'GHS',
      0.31,
      0,
      'admin-1',
      undefined,
      undefined,
      { quoteBasis: undefined },
    );
    expect(result).toMatchObject({
      success: true,
      from: 'NGN',
      to: 'GHS',
      rate: 0.31,
      markup: 0,
      inputRate: 0.31,
      quoteBasis: 'TARGET_PER_SOURCE',
      baseRate: 0.31,
      effectiveRate: 0.31,
    });
  });

  it('returns the normalized persisted rate and markup to the admin', async () => {
    const controller = new ExchangeController(
      {} as never,
      {
        setManualRate: jest.fn().mockResolvedValue({
          rate: 0.0086,
          inputRate: 0.0086,
          quoteBasis: 'TARGET_PER_SOURCE',
          canonicalRate: 0.0086,
          markup: 2.35,
          effectiveRate: 0.008398,
        }),
      } as never,
      {} as never,
    );
    const result = await controller.updateRate(
      { userId: 'admin-1' },
      {
        from: 'NGN',
        to: 'GHS',
        rate: 0.0085999,
        markup: 2.3456,
      },
    );
    expect(result.rate).toBe(0.0086);
    expect(result.markup).toBe(2.35);
    expect(result.effectiveRate).toBeCloseTo(0.008398, 12);
  });

  it('passes explicit source-per-target units through to the rate service', async () => {
    const setManualRate = jest.fn().mockResolvedValue({
      rate: 87,
      inputRate: 87,
      quoteBasis: 'SOURCE_PER_TARGET',
      canonicalRate: 1 / 87,
      markup: 0,
      effectiveRate: 1 / 87,
    });
    const controller = new ExchangeController(
      {} as never,
      { setManualRate } as never,
      {} as never,
    );

    const result = await controller.updateRate(
      { userId: 'admin-1' },
      {
        from: 'NGN',
        to: 'GHS',
        rate: 87,
        quoteBasis: 'SOURCE_PER_TARGET',
      },
    );

    expect(setManualRate).toHaveBeenCalledWith(
      'NGN',
      'GHS',
      87,
      0,
      'admin-1',
      undefined,
      undefined,
      { quoteBasis: 'SOURCE_PER_TARGET' },
    );
    expect(result).toMatchObject({
      rate: 87,
      inputRate: 87,
      quoteBasis: 'SOURCE_PER_TARGET',
    });
    expect(result.baseRate).toBeCloseTo(1 / 87, 6);
    expect(result.effectiveRate).toBeCloseTo(1 / 87, 6);
  });
});

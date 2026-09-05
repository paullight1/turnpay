import { ExchangeController } from './exchange.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminUpdateRateDto } from './dto/exchange.dto';

describe('ExchangeController rate updates', () => {
  it.each([
    { from: 'NGN', to: 'GHS', rate: 0.0086, markup: 0 },
    { from: 'GHS', to: 'NGN', rate: 116.28 },
  ])('accepts the simplified rate payload: %j', async (payload) => {
    const dto = plainToInstance(AdminUpdateRateDto, payload);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('applies an admin rate immediately without an approval or reason', async () => {
    const exchangeService = {} as never;
    const setManualRate = jest.fn().mockResolvedValue(undefined);
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
    );
    expect(result).toMatchObject({
      success: true,
      from: 'NGN',
      to: 'GHS',
      rate: 0.31,
      markup: 0,
      effectiveRate: 0.31,
    });
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { KoraReadinessController } from './kora-readiness.controller';
describe('Kora admin readiness', () => {
  const capabilities = {
    get: () => ({
      enabled: true,
      configured: true,
      activationStatus: 'UNCONFIRMED',
    }),
  };
  it('requires both authentication and admin authorization', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, KoraReadinessController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        // Metadata lookup needs the original function identity; it never calls the method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        KoraReadinessController.prototype.readiness,
      ),
    ).toBe(5);
    expect(Reflect.getMetadata('roles', KoraReadinessController)).toEqual([
      'ADMIN',
    ]);
  });
  it('reports safe read-only diagnostics without claiming activation', async () => {
    const payouts = {
      balance: jest.fn().mockResolvedValue({ toFixed: () => '25.00' }),
      sendMomo: jest.fn(),
    };
    const controller = new KoraReadinessController(
      capabilities as never,
      payouts as never,
      new ConfigService(),
    );
    expect(await controller.readiness()).toMatchObject({
      enabled: true,
      activationStatus: 'UNCONFIRMED',
      balance: { currency: 'GHS', available: '25.00' },
    });
    expect(payouts.sendMomo).not.toHaveBeenCalled();
  });
  it('keeps provider errors safe and disabled installations offline', async () => {
    const payouts = {
      balance: jest
        .fn()
        .mockRejectedValue(new Error('sensitive provider body')),
    };
    const controller = new KoraReadinessController(
      capabilities as never,
      payouts as never,
      new ConfigService(),
    );
    expect(JSON.stringify(await controller.readiness())).not.toContain(
      'sensitive',
    );
    const disabled = new KoraReadinessController(
      { get: () => ({ enabled: false, configured: false }) } as never,
      payouts as never,
      new ConfigService(),
    );
    payouts.balance.mockClear();
    await disabled.readiness();
    expect(payouts.balance).not.toHaveBeenCalled();
  });
});

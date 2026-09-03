import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalTransfersAvailabilityGuard } from './internal-transfers-availability.guard';

describe('InternalTransfersAvailabilityGuard', () => {
  const configWith = (value: unknown) =>
    ({
      get: jest.fn().mockReturnValue(value),
    }) as unknown as ConfigService;

  it.each([undefined, null, false, 'false', 'true', 1])(
    'blocks transfers unless the validated flag is exactly true (value: %p)',
    (value) => {
      const guard = new InternalTransfersAvailabilityGuard(configWith(value));

      expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);

      try {
        guard.canActivate();
      } catch (error) {
        expect((error as ServiceUnavailableException).getResponse()).toEqual({
          statusCode: 503,
          code: 'INTERNAL_TRANSFERS_UNAVAILABLE',
          message: 'Internal transfers are temporarily unavailable',
        });
      }
    },
  );

  it('allows transfers only when the validated flag is true', () => {
    const guard = new InternalTransfersAvailabilityGuard(configWith(true));

    expect(guard.canActivate()).toBe(true);
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { InternalTransferLimitService } from './internal-transfer-limit.service';

describe('InternalTransferLimitService', () => {
  const prisma = {
    internalTransferLimitPolicy: {
      findFirst: jest.fn(),
    },
  };
  let service: InternalTransferLimitService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalTransferLimitService(prisma as never);
  });

  it('loads a policy by both currency and KYC tier', async () => {
    prisma.internalTransferLimitPolicy.findFirst.mockResolvedValue({
      id: 'ngn-tier-2-v1',
      currency: 'NGN',
      kycTier: 'TIER_2',
      perTransaction: new Decimal('250000.00'),
      daily: new Decimal('1000000.00'),
      monthly: new Decimal('5000000.00'),
      enabled: true,
      version: 1,
    });

    await service.getActivePolicy(prisma, 'NGN', 'TIER_2');

    expect(prisma.internalTransferLimitPolicy.findFirst).toHaveBeenCalledWith({
      where: {
        currency: 'NGN',
        kycTier: 'TIER_2',
        enabled: true,
        effectiveFrom: { lte: expect.any(Date) },
      },
      orderBy: { version: 'desc' },
    });
  });

  it.each([null, undefined])(
    'fails closed when no enabled policy is available (%p)',
    async (policy) => {
      prisma.internalTransferLimitPolicy.findFirst.mockResolvedValue(policy);

      await expect(
        service.getActivePolicy(prisma as never, 'GHS', 'TIER_2'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'TRANSFER_POLICY_UNAVAILABLE',
        }),
      });
    },
  );

  it('accepts the exact per-transaction boundary', () => {
    expect(() =>
      service.assertAmountWithinPolicy(new Decimal('250000.00'), {
        perTransaction: new Decimal('250000.00'),
      }),
    ).not.toThrow();
  });

  it('rejects one minor unit above the per-transaction boundary', () => {
    expect(() =>
      service.assertAmountWithinPolicy(new Decimal('250000.01'), {
        perTransaction: new Decimal('250000.00'),
      }),
    ).toThrow('Internal transfer limit exceeded');
  });

  it('does not reuse an NGN policy for GHS', async () => {
    prisma.internalTransferLimitPolicy.findFirst.mockResolvedValue(null);

    await expect(
      service.getActivePolicy(prisma as never, 'GHS', 'TIER_3'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.internalTransferLimitPolicy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ currency: 'GHS' }),
      }),
    );
  });
});

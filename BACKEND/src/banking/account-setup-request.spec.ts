import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BankingService } from './banking.service';

describe('Receiving account setup intent', () => {
  let service: BankingService;
  let saved: any;
  let prisma: any;
  const provider = { configured: true, provisionVirtualAccount: jest.fn() };
  const notifications = {
    accountReady: jest.fn().mockResolvedValue(undefined),
  };
  beforeEach(() => {
    saved = null;
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'u1', isSuspended: false }),
      },
      paystackCustomer: { findUnique: jest.fn().mockResolvedValue(null) },
      paystackAccountRequest: {
        findUnique: jest.fn(async () => saved),
        create: jest.fn(),
        createMany: jest.fn(async ({ data }) => {
          if (saved) return { count: 0 };
          saved = { id: 'request-1', ...data[0] };
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn(async () => saved),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    service = new BankingService(
      prisma,
      {} as any,
      {} as any,
      {
        get: (key, fallback) =>
          key === 'BANKING_PROVIDER_PRIMARY'
            ? 'paystack'
            : ['BANKING_ENABLED', 'VIRTUAL_ACCOUNTS_ENABLED'].includes(key)
              ? true
              : fallback,
      } as any,
      { warn: jest.fn(), info: jest.fn() } as any,
      provider as any,
      undefined,
      notifications as never,
    );
    provider.provisionVirtualAccount.mockClear();
    notifications.accountReady.mockClear();
  });
  it('saves consent before KYC without creating or exposing a bank account', async () => {
    const result = await service.requestAccountSetup('u1', {
      consentAccepted: true,
    });
    expect(result).toMatchObject({
      status: 'WAITING_FOR_KYC',
      provider: 'PAYSTACK',
    });
    expect(saved).toMatchObject({
      userId: 'u1',
      consentRecordedAt: expect.any(Date),
    });
    expect('accountNumber' in result).toBe(false);
    expect(provider.provisionVirtualAccount).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('repeated requests reuse the saved consent and do not restart preparation', async () => {
    await service.requestAccountSetup('u1', { consentAccepted: true });
    saved.status = 'PENDING';
    const result = await service.requestAccountSetup('u1', {
      consentAccepted: true,
    });
    expect(result.status).toBe('PENDING');
    expect(prisma.paystackAccountRequest.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('reuses a provider request created concurrently with setup consent', async () => {
    prisma.paystackAccountRequest.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error('unique request conflict'), {
        code: 'P2002',
      });
    });
    prisma.paystackAccountRequest.createMany = jest.fn(async () => {
      saved = {
        id: 'provider-request',
        status: 'PENDING',
        consentRecordedAt: new Date(),
      };
      return { count: 0 };
    });
    prisma.paystackAccountRequest.findUniqueOrThrow = jest.fn(
      async () => saved,
    );
    await expect(
      service.requestAccountSetup('u1', { consentAccepted: true }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects absent consent without persisting a request', async () => {
    await expect(
      service.requestAccountSetup('u1', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paystackAccountRequest.createMany).not.toHaveBeenCalled();
  });
  it('starts a consented request immediately when BVN and Tier 1 are already verified', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isSuspended: false,
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      customerCode: 'CUS_owner',
      validationStatus: 'VERIFIED',
    });
    const prepare = jest
      .spyOn(service, 'provisionVirtualAccount')
      .mockImplementation(async () => {
        saved.status = 'ACTIVE';
        return { status: 'ACTIVE' } as never;
      });
    await expect(
      service.requestAccountSetup('u1', { consentAccepted: true }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(prepare).toHaveBeenCalledWith('u1', {
      currency: 'NGN',
      provider: 'paystack',
    });
    expect(saved.consentRecordedAt).toEqual(expect.any(Date));
  });
  it('does not restart an in-flight request when a verified customer repeats consent', async () => {
    await service.requestAccountSetup('u1', { consentAccepted: true });
    saved.status = 'PENDING';
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isSuspended: false,
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      validationStatus: 'VERIFIED',
    });
    const prepare = jest.spyOn(service, 'provisionVirtualAccount');
    await expect(
      service.requestAccountSetup('u1', { consentAccepted: true }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not accept requests from suspended users', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isSuspended: true });
    await expect(
      service.requestAccountSetup('u1', { consentAccepted: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.paystackAccountRequest.createMany).not.toHaveBeenCalled();
  });
  it('keeps actual account creation blocked before verified Tier 1', async () => {
    await service.requestAccountSetup('u1', { consentAccepted: true });
    await expect(
      service.provisionVirtualAccount('u1', {
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(saved.status).toBe('WAITING_FOR_KYC');
    expect(provider.provisionVirtualAccount).not.toHaveBeenCalled();
  });

  it('only schedules requests belonging to active, BVN-verified Tier 1 owners', async () => {
    prisma.paystackAccountRequest.findMany = jest.fn().mockResolvedValue([]);
    await service.retryPaystackAccountPreparation();
    expect(prisma.paystackAccountRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'WAITING_FOR_KYC'] },
          user: {
            is: {
              isSuspended: false,
              kycStatus: 'VERIFIED',
              kycTier: { in: ['TIER_1', 'TIER_2'] },
              paystackCustomer: { is: { validationStatus: 'VERIFIED' } },
            },
          },
        }),
      }),
    );
  });
  it('does not expose or reactivate a disabled receiving account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isSuspended: false,
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.virtualAccount = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'disabled',
        status: 'DISABLED',
        accountNumber: '0123456789',
        accountName: 'Test Customer',
        bankName: 'Synthetic Bank',
      }),
    };
    await expect(
      service.provisionVirtualAccount('u1', {
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).rejects.toThrow('disabled');
    expect(provider.provisionVirtualAccount).not.toHaveBeenCalled();
  });

  it('uses saved pre-KYC consent when verified account preparation starts', async () => {
    await service.requestAccountSetup('u1', { consentAccepted: true });
    const consent = saved.consentRecordedAt;
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
      phone: '+2348012345678',
      fullName: 'Test Customer',
      isSuspended: false,
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue({
      customerCode: 'CUS_owner',
      validationStatus: 'VERIFIED',
    });
    prisma.paystackCustomer.update = jest.fn().mockResolvedValue({});
    const account = {
      id: 'account-1',
      accountNumber: '0123456789',
      accountName: 'Test Customer',
      bankName: 'Test Bank',
      status: 'ACTIVE',
      currency: 'NGN',
    };
    prisma.virtualAccount = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(account),
    };
    prisma.paystackAccountRequest.update = jest.fn().mockResolvedValue({});
    provider.provisionVirtualAccount.mockResolvedValue(account);
    await expect(
      service.provisionVirtualAccount('u1', {
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).resolves.toEqual(account);
    expect(prisma.paystackCustomer.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { accountSetupConsentAt: consent },
    });
    expect(prisma.paystackAccountRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(notifications.accountReady).toHaveBeenCalledWith(
      prisma,
      'u1',
      'account-1',
    );
  });
  it('marks deterministic worker failures as action required instead of retrying forever', async () => {
    const queued = {
      id: 'request-1',
      userId: 'u1',
      status: 'WAITING_FOR_KYC',
      updatedAt: new Date(),
    };
    prisma.paystackAccountRequest.findMany = jest
      .fn()
      .mockResolvedValue([queued]);
    prisma.paystackAccountRequest.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    jest
      .spyOn(service, 'provisionVirtualAccount')
      .mockRejectedValue(new BadRequestException('Missing legal name'));
    await service.retryPaystackAccountPreparation();
    expect(prisma.paystackAccountRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'request-1',
          updatedAt: queued.updatedAt,
        }),
        data: expect.objectContaining({
          status: 'ACTION_REQUIRED',
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it('backs off failures that happen before provider preparation', async () => {
    prisma.paystackAccountRequest.findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'request-1', userId: 'u1', updatedAt: new Date() },
      ]);
    prisma.paystackAccountRequest.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    jest
      .spyOn(service, 'provisionVirtualAccount')
      .mockRejectedValue(new Error('temporary dependency failure'));
    await service.retryPaystackAccountPreparation();
    expect(prisma.paystackAccountRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextAttemptAt: expect.any(Date) }),
      }),
    );
  });

  it('reconciles request status when a usable account was already saved', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isSuspended: false,
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_1',
    });
    const account = {
      accountNumber: '0123456789',
      accountName: 'Test Customer',
      bankName: 'Test Bank',
      status: 'ACTIVE',
    };
    prisma.virtualAccount = {
      findUnique: jest.fn().mockResolvedValue(account),
    };
    prisma.paystackAccountRequest.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    await expect(
      service.provisionVirtualAccount('u1', {
        currency: 'NGN',
        provider: 'paystack',
      }),
    ).resolves.toEqual(account);
    expect(prisma.paystackAccountRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1' }),
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(provider.provisionVirtualAccount).not.toHaveBeenCalled();
  });
});

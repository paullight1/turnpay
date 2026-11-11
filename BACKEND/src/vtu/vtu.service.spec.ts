import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { VtuService } from './vtu.service';
import { financialRequestIdentity } from '../common/utils/financial-request';

describe('VtuService purchase ledger handling', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    vtuOrder: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    paymentNotification: {
      createMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    vtuPricingRule: {
      findFirst: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
    },
    webhookLog: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any): Promise<unknown> => fn(prisma)),
  };

  const walletsService = {
    getWallet: jest.fn(),
  };

  const vtuApi = {
    getProviders: jest.fn(),
    getPackages: jest.fn(),
    validateSmartCard: jest.fn(),
    validateMeter: jest.fn(),
    validateSmile: jest.fn(),
    getInternationalCountries: jest.fn(),
    purchase: jest.fn(),
    requery: jest.fn(),
    getProviderName: jest.fn(),
    createProviderRequestId: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const ledger = {
    debitWallet: jest.fn(),
    creditWallet: jest.fn(),
  };
  const transactionPin = {
    verifyRequired: jest.fn(),
  };
  const settlementHold = {
    assertOutboundAllowed: jest.fn(),
  };

  let service: VtuService;

  beforeEach(() => {
    jest.clearAllMocks();
    transactionPin.verifyRequired.mockReset().mockResolvedValue(undefined);
    prisma.transaction.findUnique.mockReset().mockResolvedValue(null);
    configService.get.mockImplementation((key: string) => {
      if (key === 'VTU_KYC_BYPASS') {
        return false;
      }
      return undefined;
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      kycStatus: 'VERIFIED',
      kycTier: 'TIER_2',
      isSuspended: false,
    });
    vtuApi.getProviders.mockResolvedValue([
      { id: 'mtn', name: 'MTN', type: 'airtime', isActive: true },
      { id: 'mtn', name: 'MTN', type: 'data', isActive: true },
    ]);
    vtuApi.getPackages.mockResolvedValue([
      {
        id: 'mtn-1gb',
        name: '1GB',
        price: '300.00',
        validity: '30 days',
        serviceType: 'data',
      },
    ]);
    vtuApi.getProviderName.mockReturnValue('VTPASS');
    vtuApi.createProviderRequestId.mockImplementation(
      (reference: string) => `202605211500${reference.replace(/\W/g, '')}`,
    );
    prisma.vtuOrder.create.mockResolvedValue({
      id: 'order-1',
    });
    prisma.vtuOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.vtuPricingRule.findFirst.mockResolvedValue(null);
    settlementHold.assertOutboundAllowed.mockResolvedValue(undefined);
    prisma.webhookLog.findUnique.mockResolvedValue({
      id: 'webhook-log-1',
      reference: 'vtpass:transaction-update:REQ-1:provider-vtu-1:success',
      processed: false,
    });
    prisma.webhookLog.update.mockResolvedValue({});
    service = new VtuService(
      prisma as never,
      walletsService as any,
      vtuApi as any,
      configService as any,
      logger as any,
      ledger as any,
      transactionPin as any,
      {
        encryptPurchasedCode: jest.fn((value?: string) =>
          value ? `encrypted:${value}` : undefined,
        ),
        toOwnerReceipt: jest.fn((value?: string | null) =>
          value ? { purchasedCode: '1234-5678-9012' } : {},
        ),
      } as any,
      settlementHold as any,
    );
  });

  it.each(['pending', 'unknown'])(
    'keeps a terminal purchase and receipt when the initial provider response is late (%s)',
    async (kind) => {
      const state = {
        transactionStatus: 'SUCCESS',
        orderStatus: 'SUCCESS',
        metadata: { requestFingerprint: 'original', providerStatus: 'success' },
        code: 'receipt',
      };
      const db = {
        transaction: {
          update: jest.fn(async ({ data }) => {
            state.metadata = data.metadata;
          }),
          updateMany: jest.fn(async ({ where, data }) => {
            if (where.status !== state.transactionStatus) return { count: 0 };
            if (data.metadata) state.metadata = data.metadata;
            return { count: 1 };
          }),
        },
        vtuOrder: {
          update: jest.fn(async ({ data }) => {
            state.orderStatus = data.status;
            state.code = data.purchasedCodeEncrypted ?? state.code;
          }),
          updateMany: jest.fn(async ({ where, data }) => {
            if (!where.status.in.includes(state.orderStatus))
              return { count: 0 };
            state.orderStatus = data.status;
            return { count: 1 };
          }),
          findUnique: jest.fn(async () => ({
            id: 'order-1',
            requeryAttempts: 1,
            status: state.orderStatus,
          })),
        },
        paymentNotification: { createMany: jest.fn() },
        auditLog: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementationOnce(async (fn) => fn(db));
      const purchase = { reference: 'VTU-1', orderId: 'order-1' };
      if (kind === 'unknown')
        await (service as any).markProviderResultUnknown(purchase, {
          providerStatus: 'UNKNOWN',
        });
      else
        await (service as any).markProviderResultPending(
          purchase,
          { status: 'pending', reference: 'provider' },
          { providerStatus: 'pending' },
        );
      expect(state).toEqual({
        transactionStatus: 'SUCCESS',
        orderStatus: 'SUCCESS',
        metadata: { requestFingerprint: 'original', providerStatus: 'success' },
        code: 'receipt',
      });
    },
  );

  it('recovers the original purchase after service disablement and a PIN reset without dispatching new work', async () => {
    const dto = {
      type: 'airtime' as const,
      provider: 'mtn' as const,
      amount: '100.00',
      contactPhone: '+2348031234567',
      recipientNumber: '+2348031234567',
      transactionPin: '1234',
    };
    const identity = financialRequestIdentity('VTU', 'user-1', 'original-key', {
      ...dto,
      amount: '100.00',
    });
    prisma.transaction.findUnique.mockResolvedValueOnce({
      userId: 'user-1',
      reference: identity.reference,
      status: 'PENDING',
      amount: new Decimal('100.00'),
      fee: new Decimal(0),
      metadata: { requestFingerprint: identity.fingerprint },
      vtuOrders: [{ id: 'original-order' }],
    });
    configService.get.mockImplementation((key: string) =>
      key === 'VTU_ENABLED' ? false : undefined,
    );
    transactionPin.verifyRequired.mockRejectedValueOnce(
      new Error('PIN reset hold'),
    );
    const response = await service.purchase('user-1', dto, 'original-key');
    expect(response).toMatchObject({
      reference: identity.reference,
      orderId: 'original-order',
      status: 'PENDING',
    });
    expect(vtuApi.purchase).not.toHaveBeenCalled();
    expect(transactionPin.verifyRequired).not.toHaveBeenCalled();
  });

  it('does not advertise service-specific forms to older mobile clients', async () => {
    vtuApi.getProviders.mockResolvedValue([
      { id: 'mtn', type: 'airtime', isActive: true },
      { id: 'smile-airtime', type: 'airtime', isActive: true },
    ]);
    await expect(service.getProviders('airtime')).resolves.toEqual([
      { id: 'mtn', type: 'airtime', isActive: true },
    ]);
    await expect(
      (service as any).getProviders('airtime', true),
    ).resolves.toHaveLength(2);
  });

  it.each([
    ['smile-airtime', 'airtime'],
    ['smile', 'data'],
    ['glo-sme', 'data'],
    ['9mobile-sme', 'data'],
    ['showmax', 'cable'],
    ['foreign-airtime', 'airtime'],
  ])(
    'reserves NGN and completes a %s purchase through the existing ledger',
    async (provider, type) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'buyer@example.com',
        kycStatus: 'VERIFIED',
        kycTier: 'TIER_2',
        isSuspended: false,
      });
      vtuApi.getProviders.mockResolvedValue([
        { id: provider, type, isActive: true },
      ]);
      vtuApi.getPackages.mockResolvedValue([
        { id: 'plan-1', price: '1000', serviceType: type },
      ]);
      vtuApi.validateSmile.mockResolvedValue({
        name: 'Smile Customer',
        accounts: [{ id: '1111111111', name: 'Home' }],
      });
      vtuApi.getInternationalCountries.mockResolvedValue([
        { code: 'GH', prefix: '233' },
      ]);
      walletsService.getWallet.mockResolvedValue({
        id: 'wallet-1',
        balance: new Decimal(5000),
      });
      prisma.transaction.create.mockResolvedValue({
        id: 'tx-1',
        reference: 'VTU-1',
      });
      vtuApi.purchase.mockResolvedValue({
        status: 'success',
        reference: 'TX-1',
        providerRequestId: 'REQ-1',
        providerTransactionId: 'TX-1',
        message: 'Delivered',
        safeResponse: {},
        rawResponse: {},
      });
      const result = await service.purchase(
        'user-1',
        {
          type,
          provider,
          amount: '1000',
          expectedTotal: '1000',
          packageId: 'plan-1',
          contactPhone: '+2348031234567',
          recipientNumber:
            provider === 'foreign-airtime' ? '+233241234567' : '+2348031234567',
          smileEmail: 'smile@example.com',
          smileAccountId: '1111111111',
          countryCode: 'GH',
          operatorId: '5',
        } as any,
        'test-idempotency-key',
      );
      expect(result).toMatchObject({
        success: true,
        amount: '1000',
        totalDebit: '1000',
      });
      expect(ledger.debitWallet).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'NGN', amount: new Decimal(1000) }),
        prisma,
      );
      expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scope: provider === 'foreign-airtime' ? 'INTERNATIONAL' : 'LOCAL',
          countryCode: provider === 'foreign-airtime' ? 'GH' : 'NG',
          currency: 'NGN',
        }),
      });
      if (provider === 'showmax')
        expect(vtuApi.validateSmartCard).not.toHaveBeenCalled();
      if (provider === 'foreign-airtime')
        expect(vtuApi.purchase).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'buyer@example.com',
            countryCode: 'GH',
            operatorId: '5',
          }),
        );
    },
  );
  it('does not debit when the reviewed total no longer matches the server fee', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348031234567',
          recipientNumber: '+2348031234567',
          amount: '1000',
          expectedTotal: '999',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('Total price changed');
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('quotes international flexible plans from the provider rate in NGN', async () => {
    vtuApi.getProviders.mockResolvedValue([
      { id: 'foreign-airtime', type: 'airtime', isActive: true },
    ]);
    vtuApi.getPackages.mockResolvedValue([
      {
        id: 'flex',
        serviceType: 'airtime',
        price: '0',
        fixedPrice: false,
        rate: '125.25',
        minFaceValue: '5',
        maxFaceValue: '100',
      },
    ]);
    const quote = await (service as any).quote({
      type: 'airtime',
      provider: 'foreign-airtime',
      countryCode: 'GH',
      operatorId: '5',
      packageId: 'flex',
      faceValue: '10',
    });
    expect(quote).toMatchObject({
      amount: '1252.50',
      fee: '0.00',
      totalDebit: '1252.50',
      currency: 'NGN',
    });
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });
  it('rejects a Smile account that is not returned for the verified email before debiting', async () => {
    vtuApi.getProviders.mockResolvedValue([
      { id: 'smile', type: 'data', isActive: true },
    ]);
    vtuApi.validateSmile.mockResolvedValue({
      name: 'Customer',
      accounts: [{ id: '1111111111', name: 'Account' }],
    });
    await expect(
      service.purchase(
        'user-1',
        {
          type: 'data',
          provider: 'smile',
          smileEmail: 'user@example.com',
          smileAccountId: '9999999999',
          packageId: '413',
          amount: '1000',
          contactPhone: '+2348031234567',
        } as any,
        'test-idempotency-key',
      ),
    ).rejects.toThrow('Smile account');
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });
  it('rejects international flexible amounts outside provider limits before debiting', async () => {
    vtuApi.getProviders.mockResolvedValue([
      { id: 'foreign-airtime', type: 'airtime', isActive: true },
    ]);
    vtuApi.getPackages.mockResolvedValue([
      {
        id: 'flex',
        serviceType: 'airtime',
        price: '0',
        fixedPrice: false,
        rate: '125.25',
        minFaceValue: '5',
        maxFaceValue: '100',
      },
    ]);
    await expect(
      (service as any).quote({
        type: 'airtime',
        provider: 'foreign-airtime',
        countryCode: 'GH',
        operatorId: '5',
        packageId: 'flex',
        faceValue: '101',
      }),
    ).rejects.toThrow();
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('creates a pending VTU transaction and debits wallet through the ledger', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Airtime delivered',
    });

    const result = await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: expect.any(Decimal),
        transactionId: 'tx-1',
        source: 'VTU_PURCHASE',
        metadata: expect.objectContaining({
          vtuType: 'airtime',
          provider: 'mtn',
          recipientNumberMasked: expect.any(String),
        }),
      }),
      prisma,
    );
    expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx-1',
        provider: 'VTPASS',
        scope: 'LOCAL',
        serviceType: 'AIRTIME',
        countryCode: 'NG',
        localProvider: 'mtn',
        providerRequestId: expect.stringMatching(/^202605211500/),
        status: 'PENDING',
        targetMasked: expect.any(String),
      }),
    });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        metadata: expect.objectContaining({
          providerReference: 'provider-vtu-1',
        }),
      },
    });
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-1');
    expect(settlementHold.assertOutboundAllowed).toHaveBeenCalledWith({
      operation: 'VTU',
      scope: 'VTU_SETTLEMENT',
      currency: 'NGN',
      reference: 'VTU-1',
    });
  });

  it('rejects a local cable purchase when smartcard verification fails', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(20000),
    });
    vtuApi.getProviders.mockResolvedValue([
      { id: 'dstv', name: 'DStv', type: 'cable', isActive: true },
    ]);
    vtuApi.validateSmartCard.mockRejectedValue(
      new BadRequestException(
        'We could not verify this customer number. Check it and try again.',
      ),
    );

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'cable',
          provider: 'dstv',
          contactPhone: '+2348012345678',
          smartCardNumber: '1234567890',
          subscriptionType: 'change',
          packageId: 'dstv-padi',
          amount: '4400',
        },
        'test-idempotency-key',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(vtuApi.validateSmartCard).toHaveBeenCalledWith('dstv', '1234567890');
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it('releases the reservation when reconciliation blocks VTU dispatch', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    settlementHold.assertOutboundAllowed.mockRejectedValueOnce(
      new Error('reconciliation hold'),
    );

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '500',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('reconciliation hold');

    expect(vtuApi.purchase).not.toHaveBeenCalled();
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal('500'),
        transactionId: 'tx-1',
        source: 'VTU_REVERSAL',
      }),
      prisma,
    );
  });

  it('verifies the meter and stores the customer details before electricity purchase', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(20000),
    });
    vtuApi.getProviders.mockResolvedValue([
      {
        id: 'ikedc',
        name: 'Ikeja Electric',
        type: 'electricity',
        isActive: true,
      },
    ]);
    vtuApi.validateMeter.mockResolvedValue({
      name: 'ADA OBI',
      address: '12 Allen Avenue, Ikeja',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(15000),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Token generated',
    });

    const result = await service.purchase(
      'user-1',
      {
        type: 'electricity',
        provider: 'ikedc',
        contactPhone: '+2348012345678',
        meterNumber: '45028701',
        meterType: 'postpaid',
        amount: '5000',
      },
      'test-idempotency-key',
    );

    expect(vtuApi.validateMeter).toHaveBeenCalledWith(
      'ikedc',
      '45028701',
      'postpaid',
    );
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          verifiedCustomerName: 'ADA OBI',
          verifiedCustomerAddress: '12 Allen Avenue, Ikeja',
          meterNumberMasked: expect.any(String),
        }),
      }),
      prisma,
    );
    expect(result.success).toBe(true);
  });

  it('applies the highest-priority matching VTU pricing rule to wallet debit and transaction fee', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.vtuPricingRule.findFirst.mockResolvedValue({
      id: 'rule-1',
      fixedMargin: new Decimal(10),
      percentMargin: new Decimal(2.5),
      createdAt: new Date(),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Airtime delivered',
    });

    const result = await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(prisma.vtuPricingRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          AND: expect.arrayContaining([
            { OR: [{ countryCode: null }, { countryCode: 'NG' }] },
            { OR: [{ serviceType: null }, { serviceType: 'AIRTIME' }] },
            { OR: [{ provider: null }, { provider: 'mtn' }] },
            { OR: [{ scope: null }, { scope: 'LOCAL' }] },
          ]),
        }),
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: expect.any(Decimal),
        fee: expect.any(Decimal),
        metadata: expect.objectContaining({
          pricingRuleId: 'rule-1',
          marginFee: '22.5',
          debitAmount: '522.5',
        }),
      }),
    });
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: new Decimal('522.5'),
      }),
      prisma,
    );
    expect(prisma.vtuOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fee: new Decimal('22.5'),
        margin: new Decimal('22.5'),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        fee: '22.5',
        totalDebit: '522.5',
      }),
    );
  });

  it('requires verified KYC before allowing VTU purchase', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      kycStatus: 'PENDING',
      isSuspended: false,
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '500',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('KYC verification is required');

    expect(walletsService.getWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it('fails closed before any financial work when VTU is disabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'VTU_ENABLED') return false;
      return undefined;
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '500',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('VTU services are temporarily unavailable');
    expect(transactionPin.verifyRequired).not.toHaveBeenCalled();
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('allows VTU purchase when the KYC bypass flag is enabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'VTU_KYC_BYPASS') {
        return true;
      }
      return undefined;
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      kycStatus: 'PENDING',
      kycTier: 'TIER_0',
      isSuspended: false,
    });
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Airtime delivered',
    });

    await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(walletsService.getWallet).toHaveBeenCalledWith('user-1', 'NGN');
    expect(vtuApi.purchase).toHaveBeenCalled();
  });

  it('rejects data bundle purchases when client amount does not match provider package price', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'data',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '1',
          packageId: 'mtn-1gb',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('Package price mismatch');

    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it('rejects renewal verification without a provider price but permits package selection', async () => {
    vtuApi.validateSmartCard.mockResolvedValue({
      name: 'Test customer',
      status: 'active',
    });
    const dto = {
      provider: 'dstv' as const,
      smartCardNumber: '1212121212',
      contactPhone: '+2348011111111',
      subscriptionType: 'renew' as const,
    };
    await expect(service.validateSmartCard(dto)).rejects.toThrow(
      'Choose Change package',
    );
    await expect(
      service.validateSmartCard({ ...dto, subscriptionType: 'change' }),
    ).resolves.toEqual({ name: 'Test customer', status: 'active' });
    expect(ledger.debitWallet).not.toHaveBeenCalled();
    expect(vtuApi.purchase).not.toHaveBeenCalled();
  });

  it('uses the verified renewal amount for cable renewals', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(20000),
    });
    vtuApi.getProviders.mockResolvedValue([
      { id: 'dstv', name: 'DStv', type: 'cable', isActive: true },
    ]);
    vtuApi.validateSmartCard.mockResolvedValue({
      name: 'ADA OBI',
      status: 'active',
      renewalAmount: '6500.00',
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      providerRequestId: 'REQ-1',
      providerTransactionId: 'provider-vtu-1',
      status: 'success',
      message: 'Renewed',
      safeResponse: {},
      rawResponse: {},
    });

    await service.purchase(
      'user-1',
      {
        type: 'cable',
        provider: 'dstv',
        contactPhone: '+2348012345678',
        smartCardNumber: '1234567890',
        subscriptionType: 'renew',
        amount: '6500.00',
      },
      'test-idempotency-key',
    );

    expect(vtuApi.getPackages).not.toHaveBeenCalled();
    expect(vtuApi.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionType: 'renew',
        packageId: undefined,
        amount: '6500.00',
      }),
    );
    expect(ledger.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({ amount: new Decimal('6500.00') }),
      prisma,
    );
  });

  it('rejects a client-supplied cable renewal price that differs from verification', async () => {
    vtuApi.getProviders.mockResolvedValue([
      { id: 'dstv', name: 'DStv', type: 'cable', isActive: true },
    ]);
    vtuApi.validateSmartCard.mockResolvedValue({
      name: 'ADA OBI',
      status: 'active',
      renewalAmount: '6500.00',
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'cable',
          provider: 'dstv',
          contactPhone: '+2348012345678',
          smartCardNumber: '1234567890',
          subscriptionType: 'renew',
          amount: '6400.00',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow('Cable renewal price mismatch');
    expect(ledger.debitWallet).not.toHaveBeenCalled();
  });

  it('persists provider economics and an encrypted delivered code', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(10000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      providerRequestId: 'REQ-1',
      providerTransactionId: 'provider-vtu-1',
      status: 'success',
      message: 'Delivered',
      providerCost: '495.00',
      providerCommission: '5.00',
      purchasedCode: '1234-5678-9012',
      safeResponse: { code: '000', status: 'delivered' },
      rawResponse: { code: '000', status: 'delivered' },
    });

    const result = await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        costAmount: new Decimal('495.00'),
        providerCommission: new Decimal('5.00'),
        purchasedCodeEncrypted: 'encrypted:1234-5678-9012',
        rawResponse: { code: '000', status: 'delivered' },
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({ purchasedCode: '1234-5678-9012' }),
    );
  });

  it('returns a decrypted purchased code only through the owner order endpoint', async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      provider: 'VTPASS',
      scope: 'LOCAL',
      serviceType: 'ELECTRICITY',
      countryCode: 'NG',
      localProvider: 'ikedc',
      operatorId: null,
      providerRequestId: 'REQ-1',
      providerTransactionId: 'TX-1',
      providerStatus: 'success',
      status: 'SUCCESS',
      amount: new Decimal('5000'),
      fee: new Decimal('25'),
      currency: 'NGN',
      targetMasked: '******01',
      purchasedCodeEncrypted: 'encrypted:1234-5678-9012',
      requeryAttempts: 0,
      lastRequeryAt: null,
      nextRequeryAt: null,
      completedAt: new Date(),
      failedAt: null,
      transaction: {
        id: 'tx-1',
        reference: 'VTU-1',
        status: 'SUCCESS',
        amount: new Decimal('5000'),
        currency: 'NGN',
        type: 'ELECTRICITY',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await expect(service.getOrderStatus('user-1', 'VTU-1')).resolves.toEqual(
      expect.objectContaining({
        purchasedCode: '1234-5678-9012',
        fee: '25',
        totalDebit: '5025',
      }),
    );
  });

  it('leaves VTU purchase pending when provider result is unknown', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockRejectedValue(new Error('VTU provider result unknown'));

    const result = await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { reference: 'VTU-1', status: 'PENDING' },
      data: {
        metadata: expect.objectContaining({
          providerStatus: 'UNKNOWN',
        }),
      },
    });
    expect(result).toEqual({
      success: false,
      status: 'PENDING',
      reference: 'VTU-1',
      orderId: 'order-1',
      message:
        'VTU purchase submitted and pending provider confirmation. Funds remain reserved until verification completes.',
      amount: '500',
      fee: '0',
      totalDebit: '500',
    });
  });

  it('leaves provider pending responses pending without reversing wallet', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    ledger.debitWallet.mockResolvedValue({
      balanceAfter: new Decimal(4500),
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'pending',
      message: 'TRANSACTION IS PROCESSING',
    });

    const result = await service.purchase(
      'user-1',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500',
      },
      'test-idempotency-key',
    );

    expect(ledger.creditWallet).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { reference: 'VTU-1', status: 'PENDING' },
      data: {
        metadata: expect.objectContaining({
          providerReference: 'provider-vtu-1',
          providerStatus: 'pending',
        }),
      },
    });
    expect(result).toEqual({
      success: false,
      status: 'PENDING',
      reference: 'VTU-1',
      orderId: 'order-1',
      message: 'TRANSACTION IS PROCESSING',
      amount: '500',
      fee: '0',
      totalDebit: '500',
    });
  });

  it('escalates the twelfth unresolved provider check into an action-required state', async () => {
    const order = {
      id: 'order-1',
      transactionId: 'tx-1',
      provider: 'VTPASS',
      providerRequestId: 'REQ-1',
      providerTransactionId: null,
      status: 'UNKNOWN',
      requeryAttempts: 11,
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'PENDING',
        metadata: {},
      },
    };
    prisma.vtuOrder.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, requeryAttempts: 12 });
    vtuApi.requery.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'pending',
      message: 'Still processing',
    });
    prisma.paymentNotification.createMany.mockResolvedValue({ count: 1 });

    await expect(service.requeryOrder('order-1')).resolves.toEqual({
      processed: true,
      status: 'pending',
    });

    expect(prisma.vtuOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requeryAttempts: { increment: 1 } }),
      }),
    );
    expect(prisma.paymentNotification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventKey: 'vtu:requery-exhausted:order-1',
          orderId: 'order-1',
          audience: 'ADMIN',
        }),
      ],
      skipDuplicates: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'VTU_REQUERY_EXHAUSTED',
        targetType: 'VtuOrder',
        targetId: 'order-1',
        reference: 'VTU-1',
      }),
    });
  });

  it('exposes exhausted unresolved orders as customer action required without offering a replacement', async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      provider: 'VTPASS',
      scope: 'LOCAL',
      serviceType: 'AIRTIME',
      countryCode: 'NG',
      localProvider: 'mtn',
      operatorId: null,
      providerRequestId: 'REQ-1',
      providerTransactionId: null,
      providerStatus: 'pending',
      status: 'UNKNOWN',
      amount: new Decimal(500),
      fee: new Decimal(0),
      currency: 'NGN',
      targetMasked: '******1234',
      purchasedCodeEncrypted: null,
      requeryAttempts: 12,
      lastRequeryAt: new Date(),
      nextRequeryAt: null,
      completedAt: null,
      failedAt: null,
      transaction: {
        id: 'tx-1',
        reference: 'VTU-1',
        status: 'PENDING',
        amount: new Decimal(500),
        currency: 'NGN',
        type: 'AIRTIME',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await expect(service.getOrderStatus('user-1', 'VTU-1')).resolves.toEqual(
      expect.objectContaining({
        orderStatus: 'UNKNOWN',
        actionRequired: true,
        actionRequiredCode: 'VTU_MANUAL_RECOVERY_REQUIRED',
        customerAction:
          'Keep this reference and contact support. Do not start a replacement purchase while the provider result is unresolved.',
      }),
    );
  });

  it('blocks automatic customer requery after escalation while allowing supervised admin recovery', async () => {
    prisma.vtuOrder.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      status: 'UNKNOWN',
      requeryAttempts: 12,
      transaction: { status: 'PENDING' },
    });

    await expect(service.requeryOrder('order-1')).resolves.toEqual({
      processed: false,
      actionRequired: true,
      status: 'UNKNOWN',
    });
    expect(vtuApi.requery).not.toHaveBeenCalled();
  });

  it('backfills an exhausted order without calling the provider again', async () => {
    prisma.vtuOrder.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'order-1', requeryAttempts: 12 }]);
    prisma.vtuOrder.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      status: 'UNKNOWN',
      providerStatus: 'pending',
      requeryAttempts: 12,
      nextRequeryAt: null,
      transaction: { status: 'PENDING', reference: 'VTU-1' },
    });
    prisma.paymentNotification.createMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.requeryPendingOrders()).resolves.toEqual({
      checked: 1,
      results: [{ orderId: 'order-1', processed: false, actionRequired: true }],
    });
    expect(vtuApi.requery).not.toHaveBeenCalled();
  });

  it('returns the committed terminal replay after a late initial success response', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    const fingerprint = financialRequestIdentity(
      'VTU',
      'user-1',
      'test-idempotency-key',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500.00',
      },
    ).fingerprint;
    prisma.transaction.findUnique
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        status: 'REVERSED',
        amount: new Decimal(500),
        fee: new Decimal(0),
        metadata: { requestFingerprint: fingerprint },
        vtuOrders: [{ id: 'order-1', purchasedCodeEncrypted: null }],
      });
    ledger.debitWallet.mockResolvedValue({ balanceAfter: new Decimal(4500) });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Delivered',
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '500',
        },
        'test-idempotency-key',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'REVERSED',
        reference: 'VTU-1',
        orderId: 'order-1',
      }),
    );
  });

  it('does not report a misleading failure when a late initial failure follows a committed success', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    const fingerprint = financialRequestIdentity(
      'VTU',
      'user-1',
      'test-idempotency-key',
      {
        type: 'airtime',
        provider: 'mtn',
        contactPhone: '+2348012345678',
        recipientNumber: '+2348012345678',
        amount: '500.00',
      },
    ).fingerprint;
    prisma.transaction.findUnique
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        status: 'SUCCESS',
        amount: new Decimal(500),
        fee: new Decimal(0),
        metadata: { requestFingerprint: fingerprint },
        vtuOrders: [{ id: 'order-1', purchasedCodeEncrypted: null }],
      });
    prisma.transaction.updateMany.mockResolvedValueOnce({ count: 0 });
    ledger.debitWallet.mockResolvedValue({ balanceAfter: new Decimal(4500) });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'failed',
      message: 'Provider rejected request',
    });

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'airtime',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '500',
        },
        'test-idempotency-key',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'SUCCESS', orderId: 'order-1' }),
    );
  });

  it('requeries stale pending VTU orders and finalizes success', async () => {
    prisma.vtuOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      provider: 'VTPASS',
      providerRequestId: 'REQ-1',
      providerTransactionId: null,
      status: 'PENDING',
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'PENDING',
      },
    });
    vtuApi.requery.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'success',
      message: 'Delivered',
    });

    const result = await service.requeryOrder('order-1');

    expect(vtuApi.requery).toHaveBeenCalledWith('REQ-1');
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        metadata: expect.objectContaining({
          providerReference: 'provider-vtu-1',
          providerStatus: 'success',
        }),
      },
    });
    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'SUCCESS',
        providerTransactionId: 'provider-vtu-1',
        providerStatus: 'success',
        nextRequeryAt: null,
      }),
    });
    expect(result).toEqual({ processed: true, status: 'success' });
  });

  it('repairs a legacy order status mismatch when its transaction is already terminal', async () => {
    prisma.vtuOrder.findUnique.mockResolvedValue({
      id: 'order-legacy',
      transactionId: 'tx-legacy',
      provider: 'VTPASS',
      providerRequestId: 'REQ-LEGACY',
      providerTransactionId: 'TX-LEGACY',
      status: 'PENDING',
      requeryAttempts: 2,
      transaction: {
        id: 'tx-legacy',
        userId: 'user-1',
        reference: 'VTU-LEGACY',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'SUCCESS',
        metadata: {},
      },
    });
    vtuApi.requery.mockResolvedValue({
      reference: 'TX-LEGACY',
      providerRequestId: 'REQ-LEGACY',
      providerTransactionId: 'TX-LEGACY',
      status: 'success',
    });
    prisma.transaction.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(service.requeryOrder('order-legacy')).resolves.toEqual({
      processed: false,
      terminal: true,
    });
    expect(prisma.vtuOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-legacy',
        status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] },
      },
      data: expect.objectContaining({
        status: 'SUCCESS',
        nextRequeryAt: null,
      }),
    });
  });

  it('requeries a successful VTU order and applies a confirmed reversal', async () => {
    prisma.vtuOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      providerTransactionId: 'TX-1',
      status: 'SUCCESS',
      costAmount: new Decimal('485.00'),
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal('500.00'),
        fee: new Decimal('25.00'),
        currency: 'NGN',
        status: 'SUCCESS',
        metadata: {},
      },
    });
    vtuApi.requery.mockResolvedValue({
      reference: 'TX-1',
      providerTransactionId: 'TX-1',
      providerRequestId: 'REQ-1',
      status: 'reversed',
      message: 'TRANSACTION REVERSAL TO WALLET',
      providerAmount: '485.00',
      providerCurrency: 'NGN',
      walletCreditId: 'WALLET-CREDIT-1',
      providerCost: '485.00',
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await expect(service.requeryOrder('order-1')).resolves.toEqual({
      processed: true,
      status: 'reversed',
    });
    expect(vtuApi.requery).toHaveBeenCalledWith('REQ-1');
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: new Decimal('525.00'),
        currency: 'NGN',
        source: 'VTU_REVERSAL',
      }),
      prisma,
    );
  });

  it('reverses a failed VTU purchase through a single reversal ledger entry', async () => {
    walletsService.getWallet.mockResolvedValue({
      id: 'wallet-1',
      balance: new Decimal(5000),
    });
    prisma.transaction.create.mockResolvedValue({
      id: 'tx-1',
      reference: 'VTU-1',
    });
    vtuApi.purchase.mockResolvedValue({
      reference: 'provider-vtu-1',
      status: 'failed',
      message: 'Provider rejected request',
    });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.purchase(
        'user-1',
        {
          type: 'data',
          provider: 'mtn',
          contactPhone: '+2348012345678',
          recipientNumber: '+2348012345678',
          amount: '300',
          packageId: 'mtn-1gb',
        },
        'test-idempotency-key',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: expect.any(Decimal),
        transactionId: 'tx-1',
        reference: 'VTU-1-REVERSAL',
        source: 'VTU_REVERSAL',
      }),
      prisma,
    );
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { reference: 'VTU-1', status: 'PENDING' },
      data: {
        status: 'FAILED',
        metadata: expect.objectContaining({
          reversalReason: 'Provider rejected request',
        }),
      },
    });
  });

  it('finalizes a VTpass webhook success through the existing VTU order path', async () => {
    vtuApi.requery.mockResolvedValue({
      reference: 'TX-1',
      providerTransactionId: 'TX-1',
      providerRequestId: 'REQ-1',
      status: 'success',
    });
    prisma.webhookLog.findUnique.mockResolvedValue({
      id: 'webhook-log-1',
      reference: 'vtpass:transaction-update:REQ-1:TX-1:delivered',
      processed: false,
    });
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'PENDING',
      },
    });

    await expect(
      service.processVtpassWebhookEvent({
        eventType: 'transaction-update',
        providerRequestId: 'REQ-1',
        providerReference: 'TX-1',
        status: 'success',
        message: 'TRANSACTION DELIVERED',
        code: '000',
      }),
    ).resolves.toEqual({
      processed: true,
      orderId: 'order-1',
      status: 'success',
    });

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'tx-1', status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        metadata: {
          providerReference: 'TX-1',
          providerStatus: 'success',
          providerRequestId: 'REQ-1',
        },
      },
    });
    expect(prisma.vtuOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'SUCCESS',
        providerTransactionId: 'TX-1',
        providerStatus: 'success',
        nextRequeryAt: null,
      }),
    });
  });

  it('requeries and refunds a provider-confirmed reversal after local success', async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      providerTransactionId: 'TX-1',
      status: 'SUCCESS',
      costAmount: new Decimal('485.00'),
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal('500.00'),
        fee: new Decimal('25.00'),
        currency: 'NGN',
        status: 'SUCCESS',
        metadata: {},
      },
    });
    vtuApi.requery.mockResolvedValue({
      reference: 'TX-1',
      providerTransactionId: 'TX-1',
      providerRequestId: 'REQ-1',
      status: 'reversed',
      message: 'TRANSACTION REVERSAL TO WALLET',
      providerAmount: '485.00',
      providerCurrency: 'NGN',
      walletCreditId: 'WALLET-CREDIT-1',
      providerCost: '485.00',
      safeResponse: { code: '040', status: 'reversed' },
      rawResponse: { code: '040', status: 'reversed' },
    });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.processVtpassWebhookEvent({
        eventType: 'transaction-update',
        providerRequestId: 'REQ-1',
        providerReference: 'TX-1',
        status: 'reversed',
        message: 'TRANSACTION REVERSAL TO WALLET',
        code: '040',
      }),
    ).resolves.toMatchObject({
      processed: true,
      orderId: 'order-1',
      status: 'reversed',
    });

    expect(vtuApi.requery).toHaveBeenCalledWith('REQ-1');
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { reference: 'VTU-1', status: 'SUCCESS' },
      data: expect.objectContaining({
        status: 'REVERSED',
        metadata: expect.objectContaining({
          providerRequestId: 'REQ-1',
          providerTransactionId: 'TX-1',
          walletCreditId: 'WALLET-CREDIT-1',
        }),
      }),
    });
    expect(ledger.creditWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        currency: 'NGN',
        amount: new Decimal('525.00'),
        transactionId: 'tx-1',
        reference: 'VTU-1-REVERSAL',
        source: 'VTU_REVERSAL',
      }),
      prisma,
    );
  });

  it('keeps a late reversal callback retryable until requery confirms it', async () => {
    const successfulOrder = {
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      providerTransactionId: 'TX-1',
      status: 'SUCCESS',
      costAmount: new Decimal('485.00'),
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal('500.00'),
        fee: new Decimal('25.00'),
        currency: 'NGN',
        status: 'SUCCESS',
        metadata: {},
      },
    };
    prisma.vtuOrder.findFirst.mockResolvedValue(successfulOrder);
    vtuApi.requery
      .mockResolvedValueOnce({
        reference: 'TX-1',
        providerTransactionId: 'TX-1',
        providerRequestId: 'REQ-1',
        status: 'pending',
        message: 'Still processing',
      })
      .mockResolvedValueOnce({
        reference: 'TX-1',
        providerTransactionId: 'TX-1',
        providerRequestId: 'REQ-1',
        status: 'reversed',
        message: 'TRANSACTION REVERSAL TO WALLET',
        providerAmount: '485.00',
        providerCurrency: 'NGN',
        walletCreditId: 'WALLET-CREDIT-1',
        providerCost: '485.00',
      });
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.findFirst.mockResolvedValue(null);

    const event = {
      eventType: 'transaction-update' as const,
      providerRequestId: 'REQ-1',
      providerReference: 'TX-1',
      status: 'reversed' as const,
      message: 'TRANSACTION REVERSAL TO WALLET',
      code: '040',
    };

    await expect(service.processVtpassWebhookEvent(event)).rejects.toThrow(
      'VTU provider reversal not yet confirmed',
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();

    await expect(service.processVtpassWebhookEvent(event)).resolves.toEqual({
      processed: true,
      orderId: 'order-1',
      status: 'reversed',
    });
    expect(ledger.creditWallet).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'provider request identity',
      { providerRequestId: 'OTHER-REQUEST' },
      'VTU provider request identity mismatch',
    ],
    [
      'provider currency',
      { providerCurrency: 'GHS' },
      'VTU provider reversal currency mismatch',
    ],
    [
      'provider amount',
      { providerAmount: '484.99' },
      'VTU provider reversal amount mismatch',
    ],
    [
      'provider wallet credit',
      { walletCreditId: undefined },
      'VTU provider reversal wallet credit is missing',
    ],
  ])(
    'rejects a late reversal with an invalid %s',
    async (_field, override, message) => {
      prisma.vtuOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        transactionId: 'tx-1',
        providerRequestId: 'REQ-1',
        providerTransactionId: 'TX-1',
        status: 'SUCCESS',
        costAmount: new Decimal('485.00'),
        transaction: {
          id: 'tx-1',
          userId: 'user-1',
          reference: 'VTU-1',
          amount: new Decimal('500.00'),
          fee: new Decimal('25.00'),
          currency: 'NGN',
          status: 'SUCCESS',
          metadata: {},
        },
      });
      vtuApi.requery.mockResolvedValue({
        reference: 'TX-1',
        providerTransactionId: 'TX-1',
        providerRequestId: 'REQ-1',
        status: 'reversed',
        message: 'TRANSACTION REVERSAL TO WALLET',
        providerAmount: '485.00',
        providerCurrency: 'NGN',
        walletCreditId: 'WALLET-CREDIT-1',
        ...override,
      });

      await expect(
        service.processVtpassWebhookEvent({
          eventType: 'transaction-update',
          providerRequestId: 'REQ-1',
          providerReference: 'TX-1',
          status: 'reversed',
          code: '040',
        }),
      ).rejects.toThrow(message);
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      expect(ledger.creditWallet).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'failed', 'reversed'] as const)(
    'ignores callback %s when authenticated requery says pending',
    async (status) => {
      prisma.vtuOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        transactionId: 'tx-1',
        providerRequestId: 'REQ-1',
        transaction: { id: 'tx-1', status: 'PENDING', metadata: {} },
      });
      vtuApi.requery.mockResolvedValue({
        reference: 'VERIFIED-TX',
        providerRequestId: 'REQ-1',
        status: 'pending',
      });
      await expect(
        service.processVtpassWebhookEvent({
          eventType: 'transaction-update',
          providerRequestId: 'REQ-1',
          providerReference: 'UNTRUSTED-TX',
          status,
        }),
      ).resolves.toMatchObject({ status: 'pending' });
      expect(vtuApi.requery).toHaveBeenCalledWith('REQ-1');
      expect(prisma.vtuOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'VTPASS', providerRequestId: 'REQ-1' },
        }),
      );
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      expect(ledger.creditWallet).not.toHaveBeenCalled();
    },
  );

  it('leaves money unchanged and propagates provider errors for inbox retry', async () => {
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      providerRequestId: 'REQ-1',
      transaction: { status: 'PENDING' },
    });
    vtuApi.requery.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(
      service.processVtpassWebhookEvent({
        eventType: 'transaction-update',
        providerRequestId: 'REQ-1',
        status: 'failed',
      }),
    ).rejects.toThrow('Provider unavailable');
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal transaction when a late callback arrives', async () => {
    prisma.transaction.updateMany.mockResolvedValue({ count: 0 });
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'REVERSED',
        metadata: {},
      },
    });

    await service.processVtpassWebhookEvent({
      eventType: 'transaction-update',
      providerRequestId: 'REQ-1',
      providerReference: 'TX-1',
      status: 'success',
      message: 'Late delivery',
      code: '000',
    });

    expect(prisma.vtuOrder.update).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });

  it('does not regress a terminal order when a late pending callback arrives', async () => {
    prisma.vtuOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.vtuOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      transactionId: 'tx-1',
      providerRequestId: 'REQ-1',
      transaction: {
        id: 'tx-1',
        userId: 'user-1',
        reference: 'VTU-1',
        amount: new Decimal(500),
        fee: new Decimal(0),
        currency: 'NGN',
        status: 'SUCCESS',
        metadata: {},
      },
    });

    await service.processVtpassWebhookEvent({
      eventType: 'transaction-update',
      providerRequestId: 'REQ-1',
      providerReference: 'TX-1',
      status: 'pending',
      message: 'Late pending update',
      code: '099',
    });

    expect(prisma.vtuOrder.updateMany).not.toHaveBeenCalled();
    expect(vtuApi.requery).not.toHaveBeenCalled();
    expect(prisma.vtuOrder.update).not.toHaveBeenCalled();
    expect(ledger.creditWallet).not.toHaveBeenCalled();
  });
});

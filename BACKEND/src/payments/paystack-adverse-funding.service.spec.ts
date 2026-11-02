import { Decimal } from '@prisma/client/runtime/library';
import { PaystackAdverseFundingService } from './paystack-adverse-funding.service';

describe('PaystackAdverseFundingService', () => {
  const prisma = {
    fundingAdverseCase: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    paystackCustomer: { findUnique: jest.fn() },
    virtualAccount: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const paystack = { request: jest.fn(), page: jest.fn() };
  const ledger = {
    debitWallet: jest.fn(),
    debitWalletForAdverseFunding: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'PAYSTACK_SECRET_KEY') return 'sk_test_fixture';
      return fallback;
    }),
  };

  let service: PaystackAdverseFundingService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (tx: unknown) => unknown) => operation(prisma),
    );
    prisma.transaction.findUnique.mockImplementation(async ({ where }) =>
      where.reference === 'fund-reference'
        ? {
            id: 'funding-tx-1',
            userId: 'user-1',
            type: 'FUND',
            status: 'SUCCESS',
            reference: 'fund-reference',
            amount: new Decimal('100.00'),
            currency: 'NGN',
            metadata: {
              provider: 'PAYSTACK',
              customerCode: 'CUS_fixture',
            },
          }
        : null,
    );
    paystack.request
      .mockResolvedValueOnce({
        id: 123456,
        reference: 'fund-reference',
        status: 'success',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        customer: { customer_code: 'CUS_fixture' },
      })
      .mockResolvedValue({
        id: 77,
        status: 'pending',
        currency: 'NGN',
        domain: 'test',
        transaction: {
          reference: 'fund-reference',
          amount: 10000,
          currency: 'NGN',
          domain: 'test',
        },
      });
    prisma.fundingAdverseCase.upsert.mockResolvedValue({
      id: 'case-1',
      status: 'OPEN',
      verificationStatus: 'VERIFIED',
      holdRequired: true,
      exposureAmount: new Decimal('100.00'),
      recoveredAmount: new Decimal('0.00'),
    });
    prisma.fundingAdverseCase.update.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'case-1',
        status: 'OPEN',
        verificationStatus: 'VERIFIED',
        holdRequired: true,
        exposureAmount: new Decimal('100.00'),
        recoveredAmount: new Decimal('0.00'),
        ...data,
      }),
    );
    prisma.fundingAdverseCase.updateMany.mockResolvedValue({ count: 0 });
    prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    service = new PaystackAdverseFundingService(
      prisma as never,
      paystack as never,
      ledger as never,
      config as never,
    );
  });

  it('correlates a verified dispute to the original funding without debiting the wallet', async () => {
    const result = await service.processPaystackEvent({
      eventType: 'charge.dispute.create',
      providerReference: 'dispute-1',
      data: {
        id: 77,
        transaction: { reference: 'fund-reference' },
        currency: 'NGN',
        amount: 10000,
        domain: 'test',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        routed: 'adverse-funding',
        caseId: 'case-1',
      }),
    );
    expect(prisma.fundingAdverseCase.upsert).toHaveBeenCalled();
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('holds a Paystack adverse event when the local funding was already reversed', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'funding-tx-1',
      userId: 'user-1',
      type: 'FUND',
      status: 'REVERSED',
      reference: 'fund-reference',
      amount: new Decimal('100.00'),
      currency: 'NGN',
      metadata: {
        provider: 'PAYSTACK',
        customerCode: 'CUS_fixture',
      },
    });

    const result = await service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: 'refund-after-reversal',
      data: {
        transaction_reference: 'fund-reference',
        refund_reference: '9001',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
      },
    });

    expect(result).toEqual(expect.objectContaining({ reviewRequired: true }));
    expect(paystack.request).not.toHaveBeenCalled();
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('rebinds a legacy Paystack DVA funding row through the owned virtual account', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'funding-tx-1',
      userId: 'user-1',
      type: 'FUND',
      status: 'SUCCESS',
      reference: 'fund-reference',
      amount: new Decimal('100.00'),
      currency: 'NGN',
      metadata: {
        provider: 'PAYSTACK',
        channel: 'virtual_account',
        virtualAccountId: 'virtual-account-1',
      },
    });
    prisma.paystackCustomer.findUnique.mockResolvedValue(null);
    prisma.virtualAccount.findUnique.mockResolvedValue({
      userId: 'user-1',
      provider: 'PAYSTACK',
      providerCustomerId: 'CUS_fixture',
      currency: 'NGN',
    });

    await expect(
      service.processPaystackEvent({
        eventType: 'charge.dispute.create',
        providerReference: 'dispute-dva-1',
        data: {
          id: 77,
          transaction: { reference: 'fund-reference' },
          currency: 'NGN',
          amount: 10000,
          domain: 'test',
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ caseId: 'case-1' }));
    expect(prisma.virtualAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'virtual-account-1' } }),
    );
  });

  it('holds a FUND row from another provider instead of trusting a matching customer code', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'funding-tx-1',
      userId: 'user-1',
      type: 'FUND',
      status: 'SUCCESS',
      reference: 'fund-reference',
      amount: new Decimal('100.00'),
      currency: 'NGN',
      metadata: { provider: 'MONNIFY', customerCode: 'CUS_fixture' },
    });

    const result = await service.processPaystackEvent({
      eventType: 'charge.dispute.create',
      providerReference: 'dispute-other-provider',
      data: {
        id: 77,
        transaction: { reference: 'fund-reference' },
        currency: 'NGN',
        amount: 10000,
        domain: 'test',
      },
    });

    expect(result).toEqual(expect.objectContaining({ reviewRequired: true }));
    expect(prisma.paystackCustomer.findUnique).not.toHaveBeenCalled();
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('holds a Paystack event when the independently verified payment omits customer identity', async () => {
    paystack.request.mockReset();
    paystack.request.mockResolvedValueOnce({
      id: 123456,
      reference: 'fund-reference',
      status: 'success',
      amount: 10000,
      currency: 'NGN',
      domain: 'test',
    });

    const result = await service.processPaystackEvent({
      eventType: 'charge.dispute.create',
      providerReference: 'dispute-no-customer',
      data: {
        id: 77,
        transaction: { reference: 'fund-reference' },
        currency: 'NGN',
        amount: 10000,
        domain: 'test',
      },
    });

    expect(result).toEqual(expect.objectContaining({ reviewRequired: true }));
    expect(prisma.paystackCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('releases a dispute hold only when the provider dispute record confirms a decline', async () => {
    paystack.request.mockReset();
    paystack.request
      .mockResolvedValueOnce({
        id: 123456,
        reference: 'fund-reference',
        status: 'success',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        customer: { customer_code: 'CUS_fixture' },
      })
      .mockResolvedValueOnce({
        id: 77,
        status: 'resolved',
        resolution: 'declined',
        currency: 'NGN',
        domain: 'test',
        transaction: {
          reference: 'fund-reference',
          amount: 10000,
          currency: 'NGN',
          domain: 'test',
        },
      });

    const result = await service.processPaystackEvent({
      eventType: 'charge.dispute.resolve',
      providerReference: 'dispute-1',
      data: {
        id: 77,
        resolution: 'declined',
        transaction: { reference: 'fund-reference', amount: 10000 },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'RESOLVED',
        holdRequired: false,
      }),
    );
    expect(prisma.fundingAdverseCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RESOLVED',
          holdRequired: false,
        }),
      }),
    );
  });

  it('independently matches a processed refund when Paystack omits refund_reference', async () => {
    paystack.page.mockResolvedValue({
      data: [
        {
          id: 9001,
          status: 'processed',
          amount: 10000,
          currency: 'NGN',
          domain: 'test',
          transaction: 123456,
        },
      ],
    });

    const result = await service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: 'signed-body-digest',
      data: {
        transaction_reference: 'fund-reference',
        refund_reference: null,
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        routed: 'adverse-funding',
        caseId: 'case-1',
        status: 'OPEN',
        holdRequired: true,
        reviewRequired: true,
      }),
    );
    expect(paystack.page).toHaveBeenCalledWith('/refund', {
      transaction: '123456',
      currency: 'NGN',
      perPage: '100',
    });
    expect(prisma.fundingAdverseCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
          exposureAmount: new Decimal('100.00'),
        }),
      }),
    );
  });

  it('holds a processed refund whose provider transaction id does not match the verified funding', async () => {
    paystack.request.mockReset();
    paystack.request
      .mockResolvedValueOnce({
        id: 123456,
        reference: 'fund-reference',
        status: 'success',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        customer: { customer_code: 'CUS_fixture' },
      })
      .mockResolvedValueOnce({
        id: 9001,
        status: 'processed',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        transaction: 999999,
      });

    const result = await service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: 'refund-9001',
      data: {
        transaction_reference: 'fund-reference',
        refund_reference: '9001',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
      },
    });

    expect(result).toEqual(expect.objectContaining({ reviewRequired: true }));
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('keeps an unmatched signed event as a held review case instead of silently ignoring it', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);

    const result = await service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: 'refund-1',
      data: {
        transaction_reference: 'unknown-funding-reference',
        refund_reference: 'refund-1',
        amount: '10000',
        currency: 'NGN',
        domain: 'test',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        routed: 'adverse-funding',
        reviewRequired: true,
      }),
    );
    expect(prisma.fundingAdverseCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          holdRequired: true,
          status: 'UNDER_REVIEW',
          verificationStatus: 'UNMATCHED',
        }),
      }),
    );
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('rechecks a held unmatched event after the original funding arrives without touching the ledger', async () => {
    const storedPayload = {
      event: 'refund.processed',
      data: {
        transaction_reference: 'fund-reference',
        refund_reference: '9001',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
      },
    };
    prisma.transaction.findUnique.mockResolvedValue(null);

    const initial = await service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: 'refund-delivery-1',
      data: storedPayload.data,
      rawPayload: storedPayload,
    });

    expect(initial).toEqual(expect.objectContaining({ reviewRequired: true }));
    expect(prisma.fundingAdverseCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'UNDER_REVIEW',
          verificationStatus: 'UNMATCHED',
          holdRequired: true,
        }),
      }),
    );

    const heldCase = {
      id: 'case-1',
      status: 'UNDER_REVIEW',
      verificationStatus: 'UNMATCHED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-delivery-1',
      fundingReference: 'fund-reference',
      economicReference: null,
      transactionId: null,
      userId: null,
      currency: null,
      providerStatus: 'processed',
      exposureAmount: null,
      recoveredAmount: new Decimal('0.00'),
      payload: storedPayload,
    };
    prisma.fundingAdverseCase.findUnique.mockResolvedValue(heldCase);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'funding-tx-1',
      userId: 'user-1',
      type: 'FUND',
      status: 'SUCCESS',
      reference: 'fund-reference',
      amount: new Decimal('100.00'),
      currency: 'NGN',
      metadata: { provider: 'PAYSTACK', customerCode: 'CUS_fixture' },
    });
    paystack.request.mockReset();
    paystack.request
      .mockResolvedValueOnce({
        id: 123456,
        reference: 'fund-reference',
        status: 'success',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        customer: { customer_code: 'CUS_fixture' },
      })
      .mockResolvedValueOnce({
        id: 9001,
        status: 'processed',
        amount: 10000,
        currency: 'NGN',
        domain: 'test',
        transaction: 123456,
      });

    await expect(
      service.recheckCase('case-1', 'admin-1', {
        reason: 'The original Paystack credit is now independently available',
        operationKey: 'recheck-operation-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        caseId: 'case-1',
        status: 'OPEN',
        holdRequired: true,
        exposureAmount: '100.00',
        rechecked: true,
      }),
    );
    expect(prisma.fundingAdverseCase.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'case-1' },
        data: expect.objectContaining({
          verificationStatus: 'VERIFIED',
          status: 'OPEN',
          holdRequired: true,
          exposureAmount: new Decimal('100.00'),
          transactionId: 'funding-tx-1',
        }),
      }),
    );
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYSTACK_ADVERSE_FUNDING_RECHECKED',
          adminId: 'admin-1',
          targetId: 'case-1',
        }),
      }),
    );
  });

  it('does not reopen a resolved case during a provider recheck', async () => {
    prisma.fundingAdverseCase.findUnique.mockResolvedValue({
      id: 'case-resolved',
      status: 'RESOLVED',
      verificationStatus: 'VERIFIED',
      holdRequired: false,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-resolved',
      fundingReference: 'fund-reference',
      payload: {
        event: 'refund.processed',
        data: {
          transaction_reference: 'fund-reference',
          refund_reference: '9001',
        },
      },
    });

    await expect(
      service.recheckCase('case-resolved', 'admin-1', {
        reason: 'Confirm this case must remain permanently resolved',
        operationKey: 'recheck-resolved-1',
      }),
    ).rejects.toThrow('Only held OPEN or UNDER_REVIEW');
    expect(paystack.request).not.toHaveBeenCalled();
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
    expect(prisma.fundingAdverseCase.update).not.toHaveBeenCalled();
  });

  it('releases a held case only through an audited operator action', async () => {
    const heldCase = {
      id: 'case-1',
      status: 'UNDER_REVIEW',
      verificationStatus: 'UNMATCHED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-1',
      fundingReference: 'fund-reference',
      economicReference: 'refund:9001',
      providerStatus: 'processed',
      recoveredAmount: new Decimal('0.00'),
    };
    prisma.fundingAdverseCase.findUnique
      .mockResolvedValueOnce(heldCase)
      .mockResolvedValueOnce(heldCase);
    prisma.fundingAdverseCase.update.mockResolvedValue({
      ...heldCase,
      status: 'RESOLVED',
      holdRequired: false,
      recoveredAmount: new Decimal('0.00'),
    });

    await expect(
      service.resolveCase('case-1', 'admin-1', {
        action: 'RELEASE_HOLD',
        reason:
          'Operations reconciled the provider event against the statement',
      }),
    ).resolves.toMatchObject({
      caseId: 'case-1',
      status: 'RESOLVED',
      holdRequired: false,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYSTACK_ADVERSE_FUNDING_HOLD_RELEASED',
          adminId: 'admin-1',
          targetId: 'case-1',
        }),
      }),
    );
  });

  it('never collects a dispute case before a processed refund is independently confirmed', async () => {
    const disputeCase = {
      id: 'case-dispute',
      status: 'OPEN',
      verificationStatus: 'VERIFIED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'charge.dispute.create',
      providerReference: 'dispute-1',
      economicReference: 'dispute:77',
      fundingReference: 'fund-reference',
      transactionId: 'funding-tx-1',
      userId: 'user-1',
      currency: 'NGN',
      providerStatus: 'pending',
      exposureAmount: new Decimal('100.00'),
      recoveredAmount: new Decimal('0.00'),
    };
    prisma.fundingAdverseCase.findUnique
      .mockResolvedValueOnce(disputeCase)
      .mockResolvedValueOnce(disputeCase);

    await expect(
      service.resolveCase('case-dispute', 'admin-1', {
        action: 'COLLECT',
        amount: '40.00',
        operationKey: 'dispute-collection-1',
        reason: 'Dispute remains held until an actual refund is processed',
      }),
    ).rejects.toThrow('Only an independently verified processed refund');
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('caps overlapping refund cases by economic identity and original funding amount', async () => {
    const currentCase = {
      id: 'case-current',
      status: 'OPEN',
      verificationStatus: 'VERIFIED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-delivery-1',
      economicReference: 'refund:9001',
      fundingReference: 'fund-reference',
      transactionId: 'funding-tx-1',
      userId: 'user-1',
      currency: 'NGN',
      providerStatus: 'processed',
      exposureAmount: new Decimal('80.00'),
      recoveredAmount: new Decimal('0.00'),
    };
    const duplicateCase = {
      ...currentCase,
      id: 'case-duplicate',
      providerReference: 'refund-delivery-2',
      recoveredAmount: new Decimal('30.00'),
    };
    prisma.fundingAdverseCase.findUnique
      .mockResolvedValueOnce(currentCase)
      .mockResolvedValueOnce(currentCase);
    prisma.fundingAdverseCase.findMany.mockResolvedValue([
      currentCase,
      duplicateCase,
    ]);
    prisma.transaction.findUnique.mockImplementation(async ({ where }) =>
      where.reference
        ? null
        : {
            amount: new Decimal('100.00'),
            type: 'FUND',
            status: 'SUCCESS',
            currency: 'NGN',
          },
    );

    await expect(
      service.resolveCase('case-current', 'admin-1', {
        action: 'COLLECT',
        amount: '70.00',
        operationKey: 'overlap-collection-1',
        reason: 'Collection is bounded by the remaining original funding loss',
      }),
    ).rejects.toThrow('exceeds the unresolved verified refund exposure');
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });

  it('collects only an explicit bounded amount and leaves a short wallet held', async () => {
    const heldCase = {
      id: 'case-1',
      status: 'OPEN',
      verificationStatus: 'VERIFIED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-1',
      fundingReference: 'fund-reference',
      transactionId: 'funding-tx-1',
      userId: 'user-1',
      currency: 'NGN',
      exposureAmount: new Decimal('100.00'),
      recoveredAmount: new Decimal('0.00'),
      economicReference: 'refund:9001',
      providerStatus: 'processed',
    };
    prisma.fundingAdverseCase.findUnique
      .mockResolvedValueOnce(heldCase)
      .mockResolvedValueOnce(heldCase);
    prisma.fundingAdverseCase.findMany.mockResolvedValue([heldCase]);
    prisma.transaction.findUnique.mockImplementation(async ({ where }) =>
      where.reference
        ? null
        : {
            amount: new Decimal('100.00'),
            type: 'FUND',
            status: 'SUCCESS',
            currency: 'NGN',
          },
    );
    prisma.transaction.create.mockResolvedValue({
      id: 'recovery-tx-1',
      reference: 'fund-adverse-recovery',
    });
    prisma.fundingAdverseCase.update
      .mockResolvedValueOnce({ ...heldCase, holdRequired: false })
      .mockResolvedValueOnce({
        ...heldCase,
        status: 'UNDER_REVIEW',
        holdRequired: true,
        recoveredAmount: new Decimal('40.00'),
      });
    ledger.debitWalletForAdverseFunding.mockResolvedValue({
      balanceBefore: new Decimal('40.00'),
      balanceAfter: new Decimal('0.00'),
    });

    await expect(
      service.resolveCase('case-1', 'admin-1', {
        action: 'COLLECT',
        amount: '40.00',
        operationKey: 'collect-operation-1',
        reason: 'Collect verified refunded exposure after wallet review',
      }),
    ).resolves.toMatchObject({
      status: 'UNDER_REVIEW',
      holdRequired: true,
      recoveredAmount: '40.00',
    });
    expect(ledger.debitWalletForAdverseFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: new Decimal('40.00'),
        source: 'PAYSTACK_ADVERSE_RECOVERY',
      }),
      prisma,
    );
  });

  it('rechecks that the original funding is still credited before collecting', async () => {
    const heldCase = {
      id: 'case-1',
      status: 'OPEN',
      verificationStatus: 'VERIFIED',
      holdRequired: true,
      provider: 'PAYSTACK',
      eventType: 'refund.processed',
      providerReference: 'refund-1',
      fundingReference: 'fund-reference',
      transactionId: 'funding-tx-1',
      userId: 'user-1',
      currency: 'NGN',
      exposureAmount: new Decimal('100.00'),
      recoveredAmount: new Decimal('0.00'),
      economicReference: 'refund:9001',
      providerStatus: 'processed',
    };
    prisma.fundingAdverseCase.findUnique
      .mockResolvedValueOnce(heldCase)
      .mockResolvedValueOnce(heldCase);
    prisma.fundingAdverseCase.findMany.mockResolvedValue([heldCase]);
    prisma.transaction.findUnique.mockImplementation(async ({ where }) =>
      where.reference
        ? null
        : {
            amount: new Decimal('100.00'),
            type: 'FUND',
            status: 'REVERSED',
            currency: 'NGN',
          },
    );

    await expect(
      service.resolveCase('case-1', 'admin-1', {
        action: 'COLLECT',
        amount: '40.00',
        operationKey: 'reversed-funding-collection-1',
        reason: 'Do not recover against a funding transaction already reversed',
      }),
    ).rejects.toThrow('original funding transaction could not be revalidated');
    expect(ledger.debitWalletForAdverseFunding).not.toHaveBeenCalled();
  });
});

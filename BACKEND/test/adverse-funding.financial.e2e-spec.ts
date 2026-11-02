import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PaystackAdverseFundingService } from '../src/payments/paystack-adverse-funding.service';
import { SettlementHoldService } from '../src/common/services/settlement-hold.service';
import { LedgerService } from '../src/wallets/ledger.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  walletBalance,
  type FinancialTransferFixture,
} from './support/transfer-fixtures';

describe('Adverse funding financial controls (real PostgreSQL, fake Paystack)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture;
  let service: PaystackAdverseFundingService;
  let sourceReference: string;
  let paystack: { request: jest.Mock; page: jest.Mock };
  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(prisma, {
      senderBalance: '500.00',
      createPolicies: false,
    });
    sourceReference = `${fixture.prefix}-fund`;
    await prisma.transaction.create({
      data: {
        userId: fixture.users.sender.id,
        type: 'FUND',
        amount: '100.00',
        currency: 'NGN',
        status: 'SUCCESS',
        reference: sourceReference,
        metadata: {
          provider: 'PAYSTACK',
          channel: 'checkout',
          customerCode: 'CUS_financial_fixture',
        },
      },
    });
    paystack = {
      request: jest.fn(async (_method: string, path: string) => {
        if (path.startsWith('/transaction/verify/'))
          return {
            id: 551,
            reference: sourceReference,
            amount: 10000,
            currency: 'NGN',
            domain: 'test',
            status: 'success',
            customer: { customer_code: 'CUS_financial_fixture' },
          };
        if (path.startsWith('/refund/'))
          return {
            id: 11,
            status: 'processed',
            amount: 2000,
            currency: 'NGN',
            domain: 'test',
            transaction: 551,
          };
        if (path.startsWith('/dispute/'))
          return {
            id: 22,
            status: 'awaiting-merchant-feedback',
            domain: 'test',
            currency: 'NGN',
            transaction: {
              reference: sourceReference,
              amount: 10000,
              currency: 'NGN',
              domain: 'test',
            },
          };
        throw new Error('Unexpected synthetic Paystack path');
      }),
      page: jest.fn(),
    };
    service = new PaystackAdverseFundingService(
      prisma as never,
      paystack as never,
      new LedgerService(prisma as never),
      new ConfigService({ PAYSTACK_SECRET_KEY: 'sk_test_synthetic' }),
      { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as never,
    );
  });
  afterEach(async () => {
    const cases = await prisma.fundingAdverseCase.findMany({
      where: { fundingReference: sourceReference },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: cases.map((c) => c.id) } },
    });
    await prisma.fundingAdverseCase.deleteMany({
      where: { fundingReference: sourceReference },
    });
    await cleanupFinancialTransferFixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const refund = (suffix = 'a') =>
    service.processPaystackEvent({
      eventType: 'refund.processed',
      providerReference: `${fixture.prefix}-refund-${suffix}`,
      data: {
        id: 11,
        status: 'processed',
        amount: 999999,
        transaction: { reference: sourceReference },
      },
    });

  it('holds verified refund exposure, ignores webhook amount, collects only the approved amount once per operation and retains an exact ledger trail', async () => {
    const result = await refund();
    await refund();
    const row = await prisma.fundingAdverseCase.findUniqueOrThrow({
      where: { id: result.caseId },
    });
    expect(row.exposureAmount).toEqual(new Decimal('20.00'));
    expect(
      await prisma.fundingAdverseCase.count({
        where: { fundingReference: sourceReference },
      }),
    ).toBe(1);
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('500.00'),
    );
    await expect(
      new SettlementHoldService(prisma as never).assertOutboundAllowed({
        operation: 'WITHDRAWAL',
        currency: 'NGN',
      }),
    ).rejects.toThrow('funding event');
    const collect = (key: string, amount = '10.00') =>
      service.resolveCase(row.id, fixture.users.approverAdminA.id, {
        action: 'COLLECT',
        amount,
        reason: 'Processed refund verified against Paystack',
        operationKey: key,
      });
    const first = await collect('collect-1');
    const replay = await collect('collect-1');
    expect(replay.reference).toBe(first.reference);
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('490.00'),
    );
    await expect(collect('collect-1', '5.00')).rejects.toThrow();
    await collect('collect-2');
    await refund();
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('480.00'),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: {
          transaction: { userId: fixture.users.sender.id },
          source: 'PAYSTACK_ADVERSE_RECOVERY',
        },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.fundingAdverseCase.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).status,
    ).toBe('RESOLVED');
  });

  it('prevents overlapping refund events from collecting the same economic loss twice, including concurrent attempts', async () => {
    const first = await refund('one');
    const second = await refund('two');
    const requests = [first.caseId, second.caseId].map((caseId) =>
      service.resolveCase(caseId, fixture.users.approverAdminA.id, {
        action: 'COLLECT',
        amount: '20.00',
        reason: 'Processed refund verified against Paystack',
        operationKey: `collect-${caseId}`,
      }),
    );
    const results = await Promise.allSettled(requests);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('480.00'),
    );
    const rows = await prisma.fundingAdverseCase.findMany({
      where: { fundingReference: sourceReference },
    });
    expect(
      rows.reduce((sum, row) => sum.plus(row.recoveredAmount), new Decimal(0)),
    ).toEqual(new Decimal('20.00'));
  });

  it('never collects a dispute notification or an uncorrelated refund and leaves the wallet nonnegative', async () => {
    const dispute = await service.processPaystackEvent({
      eventType: 'charge.dispute.create',
      providerReference: `${fixture.prefix}-dispute`,
      data: { id: 22, transaction: { reference: sourceReference } },
    });
    await expect(
      service.resolveCase(dispute.caseId, fixture.users.approverAdminA.id, {
        action: 'COLLECT',
        amount: '20.00',
        reason: 'Checked dispute notice with provider',
        operationKey: 'unsafe-dispute-debit',
      }),
    ).rejects.toThrow('processed refund');
    paystack.request.mockImplementationOnce(async () => ({
      id: 551,
      reference: sourceReference,
      amount: 10000,
      currency: 'NGN',
      domain: 'test',
      status: 'success',
      customer: { customer_code: 'wrong-owner' },
    }));
    const invalid = await refund();
    expect(invalid.reviewRequired).toBe(true);
    await expect(
      service.resolveCase(invalid.caseId, fixture.users.approverAdminA.id, {
        action: 'COLLECT',
        amount: '20.00',
        reason: 'Attempt collection before ownership checked',
        operationKey: 'invalid-collection',
      }),
    ).rejects.toThrow();
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('500.00'),
    );
  });
  it('rechecks late funding evidence from the stored event without moving money or reopening a resolved decision', async () => {
    await prisma.transaction.update({
      where: { reference: sourceReference },
      data: { status: 'PENDING' },
    });
    const pending = await refund('late-source');
    const held = await prisma.fundingAdverseCase.findUniqueOrThrow({
      where: { id: pending.caseId },
    });
    expect(held.verificationStatus).toBe('UNMATCHED');
    expect(held.holdRequired).toBe(true);
    await prisma.transaction.update({
      where: { reference: sourceReference },
      data: { status: 'SUCCESS' },
    });
    await service.recheckCase(held.id, fixture.users.approverAdminA.id, {
      reason: 'Original funding arrived after the refund event',
      operationKey: 'recheck-original',
    });
    const verified = await prisma.fundingAdverseCase.findUniqueOrThrow({
      where: { id: held.id },
    });
    expect(verified.verificationStatus).toBe('VERIFIED');
    expect(verified.exposureAmount).toEqual(new Decimal('20.00'));
    expect(verified.holdRequired).toBe(true);
    expect(await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toEqual(
      new Decimal('500.00'),
    );
    expect(
      await prisma.ledgerEntry.count({
        where: {
          transaction: { userId: fixture.users.sender.id },
          source: 'PAYSTACK_ADVERSE_RECOVERY',
        },
      }),
    ).toBe(0);
    await service.resolveCase(held.id, fixture.users.approverAdminA.id, {
      action: 'RELEASE_HOLD',
      reason: 'Provider outcome independently reviewed and resolved',
    });
    await expect(
      service.recheckCase(held.id, fixture.users.approverAdminA.id, {
        reason: 'Do not reopen the resolved operator decision',
        operationKey: 'late-recheck',
      }),
    ).rejects.toThrow('held');
    expect(
      (
        await prisma.fundingAdverseCase.findUniqueOrThrow({
          where: { id: held.id },
        })
      ).holdRequired,
    ).toBe(false);
  });
});

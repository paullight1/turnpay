import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { LedgerService } from '../src/wallets/ledger.service';
import { SettlementHoldService } from '../src/common/services/settlement-hold.service';
import { PaymentService } from '../src/payments/payment.service';
import { PaystackVirtualAccountProvider } from '../src/banking/providers/paystack-virtual-account.provider';
import { PaystackTransferApprovalService } from '../src/paystack/paystack-transfer-approval.service';
import {
  createFinancialTestPrisma,
  createFinancialTransferFixture,
  cleanupFinancialTransferFixture,
  walletBalance,
  type FinancialTransferFixture,
} from './support/transfer-fixtures';

describe('Automatic bank transfer approval (disposable PostgreSQL, fake Paystack)', () => {
  let prisma: PrismaClient;
  let fixture: FinancialTransferFixture;
  beforeAll(async () => {
    prisma = createFinancialTestPrisma();
    await prisma.$connect();
  });
  beforeEach(async () => {
    fixture = await createFinancialTransferFixture(prisma, {
      senderBalance: '500.00',
      createPolicies: false,
    });
  });
  afterEach(async () => {
    const rows = await prisma.transaction.findMany({
      where: { userId: fixture.users.sender.id },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    await prisma.transferAttempt.deleteMany({
      where: { transactionId: { in: ids } },
    });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await cleanupFinancialTransferFixture(prisma, fixture);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    'success',
    'failed',
    'blocked',
    'reversed',
    'pending',
    'unsent',
    'disabled',
    'conflict',
    'orphaned',
    'approved-not-found',
    'lookup-outage',
  ])(
    'binds before dispatch, serializes duplicate approval and reconciles %s without another debit',
    async (status) => {
      const config = new ConfigService({
        BANKING_PROVIDER_PRIMARY: 'paystack',
        WITHDRAWALS_ENABLED: true,
        PAYSTACK_TRANSFER_APPROVAL_ENABLED: status !== 'disabled',
        BANK_ACCOUNT_ENCRYPTION_KEY: 'synthetic-approval-fixture-bank-key',
        PAYSTACK_SECRET_KEY: 'sk_test_synthetic',
      });
      const hold = new SettlementHoldService(prisma as never);
      const approval = new PaystackTransferApprovalService(
        prisma as never,
        config,
        hold,
      );
      if (status === 'unsent')
        jest
          .spyOn(approval, 'prepare')
          .mockRejectedValue(
            new Error('database temporarily unavailable before dispatch'),
          );
      let payload: {
        reference: string;
        amount: number;
        currency: string;
        source: string;
        recipient: string;
      };
      const request = jest.fn(
        async (method: string, path: string, body?: typeof payload) => {
          if (path === '/bank/resolve')
            return {
              account_name: 'Different Recipient',
              account_number: '0123456789',
            };
          if (path === '/transferrecipient')
            return { recipient_code: 'RCP_fixture' };
          if (path === '/transfer') {
            payload = body!;
            if (['orphaned', 'lookup-outage'].includes(status))
              throw new ServiceUnavailableException('interrupted request');
            // Exercise the provider calling back before POST /transfer returns.
            await Promise.all([
              approval.approve(payload),
              approval.approve(payload),
            ]);
            if (status === 'conflict')
              throw new BadRequestException('duplicate reference', {
                cause: { providerStatusCode: 409 },
              });
            if (status === 'approved-not-found')
              throw new ServiceUnavailableException('response lost');
            return { status: 'pending', reference: payload.reference };
          }
          if (method === 'GET' && path.startsWith('/transfer/verify/')) {
            if (status === 'lookup-outage')
              throw new ServiceUnavailableException('verification unavailable');
            if (['orphaned', 'approved-not-found'].includes(status))
              throw new BadRequestException('not found', {
                cause: { providerStatusCode: 404 },
              });
            return {
              reference: payload.reference,
              amount: 5000,
              currency: 'NGN',
              domain: 'test',
              status: status === 'conflict' ? 'success' : status,
              recipient: {
                recipient_code: 'RCP_fixture',
                details: { account_number: '0123456789', bank_code: '058' },
              },
            };
          }
          throw new Error('Unexpected provider call');
        },
      );
      const provider = new PaystackVirtualAccountProvider(
        { configured: true, request } as never,
        config,
        prisma as never,
        approval,
      );
      const pin = { verifyRequired: jest.fn() };
      const service = new PaymentService(
        prisma as never,
        {
          getWallet: (userId: string, currency: 'NGN') =>
            prisma.wallet.findUnique({
              where: { userId_currency: { userId, currency } },
            }),
        } as never,
        {} as never,
        config,
        { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
        new LedgerService(prisma as never),
        pin as never,
        hold,
        provider,
        approval,
      );
      const dto = {
        amount: '50.00',
        currency: 'NGN' as const,
        bankCode: '058',
        accountNumber: '0123456789',
        transactionPin: '1234',
      };
      if (status === 'disabled') {
        await expect(
          service.withdraw(fixture.users.sender.id, dto, fixture.prefix),
        ).rejects.toThrow();
        expect(
          (await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toFixed(
            2,
          ),
        ).toBe('500.00');
        expect(
          await prisma.transaction.count({
            where: { userId: fixture.users.sender.id },
          }),
        ).toBe(0);
        expect(
          request.mock.calls.filter(([, path]) => path === '/transfer'),
        ).toHaveLength(0);
        return;
      }
      const result = await service.withdraw(
        fixture.users.sender.id,
        dto,
        fixture.prefix,
      );
      const terminal = ['failed', 'blocked', 'reversed', 'unsent'].includes(
        status,
      );
      expect(result.status).toBe(
        ['success', 'conflict'].includes(status)
          ? 'SUCCESS'
          : terminal
            ? status === 'reversed'
              ? 'REVERSED'
              : 'FAILED'
            : 'PENDING',
      );
      expect(
        (await walletBalance(prisma, fixture.users.sender.id, 'NGN')).toFixed(
          2,
        ),
      ).toBe(terminal ? '500.00' : '450.00');
      if (
        ['orphaned', 'approved-not-found', 'lookup-outage'].includes(status)
      ) {
        const now = Date.now();
        const clock = jest
          .spyOn(Date, 'now')
          .mockImplementation(() => now + 301000);
        try {
          const recovered = await service.getWithdrawal(
            fixture.users.sender.id,
            result.reference,
          );
          expect(recovered.status).toBe(
            status === 'orphaned' ? 'FAILED' : 'PENDING',
          );
          expect(
            (
              await walletBalance(prisma, fixture.users.sender.id, 'NGN')
            ).toFixed(2),
          ).toBe(status === 'orphaned' ? '500.00' : '450.00');
          await service.getWithdrawal(
            fixture.users.sender.id,
            result.reference,
          );
          expect(
            await prisma.ledgerEntry.count({
              where: {
                transaction: { reference: result.reference },
                source: 'WITHDRAWAL_REVERSAL',
              },
            }),
          ).toBe(status === 'orphaned' ? 1 : 0);
        } finally {
          clock.mockRestore();
        }
        return;
      }
      expect(
        await prisma.auditLog.count({
          where: {
            reference: result.reference,
            action: 'PAYSTACK_TRANSFER_AUTO_APPROVED',
          },
        }),
      ).toBe(status === 'unsent' ? 0 : 1);
      expect(
        await prisma.ledgerEntry.count({
          where: {
            transaction: { reference: result.reference },
            source: 'WITHDRAWAL',
          },
        }),
      ).toBe(1);
      const replay = await service.withdraw(
        fixture.users.sender.id,
        { ...dto, transactionPin: '5678' },
        fixture.prefix,
      );
      expect(replay.reference).toBe(result.reference);
      expect(
        request.mock.calls.filter(([, path]) => path === '/transfer'),
      ).toHaveLength(status === 'unsent' ? 0 : 1);
      expect(pin.verifyRequired).toHaveBeenCalledTimes(1);
      if (status !== 'pending')
        await expect(approval.approve(payload!)).rejects.toThrow();
      const detail = await service.getWithdrawal(
        fixture.users.sender.id,
        result.reference,
      );
      expect(JSON.stringify(detail)).not.toContain('transferApproval');
      expect(
        await prisma.ledgerEntry.count({
          where: {
            transaction: { reference: result.reference },
            source: 'WITHDRAWAL_REVERSAL',
          },
        }),
      ).toBe(terminal ? 1 : 0);
    },
  );
});

import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { PaystackTransferApprovalService } from './paystack-transfer-approval.service';

describe('Paystack transfer approval', () => {
  const payload = {
    reference: 'wd_12345678901234567890',
    amount: 5000,
    currency: 'NGN',
    source: 'balance',
    recipient: 'RCP_recipient',
  };
  function fixture() {
    const transaction = {
      id: 'transaction',
      reference: payload.reference,
      type: 'WITHDRAW',
      status: 'PENDING',
      amount: new Decimal(50),
      currency: 'NGN',
      userId: 'user',
      walletId: 'wallet',
      user: { isSuspended: false, kycStatus: 'VERIFIED', kycTier: 'TIER_1' },
    };
    const attempt = {
      id: 'attempt',
      transactionId: transaction.id,
      provider: 'PAYSTACK',
      status: 'PENDING',
      providerStatus: 'RESERVED',
      providerReference: payload.reference,
      metadata: {},
      transaction,
    };
    const db = {
      $queryRaw: jest.fn(),
      transferAttempt: {
        findUnique: jest.fn(async () => attempt),
        update: jest.fn(async ({ data }) => Object.assign(attempt, data)),
      },
      ledgerEntry: {
        findMany: jest.fn(async () => [
          {
            source: 'WITHDRAWAL',
            direction: 'DEBIT',
            amount: new Decimal(50),
            walletId: 'wallet',
            currency: 'NGN',
          },
        ]),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { ...db, $transaction: jest.fn(async (fn) => fn(db)) };
    const hold = { assertOutboundAllowed: jest.fn() };
    const config = new ConfigService({
      PAYSTACK_TRANSFER_APPROVAL_ENABLED: true,
      WITHDRAWALS_ENABLED: true,
      PAYSTACK_SECRET_KEY: 'sk_test_unit_test_only',
    });
    const service = new PaystackTransferApprovalService(
      prisma as never,
      config,
      hold as never,
    );
    return { service, db, attempt, transaction, config, hold };
  }
  it('seals the reserved withdrawal before approving the exact payload once', async () => {
    const f = fixture();
    await f.service.prepare(payload);
    f.db.auditLog.create.mockClear();
    await expect(f.service.approve(payload)).resolves.toEqual({
      approved: true,
    });
    await expect(f.service.approve(payload)).resolves.toEqual({
      approved: true,
    });
    expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.hold.assertOutboundAllowed).toHaveBeenCalled();
  });
  it.each(['reference', 'amount', 'currency', 'source', 'recipient'])(
    'rejects a changed %s',
    async (field) => {
      const f = fixture();
      await f.service.prepare(payload);
      await expect(
        f.service.approve({
          ...payload,
          [field]: field === 'amount' ? 5001 : 'changed',
        }),
      ).rejects.toThrow();
    },
  );
  it('rejects an unprepared reservation and unknown references', async () => {
    const f = fixture();
    await expect(f.service.approve(payload)).rejects.toThrow();
    f.db.transferAttempt.findUnique.mockResolvedValue(null as never);
    await expect(f.service.approve(payload)).rejects.toThrow();
  });
  it.each(['FAILED', 'SUCCESS', 'REVERSED'])(
    'never approves %s withdrawals',
    async (status) => {
      const f = fixture();
      await f.service.prepare(payload);
      f.transaction.status = status;
      await expect(f.service.approve(payload)).rejects.toThrow();
    },
  );
  it('rejects a refund even if the withdrawal is still pending', async () => {
    const f = fixture();
    await f.service.prepare(payload);
    f.db.ledgerEntry.findMany.mockResolvedValue([
      {
        source: 'WITHDRAWAL_REVERSAL',
        direction: 'CREDIT',
        amount: new Decimal(50),
        walletId: 'wallet',
        currency: 'NGN',
      },
    ]);
    await expect(f.service.approve(payload)).rejects.toThrow();
  });
  it('rejects missing or mismatched reserved funds', async () => {
    const f = fixture();
    f.db.ledgerEntry.findMany.mockResolvedValue([]);
    await expect(f.service.prepare(payload)).rejects.toThrow();
  });
  it('rejects suspended users, reconciliation holds and disabled execution', async () => {
    const f = fixture();
    await f.service.prepare(payload);
    f.transaction.user.isSuspended = true;
    await expect(f.service.approve(payload)).rejects.toThrow();
    f.transaction.user.isSuspended = false;
    f.hold.assertOutboundAllowed.mockRejectedValueOnce(new Error('held'));
    await expect(f.service.approve(payload)).rejects.toThrow();
    f.config.set('WITHDRAWALS_ENABLED', false);
    await expect(f.service.approve(payload)).rejects.toThrow();
  });
  it('rejects expired or tampered sealed intents and cannot re-arm one', async () => {
    const f = fixture();
    await f.service.prepare(payload);
    await expect(
      f.service.prepare({ ...payload, recipient: 'RCP_other' }),
    ).rejects.toThrow();
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 301000);
    try {
      await expect(f.service.approve(payload)).rejects.toThrow();
    } finally {
      jest.useRealTimers();
    }
    (f.attempt.metadata as Record<string, any>).transferApproval.signature =
      '0'.repeat(64);
    await expect(f.service.approve(payload)).rejects.toThrow();
  });
});

import { Prisma } from '@prisma/client';
import {
  enqueueTransactionStatusEmail,
  enqueueWalletMovementEmail,
  renderFinancialEmail,
} from './financial-notifications';

describe('financial notification helpers', () => {
  it('enqueues one idempotent wallet movement event keyed by the ledger entry', async () => {
    const emailOutbox = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = { emailOutbox } as unknown as Prisma.TransactionClient;

    await enqueueWalletMovementEmail(tx, {
      userId: 'user-1',
      ledgerEntryId: 'ledger-1',
      direction: 'CREDIT',
    });

    expect(emailOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          eventKey: 'wallet:movement:ledger-1',
          eventType: 'WALLET_CREDIT',
          orderId: 'ledger-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('enqueues terminal status events with a stable transaction/status key', async () => {
    const emailOutbox = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = { emailOutbox } as unknown as Prisma.TransactionClient;

    await enqueueTransactionStatusEmail(tx, {
      userId: 'user-1',
      transactionId: 'tx-1',
      status: 'FAILED',
    });

    expect(emailOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          eventKey: 'transaction:status:tx-1:FAILED',
          eventType: 'TRANSACTION_FAILED',
          orderId: 'tx-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('escapes ledger references and never renders raw source or markup into HTML', () => {
    const content = renderFinancialEmail('WALLET_CREDIT', {
      amount: '12.50',
      balanceAfter: '112.50',
      currency: 'NGN',
      direction: 'CREDIT',
      reference: '<script>alert(1)</script>',
      source: 'KORA_DEPOSIT<svg>',
      status: 'SUCCESS',
      transactionType: 'FUND',
    });

    expect(content?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(content?.html).not.toContain('<script>alert(1)</script>');
    expect(content?.html).not.toContain('KORA_DEPOSIT<svg>');
    expect(content?.text).toContain('<script>alert(1)</script>');
  });
});

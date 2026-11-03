import { AccountNotificationsService } from './account-notifications.service';

describe('AccountNotificationsService', () => {
  function makeTransaction() {
    return {
      paymentNotification: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      emailOutbox: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  it('atomically enqueues one private verification notification and email event', async () => {
    const transaction = makeTransaction();
    const service = new AccountNotificationsService();

    await service.bvnVerified(transaction as never, 'user-1', 'verification-1');

    expect(transaction.paymentNotification.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventKey: 'kyc:bvn-verified:verification-1',
          audience: 'USER:user-1',
          orderId: 'verification-1',
          title: 'BVN verified',
        },
      ],
      skipDuplicates: true,
    });
    expect(transaction.emailOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          eventKey: 'kyc:bvn-verified:verification-1',
          eventType: 'BVN_VERIFIED',
          orderId: 'verification-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('uses stable account-ready keys and does not include account details in titles', async () => {
    const transaction = makeTransaction();
    const service = new AccountNotificationsService();

    await service.accountReady(transaction as never, 'user-1', 'account-1');

    expect(transaction.paymentNotification.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventKey: 'banking:account-ready:account-1',
          audience: 'USER:user-1',
          orderId: 'account-1',
          title: 'NGN receiving account ready',
        },
      ],
      skipDuplicates: true,
    });
    expect(transaction.emailOutbox.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          eventKey: 'banking:account-ready:account-1',
          eventType: 'ACCOUNT_READY',
          orderId: 'account-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('lets the caller transaction roll back if either enqueue write fails', async () => {
    const transaction = makeTransaction();
    transaction.emailOutbox.createMany.mockRejectedValueOnce(
      new Error('write failed'),
    );
    const service = new AccountNotificationsService();

    await expect(
      service.bvnVerified(transaction as never, 'user-1', 'verification-1'),
    ).rejects.toThrow('write failed');
  });
});

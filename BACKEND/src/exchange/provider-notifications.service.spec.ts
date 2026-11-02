import { ProviderNotificationsService } from './provider-notifications.service';
describe('provider notification read state', () => {
  it('scopes read state to the active admin and makes repeat reads idempotent', async () => {
    const prisma = {
      paymentNotification: {
        findMany: jest.fn().mockResolvedValue([{ id: 'n', title: 'Ready' }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'n', audience: 'ADMIN' }),
      },
      paymentNotificationRead: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { notificationId: 'n', readAt: new Date('2026-10-31') },
          ]),
        upsert: jest.fn().mockResolvedValue({ notificationId: 'n' }),
      },
    };
    const service = new ProviderNotificationsService(prisma as never);
    expect((await service.list('admin-a'))[0].readAt).toBeTruthy();
    expect(prisma.paymentNotificationRead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { adminId: 'admin-a', notificationId: { in: ['n'] } },
      }),
    );
    await service.read('admin-a', 'n', 'valid-key-123456789');
    await service.read('admin-a', 'n', 'valid-key-123456789');
    expect(prisma.paymentNotificationRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notificationId_adminId: { notificationId: 'n', adminId: 'admin-a' },
        },
        update: {},
      }),
    );
  });
  it('refuses to mark another customer or admin notification as read', async () => {
    const prisma = {
      paymentNotification: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'private', audience: 'USER:someone-else' }),
      },
      paymentNotificationRead: { upsert: jest.fn() },
    };
    const service = new ProviderNotificationsService(prisma as never);
    await expect(
      (service.read as any)(
        'user-a',
        'private',
        'valid-key-123456789',
        'USER:user-a',
      ),
    ).rejects.toThrow('Notification not found');
    expect(prisma.paymentNotificationRead.upsert).not.toHaveBeenCalled();
  });
});

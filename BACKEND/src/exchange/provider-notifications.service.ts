import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ProviderNotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(adminId: string, audience = 'ADMIN') {
    // Surface unread work before recent read history. Otherwise an older
    // unread alert disappears behind fifty newer read updates forever.
    const unread = await this.prisma.paymentNotification.findMany({
      where: { audience, reads: { none: { adminId } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const recentRead =
      unread.length < 50
        ? await this.prisma.paymentNotification.findMany({
            where: { audience, reads: { some: { adminId } } },
            orderBy: { createdAt: 'desc' },
            take: 50 - unread.length,
          })
        : [];
    const notifications = [
      ...new Map(
        [...unread, ...recentRead].map((item) => [item.id, item]),
      ).values(),
    ];
    const reads = await this.prisma.paymentNotificationRead.findMany({
      where: {
        adminId,
        notificationId: { in: notifications.map((item) => item.id) },
      },
    });
    const byId = new Map(
      reads.map((item) => [item.notificationId, item.readAt]),
    );
    return notifications.map((item) => ({
      ...item,
      readAt: byId.get(item.id) ?? null,
    }));
  }
  countUnread(adminId: string, audience = 'ADMIN') {
    return this.prisma.paymentNotification.count({
      where: { audience, reads: { none: { adminId } } },
    });
  }

  async read(
    adminId: string,
    notificationId: string,
    key: string,
    audience = 'ADMIN',
  ) {
    if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key ?? ''))
      throw new BadRequestException('A valid Idempotency-Key is required');
    const notification = await this.prisma.paymentNotification.findUnique({
      where: { id: notificationId },
      select: { id: true, audience: true },
    });
    if (!notification || notification.audience !== audience)
      throw new NotFoundException('Notification not found');
    return this.prisma.paymentNotificationRead.upsert({
      where: { notificationId_adminId: { notificationId, adminId } },
      create: { notificationId, adminId },
      update: {},
    });
  }
}

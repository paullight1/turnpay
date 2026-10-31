import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ProviderNotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(adminId: string) {
    const [notifications, reads] = await Promise.all([
      this.prisma.paymentNotification.findMany({
        where: { audience: 'ADMIN' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.paymentNotificationRead.findMany({
        where: { adminId },
        take: 500,
        orderBy: { readAt: 'desc' },
      }),
    ]);
    const byId = new Map(
      reads.map((item) => [item.notificationId, item.readAt]),
    );
    return notifications.map((item) => ({
      ...item,
      readAt: byId.get(item.id) ?? null,
    }));
  }
  async read(adminId: string, notificationId: string, key: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key ?? ''))
      throw new BadRequestException('A valid Idempotency-Key is required');
    if (
      !(await this.prisma.paymentNotification.findUnique({
        where: { id: notificationId },
      }))
    )
      throw new NotFoundException('Notification not found');
    return this.prisma.paymentNotificationRead.upsert({
      where: { notificationId_adminId: { notificationId, adminId } },
      create: { notificationId, adminId },
      update: {},
    });
  }
}

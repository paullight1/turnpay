import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type AccountNotificationEventType =
  | 'BVN_VERIFIED'
  | 'ACCOUNT_READY'
  | 'DEPOSIT_RECEIVED';

/**
 * Writes account lifecycle notifications into the caller's transaction.
 * Delivery is deliberately not attempted here: a provider outage must never
 * roll back the KYC or banking state that caused the event.
 */
@Injectable()
export class AccountNotificationsService {
  async depositReceived(
    tx: Prisma.TransactionClient,
    userId: string,
    transactionId: string,
  ): Promise<void> {
    await this.enqueue(
      tx,
      userId,
      transactionId,
      'wallet:deposit-received',
      'DEPOSIT_RECEIVED',
      'Deposit credited to your wallet',
    );
  }

  async bvnVerified(
    tx: Prisma.TransactionClient,
    userId: string,
    verificationId: string,
  ): Promise<void> {
    await this.enqueue(
      tx,
      userId,
      verificationId,
      'kyc:bvn-verified',
      'BVN_VERIFIED',
      'BVN verified',
    );
  }

  async accountReady(
    tx: Prisma.TransactionClient,
    userId: string,
    accountId: string,
  ): Promise<void> {
    await this.enqueue(
      tx,
      userId,
      accountId,
      'banking:account-ready',
      'ACCOUNT_READY',
      'NGN receiving account ready',
    );
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    userId: string,
    eventId: string,
    eventPrefix: string,
    eventType: AccountNotificationEventType,
    title: string,
  ): Promise<void> {
    const eventKey = `${eventPrefix}:${eventId}`;
    const audience = `USER:${userId}`;

    await tx.paymentNotification.createMany({
      data: [
        {
          eventKey,
          audience,
          orderId: eventId,
          title,
        },
      ],
      skipDuplicates: true,
    });

    // Keep only the stable event metadata. The recipient and rendered body
    // are intentionally resolved at dispatch time from the current User row.
    await tx.emailOutbox.createMany({
      data: [
        {
          userId,
          eventKey,
          eventType,
          orderId: eventId,
        },
      ],
      skipDuplicates: true,
    });
  }
}

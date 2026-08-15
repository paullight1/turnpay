import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PaymentWebhookInbox, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PinoLogger } from 'nestjs-pino';
import { BankingService } from '../../banking/banking.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { PaymentService } from '../payment.service';
import { WebhookInboxService } from './webhook-inbox.service';
import { PrismaService } from '../../prisma/prisma.service';

type InboxEventRecord = Pick<
  PaymentWebhookInbox,
  'id' | 'provider' | 'eventType' | 'providerReference' | 'payload'
>;

@Injectable()
export class PaymentWebhookProcessorService {
  constructor(
    private readonly inbox: WebhookInboxService,
    private readonly paymentService: PaymentService,
    private readonly bankingService: BankingService,
    private readonly exchangeService: ExchangeService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledEvents() {
    await this.processDueEvents();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverScheduledClaims() {
    await this.inbox.recoverStaleClaims(300);
  }

  async processDueEvents(limit = 25) {
    const events = (await this.inbox.findDueEvents(
      limit,
    )) as InboxEventRecord[];

    for (const event of events) {
      const claimed = await this.inbox.claim(event.id);
      if (!claimed) {
        continue;
      }

      try {
        const result = await this.routeEvent(event);
        await this.inbox.complete(event.id, result);
        await this.prisma.webhookLog.updateMany({
          where: { reference: event.providerReference },
          data: {
            processed: true,
            errorMessage: null,
          },
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown processing error';

        this.logger.error(
          {
            eventId: event.id,
            provider: event.provider,
            providerReference: event.providerReference,
            error: errorMessage,
          },
          'Failed to process queued payment webhook event',
        );

        await this.inbox.fail(event.id, errorMessage);
        await this.prisma.webhookLog.updateMany({
          where: { reference: event.providerReference },
          data: {
            errorMessage,
          },
        });
      }
    }
  }

  private async routeEvent(event: InboxEventRecord) {
    switch (event.provider) {
      case 'PAYSTACK':
        return this.processPaystackEvent(event);
      case 'FLUTTERWAVE':
        return this.processFlutterwaveEvent(event);
      case 'MONNIFY':
        return this.processMonnifyEvent(event);
      default:
        return { ignored: true, reason: 'Unsupported provider' };
    }
  }

  private async processPaystackEvent(event: InboxEventRecord) {
    const payload = this.asRecord(event.payload);
    const data = this.getRecord(payload, 'data');
    const eventType = this.getString(payload, 'event');
    const reference = this.getString(data, 'reference');

    if (!reference) {
      return { ignored: true, reason: 'Missing paystack reference' };
    }

    if (eventType?.startsWith('transfer.')) {
      await this.paymentService.processTransferWebhook({
        provider: 'paystack',
        eventType,
        providerReference: reference,
        providerStatus: this.getString(data, 'status') || 'PENDING',
        rawPayload: payload,
      });

      return { routed: 'transfer' };
    }

    const amount = this.getNumber(data, 'amount');
    if (eventType === 'charge.success' && amount !== null) {
      await this.paymentService.processWebhookDeposit({
        provider: 'paystack',
        eventType,
        reference,
        status: this.getString(data, 'status') || 'PENDING',
        amount: new Decimal(amount).div(100),
        currency: this.getString(data, 'currency') || 'NGN',
        rawPayload: payload,
      });

      return { routed: 'deposit' };
    }

    return { ignored: true, reason: 'Unhandled paystack event' };
  }

  private async processFlutterwaveEvent(event: InboxEventRecord) {
    const payload = this.asRecord(event.payload);
    const data = this.getRecord(payload, 'data');
    const eventType = this.getString(payload, 'event');
    const transferReference =
      this.getString(data, 'reference') || this.getString(data, 'tx_ref');

    if (!transferReference) {
      return { ignored: true, reason: 'Missing flutterwave reference' };
    }

    if (eventType?.startsWith('transfer')) {
      await this.paymentService.processTransferWebhook({
        provider: 'flutterwave',
        eventType,
        providerReference: transferReference,
        providerStatus: this.getString(data, 'status') || 'PENDING',
        rawPayload: payload,
      });

      return { routed: 'transfer' };
    }

    const txRef = this.getString(data, 'tx_ref');
    const amount = this.getNumber(data, 'amount');
    if (eventType === 'charge.completed' && txRef && amount !== null) {
      await this.paymentService.processWebhookDeposit({
        provider: 'flutterwave',
        eventType,
        reference: txRef,
        status: this.getString(data, 'status') || 'PENDING',
        amount,
        currency: this.getString(data, 'currency') || 'NGN',
        rawPayload: payload,
      });

      return { routed: 'deposit' };
    }

    return { ignored: true, reason: 'Unhandled flutterwave event' };
  }

  private async processMonnifyEvent(event: InboxEventRecord) {
    const payload = this.asRecord(event.payload);
    const eventType = this.getString(payload, 'eventType') || event.eventType;
    const data = this.getRecord(payload, 'eventData');
    const providerReference =
      this.getString(data, 'transactionReference') ||
      this.getString(data, 'paymentReference') ||
      event.providerReference;
    const upperEventType = String(eventType || '').toUpperCase();

    if (upperEventType.includes('DISBURSEMENT') && providerReference) {
      const providerStatus =
        this.getString(data, 'status') ||
        this.getString(data, 'transactionStatus') ||
        (upperEventType.includes('SUCCESSFUL')
          ? 'SUCCESS'
          : upperEventType.includes('REVERSED')
            ? 'REVERSED'
            : upperEventType.includes('FAILED')
              ? 'FAILED'
              : 'PENDING');

      await this.paymentService.processTransferWebhook({
        provider: 'monnify',
        eventType,
        providerReference,
        providerStatus,
        rawPayload: payload,
      });

      return { routed: 'transfer' };
    }

    const destination = this.getRecord(data, 'destinationAccountInformation');
    const accountNumber = this.getString(destination, 'accountNumber');
    const amount =
      this.getNumber(data, 'amountPaid') ??
      this.getNumber(data, 'totalPayable');
    const currency = this.getString(data, 'currency') || 'NGN';
    const paymentStatus = this.getString(data, 'paymentStatus');

    if (
      eventType === 'SUCCESSFUL_TRANSACTION' &&
      paymentStatus === 'PAID' &&
      providerReference &&
      accountNumber &&
      amount !== null
    ) {
      const exchangeResult =
        await this.exchangeService.processMonnifyExchangeDepositWebhook({
          eventType,
          providerReference,
          paymentReference:
            this.getString(data, 'paymentReference') ?? undefined,
          accountNumber,
          amount: new Decimal(amount),
          currency: currency as 'NGN' | 'GHS',
          rawPayload: payload,
        });

      if (exchangeResult.matched) {
        return { routed: 'exchange' };
      }

      await this.bankingService.processVirtualAccountDeposit({
        provider: 'monnify',
        eventType,
        providerReference,
        accountNumber,
        amount: new Decimal(amount),
        settlementAmount: this.toOptionalDecimal(data, 'settlementAmount'),
        currency: currency as 'NGN' | 'GHS',
        rawPayload: payload,
      });

      return { routed: 'banking' };
    }

    return { ignored: true, reason: 'Unhandled monnify event' };
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value;
  }

  private getRecord(
    record: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const value = record[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private getString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    return typeof value === 'string' ? value : null;
  }

  private getNumber(
    record: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = record[key];
    return typeof value === 'number' ? value : null;
  }

  private toOptionalDecimal(
    record: Record<string, unknown>,
    key: string,
  ): Decimal | undefined {
    const value = this.getNumber(record, key);
    return value === null ? undefined : new Decimal(value);
  }
}

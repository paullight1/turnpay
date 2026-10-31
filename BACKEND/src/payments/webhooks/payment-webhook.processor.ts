import { ProviderExchangeSettlementService } from '../../exchange/provider-exchange-settlement.service';
import { GhsWithdrawalsService } from '../../kora/ghs-withdrawals.service';
import { KoraAccountsService } from '../../kora/kora-accounts.service';
import { KoraCollectionsService } from '../../kora/kora-collections.service';
import { PaystackFundingService } from '../paystack-funding.service';
import { KycService } from '../../kyc/kyc.service';
import { Injectable, Optional } from '@nestjs/common';
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
    @Optional() private readonly funding?: PaystackFundingService,
    @Optional() private readonly kyc?: KycService,
    @Optional() private readonly koraAccounts?: KoraAccountsService,
    @Optional() private readonly koraCollections?: KoraCollectionsService,
    @Optional()
    private readonly providerExchange?: ProviderExchangeSettlementService,
    @Optional() private readonly ghsWithdrawals?: GhsWithdrawalsService,
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
          where: {
            provider: event.provider,
            eventType: event.eventType,
            reference: event.providerReference,
          },
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
          where: {
            provider: event.provider,
            eventType: event.eventType,
            reference: event.providerReference,
          },
          data: {
            errorMessage,
          },
        });
      }
    }
  }

  private async routeEvent(event: InboxEventRecord) {
    switch (event.provider) {
      case 'KORA':
        if (event.eventType === 'account_number.creation') {
          if (!this.koraAccounts)
            throw new Error('Ghana account processor unavailable');
          return this.koraAccounts.accountEvent(
            this.getRecord(this.asRecord(event.payload), 'data'),
          );
        }
        if (['charge.success', 'charge.failed'].includes(event.eventType)) {
          if (!this.koraCollections)
            throw new Error('Ghana collection processor unavailable');
          return this.koraCollections.confirmCharge(event.providerReference);
        }
        if (event.eventType.startsWith('transfer.')) {
          if (!this.providerExchange || !this.ghsWithdrawals)
            throw new Error('Ghana settlement processor unavailable');
          const order = await this.prisma.providerExchangeOrder.findUnique({
            where: { payoutReference: event.providerReference },
          });
          return order
            ? this.providerExchange.reconcile(event.providerReference)
            : this.ghsWithdrawals.reconcile(event.providerReference);
        }
        return { ignored: true, reason: 'Unhandled Kora event' };
      case 'PAYSTACK':
        return this.processPaystackEvent(event);
      case 'MONNIFY':
        return this.processMonnifyEvent(event);
      default:
        return { ignored: true, reason: 'Unsupported provider' };
    }
  }

  private async processPaystackEvent(event: InboxEventRecord) {
    const data = this.getRecord(this.asRecord(event.payload), 'data');
    if (event.eventType === 'charge.success') {
      if (!this.funding)
        throw new Error('Paystack funding processor unavailable');
      return this.funding.confirmCharge(event.providerReference);
    }
    if (
      ['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(
        event.eventType,
      )
    ) {
      const order = this.providerExchange
        ? await this.prisma.providerExchangeOrder.findUnique({
            where: { payoutReference: event.providerReference },
          })
        : null;
      if (order)
        return this.providerExchange!.reconcile(event.providerReference);
      return this.paymentService.processTransferWebhook({
        provider: 'paystack',
        eventType: event.eventType,
        providerReference: event.providerReference,
        providerStatus:
          typeof data.status === 'string' ? data.status : 'pending',
        rawPayload: {},
      });
    }
    if (
      [
        'customeridentification.success',
        'customeridentification.failed',
      ].includes(event.eventType)
    ) {
      if (!this.kyc) throw new Error('Paystack identity processor unavailable');
      return this.kyc.processPaystackIdentification(event.eventType, data);
    }
    if (
      [
        'dedicatedaccount.assign.success',
        'dedicatedaccount.assign.failed',
      ].includes(event.eventType)
    )
      return this.bankingService.processPaystackAccountAssignment(
        event.eventType,
        data,
      );
    return { ignored: true, reason: 'Unhandled Paystack event' };
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
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private toOptionalDecimal(
    record: Record<string, unknown>,
    key: string,
  ): Decimal | undefined {
    const value = this.getNumber(record, key);
    return value === null ? undefined : new Decimal(value);
  }
}

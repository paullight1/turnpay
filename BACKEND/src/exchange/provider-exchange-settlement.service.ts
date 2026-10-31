import { RequestAuditContext } from '../common/services/request-audit-context';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { KoraPayoutsService } from '../kora/kora-payouts.service';
import { KoraCapabilitiesService } from '../kora/kora-capabilities.service';
import { PaystackClient } from '../paystack/paystack.client';
import { SettlementHoldService } from '../common/services/settlement-hold.service';
import { decryptSensitiveValue } from '../common/utils/encryption';
import { asRecord, providerText } from '../kora/kora.client';
import { eligibleKoraUser, serialMoney } from '../kora/kora.policy';
import { reserveCurrencyLimit } from '../kora/kora-limits';
import { orderInclude, orderView } from './provider-exchange.service';

@Injectable()
export class ProviderExchangeSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly kora: KoraPayoutsService,
    private readonly paystack: PaystackClient,
    private readonly config: ConfigService,
    private readonly capabilities: KoraCapabilitiesService,
    private readonly holds: SettlementHoldService,
  ) {}
  async release(
    id: string,
    adminId: string,
    reason: string,
    key: string,
    honorExpired = false,
    audit?: RequestAuditContext,
  ) {
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(key ?? '') ||
      reason.trim().length < 10 ||
      reason.length > 500
    )
      throw new BadRequestException(
        'A valid attempt and a clear payment reason are required',
      );
    if (
      !this.capabilities.get().exchange ||
      this.config.get('PAYSTACK_EXCHANGE_USE_CASE_APPROVED') !== true
    )
      throw new ServiceUnavailableException(
        'Exchange payouts are awaiting merchant activation',
      );
    const existing = await this.prisma.providerExchangeOrder.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!existing) throw new NotFoundException('Exchange not found');
    if (existing.payoutReference) return orderView(existing);
    if (
      !existing.fundedAt ||
      !['READY', 'NEEDS_REVIEW'].includes(existing.status)
    )
      throw new ConflictException(
        'Confirmed source funds are required before sending',
      );
    if (existing.status === 'NEEDS_REVIEW' && !honorExpired)
      throw new ConflictException(
        'Explicitly honor the original expired quote before sending',
      );
    const q = existing.quote;
    const buffer =
      q.targetCurrency === 'GHS'
        ? new Decimal(
            this.config.get<string>('KORA_GHS_PAYOUT_FEE_BUFFER', '0'),
          )
        : new Decimal(0);
    if (
      q.targetCurrency === 'GHS' &&
      (!this.capabilities.get().momoPayouts ||
        (await this.kora.balance()).lt(q.targetAmount.plus(buffer)))
    )
      throw new ServiceUnavailableException(
        'Add funds to the Ghana payout balance, then retry this order',
      );
    if (q.targetCurrency === 'NGN') {
      const balances = await this.paystack.request<
        Array<{ currency: string; balance: number | string }>
      >('GET', '/balance');
      const available = balances.find((b) => b.currency === 'NGN');
      const raw = String(available?.balance ?? '0');
      if (!/^\d+$/.test(raw) || new Decimal(raw).div(100).lt(q.targetAmount))
        throw new ServiceUnavailableException(
          'Add funds to the naira payout balance, then retry this order',
        );
    }
    const reference = `px-${id.replaceAll('-', '')}`;
    const claimed = await serialMoney(this.prisma, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId } });
      if (!admin || admin.role !== 'ADMIN' || admin.isSuspended)
        throw new ForbiddenException('An active admin account is required');
      await eligibleKoraUser(tx, existing.userId);
      const credential = await tx.transactionPinCredential.findUnique({
        where: { userId: existing.userId },
      });
      if (credential?.resetHoldUntil && credential.resetHoldUntil > new Date())
        throw new ForbiddenException('Transaction PIN reset hold is active');
      await this.holds.assertSettlementAllowed(
        {
          operation: 'EXCHANGE',
          currency: q.targetCurrency,
          provider: q.targetCurrency === 'GHS' ? 'KORA' : 'PAYSTACK',
          reference,
        },
        tx,
      );
      const update = await tx.providerExchangeOrder.updateMany({
        where: {
          id,
          payoutReference: null,
          fundedAt: { not: null },
          status: existing.status,
        },
        data: {
          status: 'PROCESSING',
          payoutReference: reference,
          releasedBy: adminId,
          reason: reason.trim(),
        },
      });
      if (!update.count) return false;
      if (q.fundingSource === 'EXTERNAL')
        await reserveCurrencyLimit(
          tx,
          this.config,
          existing.userId,
          q.sourceCurrency,
          q.total,
        );
      await tx.transferAttempt.create({
        data: {
          transactionId: existing.transactionId,
          provider: q.targetCurrency === 'GHS' ? 'KORA' : 'PAYSTACK',
          providerReference: reference,
          providerStatus: 'RESERVED',
          metadata: {
            flow: 'PROVIDER_EXCHANGE',
            orderId: id,
            currency: q.targetCurrency,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'PROVIDER_EXCHANGE_RELEASED',
          targetType: 'ProviderExchangeOrder',
          targetId: id,
          reference,
          reason: reason.trim(),
          before: { status: existing.status },
          after: { status: 'PROCESSING' },
          metadata: audit ? { request: audit } : {},
        },
      });
      return true;
    });
    if (claimed) {
      const number = decryptSensitiveValue(
        q.destinationEncrypted,
        this.config.get('BANK_ACCOUNT_ENCRYPTION_KEY'),
      );
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: existing.userId },
      });
      // Persist dispatch before HTTP; after uncertainty only provider requery may settle it.
      await this.prisma.transferAttempt.update({
        where: {
          provider_providerReference: {
            provider: q.targetCurrency === 'GHS' ? 'KORA' : 'PAYSTACK',
            providerReference: reference,
          },
        },
        data: { providerStatus: 'DISPATCHING', status: 'PROCESSING' },
      });
      try {
        if (q.targetCurrency === 'GHS')
          await this.kora.sendMomo({
            reference,
            amount: q.targetAmount,
            number,
            operator: q.destinationCode,
            name: q.destinationName,
            email: user.email,
          });
        else {
          const recipient = await this.paystack.request<{
            recipient_code: string;
          }>('POST', '/transferrecipient', {
            type: 'nuban',
            name: q.destinationName,
            account_number: number,
            bank_code: q.destinationCode,
            currency: 'NGN',
          });
          if (!recipient.recipient_code)
            throw new ConflictException('Recipient confirmation is pending');
          const minor = q.targetAmount.mul(100);
          if (!minor.isInteger() || minor.gt(Number.MAX_SAFE_INTEGER))
            throw new BadRequestException('Invalid transfer amount');
          await this.paystack.request('POST', '/transfer', {
            source: 'balance',
            reference,
            amount: minor.toNumber(),
            recipient: recipient.recipient_code,
            reason: 'TrustPay exchange payout',
          });
        }
      } catch {
        /* An accepted transfer may have lost its response. Do not release funds or send again. */
      }
    }
    return orderView(
      await this.prisma.providerExchangeOrder.findUniqueOrThrow({
        where: { id },
        include: orderInclude,
      }),
    );
  }
  async reconcile(reference: string) {
    const order = await this.prisma.providerExchangeOrder.findUnique({
      where: { payoutReference: reference },
      include: orderInclude,
    });
    if (!order) return { ignored: true };
    const q = order.quote;
    const number = decryptSensitiveValue(
      q.destinationEncrypted,
      this.config.get('BANK_ACCOUNT_ENCRYPTION_KEY'),
    );
    let status: string;
    if (q.targetCurrency === 'GHS')
      status = await this.kora.verify(reference, {
        amount: q.targetAmount,
        number,
        operator: q.destinationCode,
      });
    else {
      const data = await this.paystack.request<Record<string, unknown>>(
        'GET',
        `/transfer/verify/${encodeURIComponent(reference)}`,
      );
      const details = asRecord(asRecord(data.recipient).details);
      const raw = String(data.amount);
      if (
        data.reference !== reference ||
        data.currency !== 'NGN' ||
        !/^\d+$/.test(raw) ||
        !new Decimal(raw).div(100).eq(q.targetAmount) ||
        details.account_number !== number ||
        details.bank_code !== q.destinationCode
      )
        throw new ConflictException(
          'Naira payout confirmation does not match its destination',
        );
      status = providerText(data.status).toLowerCase();
    }
    if (!['success', 'failed', 'reversed'].includes(status))
      return { pending: true };
    return serialMoney(this.prisma, async (tx) => {
      const row = await tx.providerExchangeOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
      if (
        row.status === 'REFUNDED' ||
        (row.status === 'SENT' && status !== 'reversed') ||
        (row.status === 'NEEDS_REVIEW' && status !== 'success')
      )
        return { duplicate: true };
      if (!['PROCESSING', 'SENT'].includes(row.status))
        return { ignored: true };
      const next =
        status === 'success'
          ? 'SENT'
          : q.fundingSource === 'WALLET'
            ? 'REFUNDED'
            : 'NEEDS_REVIEW';
      const update = await tx.providerExchangeOrder.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: next },
      });
      if (!update.count) return { duplicate: true };
      if (status !== 'success' && q.fundingSource === 'WALLET') {
        await this.ledger.creditWallet(
          {
            userId: row.userId,
            currency: q.sourceCurrency,
            amount: q.total,
            transactionId: row.transactionId,
            reference: `${reference}-refund`,
            source: 'EXCHANGE_PROVIDER_REVERSAL',
          },
          tx,
        );
        await tx.exchangeTreasuryEntry.create({
          data: {
            orderId: row.id,
            currency: q.sourceCurrency,
            kind: 'SOURCE_REFUNDED',
            amount: q.total,
          },
        });
      }
      await tx.exchangeTreasuryEntry.create({
        data: {
          orderId: row.id,
          currency: q.targetCurrency,
          kind:
            status === 'success'
              ? 'DESTINATION_PAID'
              : status === 'reversed'
                ? 'DESTINATION_REVERSED'
                : 'DESTINATION_FAILED',
          amount: q.targetAmount,
        },
      });
      await tx.transaction.update({
        where: { id: row.transactionId },
        data: {
          status:
            status === 'success'
              ? 'SUCCESS'
              : status === 'reversed'
                ? 'REVERSED'
                : 'FAILED',
        },
      });
      await tx.transferAttempt.update({
        where: {
          provider_providerReference: {
            provider: q.targetCurrency === 'GHS' ? 'KORA' : 'PAYSTACK',
            providerReference: reference,
          },
        },
        data: {
          status:
            status === 'success'
              ? 'SUCCESS'
              : status === 'reversed'
                ? 'REVERSED'
                : 'FAILED',
          providerStatus: status,
          lastCheckedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'PROVIDER_EXCHANGE_SETTLED',
          targetType: 'ProviderExchangeOrder',
          targetId: row.id,
          reference,
          before: { status: row.status },
          after: { status: next },
          metadata: {
            sourceCurrency: q.sourceCurrency,
            targetCurrency: q.targetCurrency,
            sourceAmount: q.total.toFixed(2),
            targetAmount: q.targetAmount.toFixed(2),
            providerStatus: status,
          },
        },
      });
      await tx.paymentNotification.upsert({
        where: { eventKey: `exchange-${next}:${row.id}` },
        update: {},
        create: {
          eventKey: `exchange-${next}:${row.id}`,
          orderId: row.id,
          title: `Exchange ${next.toLowerCase()}`,
        },
      });
      return { status: next };
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePending() {
    const rows = await this.prisma.providerExchangeOrder.findMany({
      where: { status: 'PROCESSING', payoutReference: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    for (const row of rows) {
      await this.prisma.providerExchangeOrder.updateMany({
        where: { id: row.id, status: 'PROCESSING' },
        data: { updatedAt: new Date() },
      });
      try {
        await this.reconcile(row.payoutReference!);
      } catch {
        /* Keep unresolved money reserved until independent confirmation. */
      }
    }
  }
}

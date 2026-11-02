import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { PaystackClient } from '../paystack/paystack.client';
import { BankingService } from '../banking/banking.service';
import { allocateDepositReference } from '../common/services/deposit-allocation';
import { isKycTierAtLeast } from '../common/utils/kyc-tier';
import { fromMinorUnit, toMinorUnit } from './utils/provider-amount';

type Payment = {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  domain: string;
  fees?: number;
  channel?: string;
  customer: { customer_code: string };
  authorization?: { channel?: string; receiver_bank_account_number?: string };
};

const PAYSTACK_CHECKOUT_CHANNELS = [
  'card',
  'bank',
  'apple_pay',
  'ussd',
  'qr',
  'mobile_money',
  'bank_transfer',
  'eft',
  'capitec_pay',
  'payattitude',
] as const;

@Injectable()
export class PaystackFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly paystack: PaystackClient,
    private readonly config: ConfigService,
    private readonly banking: BankingService,
  ) {}

  capabilities() {
    const configured = this.paystack.configured;
    const enabled = (name: string) =>
      configured && this.config.get<boolean>(name, true) !== false;
    return {
      provider: 'paystack',
      country: 'NG',
      currency: 'NGN',
      configured,
      activationStatus: 'UNCONFIRMED',
      checkout: enabled('PAYSTACK_CHECKOUT_ENABLED'),
      checkoutChannels: this.allowedCheckoutChannels(),
      checkoutMinimumAmount: '50.00',
      virtualAccounts:
        enabled('BANKING_ENABLED') && enabled('VIRTUAL_ACCOUNTS_ENABLED'),
      withdrawals:
        enabled('WITHDRAWALS_ENABLED') &&
        this.config.get<string>('BANKING_PROVIDER_PRIMARY', 'paystack') ===
          'paystack',
      internalTransfers:
        this.config.get<boolean>('INTERNAL_TRANSFERS_ENABLED', false) === true,
      identityVerification: configured,
      manualDocumentReview: true,
      automatedIdentityTypes: ['BVN'],
      withdrawalMinimumTier: 'TIER_1',
    };
  }

  async initialize(userId: string, amountText: string, key: string) {
    if (!this.capabilities().checkout)
      throw new ServiceUnavailableException('Paystack funding is unavailable');
    if (!key || key.length > 200)
      throw new BadRequestException('A valid Idempotency-Key is required');
    const amount = new Decimal(amountText);
    const minor = toMinorUnit(amount);
    if (amount.lt(50))
      throw new BadRequestException(
        'The minimum Paystack checkout amount is NGN 50',
      );
    if (amount.gt(10000000))
      throw new BadRequestException('Amount must be at most 10000000');
    const user = await this.assertEligible(userId);
    const checkoutChannels = this.allowedCheckoutChannels();
    const reference = `fund-${createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 40)}`;
    const existing = await this.prisma.transaction.findUnique({
      where: { reference },
    });
    if (existing) {
      if (
        !existing.amount.eq(amount) ||
        existing.userId !== userId ||
        existing.currency !== 'NGN'
      )
        throw new BadRequestException(
          'This payment attempt has different details',
        );
      const metadata = this.record(existing.metadata);
      const authorizationUrl =
        existing.status === 'PENDING'
          ? (metadata.authorizationUrl as string | undefined)
          : undefined;
      return {
        reference,
        status: existing.status,
        authorizationUrl,
        message:
          existing.status === 'PENDING' && !authorizationUrl
            ? `Payment initialization is unresolved for reference ${reference}. Check its status before trying another payment; if it remains unresolved or has no checkout link, contact support with this reference.`
            : 'Refresh this payment status before creating another attempt.',
      };
    }
    const customer = await this.paystack.ensureCustomer(userId);
    // Persist before dispatch. A timeout must not create a second provider reference.
    const pending = await this.prisma.$transaction(async (tx) => {
      const record = await tx.transaction.create({
        data: {
          userId,
          type: 'FUND',
          amount,
          currency: 'NGN',
          status: 'PENDING',
          reference,
          metadata: {
            provider: 'PAYSTACK',
            channel: 'checkout',
            customerCode: customer.customerCode,
            allowedChannels: checkoutChannels,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'PAYSTACK_CHECKOUT_CREATED',
          targetType: 'Transaction',
          targetId: record.id,
          reference,
          metadata: { userId, amount: amount.toFixed(2), currency: 'NGN' },
        },
      });
      return record;
    });
    const callback = new URL(
      '/dashboard/fund',
      this.config.get<string>('WEB_URL', 'http://localhost:3000'),
    );
    callback.searchParams.set('paystack_return', '1');
    let result: { authorization_url: string };
    try {
      result = await this.paystack.request<{ authorization_url: string }>(
        'POST',
        '/transaction/initialize',
        {
          email: user.email,
          amount: minor,
          currency: 'NGN',
          reference,
          callback_url: callback.toString(),
          channels: checkoutChannels,
        },
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        await this.prisma.transaction.updateMany({
          where: { id: pending.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        await this.prisma.auditLog.create({
          data: {
            action: 'PAYSTACK_CHECKOUT_REJECTED',
            targetType: 'Transaction',
            targetId: pending.id,
            reference,
            metadata: { userId, status: 'FAILED' },
          },
        });
        throw error;
      }
      return {
        reference,
        status: 'PENDING',
        message: `Payment initialization is unresolved for reference ${reference}. Check its status before trying another payment; if it remains unresolved or has no checkout link, contact support with this reference.`,
      };
    }
    let authorizationUrl: URL;
    try {
      authorizationUrl = new URL(result.authorization_url);
    } catch {
      throw new ServiceUnavailableException(
        'The payment checkout could not be confirmed',
      );
    }
    if (
      authorizationUrl.protocol !== 'https:' ||
      authorizationUrl.username !== '' ||
      authorizationUrl.password !== '' ||
      authorizationUrl.port !== '' ||
      !['checkout.paystack.com', 'paystack.com'].includes(
        authorizationUrl.hostname,
      )
    )
      throw new ServiceUnavailableException(
        'The payment checkout could not be confirmed',
      );
    await this.prisma.transaction.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: {
        metadata: {
          ...this.record(pending.metadata),
          authorizationUrl: authorizationUrl.toString(),
        },
      },
    });
    return {
      reference,
      status: 'PENDING',
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async verify(userId: string, reference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
    });
    if (
      !transaction ||
      transaction.userId !== userId ||
      transaction.type !== 'FUND' ||
      this.record(transaction.metadata).provider !== 'PAYSTACK'
    )
      throw new NotFoundException('Payment not found');
    if (transaction.status === 'SUCCESS')
      return { reference, status: 'SUCCESS' };
    await this.confirmCharge(reference);
    const current = await this.prisma.transaction.findUnique({
      where: { reference },
      select: { status: true },
    });
    return { reference, status: current?.status ?? 'PENDING' };
  }

  async confirmCharge(reference: string) {
    const payment = await this.paystack.request<Payment>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    const expectedDomain = this.config
      .get<string>('PAYSTACK_SECRET_KEY')
      ?.startsWith('sk_live_')
      ? 'live'
      : 'test';
    if (
      payment.reference !== reference ||
      payment.domain !== expectedDomain ||
      payment.currency !== 'NGN'
    )
      throw new BadRequestException(
        'Payment confirmation does not match this environment or currency',
      );
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
    });
    if (payment.status !== 'success') {
      if (transaction && ['failed', 'abandoned'].includes(payment.status)) {
        const metadata = this.record(transaction.metadata);
        if (
          transaction.type !== 'FUND' ||
          metadata.provider !== 'PAYSTACK' ||
          metadata.channel !== 'checkout' ||
          metadata.customerCode !== payment.customer?.customer_code ||
          !transaction.amount.eq(fromMinorUnit(payment.amount))
        )
          throw new BadRequestException(
            'Payment failure confirmation does not match the funding attempt',
          );
        this.assertCheckoutChannelAllowed(payment, metadata);
        await this.prisma.transaction.updateMany({
          where: { id: transaction.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
        return {
          reference,
          status: transaction.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        };
      }
      return { reference, status: 'PENDING' };
    }
    const amount = fromMinorUnit(payment.amount);
    if (transaction) {
      const metadata = this.record(transaction.metadata);
      if (
        transaction.type === 'FUND' &&
        metadata.provider === 'PAYSTACK' &&
        transaction.status === 'SUCCESS' &&
        transaction.currency === payment.currency &&
        transaction.amount.eq(amount)
      ) {
        this.assertCheckoutChannelAllowed(payment, metadata);
        return { reference, status: 'SUCCESS' };
      }
      if (
        transaction.type !== 'FUND' ||
        metadata.provider !== 'PAYSTACK' ||
        metadata.channel !== 'checkout' ||
        transaction.currency !== payment.currency ||
        !transaction.amount.eq(amount) ||
        metadata.customerCode !== payment.customer?.customer_code
      )
        throw new BadRequestException(
          'Payment confirmation does not match the funding attempt',
        );
      this.assertCheckoutChannelAllowed(payment, metadata);
      if (transaction.status === 'SUCCESS')
        return { reference, status: 'SUCCESS' };
      await this.assertEligible(transaction.userId);
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.transaction.updateMany({
          where: { id: transaction.id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'SUCCESS' },
        });
        if (updated.count !== 1) return;
        await allocateDepositReference(tx, {
          reference,
          settlementId: `funding:${transaction.id}`,
          amount,
          kind: 'FUNDING',
          existingFundingTransactionId: transaction.id,
        });
        const credit = await this.ledger.creditWallet(
          {
            userId: transaction.userId,
            currency: 'NGN',
            amount,
            transactionId: transaction.id,
            reference,
            source: 'PAYSTACK_CHECKOUT',
          },
          tx,
        );
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            walletId: credit.walletId,
            metadata: {
              ...metadata,
              providerFees:
                payment.fees === undefined
                  ? null
                  : fromMinorUnit(payment.fees, true).toFixed(2),
            },
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'PAYSTACK_FUNDING_CREDITED',
            targetType: 'Transaction',
            targetId: transaction.id,
            reference,
            before: { walletBalance: credit.balanceBefore.toFixed(2) },
            after: { walletBalance: credit.balanceAfter.toFixed(2) },
            metadata: {
              userId: transaction.userId,
              amount: amount.toFixed(2),
              currency: 'NGN',
            },
          },
        });
      });
      return { reference, status: 'SUCCESS' };
    }
    const accountNumber = payment.authorization?.receiver_bank_account_number;
    const channel = payment.authorization?.channel || payment.channel;
    if (
      channel !== 'dedicated_nuban' ||
      !accountNumber ||
      !payment.customer?.customer_code
    )
      throw new BadRequestException(
        'Unmatched Paystack payment requires reconciliation',
      );
    const account = await this.prisma.virtualAccount.findUnique({
      where: {
        provider_accountNumber: { provider: 'PAYSTACK', accountNumber },
      },
    });
    if (
      !account ||
      account.providerCustomerId !== payment.customer.customer_code
    )
      throw new BadRequestException(
        'Payment receiving account does not match a customer',
      );
    return this.banking.processVirtualAccountDeposit({
      provider: 'paystack',
      eventType: 'charge.success',
      providerReference: reference,
      accountNumber,
      amount,
      currency: 'NGN',
      settlementAmount:
        payment.fees === undefined
          ? undefined
          : amount.sub(fromMinorUnit(payment.fees, true)),
      rawPayload: {
        reference,
        provider: 'PAYSTACK',
        amount: amount.toFixed(2),
        currency: 'NGN',
      },
    });
  }

  async diagnostics() {
    const [banks, balance] = await Promise.allSettled([
      this.paystack.request<unknown[]>(
        'GET',
        '/dedicated_account/available_providers',
      ),
      this.paystack.request<unknown>('GET', '/balance'),
    ]);
    return {
      configured: this.paystack.configured,
      apiConnected:
        banks.status === 'fulfilled' || balance.status === 'fulfilled',
      virtualAccountProviders: banks.status === 'fulfilled' ? banks.value : [],
      balanceAccess: balance.status === 'fulfilled',
      transferApproval:
        'Confirm merchant dashboard settings; no payout was initiated',
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private allowedCheckoutChannels() {
    const raw = this.config.get<string>(
      'PAYSTACK_FUNDING_ALLOWED_CHANNELS',
      'bank_transfer',
    );
    const channels = String(raw ?? '')
      .split(',')
      .map((channel) => channel.trim().toLowerCase())
      .filter(
        (channel): channel is (typeof PAYSTACK_CHECKOUT_CHANNELS)[number] =>
          (PAYSTACK_CHECKOUT_CHANNELS as readonly string[]).includes(channel),
      );
    if (channels.length === 0) {
      throw new ServiceUnavailableException(
        'Paystack funding channels are not configured',
      );
    }
    return [...new Set(channels)];
  }

  private assertCheckoutChannelAllowed(
    payment: Payment,
    metadata: Record<string, unknown>,
  ) {
    // Legacy/DVA funding records do not have this checkout policy metadata.
    if (!Array.isArray(metadata.allowedChannels)) return;
    const allowed = metadata.allowedChannels.filter(
      (channel): channel is string => typeof channel === 'string',
    );
    const channel = payment.authorization?.channel || payment.channel;
    if (!channel || !allowed.includes(channel)) {
      throw new BadRequestException(
        'Payment confirmation used a channel that is not permitted for funding',
      );
    }
  }

  private async assertEligible(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        isSuspended: true,
        kycStatus: true,
        kycTier: true,
      },
    });
    if (
      !user ||
      user.isSuspended ||
      user.kycStatus !== 'VERIFIED' ||
      !isKycTierAtLeast(user.kycTier, 'TIER_1')
    )
      throw new ForbiddenException(
        'Complete identity verification before funding your wallet',
      );
    return user;
  }
}

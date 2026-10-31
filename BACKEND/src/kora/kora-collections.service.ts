import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { allocateDepositReference } from '../common/services/deposit-allocation';
import { encryptSensitiveValue } from '../common/utils/encryption';
import {
  KoraClient,
  asRecord,
  providerText,
  parseKoraMoney,
  KoraRecord,
} from './kora.client';
import { KoraCapabilitiesService } from './kora-capabilities.service';
import {
  eligibleKoraUser,
  fundExchangeOrder,
  nonnegativeProviderFee,
  serialMoney,
} from './kora.policy';

@Injectable()
export class KoraCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: KoraClient,
    private readonly ledger: LedgerService,
    private readonly capabilities: KoraCapabilitiesService,
    private readonly config: ConfigService,
  ) {}
  private encryptionKey() {
    return this.config.get<string>('BANK_ACCOUNT_ENCRYPTION_KEY');
  }
  async createMomoIntent(
    userId: string,
    orderId: string | undefined,
    dto: { amount?: string; mobileNumber: string },
    key: string,
  ) {
    if (!this.capabilities.get().momoCollections)
      throw new ServiceUnavailableException(
        'Ghana MoMo payments are not enabled',
      );
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(key ?? '') ||
      !/^233\d{9}$/.test(dto.mobileNumber)
    )
      throw new BadRequestException(
        'Check the payment reference and Ghana mobile number',
      );
    const user = await eligibleKoraUser(
      this.prisma,
      userId,
      orderId ? 'TIER_2' : 'TIER_1',
    );
    const order = orderId
      ? await this.prisma.providerExchangeOrder.findFirst({
          where: { id: orderId, userId },
          include: { quote: true },
        })
      : null;
    const amount = order?.quote.total ?? parseKoraMoney(dto.amount);
    const reference = `ghs-pay-${createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 32)}`;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          userId,
          orderId: orderId ?? null,
          amount: amount.toFixed(2),
          phone: dto.mobileNumber,
        }),
      )
      .digest('hex');
    let intent = await this.prisma.koraCollectionIntent.findUnique({
      where: { reference },
    });
    if (intent && intent.requestHash !== requestHash)
      throw new ConflictException('This payment attempt has different details');
    if (intent) return this.getIntent(userId, intent.id);
    if (
      orderId &&
      (!order ||
        order.quote.sourceCurrency !== 'GHS' ||
        order.quote.fundingSource !== 'EXTERNAL' ||
        order.status !== 'AWAITING_PAYMENT')
    )
      throw new ConflictException(
        'This exchange is not awaiting a cedi payment',
      );
    if (order && order.quote.expiresAt < new Date())
      throw new ConflictException(
        'This quote expired. Create a new exchange before paying.',
      );
    if (order && !this.capabilities.get().exchange)
      throw new ServiceUnavailableException(
        'Exchange payments are not enabled',
      );
    if (!intent) {
      try {
        intent = await serialMoney(this.prisma, async (tx) => {
          const transaction = order
            ? null
            : await tx.transaction.create({
                data: {
                  userId,
                  type: 'FUND',
                  currency: 'GHS',
                  amount,
                  reference: `KORA:${reference}`,
                  metadata: { provider: 'KORA', channel: 'mobile_money' },
                },
              });
          return tx.koraCollectionIntent.create({
            data: {
              userId,
              reference,
              requestHash,
              amount,
              purpose: order ? 'EXCHANGE' : 'WALLET',
              orderId,
              transactionId: transaction?.id,
              mobileEncrypted: encryptSensitiveValue(
                dto.mobileNumber,
                this.encryptionKey(),
              ),
            },
          });
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error;
        intent = await this.prisma.koraCollectionIntent.findUnique({
          where: { reference },
        });
        if (!intent || intent.requestHash !== requestHash)
          throw new ConflictException(
            'An existing payment already belongs to this order. Refresh its status.',
          );
      }
    }
    if (intent.submittedAt) return this.getIntent(userId, intent.id);
    const claimed = await this.prisma.koraCollectionIntent.updateMany({
      where: { id: intent.id, submittedAt: null },
      data: { submittedAt: new Date(), claimedAt: new Date() },
    });
    if (claimed.count === 1) {
      try {
        const data = await this.client.request(
          'POST',
          '/charges/mobile-money',
          {
            reference,
            amount,
            currency: 'GHS',
            customer: { name: user.fullName, email: user.email },
            mobile_money: { number: dto.mobileNumber },
            merchant_bears_cost: true,
          },
        );
        await this.saveAuthorization(intent.id, data, reference, amount);
      } catch {
        /* Unknown outcomes keep the persisted reference; never create another charge. */
      }
    }
    return this.getIntent(userId, intent.id);
  }
  private async saveAuthorization(
    id: string,
    data: KoraRecord,
    reference: string,
    amount: Prisma.Decimal,
  ) {
    if (
      data.currency !== 'GHS' ||
      !parseKoraMoney(data.amount).eq(amount) ||
      data.payment_reference !== reference
    )
      throw new ConflictException('The payment response needs verification');
    const providerReference = providerText(data.transaction_reference);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(providerReference))
      throw new ConflictException('Provider reference needs verification');
    const model = providerText(data.auth_model);
    const auth: Record<string, string> = {
      model: ['OTP', 'STK_PROMPT', 'REDIRECT'].includes(model)
        ? model
        : 'PENDING',
    };
    if (model === 'REDIRECT') {
      const raw = providerText(asRecord(data.authorization).redirect_url);
      const url = new URL(raw);
      const allowed = this.config
        .get<string>('KORA_REDIRECT_HOSTS', '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !allowed.includes(url.hostname)
      )
        throw new ConflictException(
          'This payment authorization address is not enabled',
        );
      auth.redirectUrl = url.toString();
    }
    await this.prisma.koraCollectionIntent.update({
      where: { id },
      data: { providerReference, authorization: auth, claimedAt: null },
    });
  }
  async getIntent(userId: string, id: string) {
    const intent = await this.prisma.koraCollectionIntent.findFirst({
      where: { id, userId },
    });
    if (!intent) throw new NotFoundException('Payment not found');
    return {
      id: intent.id,
      reference: intent.reference,
      status: intent.status,
      currency: 'GHS',
      amount: intent.amount.toFixed(2),
      authorization: asRecord(intent.authorization),
      orderId: intent.orderId,
    };
  }
  async refreshIntent(userId: string, id: string) {
    const intent = await this.prisma.koraCollectionIntent.findFirst({
      where: { id, userId },
    });
    if (!intent) throw new NotFoundException('Payment not found');
    if (intent.status !== 'SUCCESS') {
      try {
        await this.confirmCharge(intent.providerReference ?? intent.reference);
      } catch {
        /* Preserve unknown status, expose it through the owned view. */
      }
    }
    return this.getIntent(userId, id);
  }
  async authorizeIntent(userId: string, id: string, otp: string) {
    const intent = await this.prisma.koraCollectionIntent.findFirst({
      where: { id, userId },
    });
    if (
      !intent?.providerReference ||
      asRecord(intent.authorization).model !== 'OTP' ||
      intent.status !== 'PENDING'
    )
      throw new ConflictException('This payment is not waiting for an OTP');
    if (!/^\d{4,8}$/.test(otp))
      throw new BadRequestException('Enter the code sent to your phone');
    const claimed = await this.prisma.koraCollectionIntent.updateMany({
      where: { id, claimedAt: null, status: 'PENDING' },
      data: { claimedAt: new Date(), authorization: { model: 'PENDING' } },
    });
    if (!claimed.count)
      throw new ConflictException('Authorization is already being checked');
    const data = await this.client.request(
      'POST',
      '/charges/mobile-money/authorize',
      { reference: intent.providerReference, token: otp },
    );
    await this.saveAuthorization(
      intent.id,
      data,
      intent.reference,
      intent.amount,
    );
    return this.getIntent(userId, id);
  }
  async confirmCharge(reference: string) {
    if (!/^[A-Za-z0-9_-]{5,160}$/.test(reference))
      throw new BadRequestException('Invalid payment reference');
    const payment = await this.client.request(
      'GET',
      `/charges/${encodeURIComponent(reference)}`,
    );
    const providerReference = providerText(payment.reference);
    if (
      providerReference !== reference &&
      payment.payment_reference !== reference
    )
      throw new ConflictException('Payment reference does not match');
    if (payment.currency !== 'GHS')
      throw new ConflictException('Payment currency does not match');
    if (payment.status !== 'success') {
      if (['pending', 'processing'].includes(providerText(payment.status))) {
        const intent = await this.prisma.koraCollectionIntent.findFirst({
          where: {
            OR: [
              { reference },
              { providerReference },
              ...(providerText(payment.payment_reference)
                ? [{ reference: providerText(payment.payment_reference) }]
                : []),
            ],
          },
        });
        if (
          intent &&
          payment.payment_reference === intent.reference &&
          (!intent.providerReference ||
            intent.providerReference === providerReference) &&
          parseKoraMoney(payment.amount).eq(intent.amount) &&
          ['OTP', 'STK_PROMPT', 'REDIRECT'].includes(
            providerText(payment.auth_model),
          )
        ) {
          await this.saveAuthorization(
            intent.id,
            { ...payment, transaction_reference: providerReference },
            intent.reference,
            intent.amount,
          );
        }
      }
      return { routed: 'pending' };
    }
    // amount_paid must be positive if present; contradictory success payloads stay unresolved.
    const amount = parseKoraMoney(payment.amount_paid ?? payment.amount);
    if (!parseKoraMoney(payment.amount).eq(amount))
      throw new ConflictException('Payment amount needs reconciliation');
    const fee = nonnegativeProviderFee(payment.fee);
    if (fee.gt(amount))
      throw new ConflictException('Payment fee needs reconciliation');
    const intent = await this.prisma.koraCollectionIntent.findFirst({
      where: {
        OR: [
          { reference },
          { providerReference },
          ...(providerText(payment.payment_reference)
            ? [{ reference: providerText(payment.payment_reference) }]
            : []),
        ],
      },
    });
    const details = asRecord(payment.virtual_bank_account);
    const accountRef = providerText(details.account_reference);
    const accountNumber = providerText(details.account_number);
    const account =
      !intent && accountRef
        ? await this.prisma.virtualAccount.findFirst({
            where: {
              provider: 'KORA',
              providerAccountId: accountRef,
              currency: 'GHS',
              status: 'ACTIVE',
            },
          })
        : null;
    if (!intent && (!account || account.accountNumber !== accountNumber))
      throw new ConflictException(
        'Payment cannot be matched to a receiving account',
      );
    if (
      intent &&
      (!intent.amount.eq(amount) ||
        (intent.providerReference &&
          intent.providerReference !== providerReference))
    )
      throw new ConflictException(
        'Payment does not match its original details',
      );
    const namespaced = `KORA:${providerReference}`;
    return serialMoney(this.prisma, async (tx) => {
      const event = await tx.providerEvent.upsert({
        where: {
          provider_providerReference_eventType: {
            provider: 'KORA',
            providerReference,
            eventType: 'charge.success',
          },
        },
        update: {},
        create: {
          provider: 'KORA',
          providerReference,
          eventType: 'charge.success',
          payload: {
            currency: 'GHS',
            amount: amount.toFixed(2),
            fee: fee.toFixed(2),
          },
        },
      });
      const claim = await tx.providerEvent.updateMany({
        where: { id: event.id, status: { in: ['RECEIVED', 'FAILED'] } },
        data: { status: 'PROCESSING' },
      });
      if (!claim.count) return { routed: 'duplicate', duplicate: true };
      const userId = intent?.userId ?? account!.userId;
      await eligibleKoraUser(tx, userId, intent?.orderId ? 'TIER_2' : 'TIER_1');
      const fundingTransaction = intent?.transactionId
        ? await tx.transaction.findUniqueOrThrow({
            where: { id: intent.transactionId },
          })
        : null;
      await allocateDepositReference(tx, {
        reference: namespaced,
        settlementId: intent?.orderId
          ? `kora-order:${intent.orderId}`
          : `kora-fund:${event.id}`,
        amount,
        kind: 'FUNDING',
        existingFundingTransactionId: fundingTransaction?.id,
      });
      if (intent?.orderId) {
        const order = await tx.providerExchangeOrder.findUniqueOrThrow({
          where: { id: intent.orderId },
          include: { quote: true },
        });
        if (
          order.userId !== userId ||
          order.quote.sourceCurrency !== 'GHS' ||
          order.quote.fundingSource !== 'EXTERNAL' ||
          !order.quote.total.eq(amount)
        )
          throw new ConflictException('Payment does not match this exchange');
        await fundExchangeOrder(tx, order.id, namespaced);
      } else {
        const transaction =
          fundingTransaction ??
          (await tx.transaction.create({
            data: {
              userId,
              type: 'FUND',
              currency: 'GHS',
              amount,
              reference: namespaced,
              status: 'PENDING',
              metadata: {
                provider: 'KORA',
                channel: 'virtual_account',
                providerReference,
                fee: fee.toFixed(2),
                settlementAmount: amount.minus(fee).toFixed(2),
              },
            },
          }));
        if (
          transaction.status !== 'PENDING' ||
          transaction.currency !== 'GHS' ||
          !transaction.amount.eq(amount)
        )
          throw new ConflictException(
            'Funding transaction needs reconciliation',
          );
        const credit = await this.ledger.creditWallet(
          {
            userId,
            currency: 'GHS',
            amount,
            transactionId: transaction.id,
            reference: namespaced,
            source: 'KORA_DEPOSIT',
          },
          tx,
        );
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'SUCCESS', walletId: credit.walletId },
        });
      }
      if (intent)
        await tx.koraCollectionIntent.update({
          where: { id: intent.id },
          data: {
            status: 'SUCCESS',
            providerReference,
            claimedAt: null,
            authorization: Prisma.JsonNull,
          },
        });
      await tx.providerEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: intent?.orderId
            ? 'KORA_EXCHANGE_FUNDED'
            : 'KORA_WALLET_FUNDED',
          targetType: intent?.orderId
            ? 'ProviderExchangeOrder'
            : 'ProviderEvent',
          targetId: intent?.orderId ?? event.id,
          reference: namespaced,
          metadata: {
            userId,
            currency: 'GHS',
            amount: amount.toFixed(2),
            fee: fee.toFixed(2),
          },
        },
      });
      return { routed: intent?.orderId ? 'exchange' : 'wallet' };
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverPendingPayments() {
    const rows = await this.prisma.koraCollectionIntent.findMany({
      where: { status: 'PENDING', submittedAt: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: 15,
    });
    for (const row of rows) {
      await this.prisma.koraCollectionIntent.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { updatedAt: new Date() },
      });
      try {
        await this.confirmCharge(row.providerReference ?? row.reference);
      } catch {
        /* Do not resubmit an uncertain charge. */
      }
    }
  }
}

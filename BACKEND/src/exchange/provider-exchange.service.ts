import { RequestAuditContext } from '../common/services/request-audit-context';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { RateService } from './providers/rate.service';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { SettlementHoldService } from '../common/services/settlement-hold.service';
import { encryptSensitiveValue } from '../common/utils/encryption';
import { maskAccountNumber } from '../common/utils/masking';
import { KoraCapabilitiesService } from '../kora/kora-capabilities.service';
import { KoraClient, providerText, parseKoraMoney } from '../kora/kora.client';
import {
  eligibleKoraUser,
  fundExchangeOrder,
  serialMoney,
} from '../kora/kora.policy';
import { reserveCurrencyLimit } from '../kora/kora-limits';
import { PaystackClient } from '../paystack/paystack.client';

export type ProviderQuoteInput = {
  sourceCurrency: 'GHS' | 'NGN';
  fundingSource: 'WALLET' | 'EXTERNAL';
  amount: string;
  destinationCode: string;
  destinationNumber: string;
};
export const orderInclude = { quote: true, collectionIntent: true } as const;
export type FundedOrder = Prisma.ProviderExchangeOrderGetPayload<{
  include: typeof orderInclude;
}>;
export function quoteView(
  q: Prisma.ProviderExchangeQuoteGetPayload<Record<string, never>>,
) {
  return {
    id: q.id,
    sourceCurrency: q.sourceCurrency,
    targetCurrency: q.targetCurrency,
    fundingSource: q.fundingSource,
    amount: q.amount.toFixed(2),
    fee: q.fee.toFixed(2),
    total: q.total.toFixed(2),
    rate: q.rate.toFixed(6),
    targetAmount: q.targetAmount.toFixed(2),
    destinationType: q.destinationType,
    destinationCode: q.destinationCode,
    destinationName: q.destinationName,
    destinationMasked: q.destinationMasked,
    expiresAt: q.expiresAt,
  };
}
export function orderView(row: FundedOrder) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    reference: `PX-${row.id}`,
    status: row.status,
    fundedAt: row.fundedAt,
    payoutReference: row.payoutReference,
    reason: row.reason,
    createdAt: row.createdAt,
    quote: quoteView(row.quote),
    payment: row.collectionIntent
      ? {
          id: row.collectionIntent.id,
          status: row.collectionIntent.status,
          authorization: row.collectionIntent.authorization,
        }
      : null,
  };
}

@Injectable()
export class ProviderExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rates: RateService,
    private readonly pin: TransactionPinService,
    private readonly config: ConfigService,
    private readonly capabilities: KoraCapabilitiesService,
    private readonly kora: KoraClient,
    private readonly paystack: PaystackClient,
    private readonly holds: SettlementHoldService,
  ) {}
  enabled() {
    return (
      this.capabilities.get().exchange &&
      this.config.get('PAYSTACK_EXCHANGE_USE_CASE_APPROVED') === true &&
      this.paystack.configured
    );
  }
  private requireEnabled() {
    if (!this.enabled())
      throw new ServiceUnavailableException(
        'Provider exchange is awaiting merchant activation',
      );
  }
  async quote(userId: string, dto: ProviderQuoteInput) {
    this.requireEnabled();
    await eligibleKoraUser(this.prisma, userId);
    if (
      !['GHS', 'NGN'].includes(dto.sourceCurrency) ||
      !['WALLET', 'EXTERNAL'].includes(dto.fundingSource)
    )
      throw new BadRequestException('Unsupported exchange method');
    if (dto.fundingSource === 'EXTERNAL' && dto.sourceCurrency !== 'GHS')
      throw new BadRequestException('Fund your naira wallet before exchanging');
    if (
      dto.fundingSource === 'EXTERNAL' &&
      !this.capabilities.get().momoCollections
    )
      throw new ServiceUnavailableException(
        'Cedi MoMo payments are unavailable',
      );
    const source = dto.sourceCurrency,
      target = source === 'GHS' ? 'NGN' : 'GHS';
    const amount = parseKoraMoney(dto.amount);
    const live = await this.rates.getRate(source, target);
    if (live.isStale)
      throw new ServiceUnavailableException(
        'A fresh exchange rate is required',
      );
    const markup = new Decimal(String(live.markup));
    if (!markup.isFinite() || markup.lt(0) || markup.gt(50))
      throw new ServiceUnavailableException('Exchange rate is unavailable');
    const rate = new Decimal(String(live.rate))
      .mul(new Decimal(1).minus(markup.div(100)))
      .toDecimalPlaces(6, Decimal.ROUND_DOWN);
    const targetAmount = amount
      .mul(rate)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (
      !rate.isFinite() ||
      rate.lte(0) ||
      targetAmount.lte(0) ||
      targetAmount.gt('10000000')
    )
      throw new BadRequestException(
        'This amount is outside the exchange limits',
      );
    const fee =
      dto.fundingSource === 'EXTERNAL'
        ? new Decimal(0)
        : amount
            .mul(new Decimal(1).plus(markup.div(2)))
            .div(100)
            .toDecimalPlaces(2, Decimal.ROUND_CEIL);
    const destination = await this.resolveDestination(
      target,
      dto.destinationCode,
      dto.destinationNumber,
    );
    const row = await this.prisma.providerExchangeQuote.create({
      data: {
        userId,
        sourceCurrency: source,
        targetCurrency: target,
        fundingSource: dto.fundingSource,
        amount,
        fee,
        total: amount.plus(fee),
        rate,
        targetAmount,
        ...destination,
        expiresAt: new Date(
          Date.now() + (dto.fundingSource === 'EXTERNAL' ? 600000 : 120000),
        ),
      },
    });
    return quoteView(row);
  }
  async resolveDestination(
    currency: 'GHS' | 'NGN',
    code: string,
    number: string,
  ) {
    let name: string;
    if (currency === 'NGN') {
      if (!/^\d{10}$/.test(number) || !/^[A-Za-z0-9_-]{2,20}$/.test(code))
        throw new BadRequestException(
          'Check the Nigerian bank and account number',
        );
      const data = await this.paystack.request<{
        account_name: string;
        account_number: string;
      }>('GET', '/bank/resolve', undefined, {
        account_number: number,
        bank_code: code,
      });
      if (data.account_number !== number || !data.account_name?.trim())
        throw new BadRequestException('The bank account could not be verified');
      name = data.account_name.trim();
    } else {
      if (!this.capabilities.get().momoPayouts)
        throw new ServiceUnavailableException(
          'Ghana MoMo payouts are not enabled',
        );
      if (!/^233\d{9}$/.test(number))
        throw new BadRequestException('Use a Ghana number starting with 233');
      const operators = await this.kora.request<
        Array<{ slug: string; code: string }>
      >('GET', '/misc/mobile-money', undefined, { countryCode: 'GH' });
      const operator = operators.find((item) => item.slug === code);
      if (!operator?.code)
        throw new BadRequestException('Choose an available Ghana MoMo network');
      const data = await this.kora.request(
        'POST',
        '/misc/mobile-money/resolve',
        { mobileMoneyCode: operator.code, phoneNumber: number, currency: 'GH' },
      );
      name = providerText(data.account_name).trim();
      if (!name)
        throw new BadRequestException(
          'The MoMo recipient could not be verified',
        );
    }
    return {
      destinationType: currency === 'NGN' ? 'BANK' : 'MOMO',
      destinationCode: code,
      destinationName: name,
      destinationEncrypted: encryptSensitiveValue(
        number,
        this.config.get('BANK_ACCOUNT_ENCRYPTION_KEY'),
      ),
      destinationMasked: maskAccountNumber(number),
    };
  }
  async getQuote(userId: string, id: string) {
    const quote = await this.prisma.providerExchangeQuote.findFirst({
      where: { id, userId },
    });
    if (!quote) throw new NotFoundException('Exchange quote not found');
    return quoteView(quote);
  }
  async recoverQuote(userId: string, id: string) {
    return serialMoney(this.prisma, async (tx) => {
      const quote = await tx.providerExchangeQuote.findFirst({
        where: { id, userId },
      });
      if (!quote) throw new NotFoundException('Exchange quote not found');
      const existing = await tx.providerExchangeOrder.findUnique({
        where: { quoteId: id },
        include: orderInclude,
      });
      if (existing) return { order: orderView(existing), canRequote: false };
      if (quote.expiresAt >= new Date() && !quote.cancelledAt)
        return { order: null, canRequote: false };
      // Write this row in the same serializable transaction: an in-flight consumer must conflict.
      await tx.providerExchangeQuote.update({
        where: { id },
        data: { cancelledAt: new Date() },
      });
      return { order: null, canRequote: true };
    });
  }
  async listAdmin(input: { status?: string; cursor?: string }) {
    const status =
      input.status && input.status !== 'ALL' ? input.status : undefined;
    const [rows, groups] = await Promise.all([
      this.prisma.providerExchangeOrder.findMany({
        where: { ...(status ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: orderInclude,
      }),
      this.prisma.providerExchangeOrder.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    const items = rows.slice(0, 50);
    return {
      items: items.map(orderView),
      nextCursor: rows.length > 50 ? items.at(-1)!.id : null,
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
    };
  }
  async create(
    userId: string,
    quoteId: string,
    transactionPin: string,
    key: string,
    audit?: RequestAuditContext,
  ) {
    this.requireEnabled();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key ?? ''))
      throw new BadRequestException('A valid Idempotency-Key is required');
    await this.pin.verifyRequired(userId, transactionPin);
    const keyHash = createHash('sha256').update(key).digest('hex');
    const existing = await this.prisma.providerExchangeOrder.findUnique({
      where: { userId_createKeyHash: { userId, createKeyHash: keyHash } },
      include: orderInclude,
    });
    if (existing) {
      if (existing.quoteId !== quoteId)
        throw new ConflictException(
          'This attempt belongs to different exchange details',
        );
      return orderView(existing);
    }
    try {
      const order = await serialMoney(this.prisma, async (tx) => {
        await eligibleKoraUser(tx, userId);
        const q = await tx.providerExchangeQuote.findFirst({
          where: { id: quoteId, userId },
        });
        if (!q) throw new NotFoundException('Exchange quote not found');
        if (q.cancelledAt || q.expiresAt < new Date())
          throw new ConflictException(
            'This quote expired. Review a new quote before paying.',
          );
        await this.holds.assertOutboundAllowed(
          { operation: 'EXCHANGE', currency: q.sourceCurrency },
          tx,
        );
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'EXCHANGE',
            currency: q.sourceCurrency,
            amount: q.amount,
            fee: q.fee,
            reference: `PX-${q.id}`,
            metadata: {
              flow: 'PROVIDER_EXCHANGE',
              sourceCurrency: q.sourceCurrency,
              targetCurrency: q.targetCurrency,
              targetAmount: q.targetAmount.toFixed(2),
            },
          },
        });
        const row = await tx.providerExchangeOrder.create({
          data: {
            userId,
            quoteId,
            transactionId: transaction.id,
            createKeyHash: keyHash,
          },
          include: orderInclude,
        });
        if (q.fundingSource === 'WALLET') {
          await reserveCurrencyLimit(
            tx,
            this.config,
            userId,
            q.sourceCurrency,
            q.total,
          );
          await this.ledger.debitWallet(
            {
              userId,
              currency: q.sourceCurrency,
              amount: q.total,
              transactionId: transaction.id,
              reference: transaction.reference,
              source: 'EXCHANGE_PROVIDER_RESERVATION',
            },
            tx,
          );
          await fundExchangeOrder(
            tx,
            row.id,
            `WALLET:${transaction.reference}`,
          );
        }
        await tx.auditLog.create({
          data: {
            action: 'PROVIDER_EXCHANGE_CREATED',
            targetType: 'ProviderExchangeOrder',
            targetId: row.id,
            reference: transaction.reference,
            metadata: {
              userId,
              amount: q.total.toFixed(2),
              currency: q.sourceCurrency,
              fundingSource: q.fundingSource,
              ...(audit ? { request: audit } : {}),
            },
          },
        });
        return tx.providerExchangeOrder.findUniqueOrThrow({
          where: { id: row.id },
          include: orderInclude,
        });
      });
      return orderView(order);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.providerExchangeOrder.findUnique({
          where: { userId_createKeyHash: { userId, createKeyHash: keyHash } },
          include: orderInclude,
        });
        if (replay?.quoteId === quoteId) return orderView(replay);
        throw new ConflictException(
          'This quote was already used. Open the existing exchange.',
        );
      }
      throw error;
    }
  }
  async get(userId: string, id: string) {
    const row = await this.prisma.providerExchangeOrder.findFirst({
      where: { id, userId },
      include: orderInclude,
    });
    if (!row) throw new NotFoundException('Exchange not found');
    return orderView(row);
  }
  async list(userId?: string) {
    return (
      await this.prisma.providerExchangeOrder.findMany({
        where: userId ? { userId } : {},
        orderBy: { createdAt: 'desc' },
        take: userId ? 50 : 100,
        include: orderInclude,
      })
    ).map(orderView);
  }
}

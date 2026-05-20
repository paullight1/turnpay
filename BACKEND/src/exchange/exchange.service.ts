import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RateService } from './providers/rate.service';
import { RedisService } from '../redis/redis.service';
import { CreateQuoteDto, ExecuteQuoteDto } from './dto/exchange.dto';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';

export interface QuoteData {
  id: string;
  userId: string;
  from: string;
  to: string;
  amount: number;
  rate: number;
  markupPercent: number;
  fee: number;
  sendAmount: number;
  receiveAmount: number;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class ExchangeService {
  private readonly quoteTtlSeconds = 600;
  private readonly transactionTimeout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateService: RateService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly ledger: LedgerService,
  ) {
    this.transactionTimeout = 5000;
  }

  async getRate(from: string, to: string) {
    const { rate, markup } = await this.rateService.getRate(from, to);
    return {
      from,
      to,
      baseRate: rate,
      markupPercent: markup,
      effectiveRate: rate * (1 + markup / 100),
    };
  }

  async createQuote(userId: string, dto: CreateQuoteDto): Promise<QuoteData> {
    if (dto.from === dto.to) {
      throw new BadRequestException(
        'Source and destination currencies must be different',
      );
    }

    const { rate, markup } = await this.rateService.getRate(dto.from, dto.to);
    const effectiveRate = new Decimal(rate).mul(
      new Decimal(1).plus(new Decimal(markup).div(100)),
    );

    const fee = this.calculateFee(dto.amount, markup);
    const amount = new Decimal(dto.amount);
    const sendAmount = amount.plus(fee);
    const receiveAmount = amount.mul(effectiveRate);

    const quoteId = uuidv4();
    const quote: QuoteData = {
      id: quoteId,
      userId,
      from: dto.from,
      to: dto.to,
      amount: dto.amount,
      rate: effectiveRate.toNumber(),
      markupPercent: markup,
      fee: fee.toNumber(),
      sendAmount: sendAmount.toNumber(),
      receiveAmount: receiveAmount.toNumber(),
      expiresAt: new Date(Date.now() + this.quoteTtlSeconds * 1000),
      createdAt: new Date(),
    };

    await this.redis.set(
      `quote:${quoteId}`,
      JSON.stringify(quote),
      this.quoteTtlSeconds,
    );

    this.logger.info(
      {
        userId,
        quoteId,
        from: dto.from,
        to: dto.to,
        amount: dto.amount,
        fee,
        receiveAmount,
      },
      'Exchange quote created',
    );

    return quote;
  }

  async executeQuote(userId: string, dto: ExecuteQuoteDto) {
    const raw = await this.redis.get(`quote:${dto.quoteId}`);

    if (!raw) {
      throw new NotFoundException(
        'Quote not found. Please create a new quote.',
      );
    }

    const quote = JSON.parse(raw) as QuoteData;

    if (quote.userId !== userId) {
      throw new BadRequestException('Quote does not belong to this user');
    }

    if (new Date() > quote.expiresAt) {
      await this.redis.del(`quote:${quote.id}`);
      throw new BadRequestException(
        'Quote has expired. Please create a new quote.',
      );
    }

    const amount = new Decimal(quote.amount);
    const fee = new Decimal(quote.fee);
    const sendAmount = new Decimal(quote.sendAmount);
    const receiveAmount = new Decimal(quote.receiveAmount);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const sourceWallet = await tx.wallet.findUnique({
          where: {
            userId_currency: {
              userId,
              currency: quote.from as 'NGN' | 'GHS',
            },
          },
          select: { id: true },
        });

        if (!sourceWallet) {
          throw new NotFoundException(`${quote.from} wallet not found`);
        }

        const targetWallet = await tx.wallet.findUnique({
          where: {
            userId_currency: {
              userId,
              currency: quote.to as 'NGN' | 'GHS',
            },
          },
          select: { id: true },
        });

        if (!targetWallet) {
          throw new NotFoundException(`${quote.to} wallet not found`);
        }

        const reference = `EXC-${Date.now()}-${uuidv4().slice(0, 8)}`;

        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'EXCHANGE',
            amount,
            currency: quote.from as 'NGN' | 'GHS',
            status: 'SUCCESS',
            reference,
            fee,
            metadata: {
              quoteId: quote.id,
              from: quote.from,
              to: quote.to,
              rate: quote.rate,
              markupPercent: quote.markupPercent,
              receiveAmount: quote.receiveAmount,
              sendAmount: quote.sendAmount,
            },
            walletId: sourceWallet.id,
          },
        });

        const sourceMovement = await this.ledger.debitWallet(
          {
            userId,
            currency: quote.from as 'NGN' | 'GHS',
            amount: sendAmount,
            transactionId: transaction.id,
            reference,
            source: 'EXCHANGE_DEBIT',
            metadata: {
              quoteId: quote.id,
              fee: fee.toString(),
              targetCurrency: quote.to,
            },
          },
          tx,
        );

        const targetMovement = await this.ledger.creditWallet(
          {
            userId,
            currency: quote.to as 'NGN' | 'GHS',
            amount: receiveAmount,
            transactionId: transaction.id,
            reference,
            source: 'EXCHANGE_CREDIT',
            metadata: {
              quoteId: quote.id,
              sourceCurrency: quote.from,
              rate: quote.rate,
            },
          },
          tx,
        );

        return {
          transaction,
          sourceWallet: {
            currency: quote.from,
            balance: sourceMovement.balanceAfter,
          },
          targetWallet: {
            currency: quote.to,
            balance: targetMovement.balanceAfter,
          },
        };
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    await this.redis.del(`quote:${quote.id}`);

    this.logger.info(
      {
        userId,
        transactionId: result.transaction.id,
        reference: result.transaction.reference,
        from: quote.from,
        to: quote.to,
        amount: quote.amount,
        fee: quote.fee,
      },
      'Exchange executed successfully',
    );

    return {
      success: true,
      transaction: {
        id: result.transaction.id,
        reference: result.transaction.reference,
        type: result.transaction.type,
        amount: result.transaction.amount,
        fee: result.transaction.fee,
        currency: result.transaction.currency,
        status: result.transaction.status,
        createdAt: result.transaction.createdAt,
      },
      wallets: {
        source: result.sourceWallet,
        target: result.targetWallet,
      },
    };
  }

  private calculateFee(amount: number, markupPercent: number): Decimal {
    const baseFeePercent = 1.0;
    const totalPercent = new Decimal(baseFeePercent).plus(
      new Decimal(markupPercent).div(2),
    );
    return new Decimal(amount)
      .mul(totalPercent)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_CEIL);
  }
}

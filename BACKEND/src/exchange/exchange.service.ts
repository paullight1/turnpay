import { allocateDepositReference } from '../common/services/deposit-allocation';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  ExchangePayoutStatus,
  ExchangeReceiptStatus,
  KYCTier,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RateService } from './providers/rate.service';
import { RedisService } from '../redis/redis.service';
import {
  AdminMarkPayoutSentDto,
  AdminReviewExchangeReceiptDto,
  AdminReviewPayoutDto,
  CreateQuoteDto,
  CreateExchangePayoutDto,
  CreateExchangeReceiptUploadDto,
  CreateMonnifyExchangeDepositDto,
  ExecuteQuoteDto,
  SubmitExchangeReceiptDto,
} from './dto/exchange.dto';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { formatKycTier, isKycTierAtLeast } from '../common/utils/kyc-tier';
import { SupabaseService } from '../supabase/supabase.service';
import { redactProviderPayload } from '../common/utils/masking';
import { BankingService } from '../banking/banking.service';

export interface QuoteData {
  id: string;
  userId: string;
  from: string;
  to: string;
  amount: string;
  rate: number;
  markupPercent: number;
  fee: string;
  sendAmount: string;
  receiveAmount: string;
  expiresAt: Date;
  createdAt: Date;
}

const MANUAL_RECEIPT_CREDIT_SOURCE = 'MANUAL_EXCHANGE_RECEIPT_CREDIT';
const MONNIFY_EXCHANGE_PROVIDER = 'MONNIFY';
const MONNIFY_EXCHANGE_FLOW = 'MONNIFY_VERIFIED_EXCHANGE_DEPOSIT';
// A bank reference must be at least this long before we accept a fuzzy
// substring match against the raw webhook payload. Short references (e.g. a
// 3-4 char narration) can collide incidentally with another same-amount
// intent's payload and mis-attribute a verified deposit; exact matches on the
// provider/payment reference are always allowed regardless of length.
const MIN_FUZZY_REFERENCE_MATCH_LENGTH = 6;
const MANUAL_RECEIPT_TERMINAL_STATUSES: ExchangeReceiptStatus[] = [
  'CREDITED',
  'REJECTED',
];
const DEFAULT_EXCHANGE_RECEIPT_BUCKET = 'exchange-receipts';
const DEFAULT_RECEIPT_PROOF_URL_TTL_SECONDS = 300;
const MAX_RECEIPT_FILE_SIZE = 8 * 1024 * 1024;
const RECEIPT_CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

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
    private readonly transactionPin: TransactionPinService,
    @Optional()
    private readonly supabaseService?: SupabaseService,
    @Optional()
    private readonly bankingService?: BankingService,
  ) {
    this.transactionTimeout = 5000;
  }

  async getRate(from: string, to: string) {
    const { rate, markup, isStale } = await this.rateService.getRate(from, to);
    return {
      from,
      to,
      baseRate: rate,
      markupPercent: markup,
      effectiveRate: rate * (1 - markup / 100),
      isStale,
    };
  }

  async createQuote(userId: string, dto: CreateQuoteDto): Promise<QuoteData> {
    if (dto.from === dto.to) {
      throw new BadRequestException(
        'Source and destination currencies must be different',
      );
    }

    const { rate, markup } = await this.getFreshRate(dto.from, dto.to);
    const effectiveRate = new Decimal(rate).mul(
      new Decimal(1).minus(new Decimal(markup).div(100)),
    );

    const amount = new Decimal(dto.amount);
    if (amount.greaterThan(10_000_000)) {
      throw new BadRequestException('Amount must be at most 10000000');
    }
    const fee = this.calculateFee(amount, markup);
    const sendAmount = amount.plus(fee);
    const receiveAmount = amount.mul(effectiveRate);

    const quoteId = uuidv4();
    const quote: QuoteData = {
      id: quoteId,
      userId,
      from: dto.from,
      to: dto.to,
      amount: amount.toFixed(2),
      rate: effectiveRate.toNumber(),
      markupPercent: markup,
      fee: fee.toFixed(2),
      sendAmount: sendAmount.toFixed(2),
      receiveAmount: receiveAmount.toFixed(2),
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
    await this.transactionPin.verifyRequired(userId, dto.transactionPin);

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

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new BadRequestException('Account is suspended');
    }

    this.assertExchangeKycEligible(user, 'execute an exchange');

    const amount = new Decimal(quote.amount);
    const fee = new Decimal(quote.fee);
    const sendAmount = new Decimal(quote.sendAmount);
    const receiveAmount = new Decimal(quote.receiveAmount);

    // Atomically claim the quote before any money movement. Without this,
    // two concurrent executeQuote calls carrying different Idempotency-Key
    // headers both read the still-present quote and each open its own DB
    // transaction with a distinct transaction id — so the
    // LedgerEntry @@unique([transactionId, source]) guard never collides and
    // the wallet is debited (and the target credited) twice at the locked
    // rate. SET NX ensures only one caller wins the claim.
    const execLockKey = `quote:${quote.id}:exec`;
    const claimed = await this.redis.setIfNotExists(execLockKey, '1', 60);
    if (!claimed) {
      throw new ConflictException(
        'This quote is already being processed. Please wait a moment and try again.',
      );
    }

    const result = await this.prisma
      .$transaction(
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
      )
      .catch(async (error) => {
        // Release the claim so a transient failure (e.g. DB timeout) does not
        // block the user from legitimately retrying the same quote.
        await this.redis.del(execLockKey);
        throw error;
      });

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

  async submitManualReceipt(userId: string, dto: SubmitExchangeReceiptDto) {
    const amount = new Decimal(dto.amount);
    this.assertPositiveMoney(amount);
    const receiptProof = dto.receiptObjectKey ?? dto.receiptUrl;

    if (!receiptProof) {
      throw new BadRequestException('Receipt proof is required');
    }

    if (amount.greaterThan(10_000_000)) {
      throw new BadRequestException('Amount must be at most 10000000');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
        wallets: {
          where: { currency: 'GHS' },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new BadRequestException('Account is suspended');
    }

    this.assertExchangeKycEligible(user, 'submit an exchange receipt');

    if (user.wallets.length === 0) {
      throw new NotFoundException('GHS wallet not found');
    }

    const { rate, markup } = await this.getFreshRate('NGN', 'GHS');
    const effectiveRate = new Decimal(rate).mul(
      new Decimal(1).minus(new Decimal(markup).div(100)),
    );
    const expectedCreditAmount = amount
      .mul(effectiveRate)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const reference = `MXR-${Date.now()}-${uuidv4().slice(0, 8)}`;

    const result = await this.prisma
      .$transaction(
        async (tx) => {
          const transaction = await tx.transaction.create({
            data: {
              userId,
              type: 'EXCHANGE',
              amount,
              currency: 'NGN',
              status: 'PENDING',
              reference,
              fee: new Decimal(0),
              metadata: {
                flow: 'MANUAL_EXCHANGE_RECEIPT',
                sourceCurrency: 'NGN',
                targetCurrency: 'GHS',
                expectedCreditAmount: expectedCreditAmount.toFixed(2),
                rate: effectiveRate.toFixed(6),
                markupPercent: new Decimal(markup).toFixed(2),
                bankReference: dto.bankReference,
              },
            },
          });

          const receipt = await tx.exchangeReceipt.create({
            data: {
              userId,
              transactionId: transaction.id,
              sourceCurrency: 'NGN',
              targetCurrency: 'GHS',
              amount,
              expectedCreditAmount,
              rate: effectiveRate,
              markupPercent: new Decimal(markup).toDecimalPlaces(2),
              bankReference: dto.bankReference,
              senderName: dto.senderName,
              senderBankName: dto.senderBankName,
              receiptUrl: receiptProof,
              metadata: {
                note: dto.note,
                receiptProofType: dto.receiptObjectKey
                  ? 'MANAGED_STORAGE_OBJECT'
                  : 'EXTERNAL_URL',
                submittedAt: new Date().toISOString(),
              },
            },
            include: {
              transaction: {
                select: {
                  reference: true,
                  status: true,
                },
              },
            },
          });

          return receipt;
        },
        {
          timeout: this.transactionTimeout,
          maxWait: 3000,
        },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException(
            'Receipt reference has already been submitted',
          );
        }

        throw error;
      });

    this.logger.info(
      {
        userId,
        receiptId: result.id,
        transactionReference: reference,
      },
      'Manual exchange receipt submitted',
    );

    return this.mapExchangeReceipt(result);
  }

  async createMonnifyExchangeDepositIntent(
    userId: string,
    dto: CreateMonnifyExchangeDepositDto,
  ) {
    const amount = new Decimal(dto.amount);
    this.assertPositiveMoney(amount);

    if (amount.greaterThan(10_000_000)) {
      throw new BadRequestException('Amount must be at most 10000000');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
        wallets: {
          where: { currency: 'GHS' },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new BadRequestException('Account is suspended');
    }

    this.assertExchangeKycEligible(user, 'create a Monnify exchange deposit');

    if (user.wallets.length === 0) {
      throw new NotFoundException('GHS wallet not found');
    }

    const collectionAccount = this.getMonnifyExchangeCollectionAccount();
    if (!collectionAccount && !this.bankingService) {
      throw new BadRequestException(
        'Monnify exchange collection account is not configured',
      );
    }

    const fallbackCollectionAccount = collectionAccount
      ? null
      : await this.resolveUserMonnifyVirtualAccount(userId);

    const { rate, markup } = await this.getFreshRate('NGN', 'GHS');
    const effectiveRate = new Decimal(rate).mul(
      new Decimal(1).minus(new Decimal(markup).div(100)),
    );
    const expectedCreditAmount = amount
      .mul(effectiveRate)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const reference = `MXD-${Date.now()}-${uuidv4().slice(0, 8)}`.toUpperCase();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'EXCHANGE',
            amount,
            currency: 'NGN',
            status: 'PENDING',
            reference,
            fee: new Decimal(0),
            metadata: {
              flow: MONNIFY_EXCHANGE_FLOW,
              provider: MONNIFY_EXCHANGE_PROVIDER,
              sourceCurrency: 'NGN',
              targetCurrency: 'GHS',
              expectedCreditAmount: expectedCreditAmount.toFixed(2),
              rate: effectiveRate.toFixed(6),
              markupPercent: new Decimal(markup).toFixed(2),
              exchangeRequestReference: reference,
              providerVerificationStatus: 'PENDING',
              collectionAccount: collectionAccount || fallbackCollectionAccount,
            },
          },
        });

        return tx.exchangeReceipt.create({
          data: {
            userId,
            transactionId: transaction.id,
            sourceCurrency: 'NGN',
            targetCurrency: 'GHS',
            amount,
            expectedCreditAmount,
            rate: effectiveRate,
            markupPercent: new Decimal(markup).toDecimalPlaces(2),
            bankReference: reference,
            senderName: user.fullName || user.email,
            receiptUrl: `monnify://pending/${reference}`,
            metadata: {
              flow: MONNIFY_EXCHANGE_FLOW,
              provider: MONNIFY_EXCHANGE_PROVIDER,
              exchangeRequestReference: reference,
              providerVerificationStatus: 'PENDING',
              collectionAccount: collectionAccount || fallbackCollectionAccount,
              submittedAt: new Date().toISOString(),
            },
          },
          include: {
            transaction: {
              select: {
                reference: true,
                status: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      {
        userId,
        receiptId: result.id,
        transactionReference: reference,
      },
      'Monnify exchange deposit intent created',
    );

    return this.mapExchangeReceipt(result);
  }

  async processMonnifyExchangeDepositWebhook(event: {
    eventType: string;
    providerReference: string;
    paymentReference?: string;
    accountNumber?: string;
    amount: Decimal;
    currency: 'NGN' | 'GHS';
    rawPayload: Record<string, unknown>;
  }) {
    if (event.currency !== 'NGN') {
      return { matched: false, processed: false };
    }

    this.assertPositiveMoney(event.amount);

    const configuredAccount = this.getMonnifyExchangeCollectionAccount();
    if (
      configuredAccount &&
      event.accountNumber &&
      configuredAccount !== event.accountNumber
    ) {
      return { matched: false, processed: false };
    }

    const providerEvent = await this.findOrCreateProviderEvent({
      provider: MONNIFY_EXCHANGE_PROVIDER,
      eventType: event.eventType,
      providerReference: event.providerReference,
      rawPayload: event.rawPayload,
    });

    if (providerEvent.status === 'PROCESSED') {
      return { matched: true, processed: false, duplicate: true };
    }

    const searchablePayload = this.normalizeReferenceSearchText([
      event.providerReference,
      event.paymentReference,
      event.accountNumber,
      JSON.stringify(event.rawPayload),
    ]);
    const providerReferenceNormalized = this.normalizeReferenceSearchText([
      event.providerReference,
    ]);
    const paymentReferenceNormalized = this.normalizeReferenceSearchText([
      event.paymentReference,
    ]);

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const candidates = await tx.exchangeReceipt.findMany({
            where: {
              amount: event.amount,
              sourceCurrency: 'NGN',
              targetCurrency: 'GHS',
              status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
              metadata: {
                path: ['flow'],
                equals: MONNIFY_EXCHANGE_FLOW,
              },
            },
            include: {
              transaction: true,
            },
            orderBy: { createdAt: 'asc' },
            take: 25,
          });

          const receipt = candidates.find((candidate) => {
            const candidateReference = this.normalizeReferenceSearchText([
              candidate.bankReference,
            ]);

            if (!candidateReference) {
              return false;
            }

            return (
              candidateReference === providerReferenceNormalized ||
              candidateReference === paymentReferenceNormalized ||
              (candidateReference.length >= MIN_FUZZY_REFERENCE_MATCH_LENGTH &&
                searchablePayload.includes(candidateReference))
            );
          });

          if (!receipt) {
            await tx.providerEvent.update({
              where: { id: providerEvent.id },
              data: {
                status: 'IGNORED',
                errorMessage:
                  'No pending Monnify exchange deposit intent matched',
                processedAt: new Date(),
              },
            });
            return { matched: false, processed: false };
          }

          if (receipt.transaction.status !== 'PENDING') {
            throw new BadRequestException(
              'Matched exchange transaction is not pending',
            );
          }

          const existingMetadata = this.asRecord(receipt.metadata);
          const before = {
            status: receipt.status,
            transactionStatus: receipt.transaction.status,
            providerVerificationStatus: this.toSafeString(
              existingMetadata.providerVerificationStatus,
              'PENDING',
            ),
          };

          await tx.exchangeReceipt.update({
            where: { id: receipt.id },
            data: {
              status: 'APPROVED',
              receiptUrl: `monnify://transaction/${event.providerReference}`,
              metadata: this.toJsonInput({
                ...existingMetadata,
                providerVerificationStatus: 'VERIFIED',
                provider: MONNIFY_EXCHANGE_PROVIDER,
                providerReference: event.providerReference,
                paymentReference: event.paymentReference,
                providerEventId: providerEvent.id,
                verifiedAmount: event.amount.toFixed(2),
                verifiedCurrency: event.currency,
                verifiedAt: new Date().toISOString(),
                sourceAccountNumber: event.accountNumber,
              }),
            },
          });

          await tx.transaction.update({
            where: { id: receipt.transactionId },
            data: {
              metadata: this.toJsonInput({
                ...this.asRecord(receipt.transaction.metadata),
                providerVerificationStatus: 'VERIFIED',
                provider: MONNIFY_EXCHANGE_PROVIDER,
                providerReference: event.providerReference,
                paymentReference: event.paymentReference,
                providerEventId: providerEvent.id,
              }),
            },
          });

          await tx.providerEvent.update({
            where: { id: providerEvent.id },
            data: { status: 'PROCESSED', processedAt: new Date() },
          });

          await tx.auditLog.create({
            data: {
              action: 'MONNIFY_EXCHANGE_DEPOSIT_VERIFIED',
              targetType: 'ExchangeReceipt',
              targetId: receipt.id,
              reference: receipt.transaction.reference,
              before,
              after: {
                status: 'APPROVED',
                transactionStatus: 'PENDING',
                providerVerificationStatus: 'VERIFIED',
                providerReference: event.providerReference,
              },
              metadata: {
                providerEventId: providerEvent.id,
                amount: event.amount.toFixed(2),
                currency: event.currency,
              },
            },
          });

          return { matched: true, processed: true, receiptId: receipt.id };
        },
        {
          timeout: this.transactionTimeout,
          maxWait: 3000,
        },
      );

      if (result.matched) {
        this.logger.info(
          {
            providerReference: event.providerReference,
            receiptId: result.receiptId,
          },
          'Monnify exchange deposit verified',
        );
      }

      return result;
    } catch (error) {
      await this.prisma.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown processing error',
          processedAt: new Date(),
        },
      });

      throw error;
    }
  }

  async createManualReceiptUploadUrl(
    userId: string,
    dto: CreateExchangeReceiptUploadDto,
  ) {
    if (!this.supabaseService) {
      throw new BadRequestException('Receipt upload storage is not configured');
    }

    const extension = RECEIPT_CONTENT_TYPE_EXTENSIONS[dto.contentType];

    if (!extension) {
      throw new BadRequestException('Unsupported receipt file type');
    }

    if (dto.fileSize > MAX_RECEIPT_FILE_SIZE) {
      throw new BadRequestException('Receipt file must be 8MB or smaller');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new BadRequestException('Account is suspended');
    }

    this.assertExchangeKycEligible(user, 'upload an exchange receipt');

    const objectKey = `exchange-receipts/${userId}/${Date.now()}-${uuidv4()}${extension}`;
    const bucket = this.getExchangeReceiptBucket();
    const signedUpload = await this.supabaseService.createSignedUploadUrl(
      bucket,
      objectKey,
    );

    this.logger.info(
      { userId, objectKey },
      'Exchange receipt upload URL created',
    );

    return {
      bucket,
      objectKey,
      token: signedUpload.token,
      signedUrl: signedUpload.signedUrl,
      expiresInSeconds: 7200,
    };
  }

  async getManualReceipts(userId: string) {
    const receipts = await this.prisma.exchangeReceipt.findMany({
      where: { userId },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        transaction: {
          select: {
            id: true,
            reference: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    return receipts.map((receipt) => this.mapExchangeReceipt(receipt));
  }

  async createManualReceiptProofUrl(receiptId: string, userId: string) {
    return this.createReceiptProofUrl(receiptId, userId, false);
  }

  async getAdminManualReceipts(limit = 50, status?: ExchangeReceiptStatus) {
    const receipts = await this.prisma.exchangeReceipt.findMany({
      where: status ? { status } : undefined,
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            kycStatus: true,
            kycTier: true,
            isSuspended: true,
          },
        },
        transaction: {
          select: {
            id: true,
            reference: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return receipts.map((receipt) => this.mapExchangeReceipt(receipt));
  }

  async createAdminManualReceiptProofUrl(receiptId: string, adminId: string) {
    return this.createReceiptProofUrl(receiptId, adminId, true);
  }

  async reviewManualReceipt(
    receiptId: string,
    adminId: string,
    dto: AdminReviewExchangeReceiptDto,
  ) {
    const now = new Date();

    const receipt = await this.prisma.exchangeReceipt.findUnique({
      where: { id: receiptId },
      include: {
        user: {
          select: {
            id: true,
            kycStatus: true,
            kycTier: true,
            isSuspended: true,
          },
        },
        transaction: true,
      },
    });

    if (!receipt) {
      throw new NotFoundException('Exchange receipt not found');
    }

    if (MANUAL_RECEIPT_TERMINAL_STATUSES.includes(receipt.status)) {
      throw new BadRequestException('Receipt is already in a terminal state');
    }

    if (receipt.user.isSuspended) {
      throw new BadRequestException('User account is suspended');
    }

    this.assertExchangeKycEligible(receipt.user, 'review an exchange receipt');

    if (dto.status === 'APPROVED') {
      return this.approveManualReceipt(receiptId, adminId, dto.reason, now);
    }

    return this.closeManualReceiptWithoutCredit(
      receiptId,
      adminId,
      dto.status,
      dto.reason,
      now,
    );
  }

  private async approveManualReceipt(
    receiptId: string,
    adminId: string,
    reason: string,
    reviewedAt: Date,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const receipt = await tx.exchangeReceipt.findUnique({
          where: { id: receiptId },
          include: {
            user: {
              select: {
                id: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: true,
          },
        });

        if (!receipt) {
          throw new NotFoundException('Exchange receipt not found');
        }

        if (MANUAL_RECEIPT_TERMINAL_STATUSES.includes(receipt.status)) {
          throw new BadRequestException(
            'Receipt is already in a terminal state',
          );
        }

        if (receipt.transaction.status !== 'PENDING') {
          throw new BadRequestException(
            'Receipt transaction is not pending review',
          );
        }

        if (receipt.user.isSuspended) {
          throw new BadRequestException('User account is suspended');
        }

        this.assertExchangeKycEligible(receipt.user, 'credit an exchange');
        this.assertProviderVerificationAllowsCredit(receipt);

        const verification = this.asRecord(receipt.metadata);
        const verifiedProviderReference =
          verification.flow === MONNIFY_EXCHANGE_FLOW &&
          verification.providerVerificationStatus === 'VERIFIED' &&
          typeof verification.providerReference === 'string'
            ? verification.providerReference
            : undefined;
        await allocateDepositReference(tx, {
          reference: verifiedProviderReference || receipt.bankReference,
          settlementId: receipt.id,
          amount: receipt.amount,
          kind: 'EXCHANGE',
          legacyReceiptId: receipt.id,
          ...(verifiedProviderReference &&
          typeof verification.providerEventId === 'string'
            ? { verifiedExchangeProviderEventId: verification.providerEventId }
            : {}),
        });

        const before = {
          status: receipt.status,
          transactionStatus: receipt.transaction.status,
          providerVerificationStatus: this.toSafeString(
            this.asRecord(receipt.metadata).providerVerificationStatus,
            'NOT_REQUIRED',
          ),
        };

        const updatedReceipt = await tx.exchangeReceipt.updateMany({
          where: {
            id: receipt.id,
            status: { notIn: MANUAL_RECEIPT_TERMINAL_STATUSES },
          },
          data: {
            status: 'CREDITED',
            adminId,
            reviewReason: reason,
            reviewedAt,
            creditedAt: reviewedAt,
          },
        });

        if (updatedReceipt.count !== 1) {
          throw new BadRequestException('Receipt was already reviewed');
        }

        await tx.transaction.update({
          where: { id: receipt.transactionId },
          data: { status: 'SUCCESS' },
        });

        await this.ledger.creditWallet(
          {
            userId: receipt.userId,
            currency: 'GHS',
            amount: new Decimal(receipt.expectedCreditAmount),
            transactionId: receipt.transactionId,
            reference: receipt.transaction.reference,
            source: MANUAL_RECEIPT_CREDIT_SOURCE,
            metadata: {
              receiptId: receipt.id,
              adminId,
              reason,
              bankReference: receipt.bankReference,
              sourceCurrency: 'NGN',
              sourceAmount: new Decimal(receipt.amount).toFixed(2),
              rate: new Decimal(receipt.rate).toFixed(6),
            },
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'MANUAL_EXCHANGE_RECEIPT_CREDIT',
            targetType: 'ExchangeReceipt',
            targetId: receipt.id,
            reference: receipt.transaction.reference,
            reason,
            before,
            after: {
              status: 'CREDITED',
              transactionStatus: 'SUCCESS',
              creditedAmount: new Decimal(receipt.expectedCreditAmount).toFixed(
                2,
              ),
              creditedCurrency: 'GHS',
            },
            metadata: {
              bankReference: receipt.bankReference,
              transactionId: receipt.transactionId,
            },
          },
        });

        return tx.exchangeReceipt.findUnique({
          where: { id: receipt.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      { adminId, receiptId },
      'Manual exchange receipt credited',
    );

    return this.mapExchangeReceipt(result);
  }

  private async closeManualReceiptWithoutCredit(
    receiptId: string,
    adminId: string,
    status: 'REJECTED' | 'NEEDS_MORE_INFO',
    reason: string,
    reviewedAt: Date,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const receipt = await tx.exchangeReceipt.findUnique({
          where: { id: receiptId },
          include: { transaction: true },
        });

        if (!receipt) {
          throw new NotFoundException('Exchange receipt not found');
        }

        if (MANUAL_RECEIPT_TERMINAL_STATUSES.includes(receipt.status)) {
          throw new BadRequestException(
            'Receipt is already in a terminal state',
          );
        }

        const before = {
          status: receipt.status,
          transactionStatus: receipt.transaction.status,
        };
        const transactionStatus = status === 'REJECTED' ? 'FAILED' : 'PENDING';

        const updatedReceipt = await tx.exchangeReceipt.updateMany({
          where: {
            id: receipt.id,
            status: { notIn: MANUAL_RECEIPT_TERMINAL_STATUSES },
          },
          data: {
            status,
            adminId,
            reviewReason: reason,
            reviewedAt,
          },
        });

        if (updatedReceipt.count !== 1) {
          throw new BadRequestException('Receipt was already reviewed');
        }

        await tx.transaction.update({
          where: { id: receipt.transactionId },
          data: { status: transactionStatus },
        });

        await tx.auditLog.create({
          data: {
            adminId,
            action: `MANUAL_EXCHANGE_RECEIPT_${status}`,
            targetType: 'ExchangeReceipt',
            targetId: receipt.id,
            reference: receipt.transaction.reference,
            reason,
            before,
            after: {
              status,
              transactionStatus,
            },
            metadata: {
              bankReference: receipt.bankReference,
              transactionId: receipt.transactionId,
            },
          },
        });

        return tx.exchangeReceipt.findUnique({
          where: { id: receipt.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      { adminId, receiptId, status },
      'Manual exchange receipt reviewed without credit',
    );

    return this.mapExchangeReceipt(result);
  }

  async createPayout(userId: string, dto: CreateExchangePayoutDto) {
    await this.transactionPin.verifyRequired(userId, dto.transactionPin);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        kycStatus: true,
        kycTier: true,
        isSuspended: true,
        wallets: {
          where: { currency: 'NGN' },
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isSuspended) {
      throw new BadRequestException('Account is suspended');
    }

    this.assertExchangeKycEligible(user, 'request a payout');

    if (user.wallets.length === 0) {
      throw new NotFoundException('NGN wallet not found');
    }

    const { rate, markup } = await this.getFreshRate('NGN', 'GHS');
    const effectiveRate = new Decimal(rate).mul(
      new Decimal(1).minus(new Decimal(markup).div(100)),
    );

    const sourceAmount = new Decimal(dto.sourceAmount);
    this.assertPositiveMoney(sourceAmount);

    if (sourceAmount.greaterThan(10_000_000)) {
      throw new BadRequestException('Amount must be at most 10000000');
    }

    const fee = this.calculateFee(sourceAmount, markup);
    const sendAmount = sourceAmount.plus(fee);
    const destinationAmount = sourceAmount
      .mul(effectiveRate)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);

    const reference = `PAY-${Date.now()}-${uuidv4().slice(0, 8)}`;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'EXCHANGE',
            amount: sourceAmount,
            currency: 'NGN',
            status: 'PENDING',
            reference,
            fee,
            metadata: {
              flow: 'EXCHANGE_PAYOUT',
              sourceCurrency: 'NGN',
              destinationCurrency: 'GHS',
              destinationAmount: destinationAmount.toFixed(2),
              rate: effectiveRate.toFixed(6),
              markupPercent: new Decimal(markup).toFixed(2),
              destinationBankName: dto.destinationBankName,
              destinationAccountNumber: dto.destinationAccountNumber,
              destinationAccountName: dto.destinationAccountName,
            },
          },
        });

        await this.ledger.debitWallet(
          {
            userId,
            currency: 'NGN',
            amount: sendAmount,
            transactionId: transaction.id,
            reference,
            source: 'EXCHANGE_PAYOUT_DEBIT',
            metadata: {
              destinationCurrency: 'GHS',
              destinationAmount: destinationAmount.toString(),
              rate: effectiveRate.toString(),
              fee: fee.toString(),
            },
          },
          tx,
        );

        const payout = await tx.exchangePayout.create({
          data: {
            userId,
            transactionId: transaction.id,
            sourceCurrency: 'NGN',
            destinationCurrency: 'GHS',
            sourceAmount,
            destinationAmount,
            rate: effectiveRate,
            fee,
            destinationBankName: dto.destinationBankName,
            destinationBankCode: dto.destinationBankCode,
            destinationAccountNumber: dto.destinationAccountNumber,
            destinationAccountName: dto.destinationAccountName,
          },
          include: {
            transaction: {
              select: {
                reference: true,
                status: true,
                createdAt: true,
              },
            },
          },
        });

        return payout;
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      {
        userId,
        payoutId: result.id,
        reference,
        sourceAmount: sourceAmount.toFixed(2),
        destinationAmount: destinationAmount.toFixed(2),
      },
      'Exchange payout request created',
    );

    return this.mapExchangePayout(result);
  }

  async getUserPayouts(userId: string) {
    const payouts = await this.prisma.exchangePayout.findMany({
      where: { userId },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        transaction: {
          select: {
            reference: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    return payouts.map((payout) => this.mapExchangePayout(payout));
  }

  async getAdminPayouts(limit = 50, status?: string) {
    const where = status
      ? { status: status as ExchangePayoutStatus }
      : undefined;

    try {
      const payouts = await this.prisma.exchangePayout.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              kycStatus: true,
              kycTier: true,
              isSuspended: true,
            },
          },
          transaction: {
            select: {
              id: true,
              reference: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      return payouts.map((payout) => this.mapExchangePayout(payout));
    } catch (error) {
      this.logger.error(
        {
          limit,
          status: status ?? null,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
        },
        'Failed to load admin exchange payouts',
      );
      throw error;
    }
  }

  async getAdminPayoutStats() {
    try {
      // One grouped aggregate instead of five separate COUNT round-trips.
      const grouped = await this.prisma.exchangePayout.groupBy({
        by: ['status'],
        _count: { _all: true },
      });

      const countByStatus = new Map(
        grouped.map((row) => [row.status, row._count._all]),
      );
      const countFor = (status: ExchangePayoutStatus) =>
        countByStatus.get(status) ?? 0;

      return {
        pendingApproval: countFor('PENDING_APPROVAL'),
        approved: countFor('APPROVED'),
        processing: countFor('PROCESSING'),
        sent: countFor('SENT'),
        failed: countFor('FAILED'),
      };
    } catch (error) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
        },
        'Failed to load admin payout stats',
      );
      throw error;
    }
  }

  async approvePayout(
    payoutId: string,
    adminId: string,
    dto: AdminReviewPayoutDto,
  ) {
    const payout = await this.prisma.exchangePayout.findUnique({
      where: { id: payoutId },
      include: {
        user: {
          select: {
            id: true,
            kycStatus: true,
            kycTier: true,
            isSuspended: true,
          },
        },
        transaction: true,
      },
    });

    if (!payout) {
      throw new NotFoundException('Payout request not found');
    }

    const terminalStatuses: ExchangePayoutStatus[] = [
      'SENT',
      'FAILED',
      'REVERSED',
    ];
    if (terminalStatuses.includes(payout.status)) {
      throw new BadRequestException('Payout is already in a terminal state');
    }

    if (payout.user.isSuspended) {
      throw new BadRequestException('User account is suspended');
    }

    if (dto.status === 'APPROVED') {
      return this.processPayoutApproval(
        payoutId,
        adminId,
        dto.reason,
        new Date(),
      );
    }

    return this.processPayoutRejection(
      payoutId,
      adminId,
      dto.reason,
      new Date(),
    );
  }

  async markPayoutSent(
    payoutId: string,
    adminId: string,
    dto: AdminMarkPayoutSentDto,
  ) {
    const now = new Date();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const payout = await tx.exchangePayout.findUnique({
          where: { id: payoutId },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

        if (!payout) {
          throw new NotFoundException('Payout request not found');
        }

        if (payout.status !== 'APPROVED') {
          throw new BadRequestException(
            'Payout must be approved before marking as sent',
          );
        }

        if (!payout.adminId) {
          throw new BadRequestException(
            'Payout approval actor is missing; resubmit the approval before settlement',
          );
        }

        if (payout.adminId === adminId) {
          throw new BadRequestException(
            'Payout settlement requires a different admin from the approver',
          );
        }

        const before = {
          status: payout.status,
          notificationSent: payout.notificationSent,
        };

        const sentPayout = await tx.exchangePayout.updateMany({
          where: { id: payout.id, status: 'APPROVED' },
          data: {
            status: 'SENT',
            adminPaymentReceipt: dto.paymentReceiptUrl,
            notificationSent: true,
            sentAt: now,
          },
        });

        if (sentPayout.count !== 1) {
          throw new BadRequestException(
            'Payout was already marked as sent or is no longer approved',
          );
        }

        await tx.transaction.update({
          where: { id: payout.transactionId },
          data: { status: 'SUCCESS' },
        });

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'EXCHANGE_PAYOUT_MARKED_SENT',
            targetType: 'ExchangePayout',
            targetId: payout.id,
            reference: payout.transaction.reference,
            reason: dto.reason,
            before,
            after: {
              status: 'SENT',
              notificationSent: true,
              paymentReceiptUrl: dto.paymentReceiptUrl,
              sentAt: now,
            },
            metadata: {
              approvalAdminId: payout.adminId,
              destinationBankName: payout.destinationBankName,
              destinationAccountNumber: payout.destinationAccountNumber,
              destinationAmount: new Decimal(payout.destinationAmount).toFixed(
                2,
              ),
            },
          },
        });

        return tx.exchangePayout.findUnique({
          where: { id: payout.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      { adminId, payoutId, paymentReceiptUrl: dto.paymentReceiptUrl },
      'Exchange payout marked as sent',
    );

    return this.mapExchangePayout(result);
  }

  private async processPayoutApproval(
    payoutId: string,
    adminId: string,
    reason: string,
    reviewedAt: Date,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payout = await tx.exchangePayout.findUnique({
          where: { id: payoutId },
          include: {
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
              },
            },
          },
        });

        if (!payout) {
          throw new NotFoundException('Payout request not found');
        }

        if (payout.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException('Only pending payouts can be approved');
        }

        const before = {
          status: payout.status,
          transactionStatus: payout.transaction.status,
        };

        const approvedPayout = await tx.exchangePayout.updateMany({
          where: { id: payout.id, status: 'PENDING_APPROVAL' },
          data: {
            status: 'APPROVED',
            adminId,
            adminNote: reason,
            notificationSent: true,
            reviewedAt,
          },
        });

        if (approvedPayout.count !== 1) {
          throw new BadRequestException('Only pending payouts can be approved');
        }

        await tx.transaction.update({
          where: { id: payout.transactionId },
          data: { status: 'SUCCESS' },
        });

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'EXCHANGE_PAYOUT_APPROVED',
            targetType: 'ExchangePayout',
            targetId: payout.id,
            reference: payout.transaction.reference,
            reason,
            before,
            after: {
              status: 'APPROVED',
              transactionStatus: 'SUCCESS',
              notificationSent: true,
            },
            metadata: {
              destinationBankName: payout.destinationBankName,
              destinationAccountNumber: payout.destinationAccountNumber,
              destinationAmount: new Decimal(payout.destinationAmount).toFixed(
                2,
              ),
            },
          },
        });

        return tx.exchangePayout.findUnique({
          where: { id: payout.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info({ adminId, payoutId }, 'Exchange payout approved');

    return this.mapExchangePayout(result);
  }

  private async processPayoutRejection(
    payoutId: string,
    adminId: string,
    reason: string,
    reviewedAt: Date,
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payout = await tx.exchangePayout.findUnique({
          where: { id: payoutId },
          include: {
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
              },
            },
          },
        });

        if (!payout) {
          throw new NotFoundException('Payout request not found');
        }

        if (payout.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException('Only pending payouts can be rejected');
        }

        const before = {
          status: payout.status,
          transactionStatus: payout.transaction.status,
        };

        const rejectedPayout = await tx.exchangePayout.updateMany({
          where: { id: payout.id, status: 'PENDING_APPROVAL' },
          data: {
            status: 'FAILED',
            adminId,
            adminNote: reason,
            reviewedAt,
          },
        });

        if (rejectedPayout.count !== 1) {
          throw new BadRequestException('Only pending payouts can be rejected');
        }

        await tx.transaction.update({
          where: { id: payout.transactionId },
          data: { status: 'FAILED' },
        });

        // Reverse the NGN debit — credit back to user
        await this.ledger.creditWallet(
          {
            userId: payout.userId,
            currency: 'NGN',
            amount: new Decimal(payout.sourceAmount).plus(
              new Decimal(payout.fee),
            ),
            transactionId: payout.transactionId,
            reference: payout.transaction.reference,
            source: 'EXCHANGE_PAYOUT_REVERSAL',
            metadata: {
              payoutId: payout.id,
              adminId,
              reason,
              originalSource: 'EXCHANGE_PAYOUT_DEBIT',
            },
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            adminId,
            action: 'EXCHANGE_PAYOUT_REJECTED',
            targetType: 'ExchangePayout',
            targetId: payout.id,
            reference: payout.transaction.reference,
            reason,
            before,
            after: {
              status: 'FAILED',
              transactionStatus: 'FAILED',
              reversed: true,
            },
            metadata: {
              destinationBankName: payout.destinationBankName,
              reversedAmount: new Decimal(payout.sourceAmount)
                .plus(new Decimal(payout.fee))
                .toFixed(2),
            },
          },
        });

        return tx.exchangePayout.findUnique({
          where: { id: payout.id },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                kycStatus: true,
                kycTier: true,
                isSuspended: true,
              },
            },
            transaction: {
              select: {
                id: true,
                reference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });
      },
      {
        timeout: this.transactionTimeout,
        maxWait: 3000,
      },
    );

    this.logger.info(
      { adminId, payoutId },
      'Exchange payout rejected and reversed',
    );

    return this.mapExchangePayout(result);
  }

  private mapExchangePayout(
    payout: {
      id: string;
      userId: string;
      transactionId: string;
      sourceCurrency: string;
      destinationCurrency: string;
      sourceAmount: Decimal | string | number;
      destinationAmount: Decimal | string | number;
      rate: Decimal | string | number;
      fee: Decimal | string | number;
      destinationBankName: string;
      destinationBankCode: string | null;
      destinationAccountNumber: string;
      destinationAccountName: string;
      status: string;
      adminId: string | null;
      adminNote: string | null;
      adminPaymentReceipt: string | null;
      notificationSent: boolean;
      reviewedAt: Date | null;
      sentAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      user?: unknown;
      transaction?: unknown;
    } | null,
  ) {
    if (!payout) {
      return null;
    }

    return {
      id: payout.id,
      userId: payout.userId,
      transactionId: payout.transactionId,
      sourceCurrency: payout.sourceCurrency,
      destinationCurrency: payout.destinationCurrency,
      sourceAmount: new Decimal(payout.sourceAmount).toFixed(2),
      destinationAmount: new Decimal(payout.destinationAmount).toFixed(2),
      rate: new Decimal(payout.rate).toFixed(6),
      fee: new Decimal(payout.fee).toFixed(2),
      destinationBankName: payout.destinationBankName,
      destinationBankCode: payout.destinationBankCode,
      destinationAccountNumber: payout.destinationAccountNumber,
      destinationAccountName: payout.destinationAccountName,
      status: payout.status,
      adminId: payout.adminId,
      adminNote: payout.adminNote,
      adminPaymentReceipt: payout.adminPaymentReceipt,
      notificationSent: payout.notificationSent,
      reviewedAt: payout.reviewedAt,
      sentAt: payout.sentAt,
      createdAt: payout.createdAt,
      updatedAt: payout.updatedAt,
      user: payout.user,
      transaction: payout.transaction,
    };
  }

  private mapExchangeReceipt(
    receipt: {
      id: string;
      userId: string;
      transactionId: string;
      sourceCurrency: string;
      targetCurrency: string;
      amount: Decimal | string | number;
      expectedCreditAmount: Decimal | string | number;
      rate: Decimal | string | number;
      markupPercent: Decimal | string | number;
      bankReference: string;
      senderName: string;
      senderBankName: string | null;
      receiptUrl: string;
      status: string;
      adminId: string | null;
      reviewReason: string | null;
      creditedAt: Date | null;
      reviewedAt: Date | null;
      metadata: unknown;
      createdAt: Date;
      updatedAt: Date;
      user?: unknown;
      transaction?: unknown;
    } | null,
  ) {
    if (!receipt) {
      return null;
    }

    return {
      id: receipt.id,
      userId: receipt.userId,
      transactionId: receipt.transactionId,
      sourceCurrency: receipt.sourceCurrency,
      targetCurrency: receipt.targetCurrency,
      amount: new Decimal(receipt.amount).toFixed(2),
      expectedCreditAmount: new Decimal(receipt.expectedCreditAmount).toFixed(
        2,
      ),
      rate: new Decimal(receipt.rate).toFixed(6),
      markupPercent: new Decimal(receipt.markupPercent).toFixed(2),
      bankReference: receipt.bankReference,
      senderName: receipt.senderName,
      senderBankName: receipt.senderBankName,
      receiptUrl: receipt.receiptUrl,
      receiptProofType: this.isManagedReceiptObjectKey(receipt.receiptUrl)
        ? 'MANAGED_STORAGE_OBJECT'
        : 'EXTERNAL_URL',
      status: receipt.status,
      adminId: receipt.adminId,
      reviewReason: receipt.reviewReason,
      creditedAt: receipt.creditedAt,
      reviewedAt: receipt.reviewedAt,
      metadata: this.sanitizeReceiptMetadata(receipt.metadata),
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
      user: receipt.user,
      transaction: receipt.transaction,
    };
  }

  private async getFreshRate(from: string, to: string) {
    const result = await this.rateService.getRate(from, to);
    if (result.isStale) {
      throw new ServiceUnavailableException(
        'A fresh exchange rate is required',
      );
    }
    return result;
  }

  private calculateFee(amount: Decimal, markupPercent: number): Decimal {
    const baseFeePercent = 1.0;
    const totalPercent = new Decimal(baseFeePercent).plus(
      new Decimal(markupPercent).div(2),
    );
    return amount
      .mul(totalPercent)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_CEIL);
  }

  private assertPositiveMoney(amount: Decimal) {
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }
  }

  private assertExchangeKycEligible(
    user: { kycStatus: string; kycTier?: KYCTier | null },
    action: string,
  ) {
    if (user.kycStatus !== 'VERIFIED') {
      throw new BadRequestException(`Verified KYC is required to ${action}`);
    }

    if (!isKycTierAtLeast(user.kycTier, 'TIER_2')) {
      throw new BadRequestException(
        `KYC ${formatKycTier('TIER_2')} is required to ${action}`,
      );
    }
  }

  private sanitizeReceiptMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return metadata;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (/secret|token|password|authorization|key/i.test(key)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }

  private async createReceiptProofUrl(
    receiptId: string,
    requesterId: string,
    isAdmin: boolean,
  ) {
    const receipt = await this.prisma.exchangeReceipt.findFirst({
      where: isAdmin
        ? { id: receiptId }
        : { id: receiptId, userId: requesterId },
      select: {
        id: true,
        userId: true,
        receiptUrl: true,
        transaction: {
          select: { reference: true },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException('Exchange receipt not found');
    }

    if (!this.isManagedReceiptObjectKey(receipt.receiptUrl)) {
      return {
        receiptId: receipt.id,
        url: receipt.receiptUrl,
        expiresInSeconds: null,
      };
    }

    if (!this.supabaseService) {
      throw new BadRequestException('Receipt proof storage is not configured');
    }

    const expiresInSeconds = this.getReceiptProofUrlTtlSeconds();
    const url = await this.supabaseService.createSignedReadUrl(
      this.getExchangeReceiptBucket(),
      receipt.receiptUrl,
      expiresInSeconds,
    );

    if (isAdmin) {
      await this.prisma.auditLog.create({
        data: {
          adminId: requesterId,
          action: 'MANUAL_EXCHANGE_RECEIPT_PROOF_VIEW',
          targetType: 'ExchangeReceipt',
          targetId: receipt.id,
          reference: receipt.transaction.reference,
          metadata: {
            userId: receipt.userId,
          },
        },
      });
    }

    return {
      receiptId: receipt.id,
      url,
      expiresInSeconds,
    };
  }

  private async resolveUserMonnifyVirtualAccount(userId: string) {
    if (!this.bankingService) {
      return null;
    }

    const accounts = await this.bankingService.getVirtualAccounts(userId);
    const account = accounts.find(
      (item) => item.provider === 'MONNIFY' && item.currency === 'NGN',
    );

    if (!account) {
      throw new NotFoundException(
        'Monnify NGN virtual account not found for this user',
      );
    }

    return account;
  }

  private async findOrCreateProviderEvent(input: {
    provider: 'MONNIFY';
    eventType: string;
    providerReference: string;
    rawPayload: Record<string, unknown>;
  }) {
    const existing = await this.prisma.providerEvent.findUnique({
      where: {
        provider_providerReference_eventType: {
          provider: input.provider,
          providerReference: input.providerReference,
          eventType: input.eventType,
        },
      },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.providerEvent.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: 'PROCESSING',
          payload: this.toJsonInput(redactProviderPayload(input.rawPayload)),
          payloadHash: this.hashPayload(input.rawPayload),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingAfterRace =
          await this.prisma.providerEvent.findUniqueOrThrow({
            where: {
              provider_providerReference_eventType: {
                provider: input.provider,
                providerReference: input.providerReference,
                eventType: input.eventType,
              },
            },
          });
        return existingAfterRace;
      }

      throw error;
    }
  }

  private assertProviderVerificationAllowsCredit(receipt: {
    metadata: unknown;
  }) {
    const metadata = this.asRecord(receipt.metadata);
    if (metadata.flow !== MONNIFY_EXCHANGE_FLOW) {
      return;
    }

    if (metadata.providerVerificationStatus !== 'VERIFIED') {
      throw new BadRequestException(
        'Monnify verification is required before crediting this exchange',
      );
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private normalizeReferenceSearchText(values: Array<string | undefined>) {
    return values
      .filter((value): value is string => !!value)
      .join(' ')
      .toUpperCase();
  }

  private toSafeString(value: unknown, fallback: string) {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return fallback;
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isManagedReceiptObjectKey(value: string) {
    return /^exchange-receipts\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(value);
  }

  private getMonnifyExchangeCollectionAccount() {
    return this.configService.get<string>(
      'MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER',
      '',
    );
  }

  // ─── Rate Override with Dual Approval ──────────────────────────────

  async createPendingRateOverride(
    adminId: string,
    dto: {
      from: string;
      to: string;
      rate: number;
      markup: number;
      reason: string;
    },
    deviationPercent: number,
  ) {
    const currentRate = await this.prisma.rate.findUnique({
      where: { from_to: { from: dto.from, to: dto.to } },
    });

    const currentRateValue = currentRate
      ? currentRate.rate.toNumber()
      : dto.rate;

    const override = await this.prisma.rateOverride.create({
      data: {
        requestedById: adminId,
        fromCurrency: dto.from,
        toCurrency: dto.to,
        proposedRate: dto.rate,
        proposedMarkup: dto.markup,
        currentRate: currentRateValue,
        deviationPercent,
        reason: dto.reason,
        status: 'PENDING_APPROVAL',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'RATE_OVERRIDE_REQUESTED',
        targetType: 'RateOverride',
        targetId: override.id,
        reason: dto.reason,
        before: {
          currentRate: currentRateValue,
          proposedRate: dto.rate,
          deviationPercent,
        },
        after: { status: 'PENDING_APPROVAL' },
        metadata: {
          from: dto.from,
          to: dto.to,
          deviationPercent,
        },
      },
    });

    this.logger.info(
      {
        adminId,
        overrideId: override.id,
        from: dto.from,
        to: dto.to,
        deviationPercent,
      },
      'Rate override pending dual approval',
    );

    return override;
  }

  async getPendingRateOverrides(limit = 20) {
    return this.prisma.rateOverride.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        requestedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async reviewRateOverride(
    overrideId: string,
    adminId: string,
    dto: { status: 'APPROVED' | 'REJECTED'; reason: string },
  ) {
    const approved = dto.status === 'APPROVED';
    const now = new Date();
    const cacheRefresh = await this.prisma.$transaction(async (tx) => {
      const override = await tx.rateOverride.findUnique({
        where: { id: overrideId },
      });

      if (!override) {
        throw new NotFoundException('Rate override request not found');
      }

      if (override.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException('Rate override is not pending approval');
      }

      if (override.requestedById === adminId) {
        throw new BadRequestException(
          'Cannot approve your own rate override request',
        );
      }

      if (approved) {
        await this.rateService.setManualRate(
          override.fromCurrency,
          override.toCurrency,
          override.proposedRate.toNumber(),
          override.proposedMarkup.toNumber(),
          undefined,
          undefined,
          tx,
          { refreshCache: false },
        );
      }

      const updated = await tx.rateOverride.updateMany({
        where: { id: overrideId, status: 'PENDING_APPROVAL' },
        data: {
          status: approved ? 'APPROVED' : 'REJECTED',
          approvedById: adminId,
          reviewReason: dto.reason,
          reviewedAt: now,
        },
      });

      if (updated.count !== 1) {
        throw new BadRequestException('Rate override was already reviewed');
      }

      await tx.auditLog.create({
        data: {
          adminId,
          action: approved
            ? 'RATE_OVERRIDE_APPROVED'
            : 'RATE_OVERRIDE_REJECTED',
          targetType: 'RateOverride',
          targetId: overrideId,
          reason: dto.reason,
          before: {
            status: 'PENDING_APPROVAL',
            proposedRate: override.proposedRate.toNumber(),
            proposedMarkup: override.proposedMarkup.toNumber(),
            deviationPercent: override.deviationPercent.toNumber(),
          },
          after: {
            status: approved ? 'APPROVED' : 'REJECTED',
            approvedBy: adminId,
            reviewedAt: now,
          },
          metadata: {
            requestedBy: override.requestedById,
            from: override.fromCurrency,
            to: override.toCurrency,
          },
        },
      });

      if (approved) {
        return {
          from: override.fromCurrency,
          to: override.toCurrency,
          rate: override.proposedRate.toNumber(),
          markup: override.proposedMarkup.toNumber(),
        };
      }

      return null;
    });

    if (cacheRefresh) {
      await this.rateService.refreshRateCache(
        cacheRefresh.from,
        cacheRefresh.to,
        cacheRefresh.rate,
        cacheRefresh.markup,
      );
    }

    this.logger.info(
      { adminId, overrideId, status: dto.status },
      `Rate override ${approved ? 'approved' : 'rejected'}`,
    );

    return this.prisma.rateOverride.findUnique({
      where: { id: overrideId },
      include: {
        requestedBy: {
          select: { id: true, email: true },
        },
        approvedBy: {
          select: { id: true, email: true },
        },
      },
    });
  }

  private getExchangeReceiptBucket() {
    return (
      this.configService.get<string>('EXCHANGE_RECEIPT_BUCKET') ||
      DEFAULT_EXCHANGE_RECEIPT_BUCKET
    );
  }

  private getReceiptProofUrlTtlSeconds() {
    return this.configService.get<number>(
      'EXCHANGE_RECEIPT_PROOF_URL_TTL_SECONDS',
      DEFAULT_RECEIPT_PROOF_URL_TTL_SECONDS,
    );
  }
}

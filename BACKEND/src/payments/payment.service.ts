import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { PaystackProvider } from './providers/paystack.provider';
import { FlutterwaveProvider } from './providers/flutterwave.provider';
import { FundWalletDto, WithdrawDto, ResolveBankDto } from './dto/payment.dto';
import { v4 as uuidv4 } from 'uuid';
import { createHmac, timingSafeEqual } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { UsersService } from '../users/users.service';
import { Transaction, WalletCurrency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerService } from '../wallets/ledger.service';
import { decryptSensitiveValue } from '../common/utils/encryption';
import { maskAccountNumber } from '../common/utils/masking';

type WithdrawalProvider = 'paystack' | 'flutterwave';

interface WithdrawalDestination {
  beneficiaryId?: string;
  provider?: WithdrawalProvider;
  bankCode: string;
  bankName?: string;
  accountName: string;
  accountNumber: string;
  accountNumberMasked: string;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly usersService: UsersService,
    private readonly paystack: PaystackProvider,
    private readonly flutterwave: FlutterwaveProvider,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly httpService: HttpService,
    private readonly ledger: LedgerService,
  ) {}

  async fundWallet(userId: string, dto: FundWalletDto) {
    const user = await this.usersService.findOne(userId);
    const reference = `FUND-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const provider = dto.provider || this.getDefaultProvider(dto.currency);

    const email = dto.email || user.email;
    const callbackUrl =
      dto.callbackUrl ||
      `${process.env.WEB_URL || 'http://localhost:3001'}/payment/callback`;

    let paymentResult: { paymentUrl: string; reference: string };

    if (provider === 'paystack') {
      const result = await this.paystack.initializePayment({
        amount: dto.amount,
        email,
        currency: dto.currency,
        reference,
        callbackUrl,
      });
      paymentResult = {
        paymentUrl: result.data.authorization_url,
        reference: result.data.reference,
      };
    } else {
      const result = await this.flutterwave.initializePayment({
        amount: dto.amount,
        email,
        currency: dto.currency,
        txRef: reference,
        redirectUrl: callbackUrl,
      });
      paymentResult = {
        paymentUrl: result.paymentUrl,
        reference,
      };
    }

    await this.prisma.transaction.create({
      data: {
        userId,
        type: 'FUND',
        amount: dto.amount,
        currency: dto.currency,
        status: 'PENDING',
        reference,
        metadata: {
          provider,
          channel: dto.channel || 'card',
          paymentUrl: paymentResult.paymentUrl,
        },
      },
    });

    this.logger.info(
      {
        userId,
        reference,
        amount: dto.amount,
        currency: dto.currency,
        provider,
      },
      'Fund wallet initiated',
    );

    return {
      reference,
      paymentUrl: paymentResult.paymentUrl,
      message: 'Complete payment to fund your wallet',
    };
  }

  async verifyPayment(reference: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status !== 'PENDING') {
      return {
        status: transaction.status,
        message: `Transaction already ${transaction.status.toLowerCase()}`,
      };
    }

    const metadata = transaction.metadata as Record<string, unknown>;
    const provider = (metadata?.provider as string) || 'paystack';
    const providerTxId = metadata?.providerTransactionId as number;

    if (provider === 'paystack') {
      const verification = await this.paystack.verifyPayment(reference);

      if (verification.status === 'success') {
        await this.processSuccessfulDeposit(transaction);
      }
    } else if (providerTxId) {
      const verification = await this.flutterwave.verifyPayment(providerTxId);

      if (verification.status === 'successful') {
        await this.processSuccessfulDeposit(transaction);
      }
    }

    const updated = await this.prisma.transaction.findUnique({
      where: { reference },
      select: { status: true, amount: true, currency: true },
    });

    return updated;
  }

  async processWebhookDeposit(data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: {
          reference: data.reference,
          status: 'PENDING',
        },
        data: { status: 'SUCCESS' },
      });

      if (updated.count === 0) {
        this.logger.info(
          { reference: data.reference },
          'Webhook: Already processed or not found',
        );
        return { received: true, processed: false };
      }

      const transaction = await tx.transaction.findUnique({
        where: { reference: data.reference },
      });

      if (!transaction) {
        this.logger.warn(
          { reference: data.reference },
          'Webhook: Transaction disappeared after lock',
        );
        return { received: true, processed: false };
      }

      const webhookAmount =
        data.currency === 'NGN' || data.currency === 'GHS'
          ? data.amount
          : data.amount / 100;

      const storedAmount = Number(transaction.amount);
      if (Math.abs(webhookAmount - storedAmount) > 0.01) {
        this.logger.error(
          {
            reference: data.reference,
            webhookAmount,
            storedAmount,
          },
          'Webhook: Amount mismatch',
        );
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED' },
        });
        return { received: true, processed: false };
      }

      const wallet = await tx.wallet.findUnique({
        where: {
          userId_currency: {
            userId: transaction.userId,
            currency: transaction.currency,
          },
        },
      });

      if (!wallet) {
        throw new Error('Wallet not found for deposit');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: webhookAmount } },
      });

      this.logger.info(
        {
          reference: transaction.reference,
          amount: webhookAmount,
        },
        'Deposit processed successfully',
      );

      return { received: true, processed: true };
    });

    return result;
  }

  async withdraw(userId: string, dto: WithdrawDto) {
    const wallet = await this.walletsService.getWallet(userId, dto.currency);
    if (!wallet) {
      throw new NotFoundException(`${dto.currency} wallet not found`);
    }

    if (wallet.balance.lt(dto.amount)) {
      throw new BadRequestException(`Insufficient ${dto.currency} balance`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        isSuspended: true,
        dailyWithdrawLimit: true,
        monthlyWithdrawLimit: true,
        dailyWithdrawn: true,
        monthlyWithdrawn: true,
        limitResetDate: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isSuspended) {
      throw new ForbiddenException('Account is suspended');
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException('KYC verification is required');
    }

    if (user) {
      const now = new Date();
      const needsReset = !user.limitResetDate || user.limitResetDate < now;

      if (needsReset) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            dailyWithdrawn: 0,
            monthlyWithdrawn: 0,
            limitResetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          },
        });
      }

      const updated = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          dailyWithdrawn: true,
          monthlyWithdrawn: true,
          dailyWithdrawLimit: true,
          monthlyWithdrawLimit: true,
        },
      });

      if (!updated) {
        throw new BadRequestException('User not found');
      }

      const newDaily = Number(updated.dailyWithdrawn) + Number(dto.amount);
      const newMonthly = Number(updated.monthlyWithdrawn) + Number(dto.amount);

      if (newDaily > Number(updated.dailyWithdrawLimit)) {
        throw new BadRequestException(
          `Daily withdrawal limit exceeded. Remaining: ₦${(Number(updated.dailyWithdrawLimit) - Number(updated.dailyWithdrawn)).toFixed(2)}`,
        );
      }

      if (newMonthly > Number(updated.monthlyWithdrawLimit)) {
        throw new BadRequestException(
          `Monthly withdrawal limit exceeded. Remaining: ₦${(Number(updated.monthlyWithdrawLimit) - Number(updated.monthlyWithdrawn)).toFixed(2)}`,
        );
      }
    }

    const destination = await this.resolveWithdrawalDestination(userId, dto);
    const provider =
      dto.provider ||
      destination.provider ||
      this.getDefaultProvider(dto.currency);
    const reference = `WD-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const amount = new Decimal(dto.amount);

    let transferStatus = 'pending';
    let providerTransferId: number | undefined;

    const transactionRecord = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          dailyWithdrawn: { increment: amount },
          monthlyWithdrawn: { increment: amount },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: 'WITHDRAW',
          amount,
          currency: dto.currency,
          status: 'PENDING',
          reference,
          walletId: wallet.id,
          metadata: {
            provider,
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
      });

      await this.ledger.debitWallet(
        {
          userId,
          currency: dto.currency,
          amount,
          transactionId: transaction.id,
          reference,
          source: 'WITHDRAWAL',
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
        tx,
      );

      return { id: transaction.id, reference: transaction.reference };
    });

    try {
      if (provider === 'paystack') {
        const recipient = await this.paystack.createTransferRecipient({
          accountNumber: destination.accountNumber,
          bankCode: destination.bankCode,
          name: destination.accountName,
          currency: dto.currency,
        });

        const transfer = await this.paystack.initiateTransfer({
          amount: dto.amount,
          recipientCode: recipient.recipientCode,
          currency: dto.currency,
          reference: transactionRecord.reference,
        });

        transferStatus = transfer.data.status;
      } else if (provider === 'flutterwave') {
        const transfer = await this.flutterwave.initiateTransfer({
          amount: dto.amount,
          bankCode: destination.bankCode,
          accountNumber: destination.accountNumber,
          currency: dto.currency,
          reference: transactionRecord.reference,
        });

        transferStatus = transfer.status;
        providerTransferId = transfer.id;
      } else {
        throw new BadRequestException('Unsupported withdrawal provider');
      }

      const finalStatus = this.mapTransferStatus(transferStatus);

      await this.prisma.transaction.update({
        where: { reference: transactionRecord.reference },
        data: { status: finalStatus },
      });

      await this.prisma.transferAttempt.create({
        data: {
          transactionId: transactionRecord.id,
          provider: provider.toUpperCase() as 'PAYSTACK' | 'FLUTTERWAVE',
          providerReference: transactionRecord.reference,
          providerStatus: transferStatus,
          status: finalStatus,
          lastCheckedAt: new Date(),
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
            providerTransferId,
          },
        },
      });

      if (finalStatus === 'FAILED') {
        await this.reverseWithdrawal(
          userId,
          dto.currency,
          amount,
          transactionRecord,
          destination,
        );

        this.logger.error(
          { reference: transactionRecord.reference, transferStatus },
          'Transfer failed, balance reversed',
        );
        throw new BadRequestException(
          'Transfer failed. Balance has been reversed.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      await this.prisma.transaction.update({
        where: { reference: transactionRecord.reference },
        data: { status: 'PENDING' },
      });

      await this.prisma.transferAttempt.create({
        data: {
          transactionId: transactionRecord.id,
          provider: provider.toUpperCase() as 'PAYSTACK' | 'FLUTTERWAVE',
          providerReference: transactionRecord.reference,
          providerStatus: 'UNKNOWN',
          status: 'PENDING',
          lastCheckedAt: new Date(),
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            bankCode: destination.bankCode,
            bankName: destination.bankName,
            accountName: destination.accountName,
            accountNumberMasked: destination.accountNumberMasked,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown provider error',
          },
        },
      });

      this.logger.warn(
        {
          reference: transactionRecord.reference,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Transfer provider result unknown, withdrawal left pending',
      );

      return {
        reference: transactionRecord.reference,
        status: 'PENDING',
        message:
          'Withdrawal submitted and pending provider confirmation. Funds remain reserved until verification completes.',
      };
    }

    this.logger.info(
      {
        userId,
        reference: transactionRecord.reference,
        amount: dto.amount,
        currency: dto.currency,
      },
      'Withdrawal processed',
    );

    return {
      reference: transactionRecord.reference,
      status: 'PENDING',
      message: 'Withdrawal submitted successfully',
    };
  }

  async getWithdrawal(userId: string, reference: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        reference,
        type: 'WITHDRAW',
      },
      select: {
        reference: true,
        amount: true,
        currency: true,
        status: true,
        fee: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
          select: {
            provider: true,
            providerReference: true,
            providerStatus: true,
            status: true,
            attemptNo: true,
            lastCheckedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Withdrawal not found');
    }

    return {
      ...transaction,
      metadata: this.sanitizeWithdrawalMetadata(transaction.metadata),
      transferAttempts: transaction.transferAttempts.map((attempt) => ({
        ...attempt,
        metadata: this.sanitizeWithdrawalMetadata(attempt.metadata),
      })),
    };
  }

  async processTransferWebhook(input: {
    provider: 'paystack' | 'flutterwave';
    eventType: string;
    providerReference: string;
    providerStatus: string;
    rawPayload: Record<string, unknown>;
  }) {
    const provider = input.provider.toUpperCase() as 'PAYSTACK' | 'FLUTTERWAVE';
    const payload = this.sanitizeProviderPayload(input.rawPayload);

    let providerEvent: { id: string; status: string };

    try {
      providerEvent = await this.prisma.providerEvent.create({
        data: {
          provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          status: 'PROCESSING',
          payload: payload as any,
        },
        select: { id: true, status: true },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') {
        throw error;
      }

      const existing = await this.prisma.providerEvent.findUnique({
        where: {
          provider_providerReference_eventType: {
            provider,
            providerReference: input.providerReference,
            eventType: input.eventType,
          },
        },
        select: { id: true, status: true },
      });

      return { received: true, processed: false, duplicate: true };
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: input.providerReference },
      include: {
        transferAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!transaction || transaction.type !== 'WITHDRAW') {
      await this.prisma.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: 'IGNORED',
          errorMessage: 'Withdrawal transaction not found',
          processedAt: new Date(),
        },
      });
      return { received: true, processed: false };
    }

    const finalStatus = this.mapTransferStatus(input.providerStatus);

    await this.prisma.$transaction(async (tx) => {
      const updatedTransaction = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: 'PENDING',
        },
        data: { status: finalStatus },
      });

      const latestAttempt = transaction.transferAttempts[0];
      if (latestAttempt) {
        await tx.transferAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            providerStatus: input.providerStatus,
            status: finalStatus,
            lastCheckedAt: new Date(),
            metadata: this.mergeJsonMetadata(latestAttempt.metadata, {
              providerEventId: providerEvent.id,
            }) as any,
          },
        });
      }

      if (
        updatedTransaction.count === 1 &&
        ['FAILED', 'REVERSED'].includes(finalStatus)
      ) {
        const existingReversal = await tx.ledgerEntry.findFirst({
          where: {
            transactionId: transaction.id,
            source: 'WITHDRAWAL_REVERSAL',
          },
        });

        if (!existingReversal) {
          await this.ledger.creditWallet(
            {
              userId: transaction.userId,
              currency: transaction.currency,
              amount: new Decimal(transaction.amount),
              transactionId: transaction.id,
              reference: `${transaction.reference}-REVERSAL`,
              source: 'WITHDRAWAL_REVERSAL',
              metadata: {
                provider,
                providerStatus: input.providerStatus,
                providerEventId: providerEvent.id,
              },
            },
            tx,
          );
        }
      }

      await tx.providerEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
    });

    return { received: true, processed: true };
  }

  private async resolveWithdrawalDestination(
    userId: string,
    dto: WithdrawDto,
  ): Promise<WithdrawalDestination> {
    if (dto.beneficiaryId) {
      const beneficiary = await this.prisma.bankAccount.findFirst({
        where: {
          id: dto.beneficiaryId,
          userId,
          isDeleted: false,
          currency: dto.currency,
        },
      });

      if (!beneficiary) {
        throw new NotFoundException('Beneficiary not found');
      }

      return {
        beneficiaryId: beneficiary.id,
        provider: beneficiary.provider
          ? (beneficiary.provider.toLowerCase() as WithdrawalProvider)
          : undefined,
        bankCode: beneficiary.bankCode,
        bankName: beneficiary.bankName,
        accountName: beneficiary.accountName,
        accountNumber: decryptSensitiveValue(
          beneficiary.accountNumberEncrypted,
          this.getBankAccountEncryptionKey(),
        ),
        accountNumberMasked: beneficiary.accountNumberMasked,
      };
    }

    if (!dto.bankCode || !dto.accountNumber || !dto.accountName) {
      throw new BadRequestException(
        'Provide beneficiaryId or bankCode, accountNumber, and accountName',
      );
    }

    return {
      provider: dto.provider,
      bankCode: dto.bankCode,
      accountName: dto.accountName,
      accountNumber: dto.accountNumber,
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
    };
  }

  private async reverseWithdrawal(
    userId: string,
    currency: WithdrawDto['currency'],
    amount: Decimal,
    transaction: { id: string; reference: string },
    destination: WithdrawalDestination,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.creditWallet(
        {
          userId,
          currency,
          amount,
          transactionId: transaction.id,
          reference: `${transaction.reference}-REVERSAL`,
          source: 'WITHDRAWAL_REVERSAL',
          metadata: {
            beneficiaryId: destination.beneficiaryId,
            accountNumberMasked: destination.accountNumberMasked,
          },
        },
        tx,
      );
    });
  }

  private mapTransferStatus(status: string) {
    const normalized = status.toLowerCase();

    if (
      ['success', 'successful', 'completed', 'complete'].includes(normalized)
    ) {
      return 'SUCCESS';
    }

    if (['reversed'].includes(normalized)) {
      return 'REVERSED';
    }

    if (['failed', 'abandoned', 'blocked', 'rejected'].includes(normalized)) {
      return 'FAILED';
    }

    return 'PENDING';
  }

  private getBankAccountEncryptionKey() {
    const key =
      this.configService.get<string>('BANK_ACCOUNT_ENCRYPTION_KEY') ||
      this.configService.get<string>('PII_ENCRYPTION_KEY');

    if (!key) {
      throw new BadRequestException(
        'Sensitive data encryption key is not configured',
      );
    }

    return key;
  }

  private sanitizeWithdrawalMetadata(metadata: unknown) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    const {
      accountNumber,
      account_number,
      accountNumberEncrypted,
      receiver_bank_account_number,
      bvn,
      nin,
      signature,
      token,
      ...safeMetadata
    } = metadata as Record<string, unknown>;

    return safeMetadata;
  }

  private mergeJsonMetadata(
    existing: unknown,
    updates: Record<string, unknown>,
  ) {
    return {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {}),
      ...updates,
    };
  }

  private sanitizeProviderPayload(payload: Record<string, unknown>) {
    const sanitized = this.sanitizeWithdrawalMetadata(payload);
    const data = sanitized.data;

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      sanitized.data = this.sanitizeWithdrawalMetadata(data);
    }

    return sanitized;
  }

  async resolveBank(dto: ResolveBankDto) {
    return this.paystack.resolveBankAccount(dto.accountNumber, dto.bankCode);
  }

  async listBanks() {
    return this.paystack.listBanks();
  }

  verifyPaystackSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    const hash = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (hash.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  verifyFlutterwaveSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>(
      'FLUTTERWAVE_SECRET_KEY',
    );
    const hash = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (hash.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  private async processSuccessfulDeposit(transaction: Transaction) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: {
          id: transaction.id,
          status: 'PENDING',
        },
        data: { status: 'SUCCESS' },
      });

      if (updated.count === 0) {
        this.logger.info(
          { reference: transaction.reference },
          'Deposit already processed',
        );
        return;
      }

      const wallet = await tx.wallet.findUnique({
        where: {
          userId_currency: {
            userId: transaction.userId,
            currency: transaction.currency,
          },
        },
      });

      if (!wallet) {
        throw new Error('Wallet not found for deposit');
      }

      const txAmount = Number(transaction.amount);
      if (isNaN(txAmount) || txAmount <= 0) {
        throw new Error('Invalid deposit amount');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: txAmount } },
      });
    });

    this.logger.info(
      {
        reference: transaction.reference,
        amount: transaction.amount,
      },
      'Deposit processed successfully',
    );
  }

  private getDefaultProvider(currency: string): string {
    return currency === 'NGN' ? 'paystack' : 'flutterwave';
  }
}

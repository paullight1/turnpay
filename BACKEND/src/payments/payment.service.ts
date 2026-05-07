import {
  BadRequestException,
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
        currency: dto.currency as 'NGN' | 'GHS',
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

      const webhookAmount = data.currency === 'NGN' || data.currency === 'GHS'
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
            currency: transaction.currency as WalletCurrency,
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
      throw new BadRequestException(
        `Insufficient ${dto.currency} balance`,
      );
    }

    const reference = `WD-${Date.now()}-${uuidv4().slice(0, 8)}`;

    let transferStatus = 'FAILED';

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: dto.amount } },
      });

      await tx.transaction.create({
        data: {
          userId,
          type: 'WITHDRAW',
          amount: dto.amount,
          currency: dto.currency as 'NGN' | 'GHS',
          status: 'PENDING',
          reference,
          walletId: wallet.id,
          metadata: {
            bankCode: dto.bankCode,
            accountNumber: dto.accountNumber,
            accountName: dto.accountName,
          },
        },
      });
    });

    const provider = dto.provider || this.getDefaultProvider(dto.currency);

    try {
      if (provider === 'paystack') {
        const recipient = await this.paystack.createTransferRecipient({
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
          name: dto.accountName,
          currency: dto.currency,
        });

        const transfer = await this.paystack.initiateTransfer({
          amount: dto.amount,
          recipientCode: recipient.recipientCode,
          currency: dto.currency,
          reference,
        });

        transferStatus = transfer.data.status;
      } else if (provider === 'flutterwave') {
        const transfer = await this.flutterwave.initiateTransfer({
          amount: dto.amount,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          currency: dto.currency,
          reference,
        });

        transferStatus = transfer.status;
      }

      const finalStatus = transferStatus === 'success' || transferStatus === 'SUCCESSFUL'
        ? 'SUCCESS'
        : transferStatus === 'pending' || transferStatus === 'PENDING'
        ? 'PENDING'
        : 'FAILED';

      await this.prisma.transaction.update({
        where: { reference },
        data: { status: finalStatus },
      });

      if (finalStatus === 'FAILED') {
        await this.prisma.$transaction(async (tx) => {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: dto.amount } },
          });
        });

        this.logger.error(
          { reference, transferStatus },
          'Transfer failed, balance reversed',
        );
        throw new BadRequestException('Transfer failed. Balance has been reversed.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      await this.prisma.transaction.update({
        where: { reference },
        data: { status: 'FAILED' },
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: dto.amount } },
        });
      });

      this.logger.error(
        { reference, error },
        'Transfer failed, balance reversed',
      );
      throw new BadRequestException('Transfer failed. Balance has been reversed.');
    }

    this.logger.info(
      { userId, reference, amount: dto.amount, currency: dto.currency },
      'Withdrawal processed',
    );

    return {
      reference,
      message: 'Withdrawal processed successfully',
    };
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
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  verifyFlutterwaveSignature(rawBody: string, signature: string): boolean {
    const secret = this.configService.getOrThrow<string>(
      'FLUTTERWAVE_SECRET_KEY',
    );
    const hash = createHmac('sha256', secret).update(rawBody).digest('hex');
    return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  private async processSuccessfulDeposit(transaction: Transaction) {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: {
          userId_currency: {
            userId: transaction.userId,
            currency: transaction.currency as WalletCurrency,
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

      await tx.transaction.update({
        where: { id: transaction.id },
        data: { status: 'SUCCESS' },
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

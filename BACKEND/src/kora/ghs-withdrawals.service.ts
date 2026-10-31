import { RequestAuditContext } from '../common/services/request-audit-context';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../wallets/ledger.service';
import { TransactionPinService } from '../common/services/transaction-pin.service';
import { SettlementHoldService } from '../common/services/settlement-hold.service';
import {
  encryptSensitiveValue,
  decryptSensitiveValue,
} from '../common/utils/encryption';
import { maskAccountNumber } from '../common/utils/masking';
import { KoraCapabilitiesService } from './kora-capabilities.service';
import { KoraPayoutsService } from './kora-payouts.service';
import { asRecord, parseKoraMoney, providerText } from './kora.client';
import { eligibleKoraUser, serialMoney } from './kora.policy';
import { reserveCurrencyLimit } from './kora-limits';

type CashoutInput = {
  expectedName?: string;
  amount: string;
  mobileNumber: string;
  operator: string;
  transactionPin: string;
};
@Injectable()
export class GhsWithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pin: TransactionPinService,
    private readonly config: ConfigService,
    private readonly capabilities: KoraCapabilitiesService,
    private readonly payouts: KoraPayoutsService,
    private readonly holds: SettlementHoldService,
  ) {}
  async create(
    userId: string,
    dto: CashoutInput,
    key: string,
    audit?: RequestAuditContext,
  ) {
    if (!this.capabilities.get().momoPayouts)
      throw new ServiceUnavailableException(
        'Ghana MoMo cash-out is not enabled',
      );
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(key ?? '') ||
      !/^233\d{9}$/.test(dto.mobileNumber)
    )
      throw new BadRequestException(
        'Check the Ghana mobile number and payment attempt',
      );
    await this.pin.verifyRequired(userId, dto.transactionPin);
    await eligibleKoraUser(this.prisma, userId);
    const amount = parseKoraMoney(dto.amount);
    const reference = `ghs-out-${createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 32)}`;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          userId,
          amount: amount.toFixed(2),
          number: dto.mobileNumber,
          operator: dto.operator,
        }),
      )
      .digest('hex');
    const existing = await this.prisma.transaction.findUnique({
      where: { reference },
    });
    if (existing) {
      if (
        asRecord(existing.metadata).requestHash !== requestHash ||
        existing.userId !== userId
      )
        throw new ConflictException(
          'This attempt has different cash-out details',
        );
      return this.get(userId, reference);
    }
    const recipient = await this.payouts.resolveRecipient(
      dto.mobileNumber,
      dto.operator,
    );
    if (
      dto.expectedName &&
      dto.expectedName.trim().toUpperCase() !== recipient.name.toUpperCase()
    )
      throw new ConflictException(
        'The recipient name changed. Review it again.',
      );
    if ((await this.payouts.balance()).lt(amount))
      throw new ServiceUnavailableException(
        'Ghana payout funds are temporarily unavailable',
      );
    try {
      await serialMoney(this.prisma, async (tx) => {
        await eligibleKoraUser(tx, userId);
        await this.holds.assertOutboundAllowed(
          {
            operation: 'WITHDRAWAL',
            currency: 'GHS',
            provider: 'KORA',
            reference,
          },
          tx,
        );
        await reserveCurrencyLimit(tx, this.config, userId, 'GHS', amount);
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'WITHDRAW',
            currency: 'GHS',
            amount,
            reference,
            metadata: {
              flow: 'GHS_CASHOUT',
              provider: 'KORA',
              requestHash,
              accountNumberMasked: maskAccountNumber(dto.mobileNumber),
              accountName: recipient.name,
              operator: dto.operator,
            },
          },
        });
        await this.ledger.debitWallet(
          {
            userId,
            currency: 'GHS',
            amount,
            transactionId: transaction.id,
            reference,
            source: 'WITHDRAWAL_KORA',
          },
          tx,
        );
        await tx.transferAttempt.create({
          data: {
            transactionId: transaction.id,
            provider: 'KORA',
            providerReference: reference,
            providerStatus: 'DISPATCHING',
            status: 'PROCESSING',
            metadata: {
              flow: 'GHS_CASHOUT',
              accountNumberEncrypted: encryptSensitiveValue(
                dto.mobileNumber,
                this.config.get('BANK_ACCOUNT_ENCRYPTION_KEY'),
              ),
              operator: dto.operator,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'KORA_WITHDRAWAL_RESERVED',
            targetType: 'Transaction',
            targetId: transaction.id,
            reference,
            metadata: {
              userId,
              amount: amount.toFixed(2),
              currency: 'GHS',
              ...(audit ? { request: audit } : {}),
              accountNumberMasked: maskAccountNumber(dto.mobileNumber),
            },
          },
        });
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const replay = await this.prisma.transaction.findUnique({
        where: { reference },
      });
      if (!replay || asRecord(replay.metadata).requestHash !== requestHash)
        throw error;
      return this.get(userId, reference);
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    try {
      await this.payouts.sendMomo({
        reference,
        amount,
        number: dto.mobileNumber,
        operator: dto.operator,
        name: recipient.name,
        email: user.email,
      });
    } catch {
      /* Query the persisted reference after uncertainty; never debit or dispatch again. */
    }
    return this.get(userId, reference);
  }
  async get(userId: string, reference: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { userId, reference, type: 'WITHDRAW', currency: 'GHS' },
    });
    if (!transaction || asRecord(transaction.metadata).flow !== 'GHS_CASHOUT')
      throw new NotFoundException('Cash-out not found');
    const meta = asRecord(transaction.metadata);
    return {
      reference,
      amount: transaction.amount.toFixed(2),
      currency: 'GHS',
      status: transaction.status,
      accountNumberMasked: providerText(meta.accountNumberMasked),
      accountName: providerText(meta.accountName),
      operator: providerText(meta.operator),
    };
  }
  async reconcile(reference: string) {
    const attempt = await this.prisma.transferAttempt.findUnique({
      where: {
        provider_providerReference: {
          provider: 'KORA',
          providerReference: reference,
        },
      },
      include: { transaction: true },
    });
    if (!attempt || asRecord(attempt.metadata).flow !== 'GHS_CASHOUT')
      return { ignored: true };
    const transaction = attempt.transaction;
    const meta = asRecord(attempt.metadata);
    const number = decryptSensitiveValue(
      providerText(meta.accountNumberEncrypted),
      this.config.get('BANK_ACCOUNT_ENCRYPTION_KEY'),
    );
    const status = await this.payouts.verify(reference, {
      amount: transaction.amount,
      number,
      operator: providerText(meta.operator),
    });
    if (!['success', 'failed', 'reversed'].includes(status))
      return { pending: true };
    return serialMoney(this.prisma, async (tx) => {
      const row = await tx.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
      });
      if (
        ['FAILED', 'REVERSED'].includes(row.status) ||
        (row.status === 'SUCCESS' && status !== 'reversed')
      )
        return { duplicate: true };
      if (status === 'success')
        await this.holds.assertSettlementAllowed(
          {
            operation: 'WITHDRAWAL',
            currency: 'GHS',
            provider: 'KORA',
            reference,
          },
          tx,
        );
      const update = await tx.transaction.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status:
            status === 'success'
              ? 'SUCCESS'
              : status === 'reversed'
                ? 'REVERSED'
                : 'FAILED',
        },
      });
      if (!update.count) return { duplicate: true };
      if (status !== 'success')
        await this.ledger.creditWallet(
          {
            userId: row.userId,
            currency: 'GHS',
            amount: row.amount,
            transactionId: row.id,
            reference: `${reference}-refund`,
            source: 'WITHDRAWAL_KORA_REVERSAL',
          },
          tx,
        );
      await tx.transferAttempt.update({
        where: { id: attempt.id },
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
          action: 'KORA_WITHDRAWAL_CONFIRMED',
          targetType: 'Transaction',
          targetId: row.id,
          reference,
          before: { status: row.status },
          after: { status },
          metadata: {
            userId: row.userId,
            currency: 'GHS',
            amount: row.amount.toFixed(2),
          },
        },
      });
      return { status };
    });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverPending() {
    const attempts = await this.prisma.transferAttempt.findMany({
      where: {
        provider: 'KORA',
        status: { in: ['PENDING', 'PROCESSING'] },
        metadata: { path: ['flow'], equals: 'GHS_CASHOUT' },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    for (const attempt of attempts)
      if (asRecord(attempt.metadata).flow === 'GHS_CASHOUT') {
        await this.prisma.transferAttempt.updateMany({
          where: { id: attempt.id, status: { in: ['PENDING', 'PROCESSING'] } },
          data: { updatedAt: new Date(), lastCheckedAt: new Date() },
        });
        try {
          await this.reconcile(attempt.providerReference);
        } catch {
          /* Keep unknown outcomes reserved. */
        }
      }
  }
}

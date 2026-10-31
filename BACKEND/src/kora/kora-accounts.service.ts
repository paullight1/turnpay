import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isKycTierAtLeast } from '../common/utils/kyc-tier';
import { maskAccountNumber } from '../common/utils/masking';
import { KoraClient, asRecord, providerText, KoraRecord } from './kora.client';
import { KoraCapabilitiesService } from './kora-capabilities.service';

@Injectable()
export class KoraAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: KoraClient,
    private readonly capabilities: KoraCapabilitiesService,
  ) {}
  private async eligible(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.isSuspended ||
      user.kycStatus !== 'VERIFIED' ||
      !isKycTierAtLeast(user.kycTier, 'TIER_1')
    )
      throw new ForbiddenException(
        'Ghana receiving accounts are unavailable until account verification is complete',
      );
    return user;
  }
  async ensureAccount(userId: string, key: string) {
    if (!this.capabilities.get().virtualAccounts)
      throw new ServiceUnavailableException(
        'Ghana receiving accounts are not enabled',
      );
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key ?? ''))
      throw new BadRequestException('A valid Idempotency-Key is required');
    const user = await this.eligible(userId);
    if (!user.fullName?.trim())
      throw new BadRequestException('Complete your legal name first');
    const reference = `ghs-account-${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
    const row = await this.prisma.koraAccountRequest.upsert({
      where: { userId },
      update: {},
      create: { userId, reference },
    });
    if (row.submittedAt) return this.refreshAccount(userId);
    const claimed = await this.prisma.koraAccountRequest.updateMany({
      where: { id: row.id, submittedAt: null },
      data: {
        submittedAt: new Date(),
        claimedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) {
      await this.prisma.auditLog.create({
        data: {
          action: 'KORA_GHS_ACCOUNT_REQUESTED',
          targetType: 'KoraAccountRequest',
          targetId: row.id,
          metadata: { userId, consentAccepted: true },
        },
      });
      try {
        await this.client.request('POST', '/virtual-bank-account', {
          currency: 'GHS',
          account_name: user.fullName.trim(),
          account_reference: reference,
          permanent: true,
          customer: { name: user.fullName.trim(), email: user.email },
        });
      } catch {
        await this.prisma.koraAccountRequest.update({
          where: { id: row.id },
          data: {
            lastError: 'Account creation is awaiting provider confirmation',
          },
        });
        return this.pending(row.id);
      }
    }
    return this.refreshAccount(userId);
  }
  async refreshAccount(userId: string) {
    await this.eligible(userId);
    const row = await this.prisma.koraAccountRequest.findUnique({
      where: { userId },
    });
    if (!row) return this.pending('', 'NOT_REQUESTED');
    const existing = await this.prisma.virtualAccount.findUnique({
      where: {
        userId_provider_currency: { userId, provider: 'KORA', currency: 'GHS' },
      },
    });
    if (existing?.status === 'ACTIVE') return this.present(existing);
    let data: KoraRecord;
    try {
      data = await this.client.request(
        'GET',
        `/virtual-bank-account/${encodeURIComponent(row.reference)}`,
      );
    } catch {
      return this.pending(row.id);
    }
    if (data.account_reference !== row.reference || data.currency !== 'GHS')
      throw new ServiceUnavailableException(
        'Ghana account could not be verified',
      );
    if (data.account_status !== 'active') return this.pending(row.id);
    const number = providerText(data.account_number);
    if (
      !/^\d{7,20}$/.test(number) ||
      !providerText(data.account_name) ||
      !providerText(data.bank_name)
    )
      throw new ServiceUnavailableException(
        'Ghana account could not be verified',
      );
    const account = await this.prisma.virtualAccount.upsert({
      where: {
        userId_provider_currency: { userId, provider: 'KORA', currency: 'GHS' },
      },
      update: {},
      create: {
        userId,
        provider: 'KORA',
        currency: 'GHS',
        status: 'ACTIVE',
        providerAccountId: row.reference,
        accountNumber: number,
        accountNumberMasked: maskAccountNumber(number),
        accountName: providerText(data.account_name),
        bankName: providerText(data.bank_name),
        metadata: { accountReference: row.reference, purpose: 'WALLET' },
      },
    });
    await this.prisma.koraAccountRequest.update({
      where: { id: row.id },
      data: { status: 'ACTIVE', claimedAt: null, lastError: null },
    });
    return this.present(account);
  }
  private pending(id: string, status = 'PENDING') {
    return {
      id,
      provider: 'KORA',
      currency: 'GHS',
      status,
      accountNumber: '',
      accountNumberMasked: '',
      accountName: '',
      bankName: '',
    };
  }
  private present(account: {
    id: string;
    accountNumber: string;
    accountNumberMasked: string;
    accountName: string;
    bankName: string;
    status: string;
  }) {
    return {
      id: account.id,
      provider: 'KORA',
      currency: 'GHS',
      status: account.status,
      accountNumber: account.accountNumber,
      accountNumberMasked: account.accountNumberMasked,
      accountName: account.accountName,
      bankName: account.bankName,
    };
  }
  async accountEvent(data: unknown) {
    const record = asRecord(data);
    const reference = providerText(record.account_reference);
    if (!reference) return { ignored: true };
    const request = await this.prisma.koraAccountRequest.findUnique({
      where: { reference },
    });
    if (!request) return { ignored: true };
    await this.refreshAccount(request.userId);
    return { routed: 'ghana-account' };
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverPendingAccounts() {
    const rows = await this.prisma.koraAccountRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });
    for (const row of rows) {
      await this.prisma.koraAccountRequest.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { updatedAt: new Date() },
      });
      try {
        await this.refreshAccount(row.userId);
      } catch {
        /* Keep unresolved requests pending for the next query. */
      }
    }
  }
}

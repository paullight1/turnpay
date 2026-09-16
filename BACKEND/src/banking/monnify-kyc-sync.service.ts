import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSensitiveValue } from '../common/utils/encryption';
import { MonnifyVirtualAccountProvider } from './providers/monnify-virtual-account.provider';

/** Durable desired-state sync. Repeated PUTs carry the same verified identities. */
@Injectable()
export class MonnifyKycSyncService {
  private running = false;
  private cursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MonnifyVirtualAccountProvider,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processPending() {
    if (
      this.running ||
      this.config.get<string>('MONNIFY_KYC_SYNC_ENABLED') !== 'true'
    )
      return;
    this.running = true;
    try {
      const accounts = await this.prisma.virtualAccount.findMany({
        where: {
          provider: 'MONNIFY',
          currency: 'NGN',
          status: 'ACTIVE',
          user: {
            kycStatus: 'VERIFIED',
            kycTier: { in: ['TIER_1', 'TIER_2'] },
            isSuspended: false,
          },
        },
        orderBy: { id: 'asc' },
        take: 25,
        ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      for (const account of accounts) {
        try {
          await this.syncAccount(account.id);
        } catch {
          this.logger.warn(
            { accountId: account.id },
            'Monnify KYC sync deferred',
          );
        }
      }
      this.cursor =
        accounts.length === 25 ? accounts[accounts.length - 1].id : undefined;
    } finally {
      this.running = false;
    }
  }

  async syncAccount(id: string) {
    const account = await this.prisma.virtualAccount.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            kycDocuments: {
              where: { status: 'VERIFIED', type: { in: ['BVN', 'NIN'] } },
              orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }],
            },
          },
        },
      },
    });
    if (
      !account ||
      account.provider !== 'MONNIFY' ||
      account.currency !== 'NGN' ||
      account.status !== 'ACTIVE' ||
      account.user.isSuspended ||
      account.user.kycStatus !== 'VERIFIED' ||
      !['TIER_1', 'TIER_2'].includes(account.user.kycTier)
    )
      return;
    const bvn = account.user.kycDocuments.find((d) => d.type === 'BVN');
    const nin = account.user.kycDocuments.find((d) => d.type === 'NIN');
    if (!bvn?.idNumber && !nin?.idNumber) return;
    const version = createHash('sha256')
      .update(
        `${bvn?.id ?? 'missing'}:${bvn?.updatedAt.toISOString() ?? ''}|${nin?.id ?? 'missing'}:${nin?.updatedAt.toISOString() ?? ''}`,
      )
      .digest('hex');
    const metadata = this.object(account.metadata);
    const previous = this.object(metadata.monnifyKycSync);
    if (previous.version === version && previous.status === 'SYNCED') return;
    if (
      typeof previous.retryAt === 'string' &&
      Date.parse(previous.retryAt) > Date.now()
    )
      return;
    const claim = randomUUID();
    const attempts =
      previous.version === version ? Number(previous.attempts || 0) + 1 : 1;
    const state = {
      version,
      claim,
      attempts,
      status: 'PENDING',
      retryAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const claimed = await this.prisma.virtualAccount.updateMany({
      where: { id, updatedAt: account.updatedAt },
      data: { metadata: { ...metadata, monnifyKycSync: state } },
    });
    if (claimed.count !== 1) return;
    let success = false;
    try {
      await this.provider.updateReservedAccountKyc(
        `TP-NGN-${account.userId}`.slice(0, 64),
        {
          ...(bvn?.idNumber ? { bvn: this.decrypt(bvn.idNumber) } : {}),
          ...(nin?.idNumber ? { nin: this.decrypt(nin.idNumber) } : {}),
        },
      );
      if (bvn?.idNumber && nin?.idNumber) {
        const tier2LimitProfileCode = this.config
          .get<string>('MONNIFY_TIER_2_LIMIT_PROFILE_CODE')
          ?.trim();
        const isProduction =
          this.config.get<string>('NODE_ENV', 'development') === 'production';
        if (isProduction && !tier2LimitProfileCode) {
          throw new Error('Monnify Tier 2 limit profile is not configured');
        }
        if (tier2LimitProfileCode) {
          await this.provider.updateReservedAccountLimit(
            `TP-NGN-${account.userId}`.slice(0, 64),
            tier2LimitProfileCode,
          );
        }
      }
      success = true;
    } catch {
      // Do not persist upstream errors; they can contain government identifiers.
    }
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.virtualAccount.updateMany({
        where: {
          id,
          metadata: { path: ['monnifyKycSync', 'claim'], equals: claim },
        },
        data: {
          metadata: {
            ...metadata,
            monnifyKycSync: {
              ...state,
              status: success ? 'SYNCED' : 'FAILED',
              retryAt: new Date(
                Date.now() +
                  Math.min(3600, 60 * 2 ** Math.min(attempts, 6)) * 1000,
              ).toISOString(),
              ...(success ? { syncedAt: new Date().toISOString() } : {}),
            },
          },
        },
      });
      if (saved.count === 1)
        await tx.auditLog.create({
          data: {
            action: success ? 'MONNIFY_KYC_SYNCED' : 'MONNIFY_KYC_SYNC_FAILED',
            targetType: 'VirtualAccount',
            targetId: id,
            metadata: { version, attempts },
          },
        });
    });
  }

  private object(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  private decrypt(value: string) {
    return value.startsWith('enc:v1:')
      ? decryptSensitiveValue(
          value.slice(7),
          this.config.get<string>('PII_ENCRYPTION_KEY'),
        )
      : value;
  }
}

import { Injectable } from '@nestjs/common';
import { type KycWebhookInbox, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { KycProviderCallbackResult } from './providers/kyc-provider.gateway';

const SAFE_CHECK_KEYS = new Set([
  'providerStatus',
  'allValidationPassed',
  'dataValidation',
  'event',
  'apiVersion',
  'country',
  'providerType',
  'documentType',
  'identifierMasked',
  'reviewRequired',
]);

@Injectable()
export class KycWebhookInboxService {
  private readonly maxAttempts = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async accept(input: {
    eventType: string;
    result: KycProviderCallbackResult;
  }): Promise<{ eventId: string; duplicate: boolean }> {
    const payload = this.toSafePayload(input.result);
    const payloadHash = this.hashPayload(payload);
    const now = new Date();

    try {
      const created = await this.prisma.kycWebhookInbox.create({
        data: {
          provider: input.result.provider,
          eventType: input.eventType,
          providerReference: input.result.reference,
          payload,
          payloadHash,
          status: 'RECEIVED',
          nextAttemptAt: now,
          receivedAt: now,
        },
        select: { id: true },
      });
      return { eventId: created.id, duplicate: false };
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) throw error;

      const existing = await this.prisma.kycWebhookInbox.findFirst({
        where: {
          provider: input.result.provider,
          eventType: input.eventType,
          providerReference: input.result.reference,
          payloadHash,
        },
        select: { id: true },
      });
      if (!existing) throw error;
      return { eventId: existing.id, duplicate: true };
    }
  }

  findDueEvents(limit = 25): Promise<KycWebhookInbox[]> {
    const now = new Date();
    return this.prisma.kycWebhookInbox.findMany({
      where: {
        OR: [
          { status: 'RECEIVED' },
          { status: 'FAILED', nextAttemptAt: { lte: now } },
        ],
      },
      orderBy: [{ receivedAt: 'asc' }],
      take: limit,
    });
  }

  async claim(eventId: string) {
    const claimedAt = new Date();
    const result = await this.prisma.kycWebhookInbox.updateMany({
      where: {
        id: eventId,
        OR: [
          { status: 'RECEIVED' },
          { status: 'FAILED', nextAttemptAt: { lte: claimedAt } },
        ],
      },
      data: {
        status: 'PROCESSING',
        claimedAt,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    return result.count === 1;
  }

  async complete(eventId: string) {
    await this.prisma.kycWebhookInbox.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        claimedAt: null,
        lastError: null,
        nextAttemptAt: null,
        processedAt: new Date(),
      },
    });
  }

  async fail(eventId: string, errorMessage: string) {
    const current = await this.prisma.kycWebhookInbox.findUnique({
      where: { id: eventId },
      select: { attemptCount: true },
    });
    const attemptCount = current?.attemptCount ?? 1;
    const deadLettered = attemptCount >= this.maxAttempts;

    await this.prisma.kycWebhookInbox.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        claimedAt: null,
        lastError: errorMessage,
        nextAttemptAt: deadLettered
          ? null
          : new Date(Date.now() + this.retryDelayMs(attemptCount)),
        processedAt: deadLettered ? new Date() : null,
      },
    });
  }

  async recoverStaleClaims(maxAgeSeconds: number) {
    const result = await this.prisma.kycWebhookInbox.updateMany({
      where: {
        status: 'PROCESSING',
        claimedAt: {
          lt: new Date(Date.now() - maxAgeSeconds * 1000),
        },
      },
      data: {
        status: 'RECEIVED',
        claimedAt: null,
        nextAttemptAt: new Date(),
        lastError: 'Recovered stale KYC webhook claim',
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        { recoveredCount: result.count },
        'Recovered stale KYC webhook claims',
      );
    }
    return result.count;
  }

  private toSafePayload(result: KycProviderCallbackResult) {
    const checks = Object.fromEntries(
      Object.entries(result.checks).filter(([key]) => SAFE_CHECK_KEYS.has(key)),
    );
    return {
      provider: result.provider,
      status: result.status,
      reference: result.reference,
      checks,
      responseHash: result.responseHash,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      ...(result.documentType ? { documentType: result.documentType } : {}),
      ...(result.country ? { country: result.country } : {}),
    };
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private retryDelayMs(attemptCount: number) {
    return Math.min(60, 2 ** Math.max(0, attemptCount - 1)) * 60 * 1000;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}

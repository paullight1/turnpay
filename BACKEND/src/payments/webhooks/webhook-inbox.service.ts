import { Injectable } from '@nestjs/common';
import { type PaymentWebhookInbox, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';

export interface WebhookInboxAcceptInput {
  provider: 'MONNIFY';
  eventType: string;
  providerReference: string;
  payload: Record<string, unknown>;
}

interface InboxResultMetadata {
  ignored?: boolean;
  [key: string]: unknown;
}

@Injectable()
export class WebhookInboxService {
  private readonly maxAttempts = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async accept(
    input: WebhookInboxAcceptInput,
  ): Promise<{ eventId: string; duplicate: boolean }> {
    const sanitizedPayload = this.sanitizePayload(input.payload);
    const payloadHash = this.hashPayload(sanitizedPayload);
    const now = new Date();

    try {
      const created = await this.prisma.paymentWebhookInbox.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          payload: sanitizedPayload as Prisma.InputJsonValue,
          payloadHash,
          status: 'RECEIVED',
          nextAttemptAt: now,
          receivedAt: now,
        },
        select: { id: true },
      });

      return { eventId: created.id, duplicate: false };
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await this.prisma.paymentWebhookInbox.findFirst({
        where: {
          provider: input.provider,
          eventType: input.eventType,
          providerReference: input.providerReference,
          payloadHash,
        },
        select: { id: true },
      });

      if (!existing) {
        throw error;
      }

      return { eventId: existing.id, duplicate: true };
    }
  }

  findDueEvents(limit = 25): Promise<PaymentWebhookInbox[]> {
    const now = new Date();

    return this.prisma.paymentWebhookInbox.findMany({
      where: {
        OR: [
          { status: 'RECEIVED' },
          {
            status: 'FAILED',
            nextAttemptAt: { lte: now },
          },
        ],
      },
      orderBy: [{ receivedAt: 'asc' }],
      take: limit,
    });
  }

  async claim(eventId: string): Promise<boolean> {
    const claimedAt = new Date();
    const updated = await this.prisma.paymentWebhookInbox.updateMany({
      where: {
        id: eventId,
        OR: [
          { status: 'RECEIVED' },
          {
            status: 'FAILED',
            nextAttemptAt: { lte: claimedAt },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        claimedAt,
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });

    return updated.count === 1;
  }

  async complete(eventId: string, result: InboxResultMetadata = {}) {
    const processedAt = new Date();

    await this.prisma.paymentWebhookInbox.update({
      where: { id: eventId },
      data: {
        status: result.ignored ? 'IGNORED' : 'PROCESSED',
        claimedAt: null,
        lastError: null,
        nextAttemptAt: null,
        processedAt,
      },
    });
  }

  async fail(eventId: string, errorMessage: string) {
    const current = await this.prisma.paymentWebhookInbox.findUnique({
      where: { id: eventId },
      select: { attemptCount: true },
    });
    const attemptCount = current?.attemptCount ?? 1;
    const deadLettered = attemptCount >= this.maxAttempts;
    const processedAt = deadLettered ? new Date() : null;
    const nextAttemptAt = deadLettered
      ? null
      : new Date(Date.now() + this.getRetryDelayMs(attemptCount));

    await this.prisma.paymentWebhookInbox.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        claimedAt: null,
        lastError: errorMessage,
        nextAttemptAt,
        processedAt,
      },
    });
  }

  async recoverStaleClaims(maxAgeSeconds: number): Promise<number> {
    const claimedBefore = new Date(Date.now() - maxAgeSeconds * 1000);
    const nextAttemptAt = new Date();

    const updated = await this.prisma.paymentWebhookInbox.updateMany({
      where: {
        status: 'PROCESSING',
        claimedAt: { lt: claimedBefore },
      },
      data: {
        status: 'RECEIVED',
        claimedAt: null,
        nextAttemptAt,
        lastError: 'Recovered stale webhook claim',
      },
    });

    if (updated.count > 0) {
      this.logger.warn(
        { recoveredCount: updated.count },
        'Recovered stale payment webhook claims',
      );
    }

    return updated.count;
  }

  private getRetryDelayMs(attemptCount: number) {
    const exponentialMinutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1));
    return exponentialMinutes * 60 * 1000;
  }

  private hashPayload(payload: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private sanitizePayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.deepSanitize(payload) as Record<string, unknown>;
  }

  private deepSanitize(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.deepSanitize(entry));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (this.isSensitiveKey(key)) {
        continue;
      }

      sanitized[key] = this.deepSanitize(entry);
    }

    return sanitized;
  }

  private isSensitiveKey(key: string) {
    return [
      'signature',
      'token',
      'authorizationCode',
      'authorization_code',
      'accountNumberEncrypted',
      'bvn',
      'nin',
    ].includes(key);
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}

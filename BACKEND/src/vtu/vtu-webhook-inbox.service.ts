import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedVtuStatus } from './providers/vtpass.types';

export type VtpassInboxEvent = {
  eventType: string;
  providerRequestId: string;
  providerReference?: string;
  status: NormalizedVtuStatus;
  message?: string;
  code?: string;
};

type InboxProcessor = (event: VtpassInboxEvent) => Promise<unknown>;

@Injectable()
export class VtuWebhookInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VtuWebhookInboxService.name);
  }

  async record(event: VtpassInboxEvent) {
    const payload = {
      code: event.code,
      message: event.message,
    };
    const payloadHash = this.hash(JSON.stringify(payload));
    const eventKey = this.hash(
      [
        event.eventType,
        event.providerRequestId,
        event.providerReference || '',
        event.status,
        payloadHash,
      ].join(':'),
    );

    try {
      const row = await this.prisma.vtuWebhookInbox.create({
        data: {
          eventKey,
          eventType: event.eventType,
          providerRequestId: event.providerRequestId,
          providerTransactionId: event.providerReference,
          providerStatus: event.status,
          payloadHash,
          payload,
        },
      });
      return { duplicate: false, inboxId: row.id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { duplicate: true };
      }
      throw error;
    }
  }

  async process(inboxId: string, processor: InboxProcessor) {
    const row = await this.prisma.vtuWebhookInbox.findUnique({
      where: { id: inboxId },
    });
    if (!row || row.processedAt) return { processed: false };

    const claimed = await this.prisma.vtuWebhookInbox.updateMany({
      where: {
        id: row.id,
        processedAt: null,
        attempts: row.attempts,
      },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
      },
    });
    if (claimed.count !== 1) return { processed: false };

    const payload = this.asObject(row.payload);
    const event: VtpassInboxEvent = {
      eventType: row.eventType,
      providerRequestId: row.providerRequestId,
      providerReference: row.providerTransactionId || undefined,
      status: this.normalizedStatus(row.providerStatus),
      message: this.optionalString(payload.message),
      code: this.optionalString(payload.code),
    };

    try {
      await processor(event);
      await this.prisma.vtuWebhookInbox.update({
        where: { id: row.id },
        data: {
          processedAt: new Date(),
          nextAttemptAt: new Date(0),
          lastError: null,
        },
      });
      return { processed: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await this.prisma.vtuWebhookInbox.update({
        where: { id: row.id },
        data: {
          lastError: errorMessage,
          nextAttemptAt: new Date(Date.now() + this.retryDelay(row.attempts)),
        },
      });
      this.logger.warn(
        { inboxId: row.id, errorMessage },
        'VTpass webhook inbox processing failed',
      );
      throw error;
    }
  }

  async retryPending(processor: InboxProcessor, limit = 25) {
    const rows = await this.prisma.vtuWebhookInbox.findMany({
      where: {
        processedAt: null,
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: 12 },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });

    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await this.process(row.id, processor);
        if (result.processed) processed += 1;
      } catch {
        failed += 1;
      }
    }

    return { checked: rows.length, processed, failed };
  }

  private retryDelay(attempts: number) {
    return Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** attempts);
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value ? value : undefined;
  }

  private normalizedStatus(value: string): NormalizedVtuStatus {
    return ['success', 'pending', 'failed', 'reversed'].includes(value)
      ? (value as NormalizedVtuStatus)
      : 'pending';
  }
}

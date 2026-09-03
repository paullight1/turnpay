import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  KYCType,
  KycVerificationStatus,
  KycWebhookInbox,
  Prisma,
} from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { KycProviderCallbackResult } from './providers/kyc-provider.gateway';
import { KycWebhookInboxService } from './kyc-webhook-inbox.service';
import { KycService } from './kyc.service';

type InboxEvent = Pick<KycWebhookInbox, 'id' | 'payload'>;

@Injectable()
export class KycWebhookProcessorService {
  constructor(
    private readonly inbox: KycWebhookInboxService,
    private readonly kycService: KycService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledEvents() {
    await this.processDueEvents();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverScheduledClaims() {
    await this.inbox.recoverStaleClaims(300);
  }

  async processDueEvents(limit = 25) {
    const events = (await this.inbox.findDueEvents(limit)) as InboxEvent[];
    for (const event of events) {
      if (!(await this.inbox.claim(event.id))) continue;

      try {
        await this.kycService.applyYouverifyCallback(
          this.toCallbackResult(event.payload),
        );
        await this.inbox.complete(event.id);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown processing error';
        this.logger.error(
          { eventId: event.id, error: errorMessage },
          'Failed to process queued Youverify callback',
        );
        await this.inbox.fail(event.id, errorMessage);
      }
    }
  }

  private toCallbackResult(
    payload: Prisma.JsonValue,
  ): KycProviderCallbackResult {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Malformed KYC webhook inbox payload');
    }
    const record = payload as Record<string, unknown>;
    const provider = record.provider;
    const status = record.status;
    const reference = record.reference;
    const responseHash = record.responseHash;
    const checks = record.checks;
    if (
      provider !== 'YOUVERIFY' ||
      !this.isVerificationStatus(status) ||
      typeof reference !== 'string' ||
      typeof responseHash !== 'string' ||
      !checks ||
      typeof checks !== 'object' ||
      Array.isArray(checks)
    ) {
      throw new BadRequestException('Malformed KYC webhook inbox payload');
    }

    return {
      provider,
      status,
      reference,
      responseHash,
      checks,
      ...(typeof record.errorMessage === 'string'
        ? { errorMessage: record.errorMessage }
        : {}),
      ...(typeof record.documentType === 'string'
        ? { documentType: record.documentType as KYCType }
        : {}),
      ...(typeof record.country === 'string'
        ? { country: record.country }
        : {}),
    };
  }

  private isVerificationStatus(value: unknown): value is KycVerificationStatus {
    return [
      'PENDING',
      'REVIEW_REQUIRED',
      'VERIFIED',
      'REJECTED',
      'FAILED',
    ].includes(String(value));
  }
}

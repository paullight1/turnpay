import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { RawBodyRequest } from '../common/types/request-context';
import { IsIn, IsObject } from 'class-validator';
import { VtuWebhookInboxService } from './vtu-webhook-inbox.service';

export class VtpassWebhookDto {
  @IsIn(['transaction-update'])
  type!: 'transaction-update';

  @IsObject()
  data!: Record<string, unknown>;
}

@Controller('webhooks/vtu')
export class VtpassWebhookController {
  constructor(
    private readonly inbox: VtuWebhookInboxService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VtpassWebhookController.name);
  }

  @Post('vtpass')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleVtpassWebhook(
    @Headers('x-trustpay-vtpass-signature') signature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body() body: VtpassWebhookDto,
  ) {
    this.verifyWebhook({
      rawBody: req.rawBody,
      receivedSignature: signature,
    });

    const event = this.normalizeEvent(body);
    await this.inbox.record(event);

    this.logger.info(
      {
        eventType: event.eventType,
        providerRequestId: event.providerRequestId,
        providerReference: event.providerReference,
        status: event.status,
      },
      'VTpass VTU webhook accepted',
    );

    return { response: 'success' };
  }

  private verifyWebhook(input: {
    rawBody: Buffer | string | undefined;
    receivedSignature: string | undefined;
  }) {
    const secret = this.configService.get<string>('VTPASS_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('VTPASS_WEBHOOK_SECRET is not configured');
      throw new BadRequestException(
        'Webhook signature secret is not configured',
      );
    }

    if (!input.receivedSignature) {
      this.logger.warn('Missing VTpass webhook signature');
      throw new BadRequestException('Missing signature header');
    }

    if (!input.rawBody) {
      this.logger.warn('Missing raw body for VTpass webhook');
      throw new BadRequestException('Missing request body');
    }

    const expectedHex = createHmac('sha256', secret)
      .update(input.rawBody)
      .digest('hex');
    const expectedBase64 = createHmac('sha256', secret)
      .update(input.rawBody)
      .digest('base64');

    if (
      !this.timingSafeCompare(expectedHex, input.receivedSignature) &&
      !this.timingSafeCompare(expectedBase64, input.receivedSignature)
    ) {
      this.logger.warn('Invalid VTpass webhook signature');
      throw new BadRequestException('Invalid signature');
    }
  }

  private normalizeEvent(body: VtpassWebhookDto) {
    const data = this.objectValue(body.data) || {};
    const content = this.objectValue(data.content);
    const transaction = this.objectValue(content?.transactions) || data;
    const eventType = body.type;
    const providerRequestId = this.stringValue(
      data.requestId || data.request_id,
    ).trim();
    const providerReference = this.stringValue(
      transaction.transactionId || transaction.id || data.transactionId,
    ).trim();
    const status = this.stringValue(transaction.status || data.status)
      .trim()
      .toLowerCase();

    const normalizedStatus = this.normalizeStatus(status);
    if (!providerRequestId || !providerReference || !normalizedStatus) {
      throw new BadRequestException('Invalid VTpass webhook payload');
    }

    return {
      eventType,
      providerRequestId,
      providerReference: providerReference || undefined,
      status: normalizedStatus,
      message:
        this.stringValue(data.response_description || data.message)
          .trim()
          .slice(0, 500) || undefined,
      code: this.stringValue(data.code).trim().slice(0, 20) || undefined,
    };
  }

  private normalizeStatus(status: string) {
    if (['reversed', 'refunded'].includes(status)) return 'reversed' as const;
    if (
      ['delivered', 'success', 'successful', 'completed', 'complete'].includes(
        status,
      )
    ) {
      return 'success' as const;
    }
    if (['failed', 'failure', 'rejected', 'cancelled'].includes(status)) {
      return 'failed' as const;
    }
    if (
      ['pending', 'processing', 'initiated', 'queued', 'unknown'].includes(
        status,
      )
    ) {
      return 'pending' as const;
    }
    return undefined;
  }

  private objectValue(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return undefined;
  }

  private stringValue(value: unknown) {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return value.toString();
    }

    return '';
  }

  private timingSafeCompare(expected: string, received: string) {
    const normalizedReceived = received.replace(/^sha256=/i, '').trim();
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(normalizedReceived);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}

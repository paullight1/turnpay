import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { RawBodyRequest } from '../common/types/request-context';
import { VtuService } from './vtu.service';

type VtpassWebhookPayload = Record<string, unknown>;

type VtpassWebhookEvent = {
  eventType: string;
  providerRequestId: string;
  providerReference?: string;
  status: string;
  message?: string;
  rawPayload: Record<string, unknown>;
};

@Controller('webhooks/vtu')
export class VtpassWebhookController {
  constructor(
    private readonly vtuService: VtuService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VtpassWebhookController.name);
  }

  @Post('vtpass')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleVtpassWebhook(
    @Headers('x-vtpass-signature') vtpassSignature: string | undefined,
    @Headers('x-webhook-signature') webhookSignature: string | undefined,
    @Headers('x-signature') genericSignature: string | undefined,
    @Headers('x-vtpass-webhook-secret') secretHeader: string | undefined,
    @Query('token') token: string | undefined,
    @Req() req: RawBodyRequest,
    @Body() body: VtpassWebhookPayload,
  ) {
    this.verifyWebhook({
      rawBody: req.rawBody,
      receivedSignature:
        vtpassSignature || webhookSignature || genericSignature,
      receivedSecret: secretHeader || token,
    });

    const event = this.normalizeEvent(body);
    await this.vtuService.recordVtpassWebhookEvent(event);

    void this.vtuService.processVtpassWebhookEvent(event).catch((error) => {
      this.logger.error(
        {
          providerRequestId: event.providerRequestId,
          providerReference: event.providerReference,
          eventType: event.eventType,
          errorMessage:
            error instanceof Error ? error.message : 'Unknown webhook error',
        },
        'VTpass webhook background processing failed',
      );
    });

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
    rawBody: string | undefined;
    receivedSignature: string | undefined;
    receivedSecret: string | undefined;
  }) {
    const secret = this.configService.get<string>('VTPASS_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('VTPASS_WEBHOOK_SECRET is not configured');
      throw new BadRequestException(
        'Webhook signature secret is not configured',
      );
    }

    if (input.receivedSecret) {
      if (!this.timingSafeCompare(secret, input.receivedSecret)) {
        this.logger.warn('Invalid VTpass webhook shared secret');
        throw new BadRequestException('Invalid webhook secret');
      }
      return;
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

  private normalizeEvent(body: VtpassWebhookPayload): VtpassWebhookEvent {
    const data = this.objectValue(body.data) || body;
    const content = this.objectValue(data.content);
    const transaction = this.objectValue(content?.transactions) || data;
    const eventType = this.stringValue(
      body.type || body.eventType || body.event,
    )
      .trim()
      .slice(0, 100);
    const providerRequestId = this.stringValue(
      data.requestId || data.request_id || body.requestId || body.request_id,
    ).trim();
    const providerReference = this.stringValue(
      transaction.transactionId ||
        transaction.id ||
        data.transactionId ||
        body.transactionId,
    ).trim();
    const status = this.stringValue(
      transaction.status || data.status || body.status,
    )
      .trim()
      .toLowerCase();

    if (!eventType || !providerRequestId || !status) {
      throw new BadRequestException('Invalid VTpass webhook payload');
    }

    return {
      eventType,
      providerRequestId,
      providerReference: providerReference || undefined,
      status,
      message:
        this.stringValue(
          data.response_description || data.message || body.message,
        )
          .trim()
          .slice(0, 500) || undefined,
      rawPayload: body,
    };
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

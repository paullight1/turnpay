import { redactProviderPayload } from '../../common/utils/masking';
import {
  BadRequestException,
  Controller,
  Body,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PaymentService } from '../payment.service';
import { PinoLogger } from 'nestjs-pino';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '@prisma/client';
import type { RawBodyRequest } from '../../common/types/request-context';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MonnifyWebhookDto,
  PaystackWebhookDto,
  PaymentWebhookInboxDto,
} from './dto/payment-webhook.dto';
import { WebhookInboxService } from './webhook-inbox.service';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly webhookInbox: WebhookInboxService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
  ) {}

  @Post('paystack')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handlePaystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest,
    @Body() body: unknown,
  ) {
    if (
      !signature ||
      !req.rawBody ||
      !this.verifyHmacHex(
        'sha512',
        req.rawBody,
        signature,
        'PAYSTACK_SECRET_KEY',
      )
    )
      throw new BadRequestException('Invalid signature');
    const payload = this.validateProviderBody(PaystackWebhookDto, body);
    const data = payload.data;
    const customer =
      data.customer && typeof data.customer === 'object'
        ? (data.customer as Record<string, unknown>)
        : {};
    const reference =
      data.reference ??
      data.customer_code ??
      customer.customer_code ??
      data.id ??
      createHash('sha256').update(req.rawBody).digest('hex');
    if (typeof reference !== 'string' && typeof reference !== 'number')
      throw new BadRequestException('Invalid provider reference');
    if (
      [
        'charge.success',
        'transfer.success',
        'transfer.failed',
        'transfer.reversed',
      ].includes(payload.event) &&
      (typeof data.reference !== 'string' || !data.reference)
    )
      throw new BadRequestException('Payment reference is required');
    await this.acceptWebhookEvent({
      provider: 'PAYSTACK',
      eventType: payload.event,
      providerReference: String(reference),
      payload: redactProviderPayload({ event: payload.event, data }) as Record<
        string,
        unknown
      >,
    });
    return { received: true };
  }

  @Post('monnify')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleMonnifyWebhook(
    @Headers('monnify-signature') signature: string,
    @Req() req: RawBodyRequest,
    @Body() body: unknown,
  ) {
    const rawBody = req.rawBody;

    if (!signature) {
      this.logger.warn('Missing Monnify webhook signature');
      throw new BadRequestException('Missing signature header');
    }

    if (!rawBody) {
      this.logger.warn('Missing raw body for Monnify webhook');
      throw new BadRequestException('Missing request body');
    }

    if (
      !this.verifyHmacHex('sha512', rawBody, signature, 'MONNIFY_SECRET_KEY')
    ) {
      this.logger.warn('Invalid Monnify webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    const payload = this.validateProviderBody(MonnifyWebhookDto, body);
    const eventType = payload.eventType;
    const data = payload.eventData;
    const providerReference =
      data?.transactionReference || data?.paymentReference;

    if (!providerReference) {
      throw new BadRequestException('Monnify provider reference is required');
    }

    this.logger.info(
      { event: eventType, reference: providerReference },
      'Monnify webhook received',
    );

    await this.acceptWebhookEvent({
      provider: 'MONNIFY',
      eventType,
      providerReference,
      payload: body as Record<string, unknown>,
    });

    return { received: true };
  }

  private async acceptWebhookEvent(body: {
    provider: 'MONNIFY' | 'PAYSTACK';
    eventType: string;
    providerReference: string;
    payload: Record<string, unknown>;
  }) {
    const event = this.validateBody(PaymentWebhookInboxDto, body);

    try {
      await this.prisma.webhookLog.create({
        data: {
          provider: event.provider,
          eventType: event.eventType,
          reference: event.providerReference,
          payload: redactProviderPayload(
            event.payload,
          ) as Prisma.InputJsonValue,
          processed: false,
        },
      });
    } catch (logError) {
      this.logger.warn(
        {
          error: logError instanceof Error ? logError.message : 'Unknown error',
          reference: event.providerReference,
        },
        'Failed to create webhook log entry (likely duplicate reference)',
      );
    }

    const accepted = await this.webhookInbox.accept(event);
    if (accepted.duplicate) {
      this.logger.info(
        {
          provider: event.provider,
          eventType: event.eventType,
          providerReference: event.providerReference,
          eventId: accepted.eventId,
        },
        'Duplicate payment webhook delivery acknowledged',
      );
    }
  }

  private verifyHmacHex(
    algorithm: 'sha512',
    rawBody: Buffer,
    receivedSignature: string,
    secretEnvName: string,
  ) {
    const secret = this.configService.getOrThrow<string>(secretEnvName);
    const expected = createHmac(algorithm, secret)
      .update(rawBody)
      .digest('hex');

    return this.timingSafeCompare(expected, receivedSignature);
  }

  private timingSafeCompare(expected: string, received: string) {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  private validateBody<T extends object>(
    dtoClass: new () => T,
    body: unknown,
  ): T {
    const instance = plainToInstance(dtoClass, body);
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      throw new BadRequestException(this.extractValidationMessage(errors[0]));
    }

    return instance;
  }

  /**
   * Provider payloads are versioned outside TRUSTPAY and legitimately gain new
   * fields over time. Signatures establish authenticity; DTO validation below
   * then validates and extracts only the fields our financial logic consumes.
   */
  private validateProviderBody<T extends object>(
    dtoClass: new () => T,
    body: unknown,
  ): T {
    const instance = plainToInstance(dtoClass, body);
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      throw new BadRequestException(this.extractValidationMessage(errors[0]));
    }

    return instance;
  }

  private extractValidationMessage(error: ValidationError): string {
    if (error.constraints) {
      const messages = Object.values(error.constraints);
      return (
        messages.find(
          (message) =>
            message.includes('must be a string') ||
            message.includes('must be a number') ||
            message.includes('should not be empty'),
        ) || messages[0]
      );
    }

    if (error.children?.length) {
      return this.extractValidationMessage(error.children[0]);
    }

    return 'Invalid webhook payload';
  }
}

import { validateSync } from 'class-validator';
import { KoraWebhookDto } from './dto/kora.dto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { asRecord, providerText, verifyKoraSignature } from './kora.client';
import { WebhookInboxService } from '../payments/webhooks/webhook-inbox.service';
import { createHash } from 'crypto';

@Controller('webhooks/kora')
export class KoraWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly inbox: WebhookInboxService,
  ) {}
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async receive(
    @Headers('x-korapay-signature') signature: string,
    @Body() body: unknown,
  ) {
    const payload = asRecord(body);
    if (
      !verifyKoraSignature(
        payload.data,
        signature,
        this.config.get<string>('KORA_SECRET_KEY', ''),
      )
    )
      throw new BadRequestException('Invalid provider signature');
    if (validateSync(Object.assign(new KoraWebhookDto(), payload)).length)
      throw new BadRequestException('Invalid provider event');
    const event = providerText(payload.event);
    if (!/^[a-z_]+\.[a-z_]+$/.test(event) || event.length > 80)
      throw new BadRequestException('Invalid provider event');
    const data = asRecord(payload.data);
    const reference =
      providerText(data.reference) || providerText(data.account_reference);
    if (
      [
        'charge.success',
        'charge.failed',
        'transfer.success',
        'transfer.failed',
        'transfer.reversed',
      ].includes(event) &&
      !/^[A-Za-z0-9_-]{5,160}$/.test(reference)
    )
      throw new BadRequestException('Payment reference is required');
    const identity =
      reference ||
      createHash('sha256').update(JSON.stringify(data)).digest('hex');
    // Only stable identifiers enter the queue. Every financial field is obtained through a fresh authenticated provider query.
    await this.inbox.accept({
      provider: 'KORA',
      eventType: event,
      providerReference: identity,
      payload: {
        event,
        data: {
          reference: identity,
          ...(event === 'account_number.creation' && reference
            ? { account_reference: reference }
            : {}),
        },
      },
    });
    return { received: true };
  }
}

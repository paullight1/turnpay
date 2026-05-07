import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentService } from '../payment.service';
import { PinoLogger } from 'nestjs-pino';
import { Throttle } from '@nestjs/throttler';

interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    gateway_response: string;
    id: number;
  };
}

interface FlutterwaveWebhookEvent {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    status: string;
    amount: number;
    currency: string;
  };
}

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly logger: PinoLogger,
  ) {}

  @Post('paystack')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handlePaystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: Request,
    @Body() body: PaystackWebhookEvent,
  ) {
    const rawBody = (req as any).rawBody;

    if (!signature) {
      this.logger.warn('Missing Paystack webhook signature');
      throw new BadRequestException('Missing signature header');
    }

    if (!rawBody) {
      this.logger.warn('Missing raw body for Paystack webhook');
      throw new BadRequestException('Missing request body');
    }

    const isValid = this.paymentService.verifyPaystackSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.warn({ signature }, 'Invalid Paystack webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    this.logger.info(
      { event: body.event, reference: body.data?.reference },
      'Paystack webhook received',
    );

    if (body.event === 'charge.success' && body.data?.reference) {
      await this.paymentService.processWebhookDeposit({
        reference: body.data.reference,
        status: body.data.status,
        amount: body.data.amount / 100,
        currency: body.data.currency || 'NGN',
      });
    }

    return { received: true };
  }

  @Post('flutterwave')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleFlutterwaveWebhook(
    @Headers('verif-hash') verifHash: string,
    @Headers('flw-signature') flwSignature: string,
    @Req() req: Request,
    @Body() body: FlutterwaveWebhookEvent,
  ) {
    const rawBody = (req as any).rawBody;

    if (flwSignature && rawBody) {
      const isValid = this.paymentService.verifyFlutterwaveSignature(
        rawBody,
        flwSignature,
      );

      if (!isValid) {
        this.logger.warn(
          { flwSignature },
          'Invalid Flutterwave webhook signature',
        );
        throw new BadRequestException('Invalid signature');
      }
    } else if (verifHash) {
      throw new BadRequestException('Missing webhook signature');
    } else {
      throw new BadRequestException('Missing webhook verification headers');
    }

    this.logger.info(
      { event: body.event, tx_ref: body.data?.tx_ref },
      'Flutterwave webhook received',
    );

    if (
      (body.event === 'charge.completed' ||
        body.event === 'transfer.completed') &&
      body.data?.tx_ref
    ) {
      await this.paymentService.processWebhookDeposit({
        reference: body.data.tx_ref,
        status: body.data.status,
        amount: body.data.amount,
        currency: body.data.currency,
      });
    }

    return { received: true };
  }
}

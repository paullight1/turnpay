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
import { Decimal } from '@prisma/client/runtime/library';
import { BankingService } from '../../banking/banking.service';

interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    gateway_response: string;
    id: number;
    authorization?: {
      receiver_bank_account_number?: string;
    };
  };
}

interface FlutterwaveWebhookEvent {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    reference?: string;
    status: string;
    amount: number;
    currency: string;
    account_number?: string;
    customer?: {
      account_number?: string;
    };
  };
}

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly bankingService: BankingService,
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
      this.logger.warn('Invalid Paystack webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    this.logger.info(
      { event: body.event, reference: body.data?.reference },
      'Paystack webhook received',
    );

    const accountNumber =
      body.data?.authorization?.receiver_bank_account_number;

    if (body.event?.startsWith('transfer.') && body.data?.reference) {
      await this.paymentService.processTransferWebhook({
        provider: 'paystack',
        eventType: body.event,
        providerReference: body.data.reference,
        providerStatus: body.data.status,
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (
      body.event === 'charge.success' &&
      body.data?.reference &&
      accountNumber
    ) {
      await this.bankingService.processVirtualAccountDeposit({
        provider: 'paystack',
        eventType: body.event,
        providerReference: body.data.reference,
        accountNumber,
        amount: new Decimal(body.data.amount / 100),
        currency: (body.data.currency || 'NGN') as 'NGN' | 'GHS',
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (body.event === 'charge.success' && body.data?.reference) {
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
        this.logger.warn('Invalid Flutterwave webhook signature');
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

    const flutterwaveAccountNumber =
      body.data?.account_number || body.data?.customer?.account_number;
    const transferReference = body.data?.reference || body.data?.tx_ref;

    if (body.event?.startsWith('transfer') && transferReference) {
      await this.paymentService.processTransferWebhook({
        provider: 'flutterwave',
        eventType: body.event,
        providerReference: transferReference,
        providerStatus: body.data.status,
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (
      body.event === 'charge.completed' &&
      body.data?.tx_ref &&
      flutterwaveAccountNumber
    ) {
      await this.bankingService.processVirtualAccountDeposit({
        provider: 'flutterwave',
        eventType: body.event,
        providerReference: body.data.tx_ref,
        accountNumber: flutterwaveAccountNumber,
        amount: new Decimal(body.data.amount),
        currency: (body.data.currency || 'NGN') as 'NGN' | 'GHS',
        rawPayload: body as unknown as Record<string, unknown>,
      });
    } else if (body.event === 'charge.completed' && body.data?.tx_ref) {
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

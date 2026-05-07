import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class FlutterwaveProvider {
  private readonly baseUrl = 'https://api.flutterwave.com/v3';
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.secretKey = this.configService.getOrThrow<string>(
      'FLUTTERWAVE_SECRET_KEY',
    );
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async initializePayment(params: {
    amount: number;
    email: string;
    currency: string;
    txRef: string;
    redirectUrl?: string;
  }) {
    const payload = {
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      redirect_url:
        params.redirectUrl || 'https://trustpay.com/payment/callback',
      customer: { email: params.email },
    };

    const response = await firstValueFrom(
      this.httpService.post<{
        status: string;
        message: string;
        data: {
          link: string;
          id: number;
        };
      }>(`${this.baseUrl}/payments`, payload, { headers: this.headers }),
    );

    this.logger.info(
      {
        txRef: params.txRef,
        amount: params.amount,
        currency: params.currency,
      },
      'Flutterwave payment initialized',
    );

    return {
      paymentUrl: response.data.data.link,
      transactionId: response.data.data.id,
    };
  }

  async verifyPayment(transactionId: number) {
    const response = await firstValueFrom(
      this.httpService.get<{
        status: string;
        data: {
          id: number;
          tx_ref: string;
          flw_ref: string;
          status: string;
          amount: number;
          currency: string;
        };
      }>(`${this.baseUrl}/transactions/${transactionId}/verify`, {
        headers: this.headers,
      }),
    );

    return response.data.data;
  }

  async initiateTransfer(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    currency: string;
    reference: string;
  }) {
    const payload = {
      account_bank: params.bankCode,
      account_number: params.accountNumber,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      reference: params.reference,
      narration: 'TrustPay withdrawal',
    };

    const response = await firstValueFrom(
      this.httpService.post<{
        status: string;
        message: string;
        data: {
          id: number;
          status: string;
          reference: string;
        };
      }>(`${this.baseUrl}/transfers`, payload, { headers: this.headers }),
    );

    this.logger.info(
      { reference: params.reference, amount: params.amount },
      'Flutterwave transfer initiated',
    );

    return {
      id: response.data.data.id,
      status: response.data.data.status,
      reference: response.data.data.reference,
    };
  }

  verifySignature(payload: string, signature: string): boolean {
    const hash = createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }
}

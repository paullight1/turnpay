import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import { PinoLogger } from 'nestjs-pino';

interface PaymentInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface TransferResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    transfer_code: string;
    status: string;
    reference: string;
  };
}

interface TransferVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    transfer_code: string;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    reason?: string;
  };
}

@Injectable()
export class PaystackProvider {
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.secretKey = this.configService.getOrThrow<string>(
      'PAYSTACK_SECRET_KEY',
    );
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async initializePayment(params: {
    amountMinor: number;
    email: string;
    currency: string;
    reference: string;
    callbackUrl?: string;
  }): Promise<PaymentInitResponse> {
    const payload = {
      amount: params.amountMinor,
      email: params.email,
      currency: params.currency.toLowerCase(),
      reference: params.reference,
      callback_url: params.callbackUrl,
    };

    const response = await firstValueFrom(
      this.httpService.post<PaymentInitResponse>(
        `${this.baseUrl}/transaction/initialize`,
        payload,
        { headers: this.headers },
      ),
    );

    this.logger.info(
      {
        reference: params.reference,
        amountMinor: params.amountMinor,
        currency: params.currency,
      },
      'Paystack payment initialized',
    );

    return response.data;
  }

  async verifyPayment(reference: string): Promise<{
    reference: string;
    status: string;
    amount: number;
    currency: string;
    channel: string;
    gateway_response: string;
  }> {
    const response = await firstValueFrom(
      this.httpService.get<{
        status: boolean;
        message: string;
        data: {
          reference: string;
          status: string;
          amount: number;
          currency: string;
          channel: string;
          gateway_response: string;
        };
      }>(`${this.baseUrl}/transaction/verify/${reference}`, {
        headers: this.headers,
      }),
    );

    return response.data.data;
  }

  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountName: string }> {
    const response = await firstValueFrom(
      this.httpService.get<{
        status: boolean;
        data: { account_name: string };
      }>(
        `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: this.headers,
        },
      ),
    );

    return { accountName: response.data.data.account_name };
  }

  async listBanks(): Promise<
    Array<{ name: string; code: string; slug: string }>
  > {
    const response = await firstValueFrom(
      this.httpService.get<{
        status: boolean;
        data: Array<{ name: string; code: string; slug: string }>;
      }>(`${this.baseUrl}/bank?perPage=100`, {
        headers: this.headers,
      }),
    );

    return response.data.data;
  }

  async initiateTransfer(params: {
    amountMinor: number;
    recipientCode: string;
    currency: string;
    reference: string;
  }): Promise<TransferResponse> {
    const payload = {
      amount: params.amountMinor,
      recipient: params.recipientCode,
      currency: params.currency.toLowerCase(),
      reference: params.reference,
    };

    const response = await firstValueFrom(
      this.httpService.post<TransferResponse>(
        `${this.baseUrl}/transfer`,
        payload,
        { headers: this.headers },
      ),
    );

    this.logger.info(
      { reference: params.reference, amountMinor: params.amountMinor },
      'Paystack transfer initiated',
    );

    return response.data;
  }

  async verifyTransfer(
    reference: string,
  ): Promise<TransferVerifyResponse['data']> {
    const response = await firstValueFrom(
      this.httpService.get<TransferVerifyResponse>(
        `${this.baseUrl}/transfer/verify/${reference}`,
        { headers: this.headers },
      ),
    );

    return response.data.data;
  }

  async createTransferRecipient(params: {
    accountNumber: string;
    bankCode: string;
    name: string;
    currency: string;
  }): Promise<{ recipientCode: string }> {
    const payload = {
      type: 'nuban',
      name: params.name,
      description: 'TrustPay withdrawal',
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency.toLowerCase(),
    };

    const response = await firstValueFrom(
      this.httpService.post<{
        status: boolean;
        data: { recipient_code: string };
      }>(`${this.baseUrl}/transferrecipient`, payload, {
        headers: this.headers,
      }),
    );

    return { recipientCode: response.data.data.recipient_code };
  }

  verifySignature(rawBody: string, signature: string): boolean {
    const hash = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}

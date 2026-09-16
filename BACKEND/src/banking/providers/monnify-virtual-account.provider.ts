import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse, isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  ProviderVirtualAccount,
  ProvisionVirtualAccountInput,
} from './banking-provider.types';

interface MonnifyAuthResponse {
  requestSuccessful: boolean;
  responseBody?: {
    accessToken?: string;
    expiresIn?: number;
  };
}

interface MonnifyReservedAccountResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    reservationReference?: string;
    accountReference?: string;
    customerEmail?: string;
    accounts?: Array<{
      bankCode?: string;
      bankName?: string;
      accountNumber?: string;
      accountName?: string;
    }>;
    status?: string;
  };
}

interface MonnifyBank {
  name?: string;
  code?: string;
  ussdTemplate?: string | null;
  baseUssdCode?: string | null;
  transferUssdTemplate?: string | null;
}

interface MonnifyBanksResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: MonnifyBank[];
}

interface MonnifyAccountValidationResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
    bankName?: string;
  };
}

interface MonnifyDisbursementResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    transactionReference?: string;
    paymentReference?: string;
    status?: string;
    amount?: number;
    destinationBankCode?: string;
    destinationAccountNumber?: string;
    destinationAccountName?: string;
    narration?: string;
  };
}

interface MonnifyTransferStatusResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    amount?: number;
    reference?: string;
    narration?: string;
    currency?: string;
    fee?: number;
    twoFaEnabled?: boolean;
    status?: string;
    transactionDescription?: string;
    transactionReference?: string;
    destinationBankCode?: string;
    destinationAccountNumber?: string;
    destinationAccountName?: string;
    destinationBankName?: string;
    createdOn?: string;
  };
}

interface MonnifyOtpResponse {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    reference?: string;
    transactionReference?: string;
    status?: string;
    transactionStatus?: string;
    message?: string;
    emailRecipients?: string[];
  };
}

@Injectable()
export class MonnifyVirtualAccountProvider {
  private accessToken?: string;
  private tokenExpiresAt = 0;

  async updateReservedAccountKyc(
    accountReference: string,
    identifiers: { bvn?: string; nin?: string },
  ): Promise<void> {
    if (
      (identifiers.bvn && !/^\d{11}$/.test(identifiers.bvn)) ||
      (identifiers.nin && !/^\d{11}$/.test(identifiers.nin)) ||
      (!identifiers.bvn && !identifiers.nin)
    ) {
      throw new BadRequestException('A verified BVN or NIN is required');
    }
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<{ requestSuccessful: boolean }>(
      firstValueFrom(
        this.httpService.put(
          `${this.baseUrl}/api/v1/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}/kyc-info`,
          identifiers,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Could not update reserved account KYC',
    );
    if (!response.data.requestSuccessful) {
      throw new BadRequestException('Could not update reserved account KYC');
    }
  }

  async updateReservedAccountLimit(
    accountReference: string,
    limitProfileCode: string,
  ): Promise<void> {
    if (!limitProfileCode.trim()) {
      throw new BadRequestException('Monnify limit profile is required');
    }
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<{
      requestSuccessful: boolean;
    }>(
      firstValueFrom(
        this.httpService.put(
          `${this.baseUrl}/api/v1/bank-transfer/reserved-accounts/limit`,
          { accountReference, limitProfileCode: limitProfileCode.trim() },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Could not update reserved account limit',
    );
    if (!response.data.requestSuccessful) {
      throw new BadRequestException('Could not update reserved account limit');
    }
  }

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async provisionVirtualAccount(
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    if (input.currency !== 'NGN') {
      throw new BadRequestException(
        'Monnify virtual accounts support NGN only',
      );
    }

    if (!input.bvn && !input.nin) {
      throw new BadRequestException(
        'BVN or NIN is required for Monnify reserved accounts',
      );
    }

    const contractCode = this.requireMonnifyContractCode();
    const token = await this.getAccessToken();
    const accountReference = this.buildAccountReference(input);
    const accountName = this.buildAccountName(input);
    const customerName = this.buildAccountHolderName(input);
    const restrictPaymentSource = this.configService.get<boolean>(
      'MONNIFY_RESTRICT_PAYMENT_SOURCE',
      false,
    );

    const payload: Record<string, unknown> = {
      accountReference,
      accountName,
      currencyCode: input.currency,
      contractCode,
      customerEmail: input.email,
      customerName,
      getAllAvailableBanks: this.configService.get<boolean>(
        'MONNIFY_GET_ALL_AVAILABLE_BANKS',
        true,
      ),
    };

    if (input.limitProfileCode) {
      payload.limitProfileCode = input.limitProfileCode;
    }

    if (input.bvn) {
      payload.bvn = input.bvn;
    }

    if (input.nin) {
      payload.nin = input.nin;
    }

    if (restrictPaymentSource && input.bvn) {
      payload.restrictPaymentSource = true;
      payload.allowedPaymentSources = { bvns: [input.bvn] };
    }

    let response: AxiosResponse<MonnifyReservedAccountResponse>;
    const reservePath = input.limitProfileCode
      ? '/api/v2/bank-transfer/reserved-accounts/limit'
      : '/api/v2/bank-transfer/reserved-accounts';
    try {
      response = await this.fetchMonnify<MonnifyReservedAccountResponse>(
        firstValueFrom(
          this.httpService.post<MonnifyReservedAccountResponse>(
            `${this.baseUrl}${reservePath}`,
            payload,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        ),
        'Could not provision Monnify reserved account',
      );
    } catch (error) {
      if (this.isDuplicateReservedAccountError(error)) {
        return this.getReservedAccountByReference(accountReference, token);
      }

      throw error;
    }

    const body = response.data.responseBody;
    const account = body?.accounts?.[0];

    return {
      provider: 'monnify',
      providerAccountId: body?.reservationReference || body?.accountReference,
      providerCustomerId: body?.customerEmail,
      accountNumber: account?.accountNumber || '',
      accountName: account?.accountName || accountName,
      bankName: account?.bankName || 'Moniepoint Microfinance Bank',
      bankCode: account?.bankCode,
      currency: input.currency,
      status: body?.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  private async getReservedAccountByReference(
    accountReference: string,
    token: string,
  ): Promise<ProviderVirtualAccount> {
    const response = await this.fetchMonnify<MonnifyReservedAccountResponse>(
      firstValueFrom(
        this.httpService.get<MonnifyReservedAccountResponse>(
          `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        ),
      ),
      'Could not fetch Monnify reserved account',
    );

    const body = response.data.responseBody;
    const account = body?.accounts?.[0];

    if (!account?.accountNumber) {
      throw new BadRequestException(
        'Could not fetch existing Monnify reserved account details',
      );
    }

    return {
      provider: 'monnify',
      providerAccountId: body?.reservationReference || body?.accountReference,
      providerCustomerId: body?.customerEmail,
      accountNumber: account.accountNumber,
      accountName: account.accountName || '',
      bankName: account.bankName || 'Moniepoint Microfinance Bank',
      bankCode: account.bankCode,
      currency: 'NGN',
      status: body?.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  async listBanks(): Promise<
    Array<{ name: string; code: string; slug: string }>
  > {
    const response = await this.fetchMonnifyBanksWithRetry();

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage || 'Could not load Monnify banks',
      );
    }

    return (response.data.responseBody || [])
      .filter((bank) => bank.name && bank.code)
      .map((bank) => ({
        name: bank.name as string,
        code: bank.code as string,
        slug: this.slugify(bank.name as string),
      }));
  }

  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountName: string; bankName?: string; bankCode?: string }> {
    const response = await this.fetchMonnifyAccountValidationWithRetry(
      accountNumber,
      bankCode,
    );

    const body = response.data.responseBody;
    if (!response.data.requestSuccessful || !body?.accountName) {
      throw new BadRequestException(
        response.data.responseMessage || 'Could not validate bank account',
      );
    }

    return {
      accountName: body.accountName,
      bankName: body.bankName,
      bankCode: body.bankCode,
    };
  }

  async initiateTransfer(input: {
    amount: string;
    reference: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    sourceAccountNumber?: string;
    narration?: string;
    currency?: 'NGN';
    async?: boolean;
  }): Promise<{
    reference: string;
    transactionReference?: string;
    status: string;
    responseMessage?: string;
    raw: Record<string, unknown>;
  }> {
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<MonnifyDisbursementResponse>(
      firstValueFrom(
        this.httpService.post<MonnifyDisbursementResponse>(
          `${this.baseUrl}/api/v2/disbursements/single`,
          {
            amount: Number(input.amount),
            reference: input.reference,
            narration: input.narration || 'TrustPay withdrawal',
            ...(input.sourceAccountNumber
              ? { sourceAccountNumber: input.sourceAccountNumber }
              : {}),
            destinationBankCode: input.bankCode,
            destinationAccountNumber: input.accountNumber,
            destinationAccountName: input.accountName,
            currency: input.currency || 'NGN',
            ...(typeof input.async === 'boolean' ? { async: input.async } : {}),
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Could not initiate Monnify transfer',
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage || 'Could not initiate Monnify transfer',
      );
    }

    return {
      reference:
        response.data.responseBody?.transactionReference || input.reference,
      transactionReference: response.data.responseBody?.transactionReference,
      status: response.data.responseBody?.status || 'PENDING',
      responseMessage: response.data.responseMessage,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  async authorizeTransfer(input: {
    reference: string;
    authorizationCode: string;
  }): Promise<{
    reference: string;
    transactionReference?: string;
    status: string;
    responseMessage?: string;
    raw: Record<string, unknown>;
  }> {
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<MonnifyOtpResponse>(
      firstValueFrom(
        this.httpService.post<MonnifyOtpResponse>(
          `${this.baseUrl}/api/v2/disbursements/single/validate-otp`,
          {
            reference: input.reference,
            authorizationCode: input.authorizationCode,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Could not authorize Monnify transfer',
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage || 'Could not authorize Monnify transfer',
      );
    }

    return {
      reference:
        response.data.responseBody?.transactionReference || input.reference,
      transactionReference: response.data.responseBody?.transactionReference,
      status:
        response.data.responseBody?.status ||
        response.data.responseBody?.transactionStatus ||
        'PENDING',
      responseMessage: response.data.responseMessage,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  async resendTransferOtp(reference: string): Promise<{
    reference: string;
    responseMessage?: string;
    emailRecipients?: string[];
    raw: Record<string, unknown>;
  }> {
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<MonnifyOtpResponse>(
      firstValueFrom(
        this.httpService.post<MonnifyOtpResponse>(
          `${this.baseUrl}/api/v2/disbursements/single/resend-otp`,
          { reference },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Could not resend Monnify transfer OTP',
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage ||
          'Could not resend Monnify transfer OTP',
      );
    }

    return {
      reference: response.data.responseBody?.transactionReference || reference,
      responseMessage: response.data.responseMessage,
      emailRecipients: response.data.responseBody?.emailRecipients,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  async getTransferStatus(reference: string): Promise<{
    reference: string;
    status: string;
    responseMessage?: string;
    raw: Record<string, unknown>;
  }> {
    const token = await this.getAccessToken();
    const response = await this.fetchMonnify<MonnifyTransferStatusResponse>(
      firstValueFrom(
        this.httpService.get<MonnifyTransferStatusResponse>(
          `${this.baseUrl}/api/v2/disbursements/single/summary`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            params: { reference },
          },
        ),
      ),
      'Could not fetch Monnify transfer status',
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage ||
          'Could not fetch Monnify transfer status',
      );
    }

    return {
      reference:
        response.data.responseBody?.transactionReference ||
        response.data.responseBody?.reference ||
        reference,
      status:
        response.data.responseBody?.status ||
        response.data.responseBody?.transactionDescription ||
        'PENDING',
      responseMessage: response.data.responseMessage,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  private async getAccessToken() {
    const now = Date.now();

    if (this.accessToken && this.tokenExpiresAt > now + 60_000) {
      return this.accessToken;
    }

    const apiKey = this.requireMonnifyApiKey();
    const secretKey = this.requireMonnifySecretKey();
    const basicToken = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    const response = await this.fetchMonnify<MonnifyAuthResponse>(
      firstValueFrom(
        this.httpService.post<MonnifyAuthResponse>(
          `${this.baseUrl}/api/v1/auth/login`,
          {},
          {
            headers: {
              Authorization: `Basic ${basicToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      ),
      'Monnify authentication failed',
    );

    const accessToken = response.data.responseBody?.accessToken;

    if (!accessToken) {
      throw new BadRequestException('Monnify authentication failed');
    }

    const expiresIn = response.data.responseBody?.expiresIn || 1800;
    this.accessToken = accessToken;
    this.tokenExpiresAt = now + expiresIn * 1000;

    return accessToken;
  }

  private requireMonnifyApiKey() {
    const apiKey = this.configService.get<string>('MONNIFY_API_KEY')?.trim();

    if (!apiKey) {
      throw new BadRequestException(
        'Monnify API credentials are not configured for this environment',
      );
    }

    return apiKey;
  }

  private requireMonnifySecretKey() {
    const secretKey = this.configService
      .get<string>('MONNIFY_SECRET_KEY')
      ?.trim();

    if (!secretKey) {
      throw new BadRequestException(
        'Monnify API credentials are not configured for this environment',
      );
    }

    return secretKey;
  }

  private requireMonnifyContractCode() {
    const contractCode = this.configService
      .get<string>('MONNIFY_CONTRACT_CODE')
      ?.trim();

    if (!contractCode) {
      throw new BadRequestException(
        'Monnify contract code is not configured for this environment',
      );
    }

    return contractCode;
  }

  private get baseUrl() {
    const configured = this.configService.get<string>('MONNIFY_BASE_URL');

    if (configured) {
      return configured.replace(/\/$/, '');
    }

    const sandboxMode = this.configService.get<boolean>(
      'BANKING_SANDBOX_MODE',
      true,
    );

    return sandboxMode
      ? 'https://sandbox.monnify.com'
      : 'https://api.monnify.com';
  }

  private async fetchMonnify<T>(
    request: Promise<AxiosResponse<T>>,
    fallbackMessage: string,
  ): Promise<AxiosResponse<T>> {
    try {
      return await request;
    } catch (error) {
      throw new BadRequestException(
        this.describeMonnifyError(error, fallbackMessage),
      );
    }
  }

  private async fetchMonnifyBanksWithRetry() {
    return this.fetchMonnifyWithTokenRetry(async (token) =>
      this.fetchMonnify<MonnifyBanksResponse>(
        firstValueFrom(
          this.httpService.get<MonnifyBanksResponse>(
            `${this.baseUrl}/api/v1/banks`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          ),
        ),
        'Could not load Monnify banks',
      ),
    );
  }

  private async fetchMonnifyAccountValidationWithRetry(
    accountNumber: string,
    bankCode: string,
  ) {
    return this.fetchMonnifyWithTokenRetry(async (token) =>
      this.fetchMonnify<MonnifyAccountValidationResponse>(
        firstValueFrom(
          this.httpService.get<MonnifyAccountValidationResponse>(
            `${this.baseUrl}/api/v1/disbursements/account/validate`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
              params: {
                accountNumber,
                bankCode,
              },
            },
          ),
        ),
        'Could not validate bank account',
      ),
    );
  }

  private async fetchMonnifyWithTokenRetry<T>(
    requestFactory: (token: string) => Promise<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    const token = await this.getAccessToken();

    try {
      return await requestFactory(token);
    } catch (error) {
      if (!this.isInvalidMonnifyTokenError(error)) {
        throw error;
      }

      this.invalidateAccessToken();
      const refreshedToken = await this.getAccessToken();

      return requestFactory(refreshedToken);
    }
  }

  private describeMonnifyError(error: unknown, fallbackMessage: string) {
    if (isAxiosError(error)) {
      const responseData = error.response?.data as
        | {
            responseMessage?: unknown;
            message?: unknown;
            error?: unknown;
          }
        | undefined;

      const providerMessage = [
        responseData?.responseMessage,
        responseData?.message,
        responseData?.error,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);

      if (typeof providerMessage === 'string') {
        return providerMessage;
      }

      if (error.message.trim()) {
        return error.message;
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallbackMessage;
  }

  private isInvalidMonnifyTokenError(error: unknown) {
    if (isAxiosError(error) && error.response?.status === 401) {
      return true;
    }

    const message = this.describeMonnifyError(error, '').toLowerCase();
    return (
      message.includes('invalid_token') ||
      message.includes('invalid token') ||
      message.includes('token expired')
    );
  }

  private invalidateAccessToken() {
    this.accessToken = undefined;
    this.tokenExpiresAt = 0;
  }

  private isDuplicateReservedAccountError(error: unknown) {
    const message = this.describeMonnifyError(error, '');
    const normalized = message.toLowerCase();

    return (
      normalized.includes('same reference') ||
      normalized.includes('existing active reserved account') ||
      normalized.includes('same customeremail')
    );
  }

  private buildAccountReference(input: ProvisionVirtualAccountInput) {
    return `TP-${input.currency}-${input.userId}`.slice(0, 64);
  }

  private buildAccountName(input: ProvisionVirtualAccountInput) {
    const holderName = this.buildAccountHolderName(input);
    const prefix = (
      this.configService.get<string>('VIRTUAL_ACCOUNT_NAME_PREFIX') ?? ''
    ).trim();

    if (!prefix) {
      return holderName.slice(0, 64);
    }

    return `${prefix} - ${holderName}`.slice(0, 64);
  }

  private buildAccountHolderName(input: ProvisionVirtualAccountInput) {
    return (
      input.accountHolderName ||
      [input.firstName, input.middleName, input.lastName]
        .filter(Boolean)
        .join(' ')
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

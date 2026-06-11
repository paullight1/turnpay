import { BadRequestException, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  ProviderVirtualAccount,
  ProvisionVirtualAccountInput,
} from "./banking-provider.types";

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

@Injectable()
export class MonnifyVirtualAccountProvider {
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async provisionVirtualAccount(
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    if (input.currency !== "NGN") {
      throw new BadRequestException(
        "Monnify virtual accounts support NGN only",
      );
    }

    if (!input.bvn && !input.nin) {
      throw new BadRequestException(
        "BVN or NIN is required for Monnify reserved accounts",
      );
    }

    const token = await this.getAccessToken();
    const accountReference = this.buildAccountReference(input);
    const accountName = this.buildAccountName(input);
    const restrictPaymentSource = this.configService.get<boolean>(
      "MONNIFY_RESTRICT_PAYMENT_SOURCE",
      false,
    );

    const payload: Record<string, unknown> = {
      accountReference,
      accountName,
      currencyCode: input.currency,
      contractCode: this.configService.getOrThrow<string>(
        "MONNIFY_CONTRACT_CODE",
      ),
      customerEmail: input.email,
      customerName: accountName,
      getAllAvailableBanks: this.configService.get<boolean>(
        "MONNIFY_GET_ALL_AVAILABLE_BANKS",
        true,
      ),
    };

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

    const response = await firstValueFrom(
      this.httpService.post<MonnifyReservedAccountResponse>(
        `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const body = response.data.responseBody;
    const account = body?.accounts?.[0];

    return {
      provider: "monnify",
      providerAccountId: body?.reservationReference || body?.accountReference,
      providerCustomerId: body?.customerEmail,
      accountNumber: account?.accountNumber || "",
      accountName: account?.accountName || accountName,
      bankName: account?.bankName || "Moniepoint Microfinance Bank",
      bankCode: account?.bankCode,
      currency: input.currency,
      status: body?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  async listBanks(): Promise<
    Array<{ name: string; code: string; slug: string }>
  > {
    const token = await this.getAccessToken();
    const response = await firstValueFrom(
      this.httpService.get<MonnifyBanksResponse>(
        `${this.baseUrl}/api/v1/banks`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage || "Could not load Monnify banks",
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
    const token = await this.getAccessToken();
    const response = await firstValueFrom(
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
    );

    const body = response.data.responseBody;
    if (!response.data.requestSuccessful || !body?.accountName) {
      throw new BadRequestException(
        response.data.responseMessage || "Could not validate bank account",
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
    narration?: string;
    currency?: "NGN";
    async?: boolean;
  }): Promise<{
    reference: string;
    transactionReference?: string;
    status: string;
    responseMessage?: string;
    raw: Record<string, unknown>;
  }> {
    const token = await this.getAccessToken();
    const response = await firstValueFrom(
      this.httpService.post<MonnifyDisbursementResponse>(
        `${this.baseUrl}/api/v2/disbursements/single`,
        {
          amount: Number(input.amount),
          reference: input.reference,
          narration: input.narration || "TrustPay withdrawal",
          destinationBankCode: input.bankCode,
          destinationAccountNumber: input.accountNumber,
          destinationAccountName: input.accountName,
          currencyCode: input.currency || "NGN",
          ...(typeof input.async === "boolean" ? { async: input.async } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    if (!response.data.requestSuccessful) {
      throw new BadRequestException(
        response.data.responseMessage || "Could not initiate Monnify transfer",
      );
    }

    return {
      reference:
        response.data.responseBody?.transactionReference || input.reference,
      transactionReference: response.data.responseBody?.transactionReference,
      status: response.data.responseBody?.status || "PENDING",
      responseMessage: response.data.responseMessage,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }

  private async getAccessToken() {
    const now = Date.now();

    if (this.accessToken && this.tokenExpiresAt > now + 60_000) {
      return this.accessToken;
    }

    const apiKey = this.configService.getOrThrow<string>("MONNIFY_API_KEY");
    const secretKey =
      this.configService.getOrThrow<string>("MONNIFY_SECRET_KEY");
    const basicToken = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

    const response = await firstValueFrom(
      this.httpService.post<MonnifyAuthResponse>(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            Authorization: `Basic ${basicToken}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const accessToken = response.data.responseBody?.accessToken;

    if (!accessToken) {
      throw new BadRequestException("Monnify authentication failed");
    }

    const expiresIn = response.data.responseBody?.expiresIn || 1800;
    this.accessToken = accessToken;
    this.tokenExpiresAt = now + expiresIn * 1000;

    return accessToken;
  }

  private get baseUrl() {
    const configured = this.configService.get<string>("MONNIFY_BASE_URL");

    if (configured) {
      return configured.replace(/\/$/, "");
    }

    const sandboxMode = this.configService.get<boolean>(
      "BANKING_SANDBOX_MODE",
      true,
    );

    return sandboxMode
      ? "https://sandbox.monnify.com"
      : "https://api.monnify.com";
  }

  private buildAccountReference(input: ProvisionVirtualAccountInput) {
    return `TP-${input.currency}-${input.userId}`.slice(0, 64);
  }

  private buildAccountName(input: ProvisionVirtualAccountInput) {
    return [input.firstName, input.middleName, input.lastName]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

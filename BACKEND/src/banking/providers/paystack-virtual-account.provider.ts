import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  ProviderVirtualAccount,
  ProvisionVirtualAccountInput,
} from "./banking-provider.types";

interface PaystackAssignDvaResponse {
  status: boolean;
  message: string;
  data?: {
    account_number?: string;
    account_name?: string;
    currency?: string;
    active?: boolean;
    assigned?: boolean;
    id?: number | string;
    bank?: {
      name?: string;
      slug?: string;
    };
    customer?: {
      customer_code?: string;
    };
  };
}

@Injectable()
export class PaystackVirtualAccountProvider {
  private readonly baseUrl = "https://api.paystack.co";
  private readonly secretKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.secretKey = this.configService.getOrThrow<string>(
      "PAYSTACK_SECRET_KEY",
    );
  }

  async provisionVirtualAccount(
    input: ProvisionVirtualAccountInput,
  ): Promise<ProviderVirtualAccount> {
    const payload: Record<string, unknown> = {
      email: input.email,
      first_name: input.firstName,
      middle_name: input.middleName,
      last_name: input.lastName,
      phone: input.phone,
      preferred_bank:
        this.configService.get<string>("PAYSTACK_DVA_PREFERRED_BANK") ||
        "test-bank",
      country: input.country,
    };

    if (input.bvn && input.identityAccountNumber && input.identityBankCode) {
      payload.bvn = input.bvn;
      payload.account_number = input.identityAccountNumber;
      payload.bank_code = input.identityBankCode;
    }

    const response = await firstValueFrom(
      this.httpService.post<PaystackAssignDvaResponse>(
        `${this.baseUrl}/dedicated_account/assign`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const data = response.data.data;

    return {
      provider: "paystack",
      providerAccountId: data?.id ? String(data.id) : undefined,
      providerCustomerId: data?.customer?.customer_code,
      accountNumber: data?.account_number || "",
      accountName: data?.account_name || "",
      bankName: data?.bank?.name || "",
      bankCode: data?.bank?.slug,
      currency: (data?.currency as "NGN" | "GHS") || input.currency,
      status: data?.active && data?.assigned ? "ACTIVE" : "PENDING",
      raw: response.data as unknown as Record<string, unknown>,
    };
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
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
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
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      }),
    );

    return response.data.data;
  }
}

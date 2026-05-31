import { Decimal } from "@prisma/client/runtime/library";

export type BankingProviderName = "paystack" | "flutterwave" | "monnify";
export type NormalizedProviderName = "PAYSTACK" | "FLUTTERWAVE" | "MONNIFY";
export type BankingCurrency = "NGN" | "GHS";

export interface ProvisionVirtualAccountInput {
  userId: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  country: string;
  currency: BankingCurrency;
  bvn?: string;
  nin?: string;
  identityAccountNumber?: string;
  identityBankCode?: string;
}

export interface ProviderVirtualAccount {
  provider: BankingProviderName;
  providerAccountId?: string;
  providerCustomerId?: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode?: string;
  currency: BankingCurrency;
  status: "ACTIVE" | "PENDING" | "FAILED" | "DISABLED";
  raw?: Record<string, unknown>;
}

export interface NormalizedDepositEvent {
  provider: BankingProviderName;
  eventType: string;
  providerReference: string;
  accountNumber: string;
  amount: Decimal;
  currency: BankingCurrency;
  rawPayload: Record<string, unknown>;
}

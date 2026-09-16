import { Decimal } from '@prisma/client/runtime/library';

export type BankingProviderName = 'monnify';
export type NormalizedProviderName = 'MONNIFY';
export type BankingCurrency = 'NGN' | 'GHS';

export interface ProvisionVirtualAccountInput {
  userId: string;
  email: string;
  phone: string;
  /**
   * Verified legal name resolved server-side (never client-supplied). This is
   * what the partner bank displays to payers, optionally behind a brand prefix.
   */
  accountHolderName: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  country: string;
  currency: BankingCurrency;
  bvn?: string;
  nin?: string;
  limitProfileCode?: string;
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
  status: 'ACTIVE' | 'PENDING' | 'FAILED' | 'DISABLED';
  raw?: Record<string, unknown>;
}

export interface NormalizedDepositEvent {
  provider: BankingProviderName;
  eventType: string;
  providerReference: string;
  accountNumber: string;
  amount: Decimal;
  /** Net amount the provider settles after its fees, when reported. */
  settlementAmount?: Decimal;
  currency: BankingCurrency;
  rawPayload: Record<string, unknown>;
}

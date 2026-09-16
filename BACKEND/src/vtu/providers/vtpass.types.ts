import type {
  VtuMeterType,
  VtuSubscriptionType,
  VtuType,
} from '../dto/vtu.dto';

export type NormalizedVtuStatus = 'success' | 'pending' | 'failed' | 'reversed';
export type VtuProviderCurrency = 'NGN' | 'GHS';

export interface VtuPackage {
  id: string;
  name: string;
  price: string;
  validity: string;
  serviceType: 'data' | 'cable';
}

export interface VtuProviderPurchase {
  type: VtuType;
  provider: string;
  contactPhone: string;
  recipientNumber?: string;
  amount: string | number;
  reference: string;
  packageId?: string;
  smartCardNumber?: string;
  subscriptionType?: VtuSubscriptionType;
  meterNumber?: string;
  meterType?: VtuMeterType;
  providerRequestId?: string;
}

export interface VtuProviderResult {
  reference: string;
  providerRequestId: string;
  providerTransactionId: string;
  status: NormalizedVtuStatus;
  message: string;
  /** Amount reported by VTpass for the provider-side transaction. */
  providerAmount?: string;
  /** VTpass is currently NGN-only for TRUSTPAY. */
  providerCurrency?: VtuProviderCurrency;
  /** Provider wallet credit identifier present on reversal responses. */
  walletCreditId?: string;
  providerCost?: string;
  providerCommission?: string;
  purchasedCode?: string;
  safeResponse: Record<string, unknown>;
  /** Compatibility alias consumed by the order service until it is migrated. */
  rawResponse: Record<string, unknown>;
}

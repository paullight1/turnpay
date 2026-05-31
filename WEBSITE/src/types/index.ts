export interface User {
  id: string;
  email: string;
  phone: string;
  fullName?: string | null;
  role: string;
  kycStatus: string;
  kycTier?: string | number | null;
  isSuspended?: boolean;
}

export interface KycVerificationMetadata {
  provider?: string | null;
  providerStatus?: string | null;
  verificationStatus?: string | null;
  manualReviewStatus?: string | null;
  manualReviewRequired?: boolean | null;
  requiresManualReview?: boolean | null;
  rejectionNote?: string | null;
  reviewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface KycDocument extends KycVerificationMetadata {
  id: string;
  type: string;
  idNumber: string;
  status: string;
  kycTier?: string | number | null;
}

export interface Wallet {
  id: string;
  currency: string;
  balance: number | string;
  updatedAt: string;
}

export interface VirtualAccount {
  id: string;
  provider: string;
  accountNumber?: string | null;
  accountNumberMasked: string;
  accountName: string;
  bankName: string;
  bankCode?: string | null;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number | string;
  currency: string;
  status: string;
  reference: string;
  fee: number | string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeQuote {
  id: string;
  from: string;
  to: string;
  amount: number;
  rate: number;
  markupPercent: number;
  fee: number;
  sendAmount: number;
  receiveAmount: number;
  expiresAt: string;
  createdAt: string;
}

export interface VtuProvider {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface VtuPackage {
  id: string;
  name: string;
  price: number;
  validity: string;
}

export interface VtuPurchaseResult {
  success?: boolean;
  status?: string;
  reference?: string;
  orderId?: string;
  message?: string;
  amount?: string;
}

export interface VtuOrderStatus {
  orderId: string;
  transactionId: string;
  reference: string;
  transactionStatus: string;
  orderStatus: string;
  provider: string;
  scope: string;
  type: string;
  countryCode?: string | null;
  localProvider?: string | null;
  operatorId?: string | null;
  providerRequestId: string;
  providerTransactionId?: string | null;
  providerStatus?: string | null;
  amount: string;
  currency: string;
  targetMasked?: string | null;
  requeryAttempts: number;
  lastRequeryAt?: string | null;
  nextRequeryAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVtuStaleOrder {
  orderId: string;
  provider: string;
  providerRequestId?: string | null;
  providerTransactionId?: string | null;
  providerStatus?: string | null;
  scope?: string | null;
  transactionId: string;
  transactionReference: string;
  transactionStatus: string;
  serviceType: string;
  countryCode?: string | null;
  localProvider?: string | null;
  operatorId?: string | null;
  amount: number | string;
  currency: string;
  costAmount?: number | string | null;
  fee?: number | string | null;
  margin?: number | string | null;
  status: string;
  targetMasked?: string | null;
  attempts: number;
  lastRequeryAt?: string | null;
  nextRequeryAt?: string | null;
  createdAt: string;
  updatedAt: string;
  transactionCreatedAt: string;
  transactionUpdatedAt: string;
}

export interface AdminVtuStaleOrdersResponse {
  generatedAt: string;
  olderThanMinutes: number;
  cutoff: string;
  count: number;
  orders: AdminVtuStaleOrder[];
}

export interface AdminVtuProviderHealth {
  id: "vtpass" | "reloadly";
  name: string;
  configured: boolean;
  enabled: boolean;
  supportsBalance: boolean;
  balance: {
    status: "available" | "unknown" | "error";
    amount?: string;
    currency?: string;
    checkedAt?: string;
  };
  warnings: string[];
}

export interface AdminVtuProviderHealthResponse {
  generatedAt: string;
  providers: AdminVtuProviderHealth[];
}

export interface AdminVtuRequeryResponse {
  orderId: string;
  reference: string;
  result?: {
    processed?: boolean;
    status?: string;
    message?: string;
  } | null;
  order?: VtuOrderStatus | null;
}

export interface AdminVtuReconciliationSummary {
  currency?: string | null;
  totalOrders?: number;
  totalAmount?: number | string;
  totalCostAmount?: number | string;
  totalFees?: number | string;
  totalMargin?: number | string;
  amountMismatches?: number;
  feeMismatches?: number;
  missingDebits?: number;
  missingReversals?: number;
  staleOrders?: number;
  highRiskExceptions?: number;
}

export interface AdminVtuReconciliationBreakdown {
  provider?: string | null;
  status?: string | null;
  currency?: string | null;
  count: number;
  amount?: number | string | null;
  costAmount?: number | string | null;
  fees?: number | string | null;
  margin?: number | string | null;
}

export interface AdminVtuReconciliationException {
  orderId?: string | null;
  transactionId?: string | null;
  reference?: string | null;
  transactionReference?: string | null;
  provider?: string | null;
  serviceType?: string | null;
  status?: string | null;
  transactionStatus?: string | null;
  currency?: string | null;
  amount?: number | string | null;
  expectedAmount?: number | string | null;
  actualAmount?: number | string | null;
  fee?: number | string | null;
  expectedFee?: number | string | null;
  actualFee?: number | string | null;
  margin?: number | string | null;
  targetMasked?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastRequeryAt?: string | null;
  nextRequeryAt?: string | null;
}

export interface AdminVtuReconciliationExceptions {
  amountMismatches: AdminVtuReconciliationException[];
  feeMismatches: AdminVtuReconciliationException[];
  missingDebits: AdminVtuReconciliationException[];
  missingReversals: AdminVtuReconciliationException[];
  staleOrders: AdminVtuReconciliationException[];
}

export interface AdminVtuReconciliationResponse {
  generatedAt: string;
  olderThanMinutes?: number;
  limit?: number;
  summary: AdminVtuReconciliationSummary;
  providerBreakdown: AdminVtuReconciliationBreakdown[];
  statusBreakdown: AdminVtuReconciliationBreakdown[];
  exceptions: AdminVtuReconciliationExceptions;
}

export interface AdminVtuPricingRule {
  id: string;
  countryCode?: string | null;
  serviceType?: string | null;
  provider?: string | null;
  scope?: string | null;
  fixedMargin: number | string;
  percentMargin: number | string;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVtuPricingRulePayload {
  reason: string;
  countryCode?: string;
  serviceType?: string;
  provider?: string;
  scope?: string;
  fixedMargin?: string;
  percentMargin?: string;
  minAmount?: string;
  maxAmount?: string;
  priority?: number;
  isActive?: boolean;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  transactionId?: string | null;
  type: string;
  description: string;
  status: string;
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    id?: string;
    email?: string;
    phone?: string;
    kycStatus?: string;
    kycTier?: string | number | null;
    isSuspended?: boolean;
  };
  transaction?: {
    id: string;
    reference: string;
    type: string;
    amount: number | string;
    currency: string;
    status: string;
    createdAt: string;
  } | null;
}

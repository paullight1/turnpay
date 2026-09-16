import axios from "axios";
import { createClient, isSupabaseConfigured } from "@/lib/supabase";
import { resolveApiOrigin } from "@/lib/api-origin";
import type { Session } from "@supabase/supabase-js";
import {
  createMoneyAttemptIdempotencyKey,
  withIdempotencyKey,
} from "@/lib/idempotency";
import {
  clearSupabaseSession as clearPersistedAuthSession,
  readPersistedSupabaseSession,
  refreshPersistedSupabaseSession,
} from "@/lib/supabase-session";
import type {
  AdminAuditLog,
  AdminVtuProviderHealthResponse,
  AdminVtuPricingRule,
  AdminVtuPricingRulePayload,
  AdminVtuReconciliationResponse,
  AdminVtuRequeryResponse,
  AdminVtuStaleOrdersResponse,
  KycDocument,
  KycStatusOverview,
  KycVerificationResult,
  VirtualAccount,
} from "@/types";
import type {
  InternalTransferReceipt,
  RecipientIdentifier,
  RecipientPreview,
  TransferCurrency,
} from "@/lib/transfer-contract";
export { redactApiDiagnostic } from "@/lib/api-log-redaction";

const API_URL = resolveApiUrl();
type AppSession = Session & {
  authMode?: "supabase" | "local";
};
const AUTH_SESSION_UPDATED_EVENT = "trustpay-auth-session-updated";

function resolveApiUrl() {
  return resolveApiOrigin();
}

function emitAuthSessionUpdated(session: AppSession | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<AppSession | null>(AUTH_SESSION_UPDATED_EVENT, {
      detail: session,
    }),
  );
}

async function getCurrentAuthSession() {
  const persistedSession = await readPersistedSupabaseSession();
  if (persistedSession?.access_token) {
    return persistedSession;
  }

  if (!isSupabaseConfigured) {
    return null;
  }

  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return (session as AppSession | null) ?? persistedSession ?? null;
  } catch {
    return persistedSession ?? null;
  }
}

export const getAuthDeviceName = () => {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  const candidate = [
    navigator.platform,
    navigator.language,
    navigator.userAgent,
  ]
    .filter(Boolean)
    .join(" • ")
    .trim();

  return candidate ? candidate.slice(0, 120) : "Unknown device";
};

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const shouldRefreshForRequest = (url?: string) =>
  !url?.includes("/api/auth/login") &&
  !url?.includes("/api/auth/refresh") &&
  !url?.includes("/api/auth/logout");

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use(async (config) => {
  const session = await getCurrentAuthSession();

  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }

  const method = config.method?.toUpperCase();
  if (
    method &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !config.headers["Idempotency-Key"]
  ) {
    config.headers["Idempotency-Key"] =
      createMoneyAttemptIdempotencyKey("mutation");
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      shouldRefreshForRequest(originalRequest.url)
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshedSession =
          (await refreshPersistedSupabaseSession()) as AppSession | null;

        if (!refreshedSession?.access_token) {
          throw new Error("Unable to refresh session");
        }

        const accessToken = refreshedSession.access_token;
        apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        emitAuthSessionUpdated(refreshedSession);
        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await clearPersistedAuthSession();
        emitAuthSessionUpdated(null);
        if (typeof window !== "undefined") {
          // The interceptor runs outside React, so a hard redirect is required
          // after the server invalidates the session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export const authApi = {
  registerStaff: (data: { email: string; password: string; fullName?: string }, idempotencyKey: string) =>
    apiClient.post("/api/auth/staff/register", data, { headers: { "Idempotency-Key": idempotencyKey } }),
  resendConfirmation: (email: string) =>
    apiClient.post("/api/auth/resend-confirmation", { email }),
  bootstrap: (accessToken?: string) =>
    apiClient.post(
      "/api/auth/bootstrap",
      undefined,
      accessToken
        ? {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        : undefined,
    ),
  login: (email: string, password: string, deviceName?: string) =>
    apiClient.post("/api/auth/login", { email, password, deviceName }),
  refresh: (refreshToken: string, deviceName?: string) =>
    apiClient.post("/api/auth/refresh", { refreshToken, deviceName }),
  register: (data: {
    fullName?: string;
    email: string;
    phone: string;
    password: string;
    transactionPin: string;
    deviceName?: string;
  }) => apiClient.post("/api/auth/register", data),
  forgotPassword: (email: string) =>
    apiClient.post("/api/auth/forgot-password", { email }),
  logout: (refreshToken?: string) =>
    apiClient.post("/api/auth/logout", { refreshToken }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post("/api/auth/change-password", {
      currentPassword,
      newPassword,
    }),
  setTransactionPin: (pin: string, idempotencyKey?: string) =>
    apiClient.post(
      "/api/auth/transaction-pin",
      { pin },
      withIdempotencyKey(idempotencyKey),
    ),
  getTransactionPinStatus: () =>
    apiClient.get<{
      configured: boolean;
      pinLength: number | null;
      resetHoldUntil: string | null;
      locked: boolean;
    }>("/api/auth/transaction-pin/status"),
  verifyTransactionPin: (pin: string, idempotencyKey?: string) =>
    apiClient.post(
      "/api/auth/transaction-pin/verify",
      { pin },
      withIdempotencyKey(idempotencyKey),
    ),
  sessions: () => apiClient.get("/api/auth/sessions"),
  revokeSession: (sessionId: string) =>
    apiClient.delete(`/api/auth/sessions/${sessionId}`),
};

export const userApi = {
  getProfile: () => apiClient.get("/api/users/me"),
  updateProfile: (data: { email?: string; phone?: string }) =>
    apiClient.patch("/api/users/me", data),
};

export const walletApi = {
  getBalances: () => apiClient.get("/api/wallets"),
};

export const transferApi = {
  previewRecipient: (recipient: RecipientIdentifier) =>
    apiClient.post<RecipientPreview>(
      "/api/transfers/recipient/preview",
      recipient,
    ),
  sendInternal: (
    data: RecipientIdentifier & {
      amount: string;
      currency: TransferCurrency;
      note?: string;
      transactionPin: string;
    },
    idempotencyKey: string,
  ) =>
    apiClient.post<InternalTransferReceipt>(
      "/api/transfers/internal",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getByReference: (reference: string) =>
    apiClient.get(`/api/transfers/internal/${encodeURIComponent(reference)}`),
};

export const bankingApi = {
  getVirtualAccounts: () =>
    apiClient.get<VirtualAccount[]>("/api/banking/accounts"),
  provisionVirtualAccount: (
    data: {
      currency: "NGN";
      provider?: "monnify";
      firstName: string;
      lastName: string;
      middleName?: string;
      country?: string;
      bvn?: string;
      nin?: string;
      identityAccountNumber?: string;
      identityBankCode?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post<VirtualAccount>(
      "/api/banking/accounts/provision",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const kycApi = {
  getStatus: () => apiClient.get<KycStatusOverview>("/api/kyc/status"),
  verifyIdentity: (
    data: {
      country: "NG";
      type: "BVN" | "NIN";
      idNumber: string;
      dateOfBirth: string;
      consentAccepted: true;
    },
    idempotencyKey: string,
  ) =>
    apiClient.post<KycVerificationResult>(
      "/api/kyc/verify",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getDocuments: () => apiClient.get<KycDocument[]>("/api/kyc/documents"),
};

export const exchangeApi = {
  getRate: (from: string, to: string) =>
    apiClient.get(
      `/api/exchange/rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createQuote: (data: { from: string; to: string; amount: number }) =>
    apiClient.post("/api/exchange/quote", data),
  executeQuote: (
    quoteId: string,
    idempotencyKey?: string,
    transactionPin?: string,
  ) =>
    apiClient.post(
      "/api/exchange/execute",
      { quoteId, ...(transactionPin && { transactionPin }) },
      withIdempotencyKey(idempotencyKey),
    ),
  createReceiptUploadUrl: (data: {
    fileName: string;
    contentType: string;
    fileSize: number;
  }) => apiClient.post("/api/exchange/receipts/upload-url", data),
  createMonnifyDepositIntent: (
    data: { amount: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/exchange/monnify-deposit-intents",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  submitReceipt: (
    data: {
      amount: string;
      bankReference: string;
      senderName: string;
      senderBankName?: string;
      receiptUrl?: string;
      receiptObjectKey?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/exchange/receipts",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getReceipts: () => apiClient.get("/api/exchange/receipts"),
  getReceiptProofUrl: (receiptId: string) =>
    apiClient.get(`/api/exchange/receipts/${receiptId}/proof-url`),
  createPayout: (
    data: {
      sourceAmount: string;
      destinationBankName: string;
      destinationBankCode?: string;
      destinationAccountNumber: string;
      destinationAccountName: string;
      transactionPin?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/exchange/payouts",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getPayouts: () => apiClient.get("/api/exchange/payouts"),
};

export const adminExchangeApi = {
  getReceipts: (status?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status && status !== "ALL") params.set("status", status);
    return apiClient.get(`/api/admin/exchange/receipts?${params}`);
  },
  reviewReceipt: (
    receiptId: string,
    data: {
      status: "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO";
      reason: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      `/api/admin/exchange/receipts/${receiptId}/review`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getReceiptProofUrl: (receiptId: string) =>
    apiClient.post(`/api/admin/exchange/receipts/${receiptId}/proof-url`, {}),
};

export type ManualExchangeSettlementMode = "WALLET" | "BANK" | "MOMO";

export type ManualExchangeOrderEvent = {
  status: string;
  reason: string;
  createdAt: string;
};

export type AdminManualExchangeOrder = {
  id: string;
  reference: string;
  status: string;
  settlementMode: ManualExchangeSettlementMode;
  sourceCurrency: string;
  targetCurrency: string;
  amount: string;
  targetAmount: string;
  rate: string;
  fee: string;
  collectionAccount: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    currency: string;
    version: string;
  };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  reviewReason: string | null;
  userId: string;
  destinationInstitution: string | null;
  destinationAccountMasked: string | null;
  destinationAccount: string | null;
  destinationName: string | null;
  bankReference: string | null;
  depositReference: string | null;
  payoutReference: string | null;
  payoutClaimedBy: string | null;
  hasProof: boolean;
  hasPayoutProof: boolean;
  events: ManualExchangeOrderEvent[];
};

export type AdminManualExchangeReviewAction =
  | "CREDIT_WALLET"
  | "CONFIRM_DEPOSIT"
  | "REQUEST_INFO"
  | "REJECT"
  | "CLAIM_PAYOUT"
  | "MARK_SENT"
  | "COMPLETE";

export type AdminManualExchangeReviewInput = {
  action: AdminManualExchangeReviewAction;
  reason: string;
  depositReference?: string;
  actualAmount?: string;
  acceptExpiredQuote?: boolean;
  payoutReference?: string;
  payoutProofObjectKey?: string;
};

export type AdminManualExchangeReconciliationRun = {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  checkedCount: number;
  mismatchCount: number;
  mismatchDetails: Array<{ reference: string; code: string }>;
};

export type ManualExchangeUploadRequest = {
  fileName: string;
  contentType: string;
  fileSize: number;
};

export type ManualExchangeUploadResponse = {
  signedUrl: string;
  objectKey: string;
  token: string;
};

export type ManualExchangeProofKind = "DEPOSIT" | "PAYOUT";

export const adminManualExchangeApi = {
  list: (status?: string) => {
    const params = new URLSearchParams();
    if (status && status !== "ALL") params.set("status", status);
    const query = params.toString();
    return apiClient.get<AdminManualExchangeOrder[]>(
      `/api/admin/exchange/manual-orders${query ? `?${query}` : ""}`,
    );
  },
  getReconciliation: () =>
    apiClient.get<AdminManualExchangeReconciliationRun[]>(
      "/api/admin/exchange/manual-orders/reconciliation",
    ),
  review: (
    orderId: string,
    data: AdminManualExchangeReviewInput,
    idempotencyKey: string,
  ) =>
    apiClient.post<AdminManualExchangeOrder>(
      `/api/admin/exchange/manual-orders/${encodeURIComponent(orderId)}/review`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  createUploadUrl: (
    orderId: string,
    data: ManualExchangeUploadRequest,
    idempotencyKey: string,
  ) =>
    apiClient.post<ManualExchangeUploadResponse>(
      `/api/admin/exchange/manual-orders/${encodeURIComponent(orderId)}/upload-url`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getProofUrl: (
    orderId: string,
    kind: ManualExchangeProofKind,
    idempotencyKey: string,
  ) =>
    apiClient.post<{ url: string }>(
      `/api/admin/exchange/manual-orders/${encodeURIComponent(orderId)}/proof-url`,
      { kind },
      withIdempotencyKey(idempotencyKey),
    ),
};

export const adminExchangeRateApi = {
  getRate: (from: string, to: string) =>
    apiClient.get(
      `/api/exchange/rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  updateRate: (
    data: {
      from: string;
      to: string;
      rate: number;
      markup?: number;
      reason?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/exchange/rates",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const adminExchangePayoutApi = {
  getPayouts: (status?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status && status !== "ALL") params.set("status", status);
    return apiClient.get(`/api/admin/exchange/payouts?${params}`);
  },
  getPayoutStats: () => apiClient.get("/api/admin/exchange/payouts/stats"),
  approvePayout: (
    payoutId: string,
    data: { status: "APPROVED" | "REJECTED"; reason: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      `/api/admin/exchange/payouts/${payoutId}/approve`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  markPayoutSent: (
    payoutId: string,
    data: { reason: string; paymentReceiptUrl?: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      `/api/admin/exchange/payouts/${payoutId}/mark-sent`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const adminAuditApi = {
  getLogs: (limit = 50, params?: URLSearchParams) => {
    const query = params ?? new URLSearchParams({ limit: String(limit) });
    if (!query.has("limit")) query.set("limit", String(limit));
    return apiClient.get<AdminAuditLog[]>(`/api/admin/audit-logs?${query}`);
  },
};

export const adminUserApi = {
  updateUser: (
    userId: string,
    data: {
      email?: string;
      phone?: string;
      role?: "USER" | "ADMIN";
      kycStatus?: "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED";
      isSuspended?: boolean;
      reason: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.put(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  suspendUser: (userId: string, reason: string, idempotencyKey?: string) =>
    apiClient.post(
      `/api/admin/users/${encodeURIComponent(userId)}/suspend`,
      { reason },
      withIdempotencyKey(idempotencyKey),
    ),
  unsuspendUser: (userId: string, reason: string, idempotencyKey?: string) =>
    apiClient.post(
      `/api/admin/users/${encodeURIComponent(userId)}/unsuspend`,
      { reason },
      withIdempotencyKey(idempotencyKey),
    ),
  revokeSession: (
    userId: string,
    sessionId: string,
    data: { reason: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      `/api/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export type AdminInternalTransferReversal = {
  id: string;
  originalAttemptId: string;
  originalTransferReference: string;
  reversalReference?: string | null;
  status: "PENDING_APPROVAL" | "COMPLETED" | "REJECTED" | "BLOCKED";
  amount: string | number;
  currency: "NGN" | "GHS";
  senderUserId: string;
  recipientUserId: string;
  requesterAdminId: string;
  approverAdminId?: string | null;
  reviewerAdminId?: string | null;
  requestReason: string;
  reviewReason?: string | null;
  requestedAt: string;
  completedAt?: string | null;
  blockedAt?: string | null;
};

export const adminInternalTransferReversalApi = {
  list: () =>
    apiClient.get<AdminInternalTransferReversal[]>(
      "/api/admin/transfers/internal/reversals",
    ),
  request: (
    reference: string,
    data: { reason: string },
    idempotencyKey: string,
  ) =>
    apiClient.post<AdminInternalTransferReversal>(
      `/api/admin/transfers/internal/${encodeURIComponent(reference)}/reversals`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  approve: (
    reversalId: string,
    data: { reason: string },
    idempotencyKey: string,
  ) =>
    apiClient.post<AdminInternalTransferReversal>(
      `/api/admin/transfers/internal/reversals/${encodeURIComponent(reversalId)}/approve`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  reject: (
    reversalId: string,
    data: { reason: string },
    idempotencyKey: string,
  ) =>
    apiClient.post<AdminInternalTransferReversal>(
      `/api/admin/transfers/internal/reversals/${encodeURIComponent(reversalId)}/reject`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const paymentApi = {
  withdraw: (
    data: {
      amount: string;
      currency: string;
      bankCode: string;
      accountNumber: string;
      accountName: string;
      transactionPin?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/payments/withdraw",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  listBanks: () => apiClient.get("/api/payments/banks"),
  resolveBank: (accountNumber: string, bankCode: string) =>
    apiClient.post("/api/payments/banks/resolve", {
      accountNumber,
      bankCode,
    }),
};

export const vtuApi = {
  getProviders: (type?: string) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    const query = params.toString();
    return apiClient.get(`/api/vtu/providers${query ? `?${query}` : ""}`);
  },
  getPackages: (provider: string) =>
    apiClient.get(`/api/vtu/packages?provider=${encodeURIComponent(provider)}`),
  purchase: (
    data: {
      type: string;
      provider: string;
      contactPhone: string;
      recipientNumber?: string;
      amount: string;
      packageId?: string;
      smartCardNumber?: string;
      subscriptionType?: "change" | "renew";
      meterNumber?: string;
      meterType?: "prepaid" | "postpaid";
      transactionPin?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/vtu/purchase",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getOrderStatus: (reference: string) =>
    apiClient.get(`/api/vtu/orders/${encodeURIComponent(reference)}`),
  requeryOrder: (reference: string, idempotencyKey?: string) =>
    apiClient.post(
      `/api/vtu/orders/${encodeURIComponent(reference)}/requery`,
      {},
      withIdempotencyKey(idempotencyKey),
    ),
  validateSmartCard: (
    data: {
      provider: string;
      smartCardNumber: string;
      subscriptionType: "change" | "renew";
      contactPhone: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/vtu/validate/smartcard",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  validateMeter: (
    data: {
      provider: string;
      meterNumber: string;
      meterType: "prepaid" | "postpaid";
      contactPhone: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/vtu/validate/meter",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const adminVtuApi = {
  getProviderHealth: () =>
    apiClient.get<AdminVtuProviderHealthResponse>(
      "/api/admin/vtu/providers/health",
    ),
  getReconciliation: (options?: {
    olderThanMinutes?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams({
      olderThanMinutes: String(options?.olderThanMinutes ?? 10),
      limit: String(options?.limit ?? 50),
    });

    return apiClient.get<AdminVtuReconciliationResponse>(
      `/api/admin/vtu/reconciliation?${params}`,
    );
  },
  getStaleOrders: (options?: { olderThanMinutes?: number; limit?: number }) => {
    const params = new URLSearchParams({
      olderThanMinutes: String(options?.olderThanMinutes ?? 10),
      limit: String(options?.limit ?? 50),
    });

    return apiClient.get<AdminVtuStaleOrdersResponse>(
      `/api/admin/vtu/orders/stale?${params}`,
    );
  },
  requeryOrder: (
    reference: string,
    data: { reason: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post<AdminVtuRequeryResponse>(
      `/api/admin/vtu/orders/${encodeURIComponent(reference)}/requery`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  getPricingRules: (options?: {
    countryCode?: string;
    serviceType?: string;
    provider?: string;
    scope?: string;
    isActive?: boolean;
    limit?: number;
  }) => {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 50),
    });
    if (options?.countryCode) params.set("countryCode", options.countryCode);
    if (options?.serviceType) params.set("serviceType", options.serviceType);
    if (options?.provider) params.set("provider", options.provider);
    if (options?.scope) params.set("scope", options.scope);
    if (options?.isActive !== undefined) {
      params.set("isActive", String(options.isActive));
    }

    return apiClient.get<AdminVtuPricingRule[]>(
      `/api/admin/vtu/pricing-rules?${params}`,
    );
  },
  createPricingRule: (
    data: AdminVtuPricingRulePayload,
    idempotencyKey?: string,
  ) =>
    apiClient.post<AdminVtuPricingRule>(
      "/api/admin/vtu/pricing-rules",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  updatePricingRule: (
    ruleId: string,
    data: AdminVtuPricingRulePayload,
    idempotencyKey?: string,
  ) =>
    apiClient.put<AdminVtuPricingRule>(
      `/api/admin/vtu/pricing-rules/${encodeURIComponent(ruleId)}`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  deactivatePricingRule: (
    ruleId: string,
    data: { reason: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post<AdminVtuPricingRule>(
      `/api/admin/vtu/pricing-rules/${encodeURIComponent(ruleId)}/deactivate`,
      data,
      withIdempotencyKey(idempotencyKey),
    ),
};

export const transactionApi = {
  getTransactions: (page = 1, limit = 20, status?: string, type?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(status && { status }),
      ...(type && { type }),
    });
    return apiClient.get(`/api/transactions?${params}`);
  },
};

export const supportApi = {
  createTicket: (data: {
    category: string;
    description: string;
    transactionReference?: string;
  }) => apiClient.post("/api/support/tickets", data),
  getTickets: (page = 1, limit = 20, status?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(status && { status }),
    });
    return apiClient.get(`/api/support/tickets?${params}`);
  },
  getAdminTickets: (page = 1, limit = 20, status?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(status && { status }),
    });
    return apiClient.get(`/api/admin/support/tickets?${params}`);
  },
  resolveAdminTicket: (
    ticketId: string,
    data: {
      status: "RESOLVED" | "CLOSED" | "ESCALATED";
      resolution?: string;
      reason: string;
    },
  ) => apiClient.put(`/api/admin/support/tickets/${ticketId}/resolve`, data),
};

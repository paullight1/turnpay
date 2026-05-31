import axios from "axios";
import { createClient } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import {
  createMoneyAttemptIdempotencyKey,
  withIdempotencyKey,
} from "@/lib/idempotency";
import type {
  AdminVtuProviderHealthResponse,
  AdminVtuPricingRule,
  AdminVtuPricingRulePayload,
  AdminVtuReconciliationResponse,
  AdminVtuRequeryResponse,
  AdminVtuStaleOrdersResponse,
  VirtualAccount,
} from "@/types";

const API_URL = resolveApiUrl();

function resolveApiUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    if (
      typeof window !== "undefined" &&
      process.env.NODE_ENV === "production" &&
      !configured.startsWith("https://") &&
      !isLocalHttpUrl(configured)
    ) {
      throw new Error(
        "NEXT_PUBLIC_API_URL must be HTTPS outside localhost in production",
      );
    }
    return configured;
  }

  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL is required in production");
  }

  return "http://localhost:3000";
}

function isLocalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
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

type RefreshSessionResponse = {
  session: Session;
};

const refreshSessionWithBackend = async (
  refreshToken: string,
  deviceName?: string,
) => {
  const supabase = createClient();
  const { data } = await axios.post<RefreshSessionResponse>(
    `${API_URL}/api/auth/refresh`,
    { refreshToken, deviceName },
    {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": createMoneyAttemptIdempotencyKey("mutation"),
      },
      timeout: 30000,
    },
  );

  if (!data.session?.access_token || !data.session.refresh_token) {
    throw new Error("Invalid refresh response");
  }

  const { data: sessionData, error } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (error) {
    throw error;
  }

  return sessionData.session ?? data.session;
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
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

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

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.refresh_token) {
        const refreshError = new Error("Missing refresh token");
        isRefreshing = false;
        processQueue(refreshError, null);
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      }

      try {
        const refreshedSession = await refreshSessionWithBackend(
          session.refresh_token,
          getAuthDeviceName(),
        );
        const accessToken = refreshedSession.access_token;
        apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        if (typeof window !== "undefined") {
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
  bootstrap: () => apiClient.post("/api/auth/bootstrap"),
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
  setTransactionPin: (pin: string) =>
    apiClient.post("/api/auth/transaction-pin", { pin }),
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
  createDocumentUploadUrl: (data: {
    fileName: string;
    contentType: string;
    fileSize: number;
  }) => apiClient.post("/api/kyc/document-upload-url", data),
  submit: (data: {
    type: string;
    idNumber: string;
    documentObjectKey: string;
  }) => apiClient.post("/api/kyc/submit", data),
  getDocuments: () => apiClient.get("/api/kyc/documents"),
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

export const adminExchangePayoutApi = {
  getPayouts: (status?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status && status !== "ALL") params.set("status", status);
    return apiClient.get(`/api/admin/exchange/payouts?${params}`);
  },
  getPayoutStats: () =>
    apiClient.get("/api/admin/exchange/payouts/stats"),
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

export const paymentApi = {
  fundWallet: (
    data: {
      amount: number;
      currency: string;
      channel?: string;
      provider?: string;
      email?: string;
    },
    idempotencyKey?: string,
  ) =>
    apiClient.post(
      "/api/payments/fund",
      data,
      withIdempotencyKey(idempotencyKey),
    ),
  withdraw: (
    data: {
      amount: number;
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
  getProviders: (
    type?: string,
    options?: { scope?: string; countryCode?: string },
  ) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (options?.scope) params.set("scope", options.scope);
    if (options?.countryCode) params.set("countryCode", options.countryCode);
    const query = params.toString();
    return apiClient.get(`/api/vtu/providers${query ? `?${query}` : ""}`);
  },
  getPackages: (provider: string) =>
    apiClient.get(`/api/vtu/packages?provider=${encodeURIComponent(provider)}`),
  purchase: (
    data: {
      type: string;
      provider?: string;
      scope?: string;
      countryCode?: string;
      operatorId?: string;
      recipientNumber?: string;
      amount: number;
      packageId?: string;
      smartCardNumber?: string;
      meterNumber?: string;
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
  validateSmartCard: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/smartcard?provider=${encodeURIComponent(provider)}&number=${encodeURIComponent(number)}`,
    ),
  validateMeter: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/meter?provider=${encodeURIComponent(provider)}&number=${encodeURIComponent(number)}`,
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

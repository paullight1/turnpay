import axios from "axios";
import { createClient } from "@/lib/supabase";
import { createMoneyAttemptIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";

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
      throw new Error("NEXT_PUBLIC_API_URL must be HTTPS outside localhost in production");
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
    config.headers["Idempotency-Key"] = createMoneyAttemptIdempotencyKey("mutation");
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
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
        error: refreshError,
      } = await supabase.auth.refreshSession();

      if (refreshError || !session) {
        processQueue(refreshError, null);
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      }

      const accessToken = session.access_token;
      apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
      processQueue(null, accessToken);

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(originalRequest);
    }

    return Promise.reject(error);
  },
);

export const authApi = {
  bootstrap: () => apiClient.post("/api/auth/bootstrap"),
  login: (email: string, password: string) =>
    apiClient.post("/api/auth/login", { email, password }),
  register: (email: string, phone: string, password: string) =>
    apiClient.post("/api/auth/register", { email, phone, password }),
  forgotPassword: (email: string) =>
    apiClient.post("/api/auth/forgot-password", { email }),
  logout: () => apiClient.post("/api/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post("/api/auth/change-password", {
      currentPassword,
      newPassword,
    }),
};

export const userApi = {
  getProfile: () => apiClient.get("/api/users/me"),
  updateProfile: (data: { email?: string; phone?: string }) =>
    apiClient.patch("/api/users/me", data),
};

export const walletApi = {
  getBalances: () => apiClient.get("/api/wallets"),
};

export const exchangeApi = {
  getRate: (from: string, to: string) =>
    apiClient.get(
      `/api/exchange/rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createQuote: (data: { from: string; to: string; amount: number }) =>
    apiClient.post("/api/exchange/quote", data),
  executeQuote: (quoteId: string, idempotencyKey?: string) =>
    apiClient.post(
      "/api/exchange/execute",
      { quoteId },
      withIdempotencyKey(idempotencyKey),
    ),
};

export const paymentApi = {
  fundWallet: (data: {
    amount: number;
    currency: string;
    channel?: string;
    provider?: string;
    email?: string;
  }, idempotencyKey?: string) =>
    apiClient.post("/api/payments/fund", data, withIdempotencyKey(idempotencyKey)),
  withdraw: (data: {
    amount: number;
    currency: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  }, idempotencyKey?: string) =>
    apiClient.post("/api/payments/withdraw", data, withIdempotencyKey(idempotencyKey)),
  listBanks: () => apiClient.get("/api/payments/banks"),
  resolveBank: (accountNumber: string, bankCode: string) =>
    apiClient.post("/api/payments/banks/resolve", {
      accountNumber,
      bankCode,
    }),
};

export const vtuApi = {
  getProviders: (type?: string) =>
    apiClient.get(
      `/api/vtu/providers${type ? `?type=${encodeURIComponent(type)}` : ""}`,
    ),
  getPackages: (provider: string) =>
    apiClient.get(`/api/vtu/packages?provider=${encodeURIComponent(provider)}`),
  purchase: (data: {
    type: string;
    provider: string;
    recipientNumber: string;
    amount: number;
    packageId?: string;
    smartCardNumber?: string;
    meterNumber?: string;
  }, idempotencyKey?: string) =>
    apiClient.post("/api/vtu/purchase", data, withIdempotencyKey(idempotencyKey)),
  validateSmartCard: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/smartcard?provider=${encodeURIComponent(provider)}&number=${encodeURIComponent(number)}`,
    ),
  validateMeter: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/meter?provider=${encodeURIComponent(provider)}&number=${encodeURIComponent(number)}`,
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

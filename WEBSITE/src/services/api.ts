import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("auth_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
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

      const refreshToken = localStorage.getItem("refresh_token");

      if (!refreshToken) {
        clearAuth();
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(
          `${API_URL}/api/auth/refresh`,
          {},
          {
            headers: { Authorization: `Bearer ${refreshToken}` },
          }
        );

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        localStorage.setItem("auth_token", accessToken);
        if (newRefreshToken) {
          localStorage.setItem("refresh_token", newRefreshToken);
        }

        apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearAuth();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

function clearAuth() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    window.location.href = "/login";
  }
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post("/api/auth/login", { email, password }),
  register: (email: string, phone: string, password: string) =>
    apiClient.post("/api/auth/register", { email, phone, password }),
  refresh: (refreshToken: string) =>
    apiClient.post("/api/auth/refresh", null, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    }),
  logout: (refreshToken: string) =>
    apiClient.post("/api/auth/logout", { refreshToken }),
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
    apiClient.get(`/api/exchange/rate?from=${from}&to=${to}`),
  createQuote: (data: { from: string; to: string; amount: number }) =>
    apiClient.post("/api/exchange/quote", data),
  executeQuote: (quoteId: string) =>
    apiClient.post("/api/exchange/execute", { quoteId }),
};

export const paymentApi = {
  fundWallet: (data: {
    amount: number;
    currency: string;
    channel?: string;
    provider?: string;
    email?: string;
  }) => apiClient.post("/api/payments/fund", data),
  withdraw: (data: {
    amount: number;
    currency: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  }) => apiClient.post("/api/payments/withdraw", data),
  listBanks: () => apiClient.get("/api/payments/banks"),
  resolveBank: (accountNumber: string, bankCode: string) =>
    apiClient.post("/api/payments/banks/resolve", {
      accountNumber,
      bankCode,
    }),
};

export const vtuApi = {
  getProviders: (type?: string) =>
    apiClient.get(`/api/vtu/providers${type ? `?type=${type}` : ""}`),
  getPackages: (provider: string) =>
    apiClient.get(`/api/vtu/packages?provider=${provider}`),
  purchase: (data: {
    type: string;
    provider: string;
    recipientNumber: string;
    amount: number;
    packageId?: string;
    smartCardNumber?: string;
    meterNumber?: string;
  }) => apiClient.post("/api/vtu/purchase", data),
  validateSmartCard: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/smartcard?provider=${provider}&number=${number}`
    ),
  validateMeter: (provider: string, number: string) =>
    apiClient.post(
      `/api/vtu/validate/meter?provider=${provider}&number=${number}`
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

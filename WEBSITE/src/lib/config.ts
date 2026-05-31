const env = {
  apiUrl: resolveApiUrl(),
  manualExchangeAccount: {
    bankName: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME || "",
    accountName: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME || "",
    accountNumber: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER || "",
  },
};

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

  if (process.env.NODE_ENV === "production") {
    return "";
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

export const config = {
  api: {
    baseUrl: env.apiUrl,
    timeout: 30000,
  },
  manualExchangeAccount: env.manualExchangeAccount,
} as const;

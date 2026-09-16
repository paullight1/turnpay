import { resolveApiOrigin } from "@/lib/api-origin";

const env = {
  apiUrl: resolveApiOrigin(),
  manualExchangeAccount: {
    bankName: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_BANK_NAME || "",
    accountName: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NAME || "",
    accountNumber: process.env.NEXT_PUBLIC_MANUAL_EXCHANGE_ACCOUNT_NUMBER || "",
  },
};

export const config = {
  api: {
    baseUrl: env.apiUrl,
    timeout: 30000,
  },
  manualExchangeAccount: env.manualExchangeAccount,
} as const;

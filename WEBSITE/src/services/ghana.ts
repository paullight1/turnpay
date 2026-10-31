import { apiClient } from "./api";
import {
  createManualExchangeIdempotencyKey,
  withIdempotencyKey,
} from "@/lib/idempotency";
export type ProviderExchangeQuote = {
  id: string;
  sourceCurrency: "NGN" | "GHS";
  targetCurrency: "NGN" | "GHS";
  fundingSource: "WALLET" | "EXTERNAL";
  amount: string;
  fee: string;
  total: string;
  rate: string;
  targetAmount: string;
  destinationName: string;
  destinationMasked: string;
  destinationType: "BANK" | "MOMO";
  destinationCode: string;
  expiresAt: string;
};
export type ProviderExchangeOrder = {
  id: string;
  reference: string;
  status: string;
  fundedAt: string | null;
  payoutReference: string | null;
  reason: string | null;
  createdAt: string;
  quote: ProviderExchangeQuote;
};
export type KoraReadiness = {
  enabled: boolean;
  configured: boolean;
  activationStatus: string;
  availableBalance?: string;
  message?: string;
  virtualAccounts: boolean;
  momoCollections: boolean;
  momoPayouts: boolean;
  useCaseApproved: boolean;
};
export const providerAdminApi = {
  orders: (status = "READY", cursor?: string) =>
    apiClient.get<{
      items: ProviderExchangeOrder[];
      nextCursor: string | null;
      counts: Record<string, number>;
    }>("/api/admin/exchange/provider/orders", {
      params: { status, ...(cursor ? { cursor } : {}) },
    }),
  notifications: () =>
    apiClient.get<
      Array<{
        id: string;
        orderId: string;
        title: string;
        createdAt: string;
        readAt: string | null;
      }>
    >("/api/admin/exchange/provider/notifications"),
  readNotification: (id: string) =>
    apiClient.post(
      `/api/admin/exchange/provider/notifications/${id}/read`,
      {},
      withIdempotencyKey(createManualExchangeIdempotencyKey()),
    ),
  send: (id: string, reason: string, key: string, honorExpiredQuote = false) =>
    apiClient.post(
      `/api/admin/exchange/provider/orders/${id}/send`,
      { reason, honorExpiredQuote },
      withIdempotencyKey(key),
    ),
  refresh: (id: string) =>
    apiClient.post(
      `/api/admin/exchange/provider/orders/${id}/refresh`,
      {},
      withIdempotencyKey(createManualExchangeIdempotencyKey()),
    ),
  readiness: () =>
    apiClient.get<KoraReadiness>("/api/admin/payments/kora/readiness"),
};
export function providerMoney(value: string, currency: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return `${currency} unavailable`;
  const [whole, fraction = ""] = value.split(".");
  return `${currency === "GHS" ? "₵" : "₦"}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
export const providerStatus: Record<string, string> = {
  AWAITING_PAYMENT: "Waiting for payment",
  READY: "Ready to send",
  PROCESSING: "Sending",
  SENT: "Sent",
  NEEDS_REVIEW: "Needs attention",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

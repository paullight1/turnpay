export function isDepositReviewStatus(status: string) {
  return status === "AWAITING_CONFIRMATION" || status === "NEEDS_MORE_INFO";
}

export function manualExchangeRequestHref(orderId: string) {
  return `/admin/exchange/manual-orders?orderId=${encodeURIComponent(orderId)}`;
}

"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { z } from "zod";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-provider";
import { hasAdminAccess } from "@/lib/admin-access";
import { getErrorMessage } from "@/lib/errors";
import { createManualExchangeIdempotencyKey } from "@/lib/idempotency";
import {
  providerAdminApi,
  providerMoney,
  providerStatus,
  type ProviderExchangeOrder,
} from "@/services/ghana";

export default function ProviderExchangeQueue() {
  const { profile } = useAuth();
  const allowed = hasAdminAccess(profile);
  const client = useQueryClient();
  const [filter, setFilter] = useState("READY");
  const [selected, setSelected] = useState<ProviderExchangeOrder | null>(null);
  const [reason, setReason] = useState("");
  const [honor, setHonor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const [attempt, setAttempt] = useState<{
    id: string;
    key: string;
    reason: string;
    honor: boolean;
  } | null>(null);
  const orders = useInfiniteQuery({
    queryKey: ["provider-exchange-orders", profile?.id, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await providerAdminApi.orders(filter, pageParam)).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const notifications = useQuery({
    queryKey: ["provider-exchange-notifications", profile?.id],
    queryFn: async () => (await providerAdminApi.notifications()).data,
    enabled: allowed,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const readiness = useQuery({
    queryKey: ["kora-readiness", profile?.id],
    queryFn: async () => (await providerAdminApi.readiness()).data,
    enabled: allowed,
    staleTime: 60000,
  });
  const all = orders.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = orders.data?.pages[0]?.counts ?? {};
  const visible =
    filter === "ALL" ? all : all.filter((order) => order.status === filter);
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["provider-exchange-orders"] });
    await client.invalidateQueries({
      queryKey: ["provider-exchange-notifications"],
    });
  }
  async function send() {
    if (!selected || inFlight.current) return;
    const parsed = z
      .string()
      .trim()
      .min(10, "Add a payment note of at least 10 characters.")
      .max(500)
      .safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    const key =
      attempt?.id === selected.id
        ? attempt.key
        : createManualExchangeIdempotencyKey();
    setAttempt({ id: selected.id, key, reason: parsed.data, honor });
    try {
      await providerAdminApi.send(selected.id, parsed.data, key, honor);
      setAttempt(null);
      setSelected(null);
      setFilter("PROCESSING");
      await refresh();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Payment confirmation is unavailable. Refresh this order before trying again.",
        ),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <DashboardLayout>
        <p className="p-6">Admin access is required.</p>
      </DashboardLayout>
    );
  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-muted-foreground">
              Ghana · Nigeria
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Exchange payments
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Source payments are checked automatically. Review the recipient,
              then send.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            ["READY", "Ready to send", CheckCircle2],
            ["PROCESSING", "Sending", Clock3],
            ["NEEDS_REVIEW", "Needs attention", Bell],
          ].map(([status, label, Icon]) => {
            const Glyph = Icon as typeof Bell;
            return (
              <button
                key={String(status)}
                onClick={() => setFilter(String(status))}
                className={`rounded-xl border p-3 sm:p-5 text-left transition-colors hover:bg-muted/40 ${filter === status ? "border-primary bg-primary/5" : ""}`}
              >
                <Glyph className="mb-3 size-5 text-muted-foreground" />
                <span className="block text-3xl font-bold tabular-nums">
                  {counts[String(status)] ?? 0}
                </span>
                <span className="text-xs font-medium sm:text-sm">
                  {String(label)}
                </span>
              </button>
            );
          })}
        </div>
        {readiness.data && !readiness.data.enabled && (
          <div className="rounded-xl border bg-muted/30 p-4 text-sm">
            <ShieldCheck className="mb-2 size-5" />
            <p className="font-semibold">Ghana payments await activation</p>
            <p className="mt-1 text-muted-foreground">
              Complete Kora onboarding and product setup before enabling new
              cedi payments.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["READY", "Ready"],
            ["AWAITING_PAYMENT", "Waiting for payment"],
            ["PROCESSING", "Sending"],
            ["NEEDS_REVIEW", "Needs attention"],
            ["SENT", "Sent"],
            ["ALL", "All"],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
          <Link
            href="/admin/exchange/manual-orders"
            className="ml-auto text-sm underline underline-offset-4"
          >
            Earlier manual orders
          </Link>
        </div>
        {orders.isPending && (
          <div className="flex gap-2 rounded-xl border p-8">
            <Loader2 className="size-5 animate-spin" />
            Loading exchange payments…
          </div>
        )}
        {orders.isError && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 p-5"
          >
            <p>Exchange payments could not load.</p>
            <Button className="mt-3" onClick={() => void orders.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!orders.isPending && !orders.isError && visible.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-semibold">No payments in this queue</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirmed payments will appear here automatically.
            </p>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((order) => (
            <Card key={order.id} className="gap-4 overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant={order.status === "SENT" ? "default" : "outline"}
                  >
                    {providerStatus[order.status] ?? "Checking status"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {order.quote.sourceCurrency} → {order.quote.targetCurrency}
                  </span>
                </div>
                <CardTitle className="mt-3 break-words text-3xl tabular-nums">
                  {providerMoney(
                    order.quote.targetAmount,
                    order.quote.targetCurrency,
                  )}
                </CardTitle>
                <p className="break-words text-sm font-medium">
                  {order.quote.destinationName}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {order.quote.destinationMasked}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <p className="flex items-center gap-2">
                    <ArrowDownLeft className="size-4" />
                    {providerMoney(
                      order.quote.total,
                      order.quote.sourceCurrency,
                    )}{" "}
                    · {order.fundedAt ? "Money confirmed" : "Not yet confirmed"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {order.quote.fundingSource === "WALLET"
                      ? "Paid from TrustPay balance"
                      : "External payment"}{" "}
                    · {order.reference}
                  </p>
                </div>
                {order.status === "NEEDS_REVIEW" && (
                  <p className="text-sm">
                    Check the payment and original quote before release.
                    Confirmed funds remain owed to the customer.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {["READY", "NEEDS_REVIEW"].includes(order.status) &&
                    order.fundedAt &&
                    !order.payoutReference && (
                      <Button
                        onClick={() => {
                          setSelected(order);
                          setReason(
                            attempt?.id === order.id ? attempt.reason : "",
                          );
                          setHonor(
                            attempt?.id === order.id ? attempt.honor : false,
                          );
                          setError("");
                        }}
                      >
                        <ArrowUpRight className="size-4" />
                        Send{" "}
                        {order.quote.targetCurrency === "NGN"
                          ? "naira"
                          : "cedis"}
                      </Button>
                    )}
                  {order.payoutReference && order.status !== "SENT" && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          await providerAdminApi.refresh(order.id);
                          await refresh();
                        } catch (err) {
                          setError(
                            getErrorMessage(
                              err,
                              "Confirmation is still pending.",
                            ),
                          );
                        }
                      }}
                    >
                      Check payment status
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {orders.hasNextPage && (
          <Button
            variant="outline"
            disabled={orders.isFetchingNextPage}
            onClick={() => void orders.fetchNextPage()}
          >
            Load more payments
          </Button>
        )}
        {error && !selected && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 p-4 text-sm"
          >
            {error}
          </p>
        )}
        {!!notifications.data?.length && (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Recent payment notifications ({notifications.data.length})
            </summary>
            <ul className="mt-4 space-y-3">
              {notifications.data.slice(0, 10).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>{item.title}</span>
                  {item.readAt ? (
                    <span className="text-xs text-muted-foreground">Read</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await providerAdminApi.readNotification(item.id);
                          await refresh();
                        } catch (err) {
                          setError(
                            getErrorMessage(
                              err,
                              "Could not mark the notification as read.",
                            ),
                          );
                        }
                      }}
                    >
                      Mark read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Dialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open && !busy) setSelected(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Review this payout</DialogTitle>
              <DialogDescription>
                Check the amount and recipient before sending.
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <>
                <p className="text-3xl font-bold">
                  {providerMoney(
                    selected.quote.targetAmount,
                    selected.quote.targetCurrency,
                  )}
                </p>
                <p className="font-semibold">
                  {selected.quote.destinationName}
                </p>
                <p className="font-mono text-sm">
                  {selected.quote.destinationMasked}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="payment-note">Payment note</Label>
                  <Input
                    id="payment-note"
                    value={reason}
                    disabled={busy || attempt?.id === selected.id}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                </div>
                {selected.status === "NEEDS_REVIEW" && (
                  <label className="flex gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={honor}
                      disabled={busy || attempt?.id === selected.id}
                      onChange={(event) => setHonor(event.target.checked)}
                    />
                    Honor the original quoted amount and rate after checking the
                    confirmed payment.
                  </label>
                )}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  onClick={() => void send()}
                  disabled={
                    busy || (selected.status === "NEEDS_REVIEW" && !honor)
                  }
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Confirm and send
                </Button>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

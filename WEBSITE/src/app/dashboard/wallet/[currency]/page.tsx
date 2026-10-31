"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  ReceiptText,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { bankingApi, transactionApi, walletApi } from "@/services/api";
import { getMoneyActionGate } from "@/lib/account-status";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth-provider";
import type { Transaction, VirtualAccount, Wallet } from "@/types";

type WalletCurrency = "NGN" | "GHS";

function resolveCurrency(value: string | string[] | undefined): WalletCurrency {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.toUpperCase() === "GHS" ? "GHS" : "NGN";
}

function formatMoney(value?: number | string) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string) {
  if (!value) return "No recent update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent update";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function accountStatusVariant(status?: string) {
  if (status === "ACTIVE") return "default";
  if (status === "FAILED" || status === "DISABLED") return "destructive";
  return "secondary";
}

function TransactionIcon({ type }: { type: string }) {
  if (type === "EXCHANGE") return <ArrowLeftRight className="size-4" />;
  if (type === "FUND") return <Banknote className="size-4" />;
  if (type === "WITHDRAW") return <Landmark className="size-4" />;
  return <Smartphone className="size-4" />;
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const statusColors: Record<string, string> = {
    SUCCESS: "border-emerald-500/25 bg-emerald-50 text-emerald-700",
    PENDING: "border-amber-500/25 bg-amber-50 text-amber-700",
    FAILED: "border-rose-500/25 bg-rose-50 text-rose-700",
    REVERSED: "border-sky-500/25 bg-sky-50 text-sky-700",
  };

  return (
    <div className="grid gap-3 border-b border-slate-200 py-3 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
          <TransactionIcon type={tx.type} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium capitalize text-slate-950">
            {tx.type.toLowerCase()}
          </p>
          <p className="truncate text-xs text-slate-500">{tx.reference}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <p className="text-sm font-semibold tabular-nums text-slate-950">
          {tx.currency} {formatMoney(tx.amount)}
        </p>
        <Badge
          variant="secondary"
          className={`border text-xs ${statusColors[tx.status] || "bg-white text-slate-600"}`}
        >
          {tx.status}
        </Badge>
      </div>
    </div>
  );
}

function LightError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-rose-700">{message}</p>
          </div>
        </div>
        <Button variant="outline" onClick={onRetry} className="bg-white sm:w-fit">
          <RefreshCw aria-hidden="true" className="size-4" />
          Retry
        </Button>
      </div>
    </div>
  );
}

export default function WalletDetailPage() {
  const { user, profile } = useAuth();
  const params = useParams<{ currency?: string }>();
  const currency = resolveCurrency(params.currency);
  const moneyGate = getMoneyActionGate(profile);
  const sendHref = moneyGate?.actionHref ?? "/dashboard/send";
  const receiveHref = moneyGate?.actionHref ?? "/dashboard/fund";

  const walletsQuery = useQuery({
    queryKey: ["wallets", user?.id],
    queryFn: async () => {
      const res = await walletApi.getBalances();
      return res.data as Wallet[];
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const accountsQuery = useQuery({
    queryKey: ["virtual-accounts", user?.id],
    queryFn: async () => {
      const response = await bankingApi.getVirtualAccounts();
      return response.data as VirtualAccount[];
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const provisioningQuery = useQuery({
    queryKey: ["virtual-account-provisioning", user?.id],
    queryFn: async () => (await bankingApi.getProvisioningStatus()).data,
    enabled: !!user && currency === "NGN",
    staleTime: 15_000,
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", user?.id, currency, "wallet-detail"],
    queryFn: async () => {
      const response = await transactionApi.getTransactions(1, 20);
      return response.data as { transactions: Transaction[]; total: number };
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const wallet = walletsQuery.data?.find((item) => item.currency === currency);
  const account = accountsQuery.data?.find(
    (item) =>
      item.currency === currency &&
      (currency !== "NGN" || item.provider?.toUpperCase() === "PAYSTACK") &&
      (currency !== "NGN" || item.status?.toUpperCase() === "ACTIVE") &&
      Boolean(item.accountNumber || item.accountNumberMasked),
  );
  const provisioningPending =
    currency === "NGN" &&
    (provisioningQuery.data?.status?.toUpperCase() === "PENDING" ||
      accountsQuery.data?.some(
        (item) =>
          item.currency === "NGN" &&
          item.provider?.toUpperCase() === "PAYSTACK" &&
          item.status?.toUpperCase() === "PENDING" &&
          !item.accountNumber &&
          !item.accountNumberMasked,
      ) === true);
  const provisioningActionRequired =
    currency === "NGN" &&
    provisioningQuery.data?.status?.toUpperCase() === "ACTION_REQUIRED";
  const walletTransactions = useMemo(
    () =>
      transactionsQuery.data?.transactions?.filter(
        (transaction) => transaction.currency === currency,
      ) ?? [],
    [currency, transactionsQuery.data?.transactions],
  );
  const displayAccountNumber =
    account?.accountNumber ?? account?.accountNumberMasked ?? "Account not ready";

  const copyAccountNumber = async () => {
    const accountNumber = account?.accountNumber ?? account?.accountNumberMasked;
    if (!accountNumber) {
      toast.error("Account number is not available yet.");
      return;
    }

    await navigator.clipboard.writeText(accountNumber);
    toast.success("Account number copied.");
  };

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
              <Link href="/dashboard">
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back
              </Link>
            </Button>
            <h1 className="text-3xl font-bold">{currency} wallet</h1>
            <p className="mt-1 text-muted-foreground">
              Account details first, then wallet history below.
            </p>
          </div>
          <Badge
            variant={
              provisioningActionRequired || provisioningPending
                ? "secondary"
                : account
                  ? accountStatusVariant(account.status)
                  : "secondary"
            }
          >
            {provisioningActionRequired
              ? "ACTION REQUIRED"
              : provisioningPending
                ? "PENDING"
                : account
                  ? account.status
                  : "No account yet"}
          </Badge>
        </div>

        <Card className="border-slate-200 bg-[linear-gradient(135deg,#ffffff,#f8fafc_55%,#ecfdf5)] text-slate-950 shadow-sm ring-slate-200">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base text-slate-700">
                Available balance
              </CardTitle>
              {walletsQuery.isLoading ? (
                <Skeleton className="mt-3 h-9 w-48 bg-slate-200" />
              ) : (
                <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-950">
                  {currency} {formatMoney(wallet?.balance)}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Updated {formatDate(wallet?.updatedAt)}
              </p>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
              <Button
                asChild
                className="bg-slate-950 text-white hover:bg-slate-800"
              >
                <Link href={sendHref}>
                  <Send aria-hidden="true" className="size-4" />
                  Send Money
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
              >
                <Link href={receiveHref}>
                  <ArrowDownToLine aria-hidden="true" className="size-4" />
                  Receive Money
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {walletsQuery.isError && (
              <LightError
                title="Wallet balance could not load"
                message={getErrorMessage(
                  walletsQuery.error,
                  "Retry before starting a money action.",
                )}
                onRetry={() => void walletsQuery.refetch()}
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white text-slate-950 shadow-sm ring-slate-200">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base text-slate-700">
                Receiving account
              </CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Use this account number for wallet deposits.
              </p>
            </div>
            {account && (
              <Button variant="outline" onClick={copyAccountNumber}>
                <Copy aria-hidden="true" className="size-4" />
                Copy
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {accountsQuery.isLoading ? (
              <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading account
              </div>
            ) : accountsQuery.isError ? (
              <LightError
                title="Account details could not load"
                message={getErrorMessage(
                  accountsQuery.error,
                  "Retry to view your receiving account.",
                )}
                onRetry={() => void accountsQuery.refetch()}
              />
            ) : provisioningActionRequired ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-amber-950">
                <AlertCircle className="mx-auto size-6 text-amber-700" />
                <p className="mt-3 font-medium">Paystack account setup needs attention</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-amber-800">
                  {provisioningQuery.data?.message ??
                    "Review your verification details and retry account setup, or contact support."}
                </p>
                <Button asChild className="mt-4">
                  <Link href="/dashboard/fund">Review and retry setup</Link>
                </Button>
              </div>
            ) : provisioningPending ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center text-amber-950">
                <Loader2 className="mx-auto size-6 animate-spin" />
                <p className="mt-3 font-medium">Paystack is preparing your NGN account</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-amber-800">
                  Your request was accepted. Refresh shortly; the account number
                  appears only after server confirmation.
                </p>
                <Button variant="outline" className="mt-4" onClick={() => void provisioningQuery.refetch()}>
                  <RefreshCw aria-hidden="true" className="size-4" />
                  Refresh status
                </Button>
              </div>
            ) : account ? (
              <div className="grid gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Account number
                  </p>
                  <p className="mt-2 break-all text-3xl font-black tracking-wide text-slate-950 sm:text-4xl">
                    {displayAccountNumber}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Account name</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900">
                      {account.accountName}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Bank</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {account.bankName}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                  <ReceiptText className="size-6" />
                </div>
                <p className="mt-3 font-medium text-slate-950">
                  {currency === "NGN"
                    ? "No Paystack account yet"
                    : "Receiving account coming soon"}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  {currency === "NGN"
                    ? "Request your Paystack account to receive wallet transfers."
                    : "GHS receiving accounts are not available yet. You can still view your balance and history."}
                </p>
                {currency === "NGN" && (
                  <Button asChild className="mt-4">
                    <Link href="/dashboard/fund">
                      <CheckCircle2 aria-hidden="true" className="size-4" />
                      Request account
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-slate-50 text-slate-950 shadow-sm ring-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>History</CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-slate-700">
              <Link href="/dashboard/transactions">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {transactionsQuery.isError ? (
              <LightError
                title="History could not load"
                message={getErrorMessage(
                  transactionsQuery.error,
                  "Retry to refresh wallet history.",
                )}
                onRetry={() => void transactionsQuery.refetch()}
              />
            ) : transactionsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-14 w-full bg-slate-200" />
                ))}
              </div>
            ) : walletTransactions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-slate-500">
                <div className="grid size-12 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
                  <ReceiptText className="size-6" />
                </div>
                <div>
                  <p className="font-medium text-slate-950">No history yet</p>
                  <p className="mt-1 max-w-md text-sm">
                    Your {currency} deposits, sends, and wallet receipts will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white px-3">
                {walletTransactions.map((transaction) => (
                  <TransactionRow key={transaction.id} tx={transaction} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

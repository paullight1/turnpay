"use client";

import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuth } from "@/lib/auth-provider";
import { walletApi, transactionApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeftRight,
  Banknote,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Landmark,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import { Wallet as WalletType, Transaction } from "@/types";
import { getMoneyActionGate } from "@/lib/account-status";
import { maskEmail } from "@/lib/privacy";
import { getErrorMessage } from "@/lib/errors";

type WalletCurrency = "NGN" | "GHS";

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

function WalletCard({
  wallet,
  currency,
  isLoading,
  onOpen,
  sendHref,
  receiveHref,
}: {
  wallet?: WalletType;
  currency: WalletCurrency;
  isLoading: boolean;
  onOpen: () => void;
  sendHref: string;
  receiveHref: string;
}) {
  const label = `${currency} available balance`;

  if (isLoading) {
    return (
      <Card className="border-slate-200 bg-white text-slate-950 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-slate-700">
            {label}
          </CardTitle>
          <Skeleton className="size-8 rounded-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer border-slate-200 bg-[linear-gradient(135deg,#ffffff,#f8fafc_52%,#ecfdf5)] text-slate-950 shadow-sm ring-slate-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-700">
          {label}
        </CardTitle>
        <div className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          {currency}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-950">
          {currency} {formatMoney(wallet?.balance)}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Updated {formatDate(wallet?.updatedAt)}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            asChild
            size="sm"
            className="bg-slate-950 text-white hover:bg-slate-800"
            onClick={(event) => event.stopPropagation()}
          >
            <Link href={sendHref}>
              <Send aria-hidden="true" className="size-4" />
              Send Money
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
            onClick={(event) => event.stopPropagation()}
          >
            <Link href={receiveHref}>
              <ArrowDownToLine aria-hidden="true" className="size-4" />
              Receive Money
            </Link>
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-xs font-medium text-slate-500">
          <span>Open account and history</span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionIcon({ type }: { type: string }) {
  if (type === "EXCHANGE") return <ArrowLeftRight className="size-4" />;
  if (type === "FUND") return <Banknote className="size-4" />;
  if (type === "WITHDRAW") return <Landmark className="size-4" />;
  return <Smartphone className="size-4" />;
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const statusColors: Record<string, string> = {
    SUCCESS: "border-emerald-400/25 bg-emerald-400/12 text-emerald-200",
    PENDING: "border-amber-300/25 bg-amber-300/12 text-amber-100",
    FAILED: "border-rose-400/25 bg-rose-400/12 text-rose-100",
    REVERSED: "border-sky-400/25 bg-sky-400/12 text-sky-100",
  };

  const currency = tx.currency === "GHS" ? "GHS" : "NGN";

  return (
    <div className="grid gap-3 border-b py-3 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <TransactionIcon type={tx.type} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium capitalize">
            {tx.type.toLowerCase()}
          </p>
          <p className="truncate text-xs text-muted-foreground">{tx.reference}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
        <p className="text-sm font-medium tabular-nums">
          {currency} {formatMoney(tx.amount)}
        </p>
        <Badge
          variant="secondary"
          className={`border text-xs ${statusColors[tx.status] || ""}`}
        >
          {tx.status}
        </Badge>
      </div>
    </div>
  );
}

function QueryErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-destructive/25 bg-destructive/5">
      <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <Button variant="outline" onClick={onRetry} className="w-full sm:w-auto">
          <RefreshCw aria-hidden="true" className="size-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const moneyGate = getMoneyActionGate(profile);
  const sendHref = moneyGate?.actionHref ?? "/dashboard/send";
  const receiveHref = moneyGate?.actionHref ?? "/dashboard/fund";

  const {
    data: wallets,
    isLoading: walletsLoading,
    isError: walletsError,
    error: walletsErrorDetails,
    refetch: refetchWallets,
  } = useQuery({
    queryKey: ["wallets", user?.id],
    queryFn: async () => {
      const res = await walletApi.getBalances();
      return res.data as WalletType[];
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const {
    data: transactions,
    isLoading: txLoading,
    isError: txError,
    error: txErrorDetails,
    refetch: refetchTransactions,
  } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const res = await transactionApi.getTransactions(1, 5);
      return res.data as { transactions: Transaction[]; total: number };
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const ngnWallet = wallets?.find((w) => w.currency === "NGN");
  const ghsWallet = wallets?.find((w) => w.currency === "GHS");

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 animate-trustpay-fade-up">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-trustpay-soft-pulse" />
              Wallet workspace
            </p>
            <h1 className="text-2xl font-bold text-balance sm:text-3xl">
              Welcome back, {maskEmail(profile?.email ?? user?.email)}
            </h1>
            <p className="mt-1 text-muted-foreground">
              Review balances, receive money, send money, and track recent receipts.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-card/55 p-2 text-center text-xs text-muted-foreground">
            <span className="flex flex-col gap-1 rounded-md bg-muted/45 px-3 py-2">
              <CheckCircle2 className="mx-auto size-4 text-emerald-300" />
              Receipts
            </span>
            <span className="flex flex-col gap-1 rounded-md bg-muted/45 px-3 py-2">
              <Clock3 className="mx-auto size-4 text-amber-200" />
              Status
            </span>
            <span className="flex flex-col gap-1 rounded-md bg-muted/45 px-3 py-2">
              <LockKeyhole className="mx-auto size-4 text-sky-200" />
              Guarded
            </span>
          </div>
        </div>

        {moneyGate && (
          <Card className="border-amber-300/25 bg-amber-300/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockKeyhole className="size-5 text-amber-200" />
                {moneyGate.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">{moneyGate.message}</p>
              {moneyGate.actionHref && moneyGate.actionLabel && (
                <Link href={moneyGate.actionHref}>
                  <Button variant="outline">{moneyGate.actionLabel}</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {walletsError && (
          <QueryErrorState
            title="Wallet balances could not load"
            message={getErrorMessage(walletsErrorDetails, "Please retry before starting a money action.")}
            onRetry={() => void refetchWallets()}
          />
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WalletCard
            wallet={ngnWallet}
            currency="NGN"
            isLoading={walletsLoading}
            onOpen={() => router.push("/dashboard/wallet/ngn")}
            sendHref={sendHref}
            receiveHref={receiveHref}
          />
          <WalletCard
            wallet={ghsWallet}
            currency="GHS"
            isLoading={walletsLoading}
            onOpen={() => router.push("/dashboard/wallet/ghs")}
            sendHref={sendHref}
            receiveHref={receiveHref}
          />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Total Transactions
              </CardTitle>
              <ClipboardList className="size-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {txLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : (
                <>
                  <div className="text-2xl font-bold tabular-nums">
                    {transactions?.total ?? 0}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {txError ? "Refresh needed" : "All time"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Transactions</CardTitle>
            <Link href="/dashboard/transactions">
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {txError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertCircle className="size-8 text-destructive" />
                <div>
                  <p className="font-medium">Transactions could not load</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {getErrorMessage(txErrorDetails, "Retry to refresh your recent activity.")}
                  </p>
                </div>
                <Button variant="outline" onClick={() => void refetchTransactions()}>
                  <RefreshCw aria-hidden="true" className="size-4" />
                  Retry
                </Button>
              </div>
            ) : txLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : transactions?.transactions?.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
                <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <ReceiptText className="size-6" />
                </div>
                <div>
                  <p className="font-medium text-foreground">No receipts yet</p>
                  <p className="mt-1 max-w-md text-sm">
                    Start by receiving money into your wallet. Your latest receipts will appear here.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href={moneyGate?.actionHref ?? "/dashboard/fund"}>
                    {moneyGate?.actionLabel ?? "Receive money"}
                  </Link>
                </Button>
              </div>
            ) : (
              <div>
                {transactions?.transactions?.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

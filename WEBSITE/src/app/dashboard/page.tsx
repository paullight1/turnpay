"use client";

import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuth } from "@/lib/auth-provider";
import { walletApi, transactionApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Banknote,
  ClipboardList,
  Landmark,
  Smartphone,
} from "lucide-react";
import { Wallet as WalletType, Transaction } from "@/types";

const quickActions = [
  {
    label: "Fund Wallet",
    href: "/dashboard/fund",
    icon: Banknote,
    color: "bg-emerald-600",
  },
  {
    label: "Exchange Currency",
    href: "/dashboard/exchange",
    icon: ArrowLeftRight,
    color: "bg-blue-600",
  },
  {
    label: "Withdraw",
    href: "/dashboard/withdraw",
    icon: Landmark,
    color: "bg-rose-600",
  },
  {
    label: "Buy Airtime",
    href: "/dashboard/vtu?type=airtime",
    icon: Smartphone,
    color: "bg-violet-600",
  },
];

type WalletCurrency = "NGN" | "GHS";

function formatMoney(value?: number | string) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function WalletCard({
  wallet,
  currency,
  isLoading,
}: {
  wallet?: WalletType;
  currency: WalletCurrency;
  isLoading: boolean;
}) {
  const label = `${currency} Balance`;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {currency}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {currency} {formatMoney(wallet?.balance)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Available balance</p>
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
    SUCCESS: "bg-green-100 text-green-800",
    PENDING: "bg-yellow-100 text-yellow-800",
    FAILED: "bg-red-100 text-red-800",
    REVERSED: "bg-gray-100 text-gray-800",
  };

  const currency = tx.currency === "GHS" ? "GHS" : "NGN";

  return (
    <div className="flex items-center justify-between border-b py-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <TransactionIcon type={tx.type} />
        </div>
        <div>
          <p className="text-sm font-medium capitalize">
            {tx.type.toLowerCase()}
          </p>
          <p className="text-xs text-muted-foreground">{tx.reference}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-medium">
          {currency} {formatMoney(tx.amount)}
        </p>
        <Badge
          variant="secondary"
          className={`text-xs ${statusColors[tx.status] || ""}`}
        >
          {tx.status}
        </Badge>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: wallets, isLoading: walletsLoading } = useQuery({
    queryKey: ["wallets", user?.id],
    queryFn: async () => {
      const res = await walletApi.getBalances();
      return res.data as WalletType[];
    },
    enabled: !!user,
    staleTime: 30000,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
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
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome back, {user?.email?.split("@")[0]}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage your wallets and transactions
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WalletCard
            wallet={ngnWallet}
            currency="NGN"
            isLoading={walletsLoading}
          />
          <WalletCard
            wallet={ghsWallet}
            currency="GHS"
            isLoading={walletsLoading}
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
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {transactions?.total ?? 0}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">All time</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-4 text-xl font-semibold">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex size-10 items-center justify-center rounded-lg text-white ${action.color}`}
                      >
                        <action.icon className="size-5" />
                      </div>
                      <span className="font-medium">{action.label}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
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
            {txLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : transactions?.transactions?.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No transactions yet. Start by funding your wallet or exchanging
                currency.
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

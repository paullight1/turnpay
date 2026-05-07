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
import { Wallet, Transaction } from "@/types";

const quickActions = [
  { label: "Exchange Currency", href: "/dashboard/exchange", icon: "💱", color: "bg-blue-500" },
  { label: "Buy Airtime", href: "/dashboard/vtu?type=airtime", icon: "📱", color: "bg-green-500" },
  { label: "Buy Data", href: "/dashboard/vtu?type=data", icon: "🌐", color: "bg-purple-500" },
  { label: "Pay Bills", href: "/dashboard/vtu?type=cable", icon: "📺", color: "bg-orange-500" },
];

function WalletCard({ wallet, isLoading }: { wallet?: Wallet; isLoading: boolean }) {
  const symbol = wallet?.currency === "NGN" ? "₦" : "₵";
  const label = wallet?.currency === "NGN" ? "NGN Balance" : "GHS Balance";
  const flag = wallet?.currency === "NGN" ? "🇳🇬" : "🇬🇭";

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <Skeleton className="size-8 rounded-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-24 mt-2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <span className="text-2xl">{flag}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {symbol} {(wallet?.balance ?? 0).toFixed(2)}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Available balance</p>
      </CardContent>
    </Card>
  );
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const statusColors: Record<string, string> = {
    SUCCESS: "bg-green-100 text-green-800",
    PENDING: "bg-yellow-100 text-yellow-800",
    FAILED: "bg-red-100 text-red-800",
    REVERSED: "bg-gray-100 text-gray-800",
  };

  const symbols: Record<string, string> = {
    NGN: "₦",
    GHS: "₵",
  };

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          {tx.type === "EXCHANGE" ? "💱" : tx.type === "FUND" ? "💰" : tx.type === "WITHDRAW" ? "🏦" : "📱"}
        </div>
        <div>
          <p className="font-medium text-sm capitalize">{tx.type.toLowerCase()}</p>
          <p className="text-xs text-muted-foreground">{tx.reference}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-medium text-sm">
          {symbols[tx.currency] || ""}{Number(tx.amount).toFixed(2)}
        </p>
        <Badge variant="secondary" className={`text-xs ${statusColors[tx.status] || ""}`}>
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
      return res.data as Wallet[];
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
          <h1 className="text-3xl font-bold">Welcome back, {user?.email?.split("@")[0]}</h1>
          <p className="text-muted-foreground mt-1">Manage your wallets and transactions</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <WalletCard wallet={ngnWallet} isLoading={walletsLoading} />
          <WalletCard wallet={ghsWallet} isLoading={walletsLoading} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
              <span className="text-2xl">📋</span>
            </CardHeader>
            <CardContent>
              {txLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{transactions?.total ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">All time</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className={`size-10 rounded-lg ${action.color} flex items-center justify-center text-white text-lg`}>
                        {action.icon}
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
              <Button variant="ghost" size="sm">View All</Button>
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
              <div className="text-center py-8 text-muted-foreground">
                No transactions yet. Start by funding your wallet or exchanging currency.
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

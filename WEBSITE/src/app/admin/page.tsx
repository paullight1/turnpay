"use client";

import { useAuth } from "@/lib/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/services/api";
import { useQuery } from "@tanstack/react-query";

type AdminStats = {
  totalUsers: number;
  totalTransactions: number;
  totalVolume: number;
  totalFees: number;
  activeUsers: number;
};

type AdminTransaction = {
  id: string;
  reference: string;
  type: string;
  amount: number | string;
  currency: string;
  status: string;
  createdAt: string;
  user?: {
    email?: string;
  };
};

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!authLoading && user?.role !== "ADMIN") {
      router.push("/dashboard");
    }
  }, [user, authLoading, router]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/stats");
      return res.data as AdminStats;
    },
    enabled: isAdmin,
    staleTime: 60000,
  });

  const { data: transactionsData, isLoading: txLoading } = useQuery({
    queryKey: ["admin-transactions"],
    queryFn: async () => {
      const res = await apiClient.get(`/api/admin/transactions?limit=${10}`);
      return res.data as AdminTransaction[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  if (authLoading || !user) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (user.role !== "ADMIN") {
    return null;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <span className="text-xl font-bold text-primary">TrustPay Admin</span>
          <Badge variant="secondary">{user.email}</Badge>
        </div>
      </header>

      <main className="container mx-auto p-6 flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-3xl font-bold">
                    {stats?.totalUsers ?? 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Registered</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Active Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-3xl font-bold">
                    {stats?.activeUsers ?? 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Last 30 days</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Total Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    ₦ {(stats?.totalVolume ?? 0).toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {stats?.totalTransactions ?? 0} transactions
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Revenue (Fees)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-3xl font-bold text-green-600">
                    ₦ {(stats?.totalFees ?? 0).toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground">From fees</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {txLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : transactionsData?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No transactions yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactionsData?.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">
                        {tx.reference}
                      </TableCell>
                      <TableCell>{tx.user?.email || "—"}</TableCell>
                      <TableCell className="capitalize">
                        {tx.type.toLowerCase()}
                      </TableCell>
                      <TableCell className="font-medium">
                        {tx.currency === "NGN" ? "₦" : "₵"}
                        {Number(tx.amount).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.status === "SUCCESS"
                              ? "default"
                              : tx.status === "PENDING"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

"use client";

import { useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuth } from "@/lib/auth-provider";
import { transactionApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Transaction } from "@/types";

export default function TransactionsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", user?.id, page],
    queryFn: async () => {
      const res = await transactionApi.getTransactions(page, limit);
      return res.data as {
        transactions: Transaction[];
        total: number;
        page: number;
        totalPages: number;
      };
    },
    enabled: !!user,
  });

  const symbols: Record<string, string> = {
    NGN: "₦",
    GHS: "₵",
  };

  const statusVariant = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return "default";
      case "PENDING":
        return "secondary";
      case "FAILED":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-muted-foreground mt-1">View all your transaction history</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : data?.transactions?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No transactions found
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {data?.transactions?.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 rounded-lg border"
                    >
                      <div className="flex items-center gap-4">
                        <div className="size-10 rounded-full bg-muted flex items-center justify-center text-lg">
                          {tx.type === "EXCHANGE"
                            ? "💱"
                            : tx.type === "FUND"
                            ? "💰"
                            : tx.type === "WITHDRAW"
                            ? "🏦"
                            : tx.type === "AIRTIME"
                            ? "📞"
                            : tx.type === "DATA"
                            ? "🌐"
                            : "📺"}
                        </div>
                        <div>
                          <p className="font-medium capitalize">
                            {tx.type.toLowerCase()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {tx.reference}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {symbols[tx.currency] || ""}
                          {Number(tx.amount).toFixed(2)}
                        </p>
                        <Badge variant={statusVariant(tx.status)}>
                          {tx.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {data.page} of {data.totalPages} ({data.total} total)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= (data.totalPages || 1)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

"use client";

import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/services/api";
import { Transaction } from "@/types";
import { redactTransactionMetadata } from "@/lib/privacy";

export default function TransactionDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const { data: tx, isLoading } = useQuery({
    queryKey: ["transaction", id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/transactions/${id}`);
      return res.data as Transaction | { error: string };
    },
  });

  const transaction = tx && !("error" in tx) ? tx : null;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">Loading…</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  if (!transaction) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">Transaction not found</p>
              <Button className="mt-4" onClick={() => router.push("/dashboard/transactions")}>
                Back to Transactions
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const symbols: Record<string, string> = { NGN: "₦", GHS: "₵" };
  const metadataRows = redactTransactionMetadata(transaction.metadata);
  const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "SUCCESS": return "default";
      case "PENDING": return "secondary";
      case "FAILED": return "destructive";
      default: return "outline";
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>← Back</Button>
          <h1 className="text-2xl font-bold">Transaction Details</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <span className="text-2xl">
                {transaction.type === "EXCHANGE" ? "💱" : transaction.type === "FUND" ? "💰" : transaction.type === "WITHDRAW" ? "🏦" : "📱"}
              </span>
              <span className="capitalize">{transaction.type.toLowerCase()}</span>
              <Badge variant={statusVariant(transaction.status)}>{transaction.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="text-center py-4">
              <p className="text-3xl font-bold">
                {symbols[transaction.currency] || ""}{Number(transaction.amount).toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">{transaction.reference}</p>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Currency</p>
                <p className="font-medium">{transaction.currency}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fee</p>
                <p className="font-medium">{symbols[transaction.currency]}{Number(transaction.fee ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Date</p>
                <p className="font-medium">{new Date(transaction.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Time</p>
                <p className="font-medium">{new Date(transaction.createdAt).toLocaleTimeString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="font-medium capitalize">{transaction.type.toLowerCase()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={statusVariant(transaction.status)}>{transaction.status}</Badge>
              </div>
            </div>

            {metadataRows.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Payment details</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {metadataRows.map((row) => (
                      <div key={row.label}>
                        <p className="text-muted-foreground">{row.label}</p>
                        <p className="font-medium break-words">{row.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

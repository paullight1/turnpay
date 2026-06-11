"use client";

import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/services/api";
import { redactTransactionMetadata } from "@/lib/privacy";
import { useState } from "react";

interface LedgerEntry {
  id: string;
  direction: "DEBIT" | "CREDIT";
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
}

interface TransferAttempt {
  id: string;
  provider: string;
  providerReference: string;
  providerStatus: string;
  status: string;
  attemptNo: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ExchangeReceipt {
  id: string;
  status: string;
  sourceCurrency: string;
  targetCurrency: string;
  amount: number;
  expectedCreditAmount: number;
  rate: number;
  senderName: string;
  senderBankName?: string;
  bankReference?: string;
  reviewReason?: string;
  creditedAt?: string;
}

interface ExchangePayout {
  id: string;
  status: string;
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  destinationAmount: number;
  rate: number;
  fee: number;
  destinationBankName: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
}

interface VtuOrder {
  id: string;
  provider: string;
  serviceType: string;
  status: string;
  amount: number;
  targetMasked?: string;
  providerRequestId?: string;
  providerTransactionId?: string;
  requeryAttempts?: number;
}

interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reference?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  admin?: {
    email: string;
    fullName: string;
  };
}

interface TransactionDetail {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: string;
  reference: string;
  fee: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ledgerEntries?: LedgerEntry[];
  transferAttempts?: TransferAttempt[];
  exchangeReceipt?: ExchangeReceipt;
  exchangePayout?: ExchangePayout;
  vtuOrders?: VtuOrder[];
  disputes?: { id: string; type: string; status: string; description: string; resolution?: string; createdAt: string }[];
  user?: {
    id: string;
    email: string;
    phone: string;
    fullName: string;
    kycStatus: string;
    kycTier: string;
  };
  wallet?: {
    id: string;
    currency: string;
  };
}

export default function TransactionDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  const { data: tx, isLoading } = useQuery({
    queryKey: ["transaction", id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/transactions/${id}`);
      return res.data as TransactionDetail | { error: string };
    },
  });

  const { data: auditTrail } = useQuery({
    queryKey: ["transaction-audit", id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/transactions/${id}/audit-trail`);
      return (res.data as { auditLogs: AuditLogEntry[] }).auditLogs || [];
    },
    enabled: showAuditTrail,
  });

  const transaction: TransactionDetail | null =
    tx && !("error" in tx) ? tx : null;

  const isAdmin = transaction?.user !== undefined;

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
              <Button
                className="mt-4"
                onClick={() => router.push("/dashboard/transactions")}
              >
                Back to Transactions
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const symbols: Record<string, string> = { NGN: "₦", GHS: "₵" };
  const symbol = symbols[transaction.currency] || "";
  const metadataRows = redactTransactionMetadata(transaction.metadata);

  const statusVariant = (
    status: string,
  ): "default" | "secondary" | "destructive" | "outline" => {
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

  const typeIcon = (type: string): string => {
    switch (type) {
      case "EXCHANGE":
        return "💱";
      case "FUND":
        return "💰";
      case "WITHDRAW":
        return "🏦";
      case "INTERNAL_TRANSFER":
        return "💸";
      default:
        return "📱";
    }
  };

  const ledgerEntries = transaction.ledgerEntries || [];
  const transferAttempts = transaction.transferAttempts || [];
  const exchangeReceipt = transaction.exchangeReceipt;
  const exchangePayout = transaction.exchangePayout;
  const vtuOrders = transaction.vtuOrders || [];
  const disputes = transaction.disputes || [];

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            ← Back
          </Button>
          <h1 className="text-2xl font-bold">Transaction Details</h1>
        </div>

        {/* Amount Hero */}
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <span className="text-5xl">{typeIcon(transaction.type)}</span>
            <p className="text-3xl font-bold">
              {symbol}
              {Number(transaction.amount).toFixed(2)}
            </p>
            <Badge variant={statusVariant(transaction.status)} className="text-sm px-3 py-1">
              {transaction.status}
            </Badge>
            <p className="text-sm text-muted-foreground capitalize">
              {transaction.type.toLowerCase().replace(/_/g, " ")}
            </p>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Reference</p>
              <p className="font-medium break-all">{transaction.reference}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Currency</p>
              <p className="font-medium">{transaction.currency}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Date</p>
              <p className="font-medium">
                {new Date(transaction.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Time</p>
              <p className="font-medium">
                {new Date(transaction.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Type</p>
              <p className="font-medium capitalize">
                {transaction.type.toLowerCase().replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={statusVariant(transaction.status)}>
                {transaction.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Fee Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Amount Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">
                {symbol}
                {Number(transaction.amount).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-medium">
                {Number(transaction.fee) === 0
                  ? "Free"
                  : `${symbol}${Number(transaction.fee).toFixed(2)}`}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold">
              <span>Net Amount</span>
              <span>
                {symbol}
                {(Number(transaction.amount) - Number(transaction.fee)).toFixed(
                  2,
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Ledger Entries */}
        {ledgerEntries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📒 Ledger Entries
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ledgerEntries.map((entry) => {
                const isDebit = entry.direction === "DEBIT";
                const prefix = isDebit ? "−" : "+";
                const color = isDebit
                  ? "text-red-500"
                  : "text-green-500";
                const bgColor = isDebit
                  ? "bg-red-500/10"
                  : "bg-green-500/10";
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-3 p-3 rounded-lg ${bgColor}`}
                  >
                    <span className="text-lg">
                      {isDebit ? "↑" : "↓"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.source}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Balance: {symbol}
                        {Number(entry.balanceBefore).toFixed(2)} → {symbol}
                        {Number(entry.balanceAfter).toFixed(2)}
                      </p>
                    </div>
                    <span className={`text-sm font-bold whitespace-nowrap ${color}`}>
                      {prefix}
                      {symbol}
                      {Number(entry.amount).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Provider Events / Transfer Attempts */}
        {transferAttempts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🔄 Provider Events
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {transferAttempts.map((attempt) => {
                const attemptStatus = attempt.status.toUpperCase();
                return (
                  <div
                    key={attempt.id}
                    className="flex justify-between items-center p-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {attempt.provider.toLowerCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Ref: {attempt.providerReference}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          attemptStatus === "SUCCESS"
                            ? "default"
                            : attemptStatus === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {attempt.providerStatus}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        Attempt #{attempt.attemptNo}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Exchange Receipt */}
        {exchangeReceipt && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                💱 Exchange Receipt
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={statusVariant(exchangeReceipt.status)}>
                  {exchangeReceipt.status}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Rate</p>
                <p className="font-medium">
                  {Number(exchangeReceipt.rate).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Sender</p>
                <p className="font-medium">{exchangeReceipt.senderName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Sender Bank</p>
                <p className="font-medium">
                  {exchangeReceipt.senderBankName || "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Expected Credit</p>
                <p className="font-medium">
                  {exchangeReceipt.targetCurrency}{" "}
                  {Number(exchangeReceipt.expectedCreditAmount).toFixed(2)}
                </p>
              </div>
              {exchangeReceipt.creditedAt && (
                <div>
                  <p className="text-muted-foreground">Credited At</p>
                  <p className="font-medium">
                    {new Date(exchangeReceipt.creditedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {exchangeReceipt.reviewReason && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">Review Reason</p>
                  <p className="font-medium">{exchangeReceipt.reviewReason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Exchange Payout */}
        {exchangePayout && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📤 Exchange Payout
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={statusVariant(exchangePayout.status)}>
                  {exchangePayout.status}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Rate</p>
                <p className="font-medium">
                  {Number(exchangePayout.rate).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Destination Bank</p>
                <p className="font-medium">
                  {exchangePayout.destinationBankName}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Account</p>
                <p className="font-medium">
                  *****
                  {exchangePayout.destinationAccountNumber.slice(-4)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Destination Amount</p>
                <p className="font-medium">
                  {exchangePayout.destinationCurrency}{" "}
                  {Number(exchangePayout.destinationAmount).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Fee</p>
                <p className="font-medium">
                  {Number(exchangePayout.fee).toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* VTU Order */}
        {vtuOrders.length > 0 && vtuOrders.map((order) => (
          <Card key={order.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📱 VTU Order
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Service</p>
                <p className="font-medium capitalize">
                  {order.serviceType.toLowerCase()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Provider</p>
                <p className="font-medium">{order.provider}</p>
              </div>
              {order.targetMasked && (
                <div>
                  <p className="text-muted-foreground">Target</p>
                  <p className="font-medium">{order.targetMasked}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={statusVariant(order.status)}>
                  {order.status}
                </Badge>
              </div>
              {order.requeryAttempts !== undefined && order.requeryAttempts > 0 && (
                <div>
                  <p className="text-muted-foreground">Requery Attempts</p>
                  <p className="font-medium">{order.requeryAttempts}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Disputes */}
        {disputes.length > 0 && disputes.map((dispute) => (
          <Card key={dispute.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                ⚠️ Dispute
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="font-medium">{dispute.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Description</p>
                <p className="font-medium">{dispute.description}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge>{dispute.status}</Badge>
              </div>
              {dispute.resolution && (
                <div>
                  <p className="text-muted-foreground">Resolution</p>
                  <p className="font-medium">{dispute.resolution}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Admin: Retry Failed */}
        {isAdmin && transaction.status === "FAILED" && (
          <Card className="border-destructive/30">
            <CardContent className="pt-6 flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                This transaction failed. You can retry or resolve it.
              </p>
              <div className="flex gap-3">
                <Button variant="destructive" className="flex-1">
                  🔄 Retry Transaction
                </Button>
                <Button variant="outline" className="flex-1">
                  ✕ Mark as Resolved
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Admin: Audit Trail */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  🛡️ Audit Trail
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAuditTrail(!showAuditTrail)}
                >
                  {showAuditTrail ? "Hide" : "Show"}
                </Button>
              </div>
            </CardHeader>
            {showAuditTrail && auditTrail && (
              <CardContent className="flex flex-col gap-3">
                {auditTrail.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No audit log entries found.
                  </p>
                ) : (
                  auditTrail.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3 rounded-lg bg-muted/50 text-sm"
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-medium">{entry.action}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {entry.reason && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Reason: {entry.reason}
                        </p>
                      )}
                      {entry.admin && (
                        <p className="text-xs text-muted-foreground mt-1">
                          By: {entry.admin.fullName || entry.admin.email}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Metadata */}
        {metadataRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Payment Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              {metadataRows.map((row) => (
                <div key={row.label}>
                  <p className="text-muted-foreground">{row.label}</p>
                  <p className="font-medium break-words">{row.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

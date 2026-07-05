"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-provider";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskEmail, maskPhone } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import { adminExchangeApi, adminExchangePayoutApi, adminUserApi, adminVtuApi, apiClient } from "@/services/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  UsersRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdminVtuReconciliationResponse,
  AdminVtuProviderHealthResponse,
  Wallet,
} from "@/types";
import { toast } from "sonner";

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
  fee?: number | string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string;
  user?: {
    id?: string;
    email?: string;
    phone?: string;
  };
};

type AdminLedgerEntry = {
  id: string;
  direction: string;
  amount: number | string;
  currency: string;
  balanceBefore?: number | string;
  balanceAfter?: number | string;
  reference: string;
  source: string;
  createdAt: string;
};

type AdminTransactionDetail = AdminTransaction & {
  wallet?: {
    id: string;
    currency: string;
    balance: number | string;
    updatedAt: string;
  } | null;
  ledgerEntries?: AdminLedgerEntry[];
  transferAttempts?: Array<{
    id?: string;
    provider: string;
    providerReference: string;
    providerStatus: string;
    status: string;
    attemptNo: number;
    lastCheckedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  vtuOrders?: Array<{
    id: string;
    provider: string;
    providerRequestId: string;
    providerTransactionId?: string | null;
    providerStatus?: string | null;
    status: string;
    serviceType: string;
    targetMasked?: string | null;
    requeryAttempts: number;
    createdAt: string;
    updatedAt: string;
  }>;
  exchangeReceipt?: ManualExchangeReceipt | null;
  disputes?: Array<{
    id: string;
    type: string;
    status: string;
    description: string;
    resolution?: string | null;
    createdAt: string;
  }>;
};

type AdminUser = {
  id: string;
  email: string;
  phone: string;
  fullName?: string | null;
  role: string;
  kycStatus: string;
  isSuspended: boolean;
  createdAt: string;
  wallets: Wallet[];
};

type AdminUserSupportTicket = {
  id: string;
  type: string;
  status: string;
  description: string;
  resolution?: string | null;
  createdAt: string;
  updatedAt: string;
  transaction?: {
    id?: string;
    reference?: string;
    type?: string;
    amount?: number | string;
    currency?: string;
    status?: string;
    createdAt?: string;
  } | null;
};

type AdminUserVirtualAccount = {
  id: string;
  provider: string;
  providerAccountId?: string | null;
  accountNumberMasked: string;
  accountName: string;
  bankName: string;
  bankCode?: string | null;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type AdminUserBankAccount = {
  id: string;
  provider?: string | null;
  bankCode: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  currency: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

type AdminUserExchangeReceipt = {
  id: string;
  bankReference: string;
  amount: number | string;
  expectedCreditAmount: number | string;
  status: string;
  createdAt: string;
  updatedAt: string;
  transaction?: {
    id?: string;
    reference?: string;
    type?: string;
    status?: string;
    createdAt?: string;
  } | null;
};

type AdminUserExchangePayout = {
  id: string;
  status: string;
  sourceAmount: number | string;
  destinationAmount: number | string;
  destinationBankName: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
  transaction?: {
    id?: string;
    reference?: string;
    type?: string;
    status?: string;
    createdAt?: string;
  } | null;
};

type AdminUserSession = {
  id: string;
  deviceId: string;
  deviceName?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastUsedAt: string;
  expiresAt: string;
  createdAt: string;
};

type AdminUserServiceStat = {
  type: string;
  currency: string;
  transactionCount: number;
  totalAmount: number | string;
  totalFees: number | string;
  lastActivityAt?: string | null;
};

type AdminUserDetail = AdminUser & {
  kycTier?: string;
  updatedAt: string;
  transactions: AdminTransaction[];
  virtualAccounts: AdminUserVirtualAccount[];
  bankAccounts: AdminUserBankAccount[];
  sessions: AdminUserSession[];
  serviceStats: AdminUserServiceStat[];
  auditLogs: AdminAuditLog[];
  disputes: AdminUserSupportTicket[];
  exchangeReceipts: AdminUserExchangeReceipt[];
  exchangePayouts: AdminUserExchangePayout[];
};

type AdminUsersResponse = {
  users: AdminUser[];
  total: number;
  page: number;
  totalPages: number;
};

type BankingOverview = {
  virtualAccounts: {
    active: number;
    failed: number;
  };
  withdrawals: {
    pending: number;
    stalePending: number;
    failedAttempts: number;
  };
  providerEvents: {
    failed: number;
  };
  generatedAt: string;
};

type SystemHealthResponse = {
  status: "ok" | "degraded";
  checks: {
    database: string;
    redis: string;
  };
  timestamp: string;
};

type ReadinessItem = {
  label: string;
  state: "ready" | "warning" | "blocked";
  detail: string;
};

type VirtualAccount = {
  id: string;
  userId: string;
  provider: string;
  providerAccountId?: string | null;
  accountNumberMasked: string;
  accountName: string;
  bankName: string;
  currency: string;
  status: string;
  createdAt: string;
};

type ProviderEvent = {
  id: string;
  provider: string;
  eventType: string;
  providerReference: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  processedAt?: string | null;
};

type PendingWithdrawal = AdminTransaction & {
  user?: AdminTransaction["user"] & {
    kycStatus?: string;
    kycTier?: string;
    isSuspended?: boolean;
  };
  transferAttempts?: AdminTransactionDetail["transferAttempts"];
};

type ReconciliationReport = {
  generatedAt: string;
  summary: Record<string, number>;
  providerOnlyEvents: Array<Record<string, unknown>>;
  localWithdrawalsWithoutTransferAttempt: Array<Record<string, unknown>>;
  amountMismatches: Array<Record<string, unknown>>;
  stalePendingTransfers: Array<Record<string, unknown>>;
};

type VtuReconciliationReport = AdminVtuReconciliationResponse & {
  summary: AdminVtuReconciliationResponse["summary"] & Record<string, unknown>;
  exceptions: AdminVtuReconciliationResponse["exceptions"] &
    Record<string, unknown>;
};

function transactionReferenceFromReconItem(item: Record<string, unknown>) {
  const transaction =
    item.transaction &&
    typeof item.transaction === "object" &&
    !Array.isArray(item.transaction)
      ? (item.transaction as Record<string, unknown>)
      : null;
  const reference =
    item.transactionReference ??
    transaction?.reference ??
    item.reference ??
    item.providerReference ??
    item.orderId ??
    item.transferReference ??
    item.providerRequestId ??
    item.providerTransactionId ??
    item.transactionId ??
    item.id;

  return typeof reference === "string" && reference.trim().length > 0
    ? reference
    : null;
}

type ManualExchangeReceipt = {
  id: string;
  amount: string;
  expectedCreditAmount: string;
  rate: string;
  bankReference: string;
  senderName: string;
  senderBankName?: string | null;
  receiptUrl: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  reviewReason?: string | null;
  createdAt: string;
  user?: {
    email?: string;
    phone?: string;
    kycStatus?: string;
    isSuspended?: boolean;
  };
  transaction?: {
    reference?: string;
    status?: string;
  };
};

function receiptVerificationStatus(receipt: ManualExchangeReceipt) {
  const value = receipt.metadata?.providerVerificationStatus;
  return typeof value === "string" ? value : null;
}

type ExchangePayout = {
  id: string;
  status: string;
  sourceAmount: string;
  destinationAmount: string;
  rate: string;
  fee: string;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationBankName: string;
  destinationBankCode?: string | null;
  destinationAccountNumber: string;
  destinationAccountName: string;
  adminPaymentReceipt?: string | null;
  notificationSent: boolean;
  adminNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  user?: {
    email?: string;
    phone?: string;
    kycStatus?: string;
    isSuspended?: boolean;
  };
  transaction?: {
    reference?: string;
    status?: string;
    createdAt?: string;
  };
};

type PayoutStats = {
  pendingApproval: number;
  approved: number;
  processing: number;
  sent: number;
  failed: number;
};

type AdminAuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reference?: string | null;
  reason?: string | null;
  createdAt: string;
  admin?: {
    id?: string;
    email?: string;
    fullName?: string | null;
  } | null;
};

type AdminOpsSummary = {
  generatedAt: string;
  stats: AdminStats & {
    suspendedUsers: number;
    verifiedUsers: number;
  };
  treasury: {
    settlementAccount: {
      provider: string;
      configured: boolean;
      accountNumberMasked?: string | null;
      note?: string | null;
    };
    walletExposure: Array<{
      currency: string;
      walletCount: number;
      balance: number | string;
    }>;
    totalWalletExposure: number | string;
  };
  exchange: {
    receipts: {
      submitted: number;
      underReview: number;
      approved: number;
      credited: number;
      rejected: number;
      needsMoreInfo: number;
      totalSourceAmount: number | string;
      totalExpectedCreditAmount: number | string;
    };
    payouts: {
      pendingApproval: number;
      approved: number;
      processing: number;
      sent: number;
      failed: number;
      reversed: number;
      totalSourceAmount: number | string;
      totalDestinationAmount: number | string;
      totalFees: number | string;
    };
  };
  platformServices: {
    totalTransactions: number;
    totalAmount: number | string;
    totalFees: number | string;
    breakdown: Array<{
      serviceType: string;
      currency: string;
      transactionCount: number;
      amount: number | string;
      fee: number | string;
      lastActivityAt?: string | null;
    }>;
    trend: Array<{
      date: string;
      transactionCount: number;
      topServiceType?: string | null;
      topServiceCount: number;
      currencyBreakdown: Array<{
        currency: string;
        transactionCount: number;
        amount: number | string;
        fee: number | string;
      }>;
    }>;
  };
  vtu: {
    totalOrders: number;
    openOrders: number;
    totalAmount: number | string;
    totalFees: number | string;
    totalCostAmount: number | string;
    totalMargin: number | string;
    serviceBreakdown: Array<{
      serviceType: string;
      orderCount: number;
      amount: number | string;
      fee: number | string;
      costAmount: number | string;
      margin: number | string;
    }>;
  };
  activity: {
    recentTransactions: AdminTransaction[];
    recentAuditLogs: AdminAuditLog[];
  };
};

function isMonnifyVerifiedReceipt(receipt: ManualExchangeReceipt) {
  return receiptVerificationStatus(receipt) === "VERIFIED";
}

const transactionFilters = ["ALL", "FUND", "EXCHANGE", "WITHDRAW", "VTU"];
const kycFilters = ["ALL", "PENDING", "SUBMITTED", "VERIFIED", "REJECTED"];
const receiptStatusFilters = [
  "ALL",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "NEEDS_MORE_INFO",
  "CREDITED",
  "REJECTED",
];

const payoutStatusFilters = [
  "ALL",
  "PENDING_APPROVAL",
  "APPROVED",
  "PROCESSING",
  "SENT",
  "FAILED",
];

const ADMIN_VTU_RECONCILIATION_LIMIT = 50;
const ADMIN_VTU_RECONCILIATION_OLDER_THAN_MINUTES = 10;

const currencyRoadmap = [
  { code: "NGN", label: "Nigerian naira", rail: "Monnify", status: "LIVE" },
  {
    code: "GHS",
    label: "Ghanaian cedi",
    rail: "Exchange wallet",
    status: "LIVE",
  },
  {
    code: "USD",
    label: "US dollar",
    rail: "Treasury review",
    status: "COMING SOON",
  },
  {
    code: "GBP",
    label: "British pound",
    rail: "Treasury review",
    status: "COMING SOON",
  },
  {
    code: "EUR",
    label: "Euro",
    rail: "Treasury review",
    status: "COMING SOON",
  },
  {
    code: "CAD",
    label: "Canadian dollar",
    rail: "Treasury review",
    status: "COMING SOON",
  },
];

const manualExchangeStages = [
  {
    label: "Receipt submitted",
    owner: "Customer",
    status: "LIVE",
  },
  {
    label: "Statement matched",
    owner: "Finance",
    status: "LIVE",
  },
  {
    label: "GHS wallet credited",
    owner: "Finance",
    status: "LIVE",
  },
  {
    label: "Audit record locked",
    owner: "System",
    status: "LIVE",
  },
];

function formatMoney(amount: number | string | undefined, currency = "NGN") {
  const numeric = Number(amount ?? 0);
  return `${currency} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCount(value: number | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function statusVariant(status: string) {
  if (
    ["SUCCESS", "VERIFIED", "ACTIVE", "LIVE", "PROCESSED", "CREDITED"].includes(
      status,
    )
  ) {
    return "default" as const;
  }

  if (
    [
      "PENDING",
      "SUBMITTED",
      "PROCESSING",
      "PLANNED",
      "NEEDS_MORE_INFO",
    ].includes(status)
  ) {
    return "secondary" as const;
  }

  if (["COMING SOON", "DISABLED", "IGNORED"].includes(status)) {
    return "outline" as const;
  }

  return "destructive" as const;
}

function readinessVariant(state: ReadinessItem["state"]) {
  if (state === "ready") {
    return "default" as const;
  }

  if (state === "warning") {
    return "secondary" as const;
  }

  return "destructive" as const;
}

function humanizeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function humanizeEntity(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function shortDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function formatTrendDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function getSummaryValue(
  summary: Record<string, unknown> | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    if (summary && Object.prototype.hasOwnProperty.call(summary, key)) {
      return summary[key];
    }
  }
  return 0;
}

function referenceFromRecord(record: Record<string, unknown>) {
  const reference =
    record.transactionReference ??
    record.orderId ??
    record.providerRequestId ??
    record.providerTransactionId ??
    record.providerReference ??
    record.transactionId ??
    record.reference ??
    record.id;
  return typeof reference === "string" && reference.trim().length > 0
    ? reference
    : "Unlinked";
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">
        {value === undefined || value === null || value === ""
          ? "Not set"
          : value}
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Banknote;
  tone?: "default" | "money" | "risk";
  loading?: boolean;
}) {
  return (
    <Card className={cn(
      "group overflow-hidden transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg",
      tone === "money" && "hover:shadow-emerald-500/10",
      tone === "risk" && "hover:shadow-red-500/10",
    )}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{label}</CardTitle>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg border transition-all duration-200",
            tone === "money" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 group-hover:bg-emerald-500/20 group-hover:shadow-sm group-hover:shadow-emerald-500/20",
            tone === "risk" && "border-red-500/30 bg-red-500/10 text-red-300 group-hover:bg-red-500/20 group-hover:shadow-sm group-hover:shadow-red-500/20",
            tone === "default" &&
              "border-border bg-muted text-muted-foreground group-hover:bg-muted/80",
          )}
        >
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionDrilldownCard({
  title,
  detail,
  loading,
  onClose,
}: {
  title: string;
  detail?: AdminTransactionDetail;
  loading?: boolean;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <CardTitle>{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent>
        {loading || !detail ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <div className="grid gap-4 md:grid-cols-2">
              <DetailField label="Reference" value={detail.reference} />
              <DetailField
                label="Type"
                value={detail.type.replaceAll("_", " ")}
              />
              <DetailField
                label="Amount"
                value={formatMoney(detail.amount, detail.currency)}
              />
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge className="mt-1" variant={statusVariant(detail.status)}>
                  {detail.status}
                </Badge>
              </div>
              <DetailField label="User" value={maskEmail(detail.user?.email)} />
              <DetailField
                label="Phone"
                value={maskPhone(detail.user?.phone)}
              />
              <DetailField
                label="Created"
                value={shortDate(detail.createdAt)}
              />
              <DetailField
                label="Updated"
                value={shortDate(detail.updatedAt)}
              />
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Ledger entries</p>
                {(detail.ledgerEntries ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No ledger entries recorded.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {detail.ledgerEntries?.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-md border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">
                            {entry.source}
                          </span>
                          <Badge variant="outline">{entry.direction}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatMoney(entry.amount, entry.currency)} · balance{" "}
                          {formatMoney(entry.balanceBefore, entry.currency)} to{" "}
                          {formatMoney(entry.balanceAfter, entry.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(detail.transferAttempts ?? []).length > 0 && (
                <div>
                  <p className="text-sm font-medium">Transfer attempts</p>
                  <div className="mt-2 space-y-2">
                    {detail.transferAttempts?.map((attempt) => (
                      <div
                        key={attempt.id ?? attempt.providerReference}
                        className="rounded-md border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">
                            {attempt.provider}
                          </span>
                          <Badge variant={statusVariant(attempt.status)}>
                            {attempt.status}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {attempt.providerReference}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Provider status: {attempt.providerStatus}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(detail.vtuOrders ?? []).length > 0 && (
                <div>
                  <p className="text-sm font-medium">VTU orders</p>
                  <div className="mt-2 space-y-2">
                    {detail.vtuOrders?.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-md border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">
                            {order.serviceType} · {order.provider}
                          </span>
                          <Badge variant={statusVariant(order.status)}>
                            {order.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Target {order.targetMasked ?? "masked"} · requeries{" "}
                          {order.requeryAttempts}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserDrilldownCard({
  user,
  loading,
  onClose,
  controlReason,
  sessionRevocationReason,
  revokingSessionId,
  pendingUserAction,
  onControlReasonChange,
  onSessionRevocationReasonChange,
  onSuspendUser,
  onUnsuspendUser,
  onRevokeSession,
}: {
  user?: AdminUserDetail;
  loading?: boolean;
  onClose: () => void;
  controlReason: string;
  sessionRevocationReason: string;
  revokingSessionId: string | null;
  pendingUserAction: "SUSPEND" | "UNSUSPEND" | null;
  onControlReasonChange: (value: string) => void;
  onSessionRevocationReasonChange: (value: string) => void;
  onSuspendUser: () => void;
  onUnsuspendUser: () => void;
  onRevokeSession: (sessionId: string) => void;
}) {
  const wallets = user?.wallets ?? [];
  const virtualAccounts = user?.virtualAccounts ?? [];
  const bankAccounts = user?.bankAccounts ?? [];
  const sessions = user?.sessions ?? [];
  const serviceStats = user?.serviceStats ?? [];
  const auditLogs = user?.auditLogs ?? [];
  const supportTickets = user?.disputes ?? [];
  const exchangeReceipts = user?.exchangeReceipts ?? [];
  const exchangePayouts = user?.exchangePayouts ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <CardTitle>User drilldown</CardTitle>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent>
        {loading || !user ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <DetailField
                  label="Name"
                  value={user.fullName?.trim() || "Not provided"}
                />
                <DetailField label="Email" value={maskEmail(user.email)} />
                <DetailField label="Phone" value={maskPhone(user.phone)} />
                <DetailField
                  label="KYC"
                  value={`${user.kycStatus} · ${user.kycTier ?? "TIER_0"}`}
                />
                <DetailField label="Joined" value={shortDate(user.createdAt)} />
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Wallet balances</p>
                  <Badge variant="outline">{wallets.length}</Badge>
                </div>
                {wallets.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No wallets found for this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {wallets.map((wallet) => (
                      <div
                        key={wallet.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{wallet.currency}</p>
                          <p className="text-xs text-muted-foreground">
                            Updated {shortDate(wallet.updatedAt)}
                          </p>
                        </div>
                        <p className="text-sm font-semibold">
                          {formatMoney(wallet.balance, wallet.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Receiving accounts</p>
                  <Badge variant="outline">{virtualAccounts.length}</Badge>
                </div>
                {virtualAccounts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No virtual accounts assigned yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {virtualAccounts.map((account) => (
                      <div
                        key={account.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {account.bankName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {account.accountName}
                            </p>
                          </div>
                          <Badge variant={statusVariant(account.status)}>
                            {account.status}
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
                          <p className="font-mono text-foreground">
                            {account.accountNumberMasked}
                          </p>
                          <p>
                            {account.provider} · {account.currency}
                            {account.bankCode ? ` · ${account.bankCode}` : ""}
                          </p>
                          <p>Updated {shortDate(account.updatedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Saved bank accounts</p>
                  <Badge variant="outline">{bankAccounts.length}</Badge>
                </div>
                {bankAccounts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No saved beneficiary accounts.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {bankAccounts.map((account) => (
                      <div
                        key={account.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {account.bankName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {account.accountName}
                            </p>
                          </div>
                          <Badge variant={account.isDeleted ? "destructive" : "outline"}>
                            {account.isDeleted ? "Deleted" : "Saved"}
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
                          <p className="font-mono text-foreground">
                            {account.accountNumberMasked}
                          </p>
                          <p>
                            {account.provider ?? "Manual"} · {account.currency}
                            {account.bankCode ? ` · ${account.bankCode}` : ""}
                          </p>
                          <p>Updated {shortDate(account.updatedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Account controls</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Suspend or restore access after a review. Every action is
                      audited.
                    </p>
                  </div>
                  <Badge
                    variant={user.isSuspended ? "destructive" : "outline"}
                  >
                    {user.isSuspended ? "Suspended" : "Active"}
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  <Label
                    htmlFor="user-control-reason"
                    className="text-xs font-medium"
                  >
                    Control reason
                  </Label>
                  <Input
                    id="user-control-reason"
                    value={controlReason}
                    onChange={(event) => {
                      onControlReasonChange(event.target.value);
                    }}
                    maxLength={500}
                    placeholder="Suspicious account activity"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for the audit log. Minimum 10 characters.
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {user.isSuspended ? (
                    <Button
                      variant="outline"
                      disabled={
                        pendingUserAction !== null ||
                        controlReason.trim().length < 10
                      }
                      onClick={onUnsuspendUser}
                    >
                      {pendingUserAction === "UNSUSPEND"
                        ? "Restoring..."
                        : "Unsuspend account"}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      disabled={
                        pendingUserAction !== null ||
                        controlReason.trim().length < 10
                      }
                      onClick={onSuspendUser}
                    >
                      {pendingUserAction === "SUSPEND"
                        ? "Suspending..."
                        : "Suspend account"}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Recent transactions</p>
                  <Badge variant="outline">{(user.transactions ?? []).length}</Badge>
                </div>
                {(user.transactions ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No transactions recorded for this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {user.transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs">
                            {tx.reference}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tx.type.replaceAll("_", " ")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {formatMoney(tx.amount, tx.currency)}
                          </p>
                          <Badge variant={statusVariant(tx.status)}>
                            {tx.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Service volume</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Airtime, data, cable, electricity, and other transfer
                      activity grouped by product.
                    </p>
                  </div>
                  <Badge variant="outline">{serviceStats.length}</Badge>
                </div>

                {serviceStats.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No service usage recorded for this user yet.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {serviceStats.map((stat) => (
                      <div
                        key={`${stat.type}-${stat.currency}`}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {humanizeEntity(stat.type)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {stat.currency}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {formatCount(stat.transactionCount)}
                          </Badge>
                        </div>

                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>{formatMoney(stat.totalAmount, stat.currency)}</p>
                          <p>Fees {formatMoney(stat.totalFees, stat.currency)}</p>
                          <p>
                            Last activity {shortDate(stat.lastActivityAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Activity timeline</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Admin and system events tied to this account, sessions,
                      receipts, payouts, and support.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{auditLogs.length}</Badge>
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={`/admin/audit?targetType=User&targetId=${encodeURIComponent(user.id)}`}
                      >
                        Open audit trail
                      </Link>
                    </Button>
                  </div>
                </div>

                {auditLogs.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No audit events found for this user yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              {humanizeEntity(log.action)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {humanizeEntity(log.targetType)} · {log.targetId}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {shortDate(log.createdAt)}
                          </Badge>
                        </div>

                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>
                            Actor{" "}
                            {log.admin?.fullName?.trim() ||
                              log.admin?.email ||
                              "System"}
                          </p>
                          {log.reference ? (
                            <p className="font-mono text-foreground">
                              Reference {log.reference}
                            </p>
                          ) : null}
                          {log.reason ? <p>Reason {log.reason}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Active sessions</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Revoking a session blocks the next refresh and records an
                      audit trail entry.
                    </p>
                  </div>
                  <Badge variant="outline">{sessions.length}</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  <Label
                    htmlFor="session-revocation-reason"
                    className="text-xs font-medium"
                  >
                    Revocation reason
                  </Label>
                  <Input
                    id="session-revocation-reason"
                    value={sessionRevocationReason}
                    onChange={(event) =>
                      onSessionRevocationReasonChange(event.target.value)
                    }
                    maxLength={500}
                    placeholder="Suspicious login from admin review"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for the audit log. Minimum 10 characters.
                  </p>
                </div>

                {sessions.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No active sessions found for this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {session.deviceName?.trim() ||
                                "Unknown device"}
                            </p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {session.deviceId}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="default">Active</Badge>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                revokingSessionId !== null ||
                                sessionRevocationReason.trim().length < 10
                              }
                              onClick={() => onRevokeSession(session.id)}
                            >
                              {revokingSessionId === session.id
                                ? "Revoking..."
                                : "Revoke"}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>IP {session.ipAddress ?? "Not recorded"}</p>
                          <p className="break-words">
                            User agent {session.userAgent ?? "Not recorded"}
                          </p>
                          <p>Last used {shortDate(session.lastUsedAt)}</p>
                          <p>Expires {shortDate(session.expiresAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Support tickets</p>
                  <Badge variant="outline">{supportTickets.length}</Badge>
                </div>
                {supportTickets.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No support tickets opened by this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {supportTickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {humanizeLabel(ticket.type)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {shortDate(ticket.createdAt)}
                            </p>
                          </div>
                          <Badge variant={statusVariant(ticket.status)}>
                            {ticket.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {ticket.description}
                        </p>
                        {ticket.transaction?.reference && (
                          <p className="mt-2 font-mono text-xs text-muted-foreground">
                            Linked transaction {ticket.transaction.reference}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Exchange receipts</p>
                  <Badge variant="outline">{exchangeReceipts.length}</Badge>
                </div>
                {exchangeReceipts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No exchange receipts recorded for this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {exchangeReceipts.map((receipt) => (
                      <div
                        key={receipt.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {receipt.transaction?.reference ?? receipt.id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {shortDate(receipt.createdAt)}
                            </p>
                          </div>
                          <Badge variant={statusVariant(receipt.status)}>
                            {receipt.status}
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>
                            {formatMoney(receipt.amount, "NGN")} → {formatMoney(receipt.expectedCreditAmount, "GHS")}
                          </p>
                          <p className="font-mono text-foreground">
                            Bank ref {receipt.bankReference}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Exchange payouts</p>
                  <Badge variant="outline">{exchangePayouts.length}</Badge>
                </div>
                {exchangePayouts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No exchange payouts recorded for this user.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {exchangePayouts.map((payout) => (
                      <div
                        key={payout.id}
                        className="rounded-md border border-border bg-background/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {payout.transaction?.reference ?? payout.id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {shortDate(payout.createdAt)}
                            </p>
                          </div>
                          <Badge variant={statusVariant(payout.status)}>
                            {payout.status}
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>
                            {formatMoney(payout.sourceAmount, "NGN")} → {formatMoney(payout.destinationAmount, "GHS")}
                          </p>
                          <p>
                            {payout.destinationBankName} ·{" "}
                            <span className="font-mono text-foreground">
                              {payout.destinationAccountNumber}
                            </span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN" || profile?.role === "ADMIN";
  const [adminTab, setAdminTab] = useState("ops");
  const [transactionType, setTransactionType] = useState("ALL");
  const [kycStatus, setKycStatus] = useState("ALL");
  const [userSearch, setUserSearch] = useState("");
  const [receiptStatus, setReceiptStatus] = useState("SUBMITTED");
  const [selectedReceipt, setSelectedReceipt] =
    useState<ManualExchangeReceipt | null>(null);
  const [reviewAction, setReviewAction] = useState<
    "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO"
  >("APPROVED");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewAttemptKey, setReviewAttemptKey] = useState<string | null>(null);
  const [payoutStatus, setPayoutStatus] = useState("PENDING_APPROVAL");
  const [selectedPayout, setSelectedPayout] = useState<ExchangePayout | null>(null);
  const [payoutReviewAction, setPayoutReviewAction] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [payoutReviewReason, setPayoutReviewReason] = useState("");
  const [payoutReviewAttemptKey, setPayoutReviewAttemptKey] = useState<string | null>(null);
  const [payoutMarkSentReason, setPayoutMarkSentReason] = useState("");
  const [payoutMarkSentReceiptUrl, setPayoutMarkSentReceiptUrl] = useState("");
  const [payoutMarkSentAttemptKey, setPayoutMarkSentAttemptKey] = useState<string | null>(null);
  const [showPayoutMarkSent, setShowPayoutMarkSent] = useState(false);
  const [selectedTransactionRef, setSelectedTransactionRef] = useState<
    string | null
  >(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedWithdrawalRef, setSelectedWithdrawalRef] = useState<
    string | null
  >(null);
  const [controlReason, setControlReason] = useState("");
  const [userActionAttemptKey, setUserActionAttemptKey] = useState<string | null>(
    null,
  );
  const [pendingUserAction, setPendingUserAction] = useState<
    "SUSPEND" | "UNSUSPEND" | null
  >(null);
  const [sessionRevocationReason, setSessionRevocationReason] = useState("");
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null,
  );
  const [selectedReconItem, setSelectedReconItem] = useState<{
    bucket: string;
    item: Record<string, unknown>;
  } | null>(null);
  const deferredUserSearch = useDeferredValue(userSearch.trim());

  const closeTransactionDrilldown = () => {
    setSelectedTransactionRef(null);
  };

  const closeUserDrilldown = () => {
    setSelectedUserId(null);
    setControlReason("");
    setUserActionAttemptKey(null);
    setPendingUserAction(null);
    setSessionRevocationReason("");
    setRevokingSessionId(null);
  };

  const closeWithdrawalDrilldown = () => {
    setSelectedWithdrawalRef(null);
  };

  const openTransactionDrilldown = (reference?: string | null) => {
    setSelectedTransactionRef(
      reference && reference.trim().length > 0 ? reference : null,
    );
    setSelectedReconItem(null);
    setSelectedUserId(null);
    setSelectedWithdrawalRef(null);
  };

  const openWithdrawalDrilldown = (reference?: string | null) => {
    setSelectedWithdrawalRef(
      reference && reference.trim().length > 0 ? reference : null,
    );
    setSelectedReconItem(null);
    setSelectedTransactionRef(null);
    setSelectedUserId(null);
  };

  const openUserDrilldown = (userId: string) => {
    setSelectedUserId(userId);
    setSelectedReconItem(null);
    setSelectedTransactionRef(null);
    setSelectedWithdrawalRef(null);
    setControlReason("");
    setUserActionAttemptKey(null);
    setPendingUserAction(null);
    setSessionRevocationReason("");
    setRevokingSessionId(null);
  };

  useEffect(() => {
    if (
      !authLoading &&
      user &&
      profile &&
      user.role !== "ADMIN" &&
      profile.role !== "ADMIN"
    ) {
      router.push("/dashboard");
    }
  }, [profile, user, authLoading, router]);

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/stats");
      return res.data as AdminStats;
    },
    enabled: isAdmin,
    staleTime: 60000,
  });

  const transactionsQuery = useQuery({
    queryKey: ["admin-transactions", 50],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/transactions?limit=50");
      return res.data as AdminTransaction[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users", kycStatus, deferredUserSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "25" });
      if (kycStatus !== "ALL") params.set("kycStatus", kycStatus);
      if (deferredUserSearch) params.set("q", deferredUserSearch);
      const res = await apiClient.get(`/api/admin/users?${params}`);
      return res.data as AdminUsersResponse;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const bankingQuery = useQuery({
    queryKey: ["admin-banking-overview"],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/banking/overview");
      return res.data as BankingOverview;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const systemHealthQuery = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: async () => {
      const res = await apiClient.get("/api/health", {
        validateStatus: () => true,
      });
      return res.data as SystemHealthResponse;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const virtualAccountsQuery = useQuery({
    queryKey: ["admin-virtual-accounts"],
    queryFn: async () => {
      const res = await apiClient.get(
        "/api/admin/banking/virtual-accounts?limit=8",
      );
      return res.data as VirtualAccount[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const providerEventsQuery = useQuery({
    queryKey: ["admin-provider-events", "FAILED"],
    queryFn: async () => {
      const res = await apiClient.get(
        "/api/admin/banking/provider-events?limit=8&status=FAILED",
      );
      return res.data as ProviderEvent[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const pendingWithdrawalsQuery = useQuery({
    queryKey: ["admin-pending-withdrawals"],
    queryFn: async () => {
      const res = await apiClient.get(
        "/api/admin/banking/transfers/pending?limit=8",
      );
      return res.data as PendingWithdrawal[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const reconciliationQuery = useQuery({
    queryKey: ["admin-reconciliation"],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/banking/reconciliation");
      return res.data as ReconciliationReport;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const vtuReconciliationQuery = useQuery({
    queryKey: [
      "admin-vtu-reconciliation",
      ADMIN_VTU_RECONCILIATION_OLDER_THAN_MINUTES,
      ADMIN_VTU_RECONCILIATION_LIMIT,
    ],
    queryFn: async () => {
      const res = await adminVtuApi.getReconciliation({
        olderThanMinutes: ADMIN_VTU_RECONCILIATION_OLDER_THAN_MINUTES,
        limit: ADMIN_VTU_RECONCILIATION_LIMIT,
      });

      return res.data as VtuReconciliationReport;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const vtuProviderHealthQuery = useQuery({
    queryKey: ["admin-vtu-provider-health"],
    queryFn: async () => {
      const res = await adminVtuApi.getProviderHealth();
      return res.data as AdminVtuProviderHealthResponse;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const transactionDetailQuery = useQuery({
    queryKey: ["admin-transaction-detail", selectedTransactionRef],
    queryFn: async () => {
      const res = await apiClient.get(
        `/api/admin/transactions/${encodeURIComponent(selectedTransactionRef ?? "")}`,
      );
      return res.data as AdminTransactionDetail;
    },
    enabled: isAdmin && Boolean(selectedTransactionRef),
  });

  const userDetailQuery = useQuery({
    queryKey: ["admin-user-detail", selectedUserId],
    queryFn: async () => {
      const res = await apiClient.get(
        `/api/admin/users/${encodeURIComponent(selectedUserId ?? "")}`,
      );
      return res.data as AdminUserDetail;
    },
    enabled: isAdmin && Boolean(selectedUserId),
  });

  const withdrawalDetailQuery = useQuery({
    queryKey: ["admin-withdrawal-detail", selectedWithdrawalRef],
    queryFn: async () => {
      const res = await apiClient.get(
        `/api/admin/banking/transfers/${encodeURIComponent(selectedWithdrawalRef ?? "")}`,
      );
      return res.data as AdminTransactionDetail;
    },
    enabled: isAdmin && Boolean(selectedWithdrawalRef),
  });

  const receiptsQuery = useQuery({
    queryKey: ["admin-exchange-receipts", receiptStatus],
    queryFn: async () => {
      const res = await adminExchangeApi.getReceipts(receiptStatus, 50);
      return res.data as ManualExchangeReceipt[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const payoutsQuery = useQuery({
    queryKey: ["admin-exchange-payouts", payoutStatus],
    queryFn: async () => {
      const res = await adminExchangePayoutApi.getPayouts(
        payoutStatus !== "ALL" ? payoutStatus : undefined,
        50,
      );
      return res.data as ExchangePayout[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const payoutStatsQuery = useQuery({
    queryKey: ["admin-exchange-payout-stats"],
    queryFn: async () => {
      const res = await adminExchangePayoutApi.getPayoutStats();
      return res.data as PayoutStats;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const opsSummaryQuery = useQuery({
    queryKey: ["admin-ops-summary", 8],
    queryFn: async () => {
      const res = await apiClient.get("/api/admin/ops/summary?limit=8");
      return res.data as AdminOpsSummary;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const reviewPayoutMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayout) throw new Error("No payout selected");
      const idempotencyKey =
        payoutReviewAttemptKey ?? createMoneyAttemptIdempotencyKey("exchange");
      setPayoutReviewAttemptKey(idempotencyKey);
      const res = await adminExchangePayoutApi.approvePayout(
        selectedPayout.id,
        {
          status: payoutReviewAction,
          reason: payoutReviewReason.trim(),
        },
        idempotencyKey,
      );
      return res.data as ExchangePayout;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-payouts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-payout-stats"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-ops-summary"] }),
      ]);
      setSelectedPayout(null);
      setPayoutReviewReason("");
      setPayoutReviewAttemptKey(null);
      toast.success("Payout review saved");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not review payout"));
    },
  });

  const markPayoutSentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPayout) throw new Error("No payout selected");
      const idempotencyKey =
        payoutMarkSentAttemptKey ?? createMoneyAttemptIdempotencyKey("exchange");
      setPayoutMarkSentAttemptKey(idempotencyKey);
      const res = await adminExchangePayoutApi.markPayoutSent(
        selectedPayout.id,
        {
          reason: payoutMarkSentReason.trim(),
          paymentReceiptUrl: payoutMarkSentReceiptUrl.trim() || undefined,
        },
        idempotencyKey,
      );
      return res.data as ExchangePayout;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-payouts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-payout-stats"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-ops-summary"] }),
      ]);
      setSelectedPayout(null);
      setShowPayoutMarkSent(false);
      setPayoutMarkSentReason("");
      setPayoutMarkSentReceiptUrl("");
      setPayoutMarkSentAttemptKey(null);
      toast.success("Payout marked as sent");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not mark payout as sent"));
    },
  });

  const reviewReceiptMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReceipt) throw new Error("No receipt selected");
      const idempotencyKey =
        reviewAttemptKey ?? createMoneyAttemptIdempotencyKey("exchange");
      setReviewAttemptKey(idempotencyKey);
      const res = await adminExchangeApi.reviewReceipt(
        selectedReceipt.id,
        {
          status: reviewAction,
          reason: reviewReason.trim(),
        },
        idempotencyKey,
      );
      return res.data as ManualExchangeReceipt;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-receipts"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-ops-summary"] }),
      ]);
      setSelectedReceipt(null);
      setReviewReason("");
      setReviewAttemptKey(null);
      toast.success("Receipt review saved");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not review receipt"));
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (variables: {
      userId: string;
      sessionId: string;
      reason: string;
      idempotencyKey: string;
    }) => {
      const res = await adminUserApi.revokeSession(
        variables.userId,
        variables.sessionId,
        { reason: variables.reason },
        variables.idempotencyKey,
      );

      return res.data as { success: boolean };
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-user-detail", variables.userId],
      });
      setRevokingSessionId(null);
      toast.success("Session revoked");
    },
    onError: (error: unknown) => {
      setRevokingSessionId(null);
      toast.error(getErrorMessage(error, "Could not revoke session"));
    },
  });

  const accountControlMutation = useMutation({
    mutationFn: async (variables: {
      userId: string;
      action: "SUSPEND" | "UNSUSPEND";
      reason: string;
      idempotencyKey: string;
    }) => {
      const res =
        variables.action === "SUSPEND"
          ? await adminUserApi.suspendUser(
              variables.userId,
              variables.reason,
              variables.idempotencyKey,
            )
          : await adminUserApi.unsuspendUser(
              variables.userId,
              variables.reason,
              variables.idempotencyKey,
            );

      return res.data as { success: boolean };
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-user-detail", variables.userId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-ops-summary"] }),
      ]);
      setPendingUserAction(null);
      setControlReason("");
      setUserActionAttemptKey(null);
      toast.success(
        variables.action === "SUSPEND"
          ? "User suspended"
          : "User unsuspended",
      );
    },
    onError: (error: unknown) => {
      setPendingUserAction(null);
      setUserActionAttemptKey(null);
      toast.error(getErrorMessage(error, "Could not update user status"));
    },
  });

  const filteredTransactions = useMemo(() => {
    const transactions = transactionsQuery.data ?? [];
    if (transactionType === "ALL") return transactions;
    if (transactionType === "VTU") {
      return transactions.filter((tx) =>
        ["AIRTIME", "DATA", "CABLE", "ELECTRICITY"].includes(tx.type),
      );
    }
    return transactions.filter((tx) => tx.type === transactionType);
  }, [transactionType, transactionsQuery.data]);

  const exchangeStats = useMemo(() => {
    const exchangeTransactions = (transactionsQuery.data ?? []).filter(
      (tx) => tx.type === "EXCHANGE",
    );
    const success = exchangeTransactions.filter(
      (tx) => tx.status === "SUCCESS",
    );
    const volume = success.reduce((total, tx) => total + Number(tx.amount), 0);

    return {
      count: exchangeTransactions.length,
      successCount: success.length,
      volume,
    };
  }, [transactionsQuery.data]);

  const vtuReconciliationBuckets = useMemo<Array<
    [string, Array<Record<string, unknown>>]
  >>(() => {
    const data = vtuReconciliationQuery.data;
    const exceptions = data?.exceptions ?? null;

    if (!exceptions) return [] as Array<[string, Array<Record<string, unknown>>]>;

    return [
      ["Amount mismatches", asRecordList(exceptions.amountMismatches)],
      ["Fee mismatches", asRecordList(exceptions.feeMismatches)],
      [
        "Missing debits",
        asRecordList((exceptions as Record<string, unknown>).missingDebits ??
          (exceptions as Record<string, unknown>).missingDebitLedger),
      ],
      ["Missing reversals", asRecordList(exceptions.missingReversals)],
      ["Stale orders", asRecordList(exceptions.staleOrders)],
    ];
  }, [vtuReconciliationQuery.data]);

  const opsSummary = opsSummaryQuery.data;
  const treasurySettlement = opsSummary?.treasury.settlementAccount;
  const platformServiceMix = opsSummary?.platformServices;
  const platformServiceTrend = useMemo(
    () => platformServiceMix?.trend ?? [],
    [platformServiceMix?.trend],
  );
  const exchangeReceiptCounts = opsSummary?.exchange.receipts;
  const exchangePayoutCounts = opsSummary?.exchange.payouts;
  const receiptQueueCount =
    (exchangeReceiptCounts?.submitted ?? 0) +
    (exchangeReceiptCounts?.underReview ?? 0) +
    (exchangeReceiptCounts?.approved ?? 0);
  const payoutQueueCount =
    (exchangePayoutCounts?.pendingApproval ?? 0) +
    (exchangePayoutCounts?.approved ?? 0) +
    (exchangePayoutCounts?.processing ?? 0);
  const exchangeQueueCount = receiptQueueCount + payoutQueueCount;
  const platformServiceTrendMax = useMemo(
    () =>
      platformServiceTrend.reduce(
        (max, day) => Math.max(max, day.transactionCount),
        0,
      ),
    [platformServiceTrend],
  );
  const platformServiceTrendHasData = platformServiceTrendMax > 0;

  const readinessChecks = useMemo<ReadinessItem[]>(() => {
    const databaseStatus = systemHealthQuery.data?.checks.database;
    const redisStatus = systemHealthQuery.data?.checks.redis;
    const settlementConfigured = Boolean(treasurySettlement?.configured);
    const configuredVtuProvider =
      vtuProviderHealthQuery.data?.providers.find(
        (provider) => provider.configured && provider.enabled,
      ) ?? null;

    return [
      {
        label: "Database",
        state:
          databaseStatus === "connected"
            ? "ready"
            : databaseStatus
              ? "blocked"
              : "warning",
        detail: databaseStatus ?? "Waiting for health response",
      },
      {
        label: "Redis",
        state:
          redisStatus === "connected"
            ? "ready"
            : redisStatus === "memory-fallback"
              ? "warning"
              : "blocked",
        detail: redisStatus ?? "Waiting for health response",
      },
      {
        label: "Settlement account",
        state: settlementConfigured ? "ready" : "blocked",
        detail:
          treasurySettlement?.accountNumberMasked ??
          "Set MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER",
      },
      {
        label: "Exchange payout store",
        state: opsSummaryQuery.isSuccess
          ? "ready"
          : opsSummaryQuery.isError
            ? "blocked"
            : "warning",
        detail: opsSummaryQuery.isSuccess
          ? "exchange_payouts is reachable"
          : opsSummaryQuery.isError
            ? "The payout summary could not load"
            : "Waiting for payout summary",
      },
      {
        label: "VTU provider",
        state: configuredVtuProvider ? "ready" : "warning",
        detail: configuredVtuProvider
          ? `${configuredVtuProvider.name} is configured`
          : "No enabled VTU provider is configured",
      },
    ];
  }, [
    opsSummaryQuery.isError,
    opsSummaryQuery.isSuccess,
    systemHealthQuery.data,
    treasurySettlement?.accountNumberMasked,
    treasurySettlement?.configured,
    vtuProviderHealthQuery.data,
  ]);

  const refreshAll = async () => {
    try {
      await Promise.all([
        statsQuery.refetch(),
        opsSummaryQuery.refetch(),
        transactionsQuery.refetch(),
        usersQuery.refetch(),
        bankingQuery.refetch(),
        virtualAccountsQuery.refetch(),
        providerEventsQuery.refetch(),
        pendingWithdrawalsQuery.refetch(),
        reconciliationQuery.refetch(),
        vtuReconciliationQuery.refetch(),
        vtuProviderHealthQuery.refetch(),
        systemHealthQuery.refetch(),
        receiptsQuery.refetch(),
        payoutsQuery.refetch(),
        payoutStatsQuery.refetch(),
      ]);
      toast.success("Admin data refreshed");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not refresh admin data"));
    }
  };

  const startReceiptReview = (
    receipt: ManualExchangeReceipt,
    action: "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO",
  ) => {
    setSelectedReceipt(receipt);
    setReviewAction(action);
    setReviewReason("");
    setReviewAttemptKey(createMoneyAttemptIdempotencyKey("exchange"));
  };

  const openReceiptProof = async (receipt: ManualExchangeReceipt) => {
    try {
      const response = await adminExchangeApi.getReceiptProofUrl(receipt.id);
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not open receipt proof"));
    }
  };

  const startPayoutReview = (
    payout: ExchangePayout,
    action: "APPROVED" | "REJECTED",
  ) => {
    setSelectedPayout(payout);
    setPayoutReviewAction(action);
    setPayoutReviewReason("");
    setPayoutReviewAttemptKey(createMoneyAttemptIdempotencyKey("exchange"));
    setShowPayoutMarkSent(false);
  };

  const startPayoutMarkSent = (payout: ExchangePayout) => {
    setSelectedPayout(payout);
    setShowPayoutMarkSent(true);
    setPayoutMarkSentReason("");
    setPayoutMarkSentReceiptUrl("");
    setPayoutMarkSentAttemptKey(createMoneyAttemptIdempotencyKey("exchange"));
  };

  const submitPayoutReview = () => {
    if (!payoutReviewReason.trim() || payoutReviewReason.trim().length < 10) {
      toast.error("Enter a review reason of at least 10 characters");
      return;
    }
    reviewPayoutMutation.mutate();
  };

  const submitPayoutMarkSent = () => {
    if (!payoutMarkSentReason.trim() || payoutMarkSentReason.trim().length < 10) {
      toast.error("Enter a reason of at least 10 characters");
      return;
    }
    markPayoutSentMutation.mutate();
  };

  const submitReceiptReview = () => {
    if (!reviewReason.trim() || reviewReason.trim().length < 10) {
      toast.error("Enter a review reason of at least 10 characters");
      return;
    }

    reviewReceiptMutation.mutate();
  };

  const revokeUserSession = (sessionId: string) => {
    if (!selectedUserId) {
      toast.error("Select a user first");
      return;
    }

    const reason = sessionRevocationReason.trim();
    if (reason.length < 10) {
      toast.error("Enter a revocation reason of at least 10 characters");
      return;
    }

    setRevokingSessionId(sessionId);
    revokeSessionMutation.mutate({
      userId: selectedUserId,
      sessionId,
      reason,
      idempotencyKey: createMoneyAttemptIdempotencyKey("mutation"),
    });
  };

  const updateUserSuspension = (suspend: boolean) => {
    if (!selectedUserId) {
      toast.error("Select a user first");
      return;
    }

    const reason = controlReason.trim();
    if (reason.length < 10) {
      toast.error("Enter a reason of at least 10 characters");
      return;
    }

    const action = suspend ? "SUSPEND" : "UNSUSPEND";
    const idempotencyKey =
      userActionAttemptKey ?? createMoneyAttemptIdempotencyKey("mutation");

    setPendingUserAction(action);
    setUserActionAttemptKey(idempotencyKey);

    accountControlMutation.mutate({
      userId: selectedUserId,
      action,
      reason,
      idempotencyKey,
    });
  };

  const openReconItem = (bucket: string, item: Record<string, unknown>) => {
    setSelectedReconItem({ bucket, item });

    const reference = transactionReferenceFromReconItem(item);
    if (!reference) {
      setSelectedTransactionRef(null);
      setSelectedWithdrawalRef(null);
      setSelectedUserId(null);
      return;
    }

    if (
      bucket === "Local withdrawals without attempt" ||
      bucket === "Stale pending transfers"
    ) {
      openWithdrawalDrilldown(reference);
      return;
    }

    openTransactionDrilldown(reference);
  };

  if (authLoading || !user || !profile) {
    return (
      <DashboardLayout>
        <Skeleton className="h-72 w-full" />
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold">Operations control center</h1>
              <Badge variant="secondary">Monnify settlement</Badge>
              <Badge variant="outline">Manual exchange review</Badge>
              <Badge variant="outline">VTU + audit</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Treasury, exchange, VTU, users, and audit trail in one working
              console.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refreshAll()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Users"
            value={formatCount(statsQuery.data?.totalUsers)}
            detail={`${formatCount(statsQuery.data?.activeUsers)} active in 30 days`}
            icon={UsersRound}
            loading={statsQuery.isLoading}
          />
          <StatTile
            label="Successful volume"
            value={formatMoney(statsQuery.data?.totalVolume, "NGN")}
            detail={`${formatCount(statsQuery.data?.totalTransactions)} total transactions`}
            icon={CircleDollarSign}
            tone="money"
            loading={statsQuery.isLoading}
          />
          <StatTile
            label="Exchange activity"
            value={formatMoney(exchangeStats.volume, "NGN")}
            detail={`${formatCount(exchangeStats.successCount)} successful exchanges`}
            icon={ArrowLeftRight}
            tone="money"
            loading={transactionsQuery.isLoading}
          />
          <StatTile
            label="Funding exceptions"
            value={formatCount(bankingQuery.data?.providerEvents.failed)}
            detail={`${formatCount(bankingQuery.data?.virtualAccounts.active)} active virtual accounts`}
            icon={ShieldCheck}
            tone={bankingQuery.data?.providerEvents.failed ? "risk" : "default"}
            loading={bankingQuery.isLoading}
          />
        </div>

        <Tabs value={adminTab} onValueChange={setAdminTab} className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto md:w-fit">
            <TabsTrigger value="ops">
              <Activity className="size-4" />
              Ops
            </TabsTrigger>
            <TabsTrigger value="finance">
              <Banknote className="size-4" />
              Finance
            </TabsTrigger>
            <TabsTrigger value="users">
              <UsersRound className="size-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="exchange" className="gap-2">
              <ArrowLeftRight className="size-4" />
              Exchange
              {payoutStatsQuery.data && payoutStatsQuery.data.pendingApproval > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {payoutStatsQuery.data.pendingApproval}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="currencies">
              <WalletCards className="size-4" />
              Currencies
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ops" className="flex flex-col gap-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
              <Card className="self-start">
                <CardHeader>
                  <CardTitle>Setup checklist</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Core system and treasury signals that should be green before
                    the admin team processes payouts or escalations.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {readinessChecks.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{item.label}</p>
                        <Badge variant={readinessVariant(item.state)}>
                          {item.state === "ready"
                            ? "Ready"
                            : item.state === "warning"
                              ? "Review"
                              : "Blocked"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="self-start">
                <CardHeader>
                  <CardTitle>Quick actions</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Jump straight to the admin surfaces ops reaches most often.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <Button
                    variant="outline"
                    className="h-auto items-start justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setAdminTab("users")}
                  >
                    <span>
                      <span className="block text-sm font-medium">Users</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Search, review, suspend, and restore accounts.
                      </span>
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto items-start justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setAdminTab("finance")}
                  >
                    <span>
                      <span className="block text-sm font-medium">Finance</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Track transactions, balances, and drilldowns.
                      </span>
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto items-start justify-between gap-3 px-4 py-3 text-left"
                    onClick={() => setAdminTab("exchange")}
                  >
                    <span>
                      <span className="block text-sm font-medium">Exchange</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Review receipts, payouts, and queue state.
                      </span>
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto items-start justify-between gap-3 px-4 py-3 text-left"
                    asChild
                  >
                    <Link href="/admin/vtu">
                      <span>
                        <span className="block text-sm font-medium">VTU Ops</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          Check provider health and service volume.
                        </span>
                      </span>
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto items-start justify-between gap-3 px-4 py-3 text-left sm:col-span-2 xl:col-span-1"
                    asChild
                  >
                    <Link href="/admin/audit">
                      <span>
                        <span className="block text-sm font-medium">
                          Audit trail
                        </span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          Open the event log with all admin actions.
                        </span>
                      </span>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>

            {opsSummaryQuery.isError && (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    Could not load the ops summary.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void opsSummaryQuery.refetch()}
                  >
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}
            {!opsSummaryQuery.isError && (
              <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Settlement account"
                value={treasurySettlement?.configured ? "Configured" : "Missing"}
                detail={
                  treasurySettlement?.accountNumberMasked ??
                  "Set MONNIFY_EXCHANGE_COLLECTION_ACCOUNT_NUMBER"
                }
                icon={Landmark}
                tone={treasurySettlement?.configured ? "default" : "risk"}
                loading={opsSummaryQuery.isLoading}
              />
              <StatTile
                label="Wallet exposure"
                value={formatMoney(opsSummary?.treasury.totalWalletExposure, "NGN")}
                detail={`${formatCount(opsSummary?.stats.totalUsers)} users tracked`}
                icon={WalletCards}
                tone="money"
                loading={opsSummaryQuery.isLoading}
              />
              <StatTile
                label="Exchange queue"
                value={formatCount(exchangeQueueCount)}
                detail={`${formatCount(exchangeReceiptCounts?.credited)} receipts credited · ${formatCount(exchangePayoutCounts?.sent)} payouts sent`}
                icon={ArrowLeftRight}
                loading={opsSummaryQuery.isLoading}
              />
              <StatTile
                label="VTU volume"
                value={formatMoney(opsSummary?.vtu.totalAmount, "NGN")}
                detail={`${formatCount(opsSummary?.vtu.totalOrders)} orders · ${formatCount(opsSummary?.vtu.openOrders)} open`}
                icon={Smartphone}
                tone="money"
                loading={opsSummaryQuery.isLoading}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] xl:items-start">
              <Card className="self-start">
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle>Treasury and exchange snapshot</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {opsSummary
                        ? `Generated ${new Date(opsSummary.generatedAt).toLocaleString()}`
                        : "Live treasury, settlement, and exchange state"}
                    </p>
                  </div>
                  <Badge
                    variant={statusVariant(
                      treasurySettlement?.configured ? "LIVE" : "DISABLED",
                    )}
                  >
                    {treasurySettlement?.configured ? "Configured" : "Action required"}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="rounded-xl border border-border/70 bg-background/70 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Settlement account
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {treasurySettlement?.accountNumberMasked ??
                            "Not configured"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          Provider
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {treasurySettlement?.provider ?? "Monnify"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {treasurySettlement?.note ??
                        "Exchange settlement requires a configured collection account before going live."}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {opsSummary?.treasury.walletExposure.map((wallet) => (
                      <div
                        key={wallet.currency}
                        className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">
                            {wallet.currency} exposure
                          </p>
                          <Badge variant="outline">
                            {formatCount(wallet.walletCount)} wallets
                          </Badge>
                        </div>
                        <p className="mt-2 text-2xl font-semibold">
                          {formatMoney(wallet.balance, wallet.currency)}
                        </p>
                      </div>
                    ))}
                    {(opsSummary?.treasury.walletExposure ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No wallet exposure data yet.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">
                        Receipt queue
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(receiptQueueCount)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatMoney(
                          exchangeReceiptCounts?.totalSourceAmount,
                          "NGN",
                        )}{" "}
                        collected · {formatMoney(
                          exchangeReceiptCounts?.totalExpectedCreditAmount,
                          "GHS",
                        )} expected credit
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">
                        Payout queue
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(payoutQueueCount)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatMoney(
                          exchangePayoutCounts?.totalSourceAmount,
                          "NGN",
                        )}{" "}
                        source · {formatMoney(
                          exchangePayoutCounts?.totalDestinationAmount,
                          "GHS",
                        )} destination · fees{" "}
                        {formatMoney(exchangePayoutCounts?.totalFees, "NGN")}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">
                        Verified users
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(opsSummary?.stats.verifiedUsers)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">
                        Suspended users
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(opsSummary?.stats.suspendedUsers)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                    <p className="text-xs text-muted-foreground">
                      Platform totals
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatMoney(opsSummary?.stats.totalVolume, "NGN")} volume
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatMoney(opsSummary?.stats.totalFees, "NGN")} fees ·{" "}
                      {formatCount(opsSummary?.stats.activeUsers)} active users
                    </p>
                  </div>
              </CardContent>
            </Card>

              <Card className="self-start">
                <CardHeader>
                  <CardTitle>Platform service mix</CardTitle>
                  <p className="text-sm text-muted-foreground">
                  Successful airtime, data, cable, electricity, exchange,
                  fund, withdraw, and internal transfer traffic.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                    <p className="text-xs text-muted-foreground">
                      Successful transactions
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatCount(platformServiceMix?.totalTransactions)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                    <p className="text-xs text-muted-foreground">Total fees</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatMoney(platformServiceMix?.totalFees, "NGN")}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                  <p className="text-xs text-muted-foreground">
                    Platform volume
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatMoney(platformServiceMix?.totalAmount, "NGN")}
                  </p>
                </div>

                <div className="space-y-3">
                  {platformServiceMix?.breakdown.map((service) => (
                    <div
                      key={`${service.serviceType}-${service.currency}`}
                      className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {humanizeLabel(service.serviceType)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {service.currency} · {formatCount(service.transactionCount)} successful
                            transactions
                          </p>
                        </div>
                        <p className="text-right text-sm font-semibold">
                          {formatMoney(service.amount, service.currency)}
                        </p>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                        <div>
                          <p>Fees</p>
                          <p className="mt-1 font-medium text-foreground">
                            {formatMoney(service.fee, service.currency)}
                          </p>
                        </div>
                        <div>
                          <p>Last activity</p>
                          <p className="mt-1 font-medium text-foreground">
                            {shortDate(service.lastActivityAt)}
                          </p>
                        </div>
                        <div>
                          <p>Type</p>
                          <p className="mt-1 font-medium text-foreground">
                            {service.serviceType}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(platformServiceMix?.breakdown ?? []).length === 0 && (
                    <div className="py-8 text-center text-muted-foreground">
                      No platform service usage captured yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

              <Card className="self-start">
                <CardHeader>
                  <CardTitle>VTU service mix</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">Total fees</p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatMoney(opsSummary?.vtu.totalFees, "NGN")}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm">
                      <p className="text-xs text-muted-foreground">
                        Open orders
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(opsSummary?.vtu.openOrders)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {opsSummary?.vtu.serviceBreakdown.map((service) => (
                      <div
                        key={service.serviceType}
                        className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              {humanizeLabel(service.serviceType)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatCount(service.orderCount)} orders
                            </p>
                          </div>
                          <p className="text-right text-sm font-semibold">
                            {formatMoney(service.amount, "NGN")}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div>
                            <p>Fees</p>
                            <p className="mt-1 font-medium text-foreground">
                              {formatMoney(service.fee, "NGN")}
                            </p>
                          </div>
                          <div>
                            <p>Cost</p>
                            <p className="mt-1 font-medium text-foreground">
                              {formatMoney(service.costAmount, "NGN")}
                            </p>
                          </div>
                          <div>
                            <p>Margin</p>
                            <p className="mt-1 font-medium text-foreground">
                              {formatMoney(service.margin, "NGN")}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {(opsSummary?.vtu.serviceBreakdown ?? []).length === 0 && (
                      <div className="py-8 text-center text-muted-foreground">
                        No VTU volume captured yet.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="self-start">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Platform service trend</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Daily successful platform traffic across the last 7 days.
                  </p>
                </div>
                <Badge variant="outline">7-day window</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {platformServiceTrendHasData ? (
                  <div className="space-y-3">
                    {platformServiceTrend.map((day) => {
                      const singleCurrency =
                        day.currencyBreakdown.length === 1
                          ? day.currencyBreakdown[0]
                          : null;
                      const barWidth =
                        platformServiceTrendMax > 0
                          ? Math.max(
                              (day.transactionCount /
                                platformServiceTrendMax) *
                                100,
                              day.transactionCount > 0 ? 8 : 0,
                            )
                          : 0;

                      return (
                        <div
                          key={day.date}
                          className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">
                                {formatTrendDate(day.date)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatCount(day.transactionCount)} successful
                                transactions
                                {day.topServiceType
                                  ? ` · Top ${humanizeLabel(day.topServiceType)}${day.topServiceCount ? ` (${formatCount(day.topServiceCount)})` : ""}`
                                  : ""}
                              </p>
                            </div>
                            <div className="text-right">
                              {day.transactionCount > 0 ? (
                                singleCurrency ? (
                                  <>
                                    <p className="text-sm font-semibold">
                                      {formatMoney(
                                        singleCurrency.amount,
                                        singleCurrency.currency,
                                      )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Fees{" "}
                                      {formatMoney(
                                        singleCurrency.fee,
                                        singleCurrency.currency,
                                      )}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm font-semibold">
                                      Mixed currencies
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatCount(day.currencyBreakdown.length)}{" "}
                                      rails active
                                    </p>
                                  </>
                                )
                              ) : (
                                <>
                                  <p className="text-sm font-semibold">
                                    No activity
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    No successful transactions
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/60">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-300"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          {day.currencyBreakdown.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {day.currencyBreakdown.map((currency) => (
                                <div
                                  key={`${day.date}-${currency.currency}`}
                                  className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm"
                                >
                                  <span className="font-medium text-foreground">
                                    {currency.currency}
                                  </span>{" "}
                                  · {formatCount(currency.transactionCount)} tx ·{" "}
                                  {formatMoney(
                                    currency.amount,
                                    currency.currency,
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                    No successful platform transactions were recorded in the
                    last 7 days.
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
              <Card className="self-start">
                <CardHeader>
                  <CardTitle>Recent user activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {opsSummaryQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (opsSummary?.activity.recentTransactions ?? []).length ===
                    0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No recent user activity.
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
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {opsSummary?.activity.recentTransactions.map((tx) => (
                          <TableRow
                            key={tx.id}
                            className="cursor-pointer"
                            onClick={() => openTransactionDrilldown(tx.reference)}
                          >
                            <TableCell className="font-mono text-xs">
                              {tx.reference}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">
                                {maskEmail(tx.user?.email)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {maskPhone(tx.user?.phone)}
                              </p>
                            </TableCell>
                            <TableCell>{humanizeLabel(tx.type)}</TableCell>
                            <TableCell className="font-medium">
                              {formatMoney(tx.amount, tx.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(tx.status)}>
                                {tx.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {shortDate(tx.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="self-start">
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Recent admin actions</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Audit-protected actions from the last few minutes.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/admin/audit">Open audit trail</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {opsSummaryQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (opsSummary?.activity.recentAuditLogs ?? []).length ===
                    0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No recent admin actions.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {opsSummary?.activity.recentAuditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">
                                {humanizeLabel(log.action)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {log.targetType} · {log.targetId}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {shortDate(log.createdAt)}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                            <p>
                              Actor:{" "}
                              {log.admin?.fullName ||
                                log.admin?.email ||
                                "System"}
                            </p>
                            <p>
                              Reference: {log.reference ?? "Not recorded"}
                            </p>
                            <p>
                              Reason: {log.reason ?? "No reason recorded"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="finance" className="flex flex-col gap-4">
            <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <CardTitle>Transaction watchlist</CardTitle>
                  <Select
                    value={transactionType}
                    onValueChange={setTransactionType}
                  >
                    <SelectTrigger className="w-full md:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {transactionFilters.map((filter) => (
                        <SelectItem key={filter} value={filter}>
                          {filter}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardHeader>
                <CardContent>
                  {transactionsQuery.isLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((item) => (
                        <Skeleton key={item} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : filteredTransactions.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground">
                      No transactions for this filter
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
                          <TableHead>Drilldown</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTransactions.slice(0, 12).map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell className="font-mono text-xs">
                              {tx.reference}
                            </TableCell>
                            <TableCell>{maskEmail(tx.user?.email)}</TableCell>
                            <TableCell>{tx.type.replace("_", " ")}</TableCell>
                            <TableCell className="font-medium">
                              {formatMoney(tx.amount, tx.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(tx.status)}>
                                {tx.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(tx.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  openTransactionDrilldown(tx.reference)
                                }
                              >
                                <Search className="size-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Monnify funding health</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Active accounts
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(bankingQuery.data?.virtualAccounts.active)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Failed events
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {formatCount(bankingQuery.data?.providerEvents.failed)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(virtualAccountsQuery.data ?? [])
                      .slice(0, 4)
                      .map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {account.accountName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {account.bankName} · {account.accountNumberMasked}
                            </p>
                          </div>
                          <Badge variant={statusVariant(account.status)}>
                            {account.status}
                          </Badge>
                        </div>
                      ))}
                    {virtualAccountsQuery.data?.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No virtual accounts yet
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Failed provider events</CardTitle>
              </CardHeader>
              <CardContent>
                {(providerEventsQuery.data ?? []).length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No failed provider events
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {providerEventsQuery.data?.map((event) => (
                        <TableRow
                          key={event.id}
                          className="cursor-pointer"
                          onClick={() =>
                            openTransactionDrilldown(event.providerReference)
                          }
                        >
                          <TableCell>{event.provider}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {event.providerReference}
                          </TableCell>
                          <TableCell>{event.eventType}</TableCell>
                          <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                            {event.errorMessage || "Not provided"}
                          </TableCell>
                          <TableCell>
                            {new Date(event.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {selectedTransactionRef && (
              <TransactionDrilldownCard
                title="Transaction drilldown"
                detail={transactionDetailQuery.data}
                loading={transactionDetailQuery.isLoading}
                onClose={closeTransactionDrilldown}
              />
            )}

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.05fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Pending withdrawals</CardTitle>
                </CardHeader>
                <CardContent>
                  {pendingWithdrawalsQuery.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (pendingWithdrawalsQuery.data ?? []).length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No pending withdrawals
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pendingWithdrawalsQuery.data?.map((withdrawal) => (
                        <button
                          key={withdrawal.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted"
                          onClick={() =>
                            openWithdrawalDrilldown(withdrawal.reference)
                          }
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs">
                              {withdrawal.reference}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {maskEmail(withdrawal.user?.email)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {formatMoney(
                                withdrawal.amount,
                                withdrawal.currency,
                              )}
                            </p>
                            <Badge variant={statusVariant(withdrawal.status)}>
                              {withdrawal.status}
                            </Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Reconciliation exceptions</CardTitle>
                </CardHeader>
                <CardContent>
                  {reconciliationQuery.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <div className="space-y-3">
                      {[
                        [
                          "Provider-only events",
                          reconciliationQuery.data?.providerOnlyEvents ?? [],
                        ],
                        [
                          "Local withdrawals without attempt",
                          reconciliationQuery.data
                            ?.localWithdrawalsWithoutTransferAttempt ?? [],
                        ],
                        [
                          "Amount mismatches",
                          reconciliationQuery.data?.amountMismatches ?? [],
                        ],
                        [
                          "Stale pending transfers",
                          reconciliationQuery.data?.stalePendingTransfers ?? [],
                        ],
                      ].flatMap(([bucket, items]) =>
                        (items as Array<Record<string, unknown>>)
                          .slice(0, 3)
                          .map((item) => (
                            <button
                              key={`${bucket}-${referenceFromRecord(item)}`}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted"
                              onClick={() =>
                                openReconItem(bucket as string, item)
                              }
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {bucket as string}
                                </p>
                                <p className="truncate font-mono text-xs text-muted-foreground">
                                  {referenceFromRecord(item)}
                                </p>
                              </div>
                              <Search className="size-4 text-muted-foreground" />
                            </button>
                          )),
                      )}
                      {reconciliationQuery.data &&
                        Object.values(reconciliationQuery.data.summary).every(
                          (value) => value === 0,
                        ) && (
                          <div className="py-8 text-center text-muted-foreground">
                            No reconciliation exceptions
                          </div>
                        )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>VTU reconciliation</CardTitle>
                </CardHeader>
                <CardContent>
                  {vtuReconciliationQuery.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-md border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">
                          Generated
                        </p>
                        <p className="mt-1 text-sm">
                          {shortDate(vtuReconciliationQuery.data?.generatedAt)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Last {vtuReconciliationQuery.data?.olderThanMinutes ?? 10}{" "}
                          minutes · limit {vtuReconciliationQuery.data?.limit ?? 50}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                          <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Orders</p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "totalOrders",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Amount</p>
                          <p className="mt-1 font-medium">
                            {formatMoney(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "totalAmount",
                                  "totalOrderAmount",
                                  "totalDebitAmount",
                                  "ordersReviewed",
                                ),
                              ),
                              "NGN",
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Debit total</p>
                          <p className="mt-1 font-medium">
                            {formatMoney(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "totalCostAmount",
                                  "totalDebitAmount",
                                  "totalAmount",
                                ),
                              ),
                              "NGN",
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">
                            Amount mismatches
                          </p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "amountMismatches",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Fee mismatches</p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "feeMismatches",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">
                            Missing debits
                          </p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "missingDebits",
                                  "missingDebitLedger",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Missing reversals</p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "missingReversals",
                                  "terminalWithoutReversalCredit",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Stale orders</p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "staleOrders",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-muted/20 p-2">
                          <p className="text-xs text-muted-foreground">Total risk</p>
                          <p className="mt-1 font-medium">
                            {formatCount(
                              toNumber(
                                getSummaryValue(
                                  vtuReconciliationQuery.data?.summary,
                                  "highRiskExceptions",
                                ),
                              ),
                            )}
                          </p>
                        </div>
                      </div>

                      {vtuReconciliationBuckets.flatMap(([bucket, items], bucketIndex) =>
                        (items as Array<Record<string, unknown>>)
                          .slice(0, 2)
                          .map((item, itemIndex) => (
                            <button
                              key={`${bucket}-${bucketIndex}-${itemIndex}-${referenceFromRecord(item)}`}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted"
                              onClick={() => openReconItem(bucket, item)}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {bucket}
                                </p>
                                <p className="truncate font-mono text-xs text-muted-foreground">
                                  {referenceFromRecord(item)}
                                </p>
                              </div>
                              <Search className="size-4 text-muted-foreground" />
                            </button>
                          )),
                      ).length === 0 && (
                        <div className="py-6 text-center text-muted-foreground">
                          No VTU reconciliation exceptions
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {selectedWithdrawalRef && (
              <TransactionDrilldownCard
                title="Withdrawal drilldown"
                detail={withdrawalDetailQuery.data}
                loading={withdrawalDetailQuery.isLoading}
                onClose={closeWithdrawalDrilldown}
              />
            )}

            {selectedReconItem && (
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <CardTitle>{selectedReconItem.bucket}</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedReconItem(null)}
                  >
                    Close
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(selectedReconItem.item).map(
                      ([key, value]) => (
                        <DetailField
                          key={key}
                          label={key}
                          value={
                            value instanceof Date
                              ? value.toLocaleString()
                              : typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value ?? "")
                          }
                        />
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="users" className="flex flex-col gap-4">
            <Card>
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle>Users and wallet balances</CardTitle>
                <Select value={kycStatus} onValueChange={setKycStatus}>
                  <SelectTrigger className="w-full md:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kycFilters.map((filter) => (
                      <SelectItem key={filter} value={filter}>
                        {filter}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Search users
                    </p>
                    <Input
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      placeholder="Email, phone, name, or referral code"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setUserSearch("")}
                      className="w-full md:w-auto"
                      disabled={!userSearch.trim()}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Showing {formatCount(usersQuery.data?.total)} users
                  {deferredUserSearch ? ` matching "${deferredUserSearch}"` : ""}
                </p>
                {usersQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4].map((item) => (
                      <Skeleton key={item} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>KYC</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>NGN wallet</TableHead>
                        <TableHead>GHS wallet</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Drilldown</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersQuery.data?.users.map((item) => {
                        const ngnWallet = item.wallets.find(
                          (wallet) => wallet.currency === "NGN",
                        );
                        const ghsWallet = item.wallets.find(
                          (wallet) => wallet.currency === "GHS",
                        );

                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <p className="font-medium">
                                {item.fullName?.trim() || maskEmail(item.email)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {maskEmail(item.email)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {maskPhone(item.phone)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(item.kycStatus)}>
                                {item.kycStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>{item.role}</TableCell>
                            <TableCell>
                              {formatMoney(ngnWallet?.balance, "NGN")}
                            </TableCell>
                            <TableCell>
                              {formatMoney(ghsWallet?.balance, "GHS")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  item.isSuspended ? "destructive" : "outline"
                                }
                              >
                                {item.isSuspended ? "SUSPENDED" : "ACTIVE"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openUserDrilldown(item.id)}
                              >
                                <Search className="size-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {selectedUserId && (
              <UserDrilldownCard
                user={userDetailQuery.data}
                loading={userDetailQuery.isLoading}
                onClose={closeUserDrilldown}
                controlReason={controlReason}
                sessionRevocationReason={sessionRevocationReason}
                revokingSessionId={revokingSessionId}
                pendingUserAction={pendingUserAction}
                onControlReasonChange={(value) => {
                  setControlReason(value);
                  setUserActionAttemptKey(null);
                }}
                onSessionRevocationReasonChange={setSessionRevocationReason}
                onSuspendUser={() => updateUserSuspension(true)}
                onUnsuspendUser={() => updateUserSuspension(false)}
                onRevokeSession={revokeUserSession}
              />
            )}
          </TabsContent>

          <TabsContent
            value="exchange"
            className="grid gap-4 xl:grid-cols-[1fr_1.2fr]"
          >
            <Card>
              <CardHeader>
                <CardTitle>NGN to GHS exchange lane</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {manualExchangeStages.map((stage, index) => (
                  <div
                    key={stage.label}
                    className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted text-sm font-semibold">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium">{stage.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {stage.owner}
                        </p>
                      </div>
                    </div>
                    <Badge variant={statusVariant(stage.status)}>
                      {stage.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Exchange transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {transactionsQuery.isLoading ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Debit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Drilldown</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(transactionsQuery.data ?? [])
                        .filter((tx) => tx.type === "EXCHANGE")
                        .slice(0, 10)
                        .map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell className="font-mono text-xs">
                              {tx.reference}
                            </TableCell>
                            <TableCell>{maskEmail(tx.user?.email)}</TableCell>
                            <TableCell>
                              {formatMoney(tx.amount, tx.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(tx.status)}>
                                {tx.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {new Date(tx.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  openTransactionDrilldown(tx.reference)
                                }
                              >
                                <Search className="size-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {selectedTransactionRef && (
              <TransactionDrilldownCard
                title="Transaction drilldown"
                detail={transactionDetailQuery.data}
                loading={transactionDetailQuery.isLoading}
                onClose={closeTransactionDrilldown}
              />
            )}

            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle>Exchange deposit queue</CardTitle>
                <Select
                  value={receiptStatus}
                  onValueChange={(value) => {
                    setReceiptStatus(value);
                    setSelectedReceipt(null);
                    setReviewReason("");
                  }}
                >
                  <SelectTrigger className="w-full md:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {receiptStatusFilters.map((filter) => (
                      <SelectItem key={filter} value={filter}>
                        {filter.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {receiptsQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((item) => (
                      <Skeleton key={item} className="h-12 w-full" />
                    ))}
                  </div>
                ) : receiptsQuery.isError ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      Could not load exchange deposit receipts.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => void receiptsQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (receiptsQuery.data ?? []).length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No receipts for this status
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Deposit</TableHead>
                        <TableHead>Credit</TableHead>
                        <TableHead>Bank ref</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receiptsQuery.data?.map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell>
                            <p className="font-mono text-xs">
                              {receipt.transaction?.reference ?? receipt.id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(receipt.createdAt).toLocaleDateString()}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">
                              {maskEmail(receipt.user?.email)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {maskPhone(receipt.user?.phone)}
                            </p>
                          </TableCell>
                          <TableCell>
                            {formatMoney(receipt.amount, "NGN")}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">
                              {formatMoney(receipt.expectedCreditAmount, "GHS")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Rate {receipt.rate}
                              {isMonnifyVerifiedReceipt(receipt) && (
                                <span className="ml-2 text-emerald-600">
                                  Monnify verified
                                </span>
                              )}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {receipt.bankReference}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(receipt.status)}>
                              {receipt.status.replaceAll("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {[
                              "SUBMITTED",
                              "UNDER_REVIEW",
                              "NEEDS_MORE_INFO",
                            ].includes(receipt.status) ? (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    startReceiptReview(receipt, "APPROVED")
                                  }
                                >
                                  {isMonnifyVerifiedReceipt(receipt)
                                    ? "Credit verified"
                                    : "Approve"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    startReceiptReview(receipt, "REJECTED")
                                  }
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                Reviewed
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {selectedReceipt && (
                  <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                      <div>
                        <p className="text-sm font-medium">
                          Review {selectedReceipt.transaction?.reference}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {isMonnifyVerifiedReceipt(selectedReceipt)
                            ? "Monnify has verified this deposit. Admin approval credits "
                            : "Confirm statement match before approving. Approval credits "}
                          {formatMoney(
                            selectedReceipt.expectedCreditAmount,
                            "GHS",
                          )}{" "}
                          to the user wallet.
                        </p>
                        {selectedReceipt.receiptUrl.startsWith("monnify://") ? (
                          <Badge variant="outline" className="mt-3">
                            Provider evidence attached
                          </Badge>
                        ) : (
                          <button
                            type="button"
                            className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                            onClick={() =>
                              void openReceiptProof(selectedReceipt)
                            }
                          >
                            Open receipt proof
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-3">
                        <Select
                          value={reviewAction}
                          onValueChange={(value) =>
                            setReviewAction(
                              value as
                                | "APPROVED"
                                | "REJECTED"
                                | "NEEDS_MORE_INFO",
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="APPROVED">
                              Approve and credit
                            </SelectItem>
                            <SelectItem value="REJECTED">Reject</SelectItem>
                            <SelectItem value="NEEDS_MORE_INFO">
                              Needs more info
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <textarea
                          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Admin review reason"
                          value={reviewReason}
                          maxLength={500}
                          onChange={(event) =>
                            setReviewReason(event.target.value)
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={submitReceiptReview}
                            disabled={reviewReceiptMutation.isPending}
                          >
                            {reviewReceiptMutation.isPending
                              ? "Saving..."
                              : "Save review"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedReceipt(null);
                              setReviewReason("");
                              setReviewAttemptKey(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle>Payout Approvals</CardTitle>
                  {payoutStatsQuery.data && (
                    <Badge variant="secondary" className="text-sm">
                      {payoutStatsQuery.data.pendingApproval} pending
                    </Badge>
                  )}
                </div>
                <Select
                  value={payoutStatus}
                  onValueChange={(value) => {
                    setPayoutStatus(value);
                    setSelectedPayout(null);
                    setShowPayoutMarkSent(false);
                  }}
                >
                  <SelectTrigger className="w-full md:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {payoutStatusFilters.map((filter) => (
                      <SelectItem key={filter} value={filter}>
                        {filter.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>

              <CardContent>
                {payoutStatsQuery.data && (
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <div className="rounded-md border bg-muted/30 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Pending</p>
                      <p className="mt-1 text-xl font-semibold text-amber-500">
                        {payoutStatsQuery.data.pendingApproval}
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Approved</p>
                      <p className="mt-1 text-xl font-semibold text-blue-500">
                        {payoutStatsQuery.data.approved}
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Sent</p>
                      <p className="mt-1 text-xl font-semibold text-emerald-500">
                        {payoutStatsQuery.data.sent}
                      </p>
                    </div>
                  </div>
                )}

                {payoutsQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((item) => (
                      <Skeleton key={item} className="h-12 w-full" />
                    ))}
                  </div>
                ) : payoutsQuery.isError ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      Could not load payout requests.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => void payoutsQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (payoutsQuery.data ?? []).length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No payouts for this status
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>NGN</TableHead>
                        <TableHead>GHS</TableHead>
                        <TableHead>Bank</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payoutsQuery.data?.map((payout) => (
                        <TableRow key={payout.id}>
                          <TableCell>
                            <p className="font-mono text-xs">
                              {payout.transaction?.reference ?? payout.id.slice(0, 12)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(payout.createdAt).toLocaleDateString()}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">
                              {maskEmail(payout.user?.email)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {maskPhone(payout.user?.phone)}
                            </p>
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatMoney(payout.sourceAmount, "NGN")}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">
                              {formatMoney(payout.destinationAmount, "GHS")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Rate {Number(payout.rate).toFixed(4)}
                            </p>
                          </TableCell>
                          <TableCell>{payout.destinationBankName}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {payout.destinationAccountNumber}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(payout.status)}>
                              {payout.status.replaceAll("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {payout.status === "PENDING_APPROVAL" ? (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    startPayoutReview(payout, "APPROVED")
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    startPayoutReview(payout, "REJECTED")
                                  }
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : payout.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startPayoutMarkSent(payout)}
                              >
                                Mark Sent
                              </Button>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {payout.notificationSent ? "Notified" : "Processed"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {selectedPayout && !showPayoutMarkSent && (
                  <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                      <div>
                        <p className="text-sm font-medium">
                          Review payout {selectedPayout.transaction?.reference}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {payoutReviewAction === "APPROVED"
                            ? "Approving means you will manually send GHS to the userʼs bank account. Mark as sent after the transfer."
                            : "Rejecting reverses the NGN debit back to the userʼs wallet."}
                        </p>
                        <div className="mt-3 grid gap-2 text-sm">
                          <p>
                            <span className="text-muted-foreground">Bank: </span>
                            {selectedPayout.destinationBankName}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Account: </span>
                            {selectedPayout.destinationAccountNumber}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Name: </span>
                            {selectedPayout.destinationAccountName}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Amount: </span>
                            {formatMoney(selectedPayout.destinationAmount, "GHS")}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3">
                        <Select
                          value={payoutReviewAction}
                          onValueChange={(value) =>
                            setPayoutReviewAction(
                              value as "APPROVED" | "REJECTED",
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="APPROVED">
                              Approve payout
                            </SelectItem>
                            <SelectItem value="REJECTED">
                              Reject and reverse
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <textarea
                          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Admin review reason (min 10 chars)"
                          value={payoutReviewReason}
                          maxLength={500}
                          onChange={(event) =>
                            setPayoutReviewReason(event.target.value)
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={submitPayoutReview}
                            disabled={reviewPayoutMutation.isPending}
                          >
                            {reviewPayoutMutation.isPending
                              ? "Saving..."
                              : "Save review"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedPayout(null);
                              setPayoutReviewReason("");
                              setPayoutReviewAttemptKey(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedPayout && showPayoutMarkSent && (
                  <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                      <div>
                        <p className="text-sm font-medium">
                          Mark payout as sent
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Confirm you have manually transferred{" "}
                          {formatMoney(selectedPayout.destinationAmount, "GHS")}{" "}
                          to {selectedPayout.destinationBankName} account{" "}
                          {selectedPayout.destinationAccountNumber} (
                          {selectedPayout.destinationAccountName}). The user will
                          be notified that money is incoming.
                        </p>
                      </div>
                      <div className="flex flex-col gap-3">
                        <textarea
                          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Reason for marking as sent (min 10 chars)"
                          value={payoutMarkSentReason}
                          maxLength={500}
                          onChange={(event) =>
                            setPayoutMarkSentReason(event.target.value)
                          }
                        />
                        <input
                          type="url"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Payment receipt URL (optional, https)"
                          value={payoutMarkSentReceiptUrl}
                          onChange={(event) =>
                            setPayoutMarkSentReceiptUrl(event.target.value)
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={submitPayoutMarkSent}
                            disabled={markPayoutSentMutation.isPending}
                          >
                            {markPayoutSentMutation.isPending
                              ? "Saving..."
                              : "Mark as sent"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedPayout(null);
                              setShowPayoutMarkSent(false);
                              setPayoutMarkSentReason("");
                              setPayoutMarkSentReceiptUrl("");
                              setPayoutMarkSentAttemptKey(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="currencies">
            <Card>
              <CardHeader>
                <CardTitle>Currency coverage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {currencyRoadmap.map((currency) => (
                    <div
                      key={currency.code}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4"
                    >
                      <div>
                        <p className="text-xl font-semibold">{currency.code}</p>
                        <p className="text-sm text-muted-foreground">
                          {currency.label}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {currency.rail}
                        </p>
                      </div>
                      <Badge variant={statusVariant(currency.status)}>
                        {currency.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

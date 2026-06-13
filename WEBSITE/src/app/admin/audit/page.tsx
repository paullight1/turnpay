"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useAuth } from "@/lib/auth-provider";
import { cn } from "@/lib/utils";
import { adminAuditApi } from "@/services/api";
import type { AdminAuditLog } from "@/types";

const LIMIT_OPTIONS = [25, 50, 100] as const;
const TARGET_TYPE_OPTIONS = [
  "ALL",
  "User",
  "UserSession",
  "Transaction",
  "ExchangeReceipt",
  "ExchangePayout",
  "Wallet",
  "TransferAttempt",
  "RateOverride",
  "VtuPricingRule",
  "SupportTicket",
  "KycVerification",
] as const;
const FINANCIAL_TARGETS = new Set([
  "Transaction",
  "ExchangeReceipt",
  "ExchangePayout",
  "Wallet",
  "TransferAttempt",
  "RateOverride",
]);
const CUSTOMER_TARGETS = new Set([
  "User",
  "Transaction",
  "ExchangeReceipt",
  "ExchangePayout",
  "UserSession",
  "KycVerification",
  "SupportTicket",
]);

function humanizeLabel(value?: string | null) {
  if (!value) return "N/A";
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "None";
  if (typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unable to render JSON";
  }
}

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = action.toUpperCase();
  if (
    normalized.includes("SUSPEND") ||
    normalized.includes("REJECT") ||
    normalized.includes("FAILED") ||
    normalized.includes("DELETE") ||
    normalized.includes("DISABLE")
  ) {
    return "destructive";
  }

  if (
    normalized.includes("APPROVE") ||
    normalized.includes("VERIFY") ||
    normalized.includes("RESOLVE") ||
    normalized.includes("CREDIT") ||
    normalized.includes("ENABLE") ||
    normalized.includes("UNSUSPEND")
  ) {
    return "default";
  }

  return "secondary";
}

function targetVariant(targetType: string): "default" | "secondary" | "destructive" | "outline" {
  if (FINANCIAL_TARGETS.has(targetType)) return "default";
  if (CUSTOMER_TARGETS.has(targetType)) return "secondary";
  return "outline";
}

function escapeCsv(value: unknown) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildAuditCsv(logs: AdminAuditLog[]) {
  const headers = [
    "createdAt",
    "actor",
    "actorEmail",
    "action",
    "targetType",
    "targetId",
    "reference",
    "reason",
    "before",
    "after",
    "metadata",
  ];

  const rows = logs.map((log) =>
    [
      log.createdAt,
      log.admin?.fullName ?? log.admin?.email ?? log.adminId ?? "System",
      log.admin?.email ?? log.adminId ?? "",
      log.action,
      log.targetType,
      log.targetId,
      log.reference ?? "",
      log.reason ?? "",
      JSON.stringify(log.before ?? null),
      JSON.stringify(log.after ?? null),
      JSON.stringify(log.metadata ?? null),
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function AuditStatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function AdminAuditPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [limit, setLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(50);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [actionFilter, setActionFilter] = useState(
    searchParams.get("action") ?? "ALL",
  );
  const [adminFilter, setAdminFilter] = useState(
    searchParams.get("adminId") ?? "ALL",
  );
  const [targetType, setTargetType] = useState<
    (typeof TARGET_TYPE_OPTIONS)[number]
  >(() => {
    const initialTargetType = searchParams.get("targetType");
    return initialTargetType &&
      TARGET_TYPE_OPTIONS.includes(
        initialTargetType as (typeof TARGET_TYPE_OPTIONS)[number],
      )
      ? (initialTargetType as (typeof TARGET_TYPE_OPTIONS)[number])
      : "ALL";
  });
  const [targetId, setTargetId] = useState(searchParams.get("targetId") ?? "");
  const [fromDate, setFromDate] = useState(
    searchParams.get("from")?.slice(0, 10) ?? "",
  );
  const [toDate, setToDate] = useState(searchParams.get("to")?.slice(0, 10) ?? "");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const isAdmin = user?.role === "ADMIN" || profile?.role === "ADMIN";

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
  }, [authLoading, profile, router, user]);

  const logsQuery = useQuery({
    queryKey: [
      "admin-audit-logs",
      limit,
      deferredSearch,
      actionFilter,
      adminFilter,
      targetType,
      targetId,
      fromDate,
      toDate,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (deferredSearch) params.set("q", deferredSearch);
      if (actionFilter !== "ALL") params.set("action", actionFilter);
      if (adminFilter !== "ALL") params.set("adminId", adminFilter);
      if (targetType !== "ALL") params.set("targetType", targetType);
      if (targetId.trim()) params.set("targetId", targetId.trim());
      if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00.000Z`).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59.999Z`).toISOString());

      const res = await adminAuditApi.getLogs(limit, params);
      return res.data as AdminAuditLog[];
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);

  const availableActions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.action))).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [logs]);

  const availableActors = useMemo(() => {
    return Array.from(
      new Map(
        logs
          .map((log) => {
            const id = log.admin?.id ?? log.adminId;
            if (!id) return null;
            return [
              id,
              {
                id,
                label: log.admin?.fullName ?? log.admin?.email ?? id,
              },
            ] as const;
          })
          .filter((entry): entry is readonly [string, { id: string; label: string }] => Boolean(entry)),
      ).values(),
    ).sort((left, right) => left.label.localeCompare(right.label));
  }, [logs]);

  const selectedLog = useMemo(
    () => {
      const activeSelectedId =
        selectedLogId && logs.some((log) => log.id === selectedLogId)
          ? selectedLogId
          : logs[0]?.id ?? null;

      return logs.find((log) => log.id === activeSelectedId) ?? null;
    },
    [logs, selectedLogId],
  );

  const auditStats = useMemo(() => {
    const uniqueAdmins = new Set(
      logs
        .map((log) => log.admin?.email ?? log.admin?.id ?? log.adminId)
        .filter((value): value is string => Boolean(value)),
    );
    const financialActions = logs.filter((log) =>
      FINANCIAL_TARGETS.has(log.targetType),
    ).length;
    const customerActions = logs.filter((log) =>
      CUSTOMER_TARGETS.has(log.targetType),
    ).length;
    const latestAt = logs[0]?.createdAt ?? null;

    return {
      total: logs.length,
      uniqueAdmins: uniqueAdmins.size,
      financialActions,
      customerActions,
      latestAt,
    };
  }, [logs]);

  const clearFilters = () => {
    setSearch("");
    setActionFilter("ALL");
    setAdminFilter("ALL");
    setTargetType("ALL");
    setTargetId("");
    setFromDate("");
    setToDate("");
  };

  const exportCsv = () => {
    if (logs.length === 0) return;

    const csv = buildAuditCsv(logs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trustpay-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (authLoading || !user || !profile) {
    return (
      <DashboardLayout>
        <Skeleton className="h-72 w-full" />
      </DashboardLayout>
    );
  }

  if (!isAdmin) return null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Audit trail</h1>
            <p className="mt-1 text-muted-foreground">
              Review every logged admin action, who made it, and what changed.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-40">
              <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value) as (typeof LIMIT_OPTIONS)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      Latest {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={logs.length === 0}>
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => void logsQuery.refetch()}>
              <RefreshCw className="mr-2 size-4" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Quick filters</CardTitle>
            <CardDescription>
              Search across actions, targets, reasons, and actor identity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr_0.95fr_0.95fr_1fr_0.8fr_0.8fr_auto]">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Search
                </p>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Action, actor, reason, target, or reference"
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Action
                </p>
                <Select
                  value={actionFilter}
                  onValueChange={setActionFilter}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All actions</SelectItem>
                    {availableActions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {humanizeLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Actor
                </p>
                <Select
                  value={adminFilter}
                  onValueChange={setAdminFilter}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All actors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All actors</SelectItem>
                    {availableActors.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Target type
                </p>
                <Select
                  value={targetType}
                  onValueChange={(value) => setTargetType(value as (typeof TARGET_TYPE_OPTIONS)[number])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All targets" />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === "ALL" ? "All targets" : humanizeLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Target ID
                </p>
                <Input
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  placeholder="User ID, transaction ID, or payout ID"
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  From
                </p>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  To
                </p>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button variant="ghost" onClick={clearFilters} className="w-full">
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AuditStatCard
            label="Logged actions"
            value={String(auditStats.total)}
            detail="Latest audit events currently loaded"
            icon={Activity}
          />
          <AuditStatCard
            label="Admin actors"
            value={String(auditStats.uniqueAdmins)}
            detail="Unique admins visible in this slice"
            icon={ShieldCheck}
          />
          <AuditStatCard
            label="Customer actions"
            value={String(auditStats.customerActions)}
            detail="User-facing events such as review, update, or support actions"
            icon={UsersRound}
          />
          <AuditStatCard
            label="Financial actions"
            value={String(auditStats.financialActions)}
            detail="Wallet, transaction, exchange, and payout changes"
            icon={WalletCards}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-col gap-2 border-b border-border/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Event log</CardTitle>
                  <CardDescription>
                    {logsQuery.isLoading
                      ? "Loading latest audit entries..."
                      : `Showing the latest ${logs.length} actions${auditStats.latestAt ? ` • Updated ${formatDateTime(auditStats.latestAt)}` : ""}`}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="gap-1">
                  <ScrollText className="size-3.5" />
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {logsQuery.isError ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Could not load the audit trail.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void logsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : logsQuery.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-80 w-full" />
                </div>
              ) : logs.length === 0 ? (
                <div className="px-4 py-12 text-center text-muted-foreground">
                  No audit entries yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow
                        key={log.id}
                        className={cn(
                          "cursor-pointer",
                          selectedLog?.id === log.id && "bg-muted/50",
                        )}
                        onClick={() => setSelectedLogId(log.id)}
                      >
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {log.admin?.fullName ?? log.admin?.email ?? log.adminId ?? "System"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {log.admin?.email ?? log.adminId ?? "No actor recorded"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={actionVariant(log.action)}>
                            {humanizeLabel(log.action)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={targetVariant(log.targetType)}>
                              {humanizeLabel(log.targetType)}
                            </Badge>
                            <p className="font-mono text-xs text-muted-foreground">
                              {log.targetId}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[18rem] truncate text-sm text-muted-foreground">
                          {log.reason ?? "No reason recorded"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="sticky top-24 h-fit">
            <CardHeader>
              <CardTitle>Selected entry</CardTitle>
              <CardDescription>
                Inspect the before and after state for the highlighted action.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedLog ? (
                <div className="py-10 text-center text-muted-foreground">
                  Select an audit entry to inspect it.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {humanizeLabel(selectedLog.action)}
                        </p>
                        <p className="mt-1 text-lg font-semibold">
                          {humanizeLabel(selectedLog.targetType)}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {selectedLog.targetId}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge variant={actionVariant(selectedLog.action)}>
                          {humanizeLabel(selectedLog.action)}
                        </Badge>
                        <Badge variant={targetVariant(selectedLog.targetType)}>
                          {humanizeLabel(selectedLog.targetType)}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Actor
                        </p>
                        <p className="mt-1 font-medium">
                          {selectedLog.admin?.fullName ?? selectedLog.admin?.email ?? selectedLog.adminId ?? "System"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {selectedLog.admin?.email ?? selectedLog.adminId ?? "No actor recorded"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Created
                        </p>
                        <p className="mt-1 font-medium">
                          {formatDateTime(selectedLog.createdAt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Reference
                        </p>
                        <p className="mt-1 font-medium">
                          {selectedLog.reference ?? "None"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Reason
                        </p>
                        <p className="mt-1 font-medium">
                          {selectedLog.reason ?? "No reason recorded"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Before
                      </p>
                      <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs leading-relaxed text-foreground">
                        {safeJson(selectedLog.before)}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        After
                      </p>
                      <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs leading-relaxed text-foreground">
                        {safeJson(selectedLog.after)}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Metadata
                      </p>
                      <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs leading-relaxed text-foreground">
                        {safeJson(selectedLog.metadata)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

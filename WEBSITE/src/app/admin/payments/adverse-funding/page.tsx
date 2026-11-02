"use client";

import { hasAdminAccess } from "@/lib/admin-access";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import {
  adminAdverseFundingApi,
  adminAuditApi,
  type PaystackAdverseFundingCase,
  type PaystackAdverseFundingResolution,
} from "@/services/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuth } from "@/lib/auth-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type StatusFilter =
  "ACTIVE" | "ALL" | "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
type ResolutionAction = "RELEASE_HOLD" | "COLLECT";

type PendingResolution = {
  caseId: string;
  payload: PaystackAdverseFundingResolution;
  idempotencyKey: string;
  fingerprint: string;
};

type PendingRecheck = {
  caseId: string;
  reason: string;
  idempotencyKey: string;
  fingerprint: string;
};

const MONEY_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

function formatMoney(
  value: number | string | null | undefined,
  currency = "NGN",
) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return `${currency} ${String(value ?? "0")}`;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function numericAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function remainingAmount(caseRecord: PaystackAdverseFundingCase) {
  return Math.max(
    0,
    numericAmount(caseRecord.exposureAmount) -
      numericAmount(caseRecord.recoveredAmount),
  );
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

function humanize(value?: string | null) {
  if (!value) return "Not available";
  return value
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusVariant(
  value?: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  const normalized = value?.toUpperCase();
  if (normalized === "RESOLVED" || normalized === "VERIFIED") return "default";
  if (normalized === "UNMATCHED") return "destructive";
  if (normalized === "UNDER_REVIEW" || normalized === "OPEN")
    return "secondary";
  return "outline";
}

function compactReference(value?: string | null) {
  if (!value) return "Not available";
  if (value.length <= 28) return value;
  return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

function canCollect(caseRecord: PaystackAdverseFundingCase) {
  return (
    caseRecord.holdRequired &&
    caseRecord.status !== "RESOLVED" &&
    caseRecord.status !== "CLOSED" &&
    caseRecord.verificationStatus === "VERIFIED" &&
    caseRecord.eventType === "refund.processed" &&
    caseRecord.providerStatus?.toLowerCase() === "processed" &&
    caseRecord.economicReference?.startsWith("refund:") === true &&
    remainingAmount(caseRecord) > 0
  );
}

function canRecheck(caseRecord: PaystackAdverseFundingCase) {
  return (
    caseRecord.holdRequired &&
    (caseRecord.status === "OPEN" || caseRecord.status === "UNDER_REVIEW") &&
    (caseRecord.verificationStatus === "PENDING" ||
      caseRecord.verificationStatus === "UNMATCHED")
  );
}

function ReferenceValue({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-1 break-all font-mono text-xs text-foreground"
        title={value ?? undefined}
      >
        {value ? compactReference(value) : "Not available"}
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ShieldAlert;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <Card
      className={cn(
        "border-white/10 bg-white/[0.035]",
        tone === "warning" && "border-amber-400/25 bg-amber-400/[0.06]",
        tone === "danger" && "border-red-400/30 bg-red-500/[0.08]",
      )}
    >
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Icon
          className={cn(
            "size-5 text-muted-foreground",
            tone === "warning" && "text-amber-300",
            tone === "danger" && "text-red-300",
          )}
        />
      </CardContent>
    </Card>
  );
}

export default function AdminAdverseFundingPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = hasAdminAccess(user) || hasAdminAccess(profile);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [action, setAction] = useState<ResolutionAction>("RELEASE_HOLD");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [attempt, setAttempt] = useState<{
    idempotencyKey: string;
    fingerprint: string;
  } | null>(null);
  const [attemptWarning, setAttemptWarning] = useState<string | null>(null);
  const [pendingResolution, setPendingResolution] =
    useState<PendingResolution | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recheckReason, setRecheckReason] = useState("");
  const [recheckAttempt, setRecheckAttempt] = useState<{
    idempotencyKey: string;
    fingerprint: string;
  } | null>(null);
  const [recheckWarning, setRecheckWarning] = useState<string | null>(null);
  const [pendingRecheck, setPendingRecheck] = useState<PendingRecheck | null>(
    null,
  );
  const [recheckConfirmOpen, setRecheckConfirmOpen] = useState(false);

  useEffect(() => {
    if (
      !authLoading &&
      user &&
      profile &&
      !hasAdminAccess(user) &&
      !hasAdminAccess(profile)
    ) {
      router.push("/dashboard");
    }
  }, [authLoading, profile, router, user]);

  const casesQuery = useQuery({
    queryKey: ["admin-adverse-funding-cases", statusFilter],
    queryFn: async () => {
      if (statusFilter === "ACTIVE") {
        const responses = await Promise.all([
          adminAdverseFundingApi.listCases("OPEN"),
          adminAdverseFundingApi.listCases("UNDER_REVIEW"),
        ]);
        const byId = new Map<string, PaystackAdverseFundingCase>();
        for (const response of responses) {
          for (const caseRecord of response.data)
            byId.set(caseRecord.id, caseRecord);
        }
        return [...byId.values()].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        );
      }
      const response = await adminAdverseFundingApi.listCases(
        statusFilter === "ALL" ? undefined : statusFilter,
      );
      return response.data;
    },
    enabled: isAdmin,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const allCases = useMemo(() => casesQuery.data ?? [], [casesQuery.data]);
  const activeCases = useMemo(
    () =>
      allCases.filter(
        (caseRecord) =>
          caseRecord.holdRequired &&
          ["OPEN", "UNDER_REVIEW"].includes(caseRecord.status),
      ),
    [allCases],
  );
  const visibleCases = useMemo(() => {
    if (statusFilter === "ACTIVE") return activeCases;
    if (statusFilter === "ALL") return allCases;
    return allCases.filter((caseRecord) => caseRecord.status === statusFilter);
  }, [activeCases, allCases, statusFilter]);

  const selectedCase = useMemo(
    () =>
      allCases.find((caseRecord) => caseRecord.id === selectedCaseId) ?? null,
    [allCases, selectedCaseId],
  );

  const reviewLogsQuery = useQuery({
    queryKey: ["admin-adverse-funding-review-logs", selectedCaseId],
    queryFn: async () => {
      if (!selectedCaseId) return [];
      const params = new URLSearchParams({
        targetType: "FundingAdverseCase",
        targetId: selectedCaseId,
        limit: "20",
      });
      const response = await adminAuditApi.getLogs(20, params);
      return response.data.filter((log) =>
        log.action.startsWith("PAYSTACK_ADVERSE_FUNDING_"),
      );
    },
    enabled: isAdmin && selectedCaseId !== null,
    staleTime: 15000,
  });

  const selectedReviewLog = reviewLogsQuery.data?.find((log) =>
    [
      "PAYSTACK_ADVERSE_FUNDING_REVIEW_REQUIRED",
      "PAYSTACK_ADVERSE_FUNDING_RECHECK_REQUIRED",
      "PAYSTACK_ADVERSE_FUNDING_RECHECKED",
    ].includes(log.action),
  );

  function selectCase(caseId: string) {
    if (caseId === selectedCaseId) return;
    setSelectedCaseId(caseId);
    setAction("RELEASE_HOLD");
    setReason("");
    setAmount("");
    setAttempt(null);
    setAttemptWarning(null);
    setPendingResolution(null);
    setRecheckReason("");
    setRecheckAttempt(null);
    setRecheckWarning(null);
    setPendingRecheck(null);
  }

  const metrics = useMemo(() => {
    const unmatched = activeCases.filter(
      (caseRecord) => caseRecord.verificationStatus === "UNMATCHED",
    ).length;
    const exposure = activeCases.reduce(
      (total, caseRecord) => total + numericAmount(caseRecord.exposureAmount),
      0,
    );
    const recovered = activeCases.reduce(
      (total, caseRecord) => total + numericAmount(caseRecord.recoveredAmount),
      0,
    );
    return { unmatched, exposure, recovered };
  }, [activeCases]);

  const resolveMutation = useMutation({
    mutationFn: async (request: PendingResolution) =>
      adminAdverseFundingApi.resolveCase(
        request.caseId,
        request.payload,
        request.idempotencyKey,
      ),
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: ["admin-adverse-funding-cases"],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "admin-adverse-funding-review-logs",
          pendingResolution?.caseId,
        ],
      });
      setConfirmOpen(false);
      setPendingResolution(null);
      setAttempt(null);
      setAttemptWarning(null);
      toast.success(
        response.data.idempotent
          ? "The original resolution receipt was returned"
          : "Funding review decision recorded",
      );
    },
    onError: (error: unknown) => {
      toast.error(
        getErrorMessage(error, "Could not record the funding review decision"),
      );
    },
  });

  const recheckMutation = useMutation({
    mutationFn: async (request: PendingRecheck) =>
      adminAdverseFundingApi.recheckCase(
        request.caseId,
        { reason: request.reason },
        request.idempotencyKey,
      ),
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: ["admin-adverse-funding-cases"],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin-adverse-funding-review-logs", pendingRecheck?.caseId],
      });
      setRecheckConfirmOpen(false);
      setPendingRecheck(null);
      setRecheckAttempt(null);
      setRecheckWarning(null);
      toast.success(
        response.data.reviewRequired
          ? "Provider recheck recorded; the hold remains active"
          : "Provider recheck completed",
      );
    },
    onError: (error: unknown) => {
      toast.error(
        getErrorMessage(error, "Could not recheck the provider evidence"),
      );
    },
  });

  function beginResolution() {
    if (!selectedCase) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10 || trimmedReason.length > 500) {
      toast.error("Enter an audit reason between 10 and 500 characters");
      return;
    }
    if (action === "COLLECT") {
      if (!canCollect(selectedCase)) {
        toast.error(
          "Collection is available only for a verified processed refund",
        );
        return;
      }
      if (!MONEY_PATTERN.test(amount.trim()) || Number(amount) <= 0) {
        toast.error(
          "Enter a positive collection amount with up to two decimals",
        );
        return;
      }
      if (Number(amount) > remainingAmount(selectedCase)) {
        toast.error("The amount exceeds the unresolved exposure for this case");
        return;
      }
    }

    const payload: PaystackAdverseFundingResolution = {
      action,
      reason: trimmedReason,
      ...(action === "COLLECT" ? { amount: amount.trim() } : {}),
    };
    const fingerprint = JSON.stringify({ caseId: selectedCase.id, ...payload });
    const sameAttempt = attempt?.fingerprint === fingerprint;
    const idempotencyKey = sameAttempt
      ? attempt.idempotencyKey
      : createMoneyAttemptIdempotencyKey("adverse-funding");

    if (attempt && !sameAttempt) {
      setAttemptWarning(
        "The review details changed, so this submission has a new idempotency key. Keep the details unchanged if you need to retry the same attempt.",
      );
    } else if (!attempt) {
      setAttemptWarning(null);
    }

    const nextAttempt = { idempotencyKey, fingerprint };
    setAttempt(nextAttempt);
    setPendingResolution({
      caseId: selectedCase.id,
      payload,
      idempotencyKey,
      fingerprint,
    });
    setConfirmOpen(true);
  }

  function confirmResolution() {
    if (!pendingResolution || resolveMutation.isPending) return;
    resolveMutation.mutate(pendingResolution);
  }

  function beginRecheck() {
    if (!selectedCase || !canRecheck(selectedCase)) return;
    const trimmedReason = recheckReason.trim();
    if (trimmedReason.length < 10 || trimmedReason.length > 500) {
      toast.error("Enter a recheck reason between 10 and 500 characters");
      return;
    }

    const fingerprint = JSON.stringify({
      caseId: selectedCase.id,
      reason: trimmedReason,
    });
    const sameAttempt = recheckAttempt?.fingerprint === fingerprint;
    const idempotencyKey = sameAttempt
      ? recheckAttempt.idempotencyKey
      : createMoneyAttemptIdempotencyKey("adverse-funding");

    if (recheckAttempt && !sameAttempt) {
      setRecheckWarning(
        "The recheck details changed, so this submission has a new idempotency key. Keep the details unchanged if you need to retry the same attempt.",
      );
    } else if (!recheckAttempt) {
      setRecheckWarning(null);
    }

    const nextAttempt = { idempotencyKey, fingerprint };
    setRecheckAttempt(nextAttempt);
    setPendingRecheck({
      caseId: selectedCase.id,
      reason: trimmedReason,
      idempotencyKey,
      fingerprint,
    });
    setRecheckConfirmOpen(true);
  }

  function confirmRecheck() {
    if (!pendingRecheck || recheckMutation.isPending) return;
    recheckMutation.mutate(pendingRecheck);
  }

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
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-red-300">
              <ShieldAlert className="size-4" />
              Financial operations
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Funding review
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review Paystack refunds and disputes that may affect credited
              wallet funds. Provider webhooks create held cases; this screen
              never collects automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => casesQuery.refetch()}
              disabled={casesQuery.isFetching}
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  casesQuery.isFetching && "animate-spin",
                )}
              />
              Refresh queue
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/admin/audit?targetType=FundingAdverseCase">
                <ExternalLink className="size-4" />
                Audit trail
              </a>
            </Button>
          </div>
        </div>

        {activeCases.length > 0 && (
          <div
            role="alert"
            className="rounded-xl border border-amber-400/35 bg-amber-400/[0.08] p-4 text-sm text-amber-100"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" />
              <div>
                <p className="font-semibold">Global outbound hold is active</p>
                <p className="mt-1 max-w-4xl leading-6 text-amber-100/80">
                  {metrics.unmatched > 0
                    ? `${metrics.unmatched} UNMATCHED case${metrics.unmatched === 1 ? " is" : "s are"} holding outbound settlement while provider ownership or transaction evidence is reviewed. `
                    : "Active adverse-funding cases are holding outbound settlement. "}
                  Do not release a hold without independent evidence and an
                  audit reason. Incoming credits and compensating reversals
                  remain separate from this review queue.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active holds"
            value={String(activeCases.length)}
            detail="Cases currently blocking outbound settlement"
            icon={ShieldAlert}
            tone={activeCases.length > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Verified exposure"
            value={formatMoney(metrics.exposure)}
            detail="Independent provider amount, not webhook amount"
            icon={WalletCards}
            tone={metrics.exposure > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Recovered"
            value={formatMoney(metrics.recovered)}
            detail="Ledger recovery already posted"
            icon={CheckCircle2}
          />
          <StatCard
            label="Needs review"
            value={String(metrics.unmatched)}
            detail="UNMATCHED cases require manual evidence"
            icon={Clock3}
            tone={metrics.unmatched > 0 ? "danger" : "neutral"}
          />
        </div>

        <Card className="border-white/10 bg-white/[0.025]">
          <CardHeader className="gap-4 border-b border-white/10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle>Adverse funding cases</CardTitle>
              <CardDescription className="mt-1">
                Only sanitized case fields are shown. Provider payloads and
                credentials are never rendered here.
              </CardDescription>
            </div>
            <div className="w-full sm:w-48">
              <Label htmlFor="funding-review-status">Queue</Label>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as StatusFilter)
                }
              >
                <SelectTrigger
                  id="funding-review-status"
                  className="mt-2 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active holds</SelectItem>
                  <SelectItem value="ALL">All cases</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {casesQuery.isLoading ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3, 4].map((item) => (
                  <Skeleton key={item} className="h-14 w-full" />
                ))}
              </div>
            ) : casesQuery.isError ? (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <AlertTriangle className="size-6 text-red-300" />
                <p className="text-sm text-red-200">
                  {getErrorMessage(
                    casesQuery.error,
                    "Could not load adverse funding cases",
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => casesQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : visibleCases.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                <ShieldCheck className="size-8 text-emerald-300" />
                <p className="font-medium">No cases in this queue</p>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  {statusFilter === "ACTIVE"
                    ? "No unresolved Paystack refund or dispute holds are waiting for an operator."
                    : "Try another queue filter or refresh the list."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event / source</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Exposure</TableHead>
                    <TableHead>Recovered</TableHead>
                    <TableHead>Hold</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCases.map((caseRecord) => (
                    <TableRow
                      key={caseRecord.id}
                      className={cn(
                        "cursor-pointer",
                        selectedCaseId === caseRecord.id && "bg-red-500/[0.08]",
                      )}
                      onClick={() => selectCase(caseRecord.id)}
                    >
                      <TableCell className="min-w-56">
                        <p className="font-medium">
                          {humanize(caseRecord.eventType)}
                        </p>
                        <p
                          className="mt-1 max-w-64 truncate font-mono text-xs text-muted-foreground"
                          title={caseRecord.providerReference}
                        >
                          {compactReference(caseRecord.providerReference)}
                        </p>
                        <p
                          className="mt-1 max-w-64 truncate text-xs text-muted-foreground"
                          title={caseRecord.fundingReference ?? undefined}
                        >
                          Funding:{" "}
                          {compactReference(caseRecord.fundingReference)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge
                            variant={statusVariant(
                              caseRecord.verificationStatus,
                            )}
                          >
                            {humanize(caseRecord.verificationStatus)}
                          </Badge>
                          <Badge variant={statusVariant(caseRecord.status)}>
                            {humanize(caseRecord.status)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {caseRecord.exposureAmount == null
                          ? "Pending verification"
                          : formatMoney(
                              caseRecord.exposureAmount,
                              caseRecord.currency ?? "NGN",
                            )}
                      </TableCell>
                      <TableCell>
                        {formatMoney(
                          caseRecord.recoveredAmount,
                          caseRecord.currency ?? "NGN",
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            caseRecord.holdRequired ? "destructive" : "outline"
                          }
                        >
                          {caseRecord.holdRequired ? "Global hold" : "Released"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(caseRecord.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={
                            selectedCaseId === caseRecord.id
                              ? "default"
                              : "outline"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            selectCase(caseRecord.id);
                          }}
                        >
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selectedCase && (
          <Card className="border-red-400/20 bg-red-500/[0.025]">
            <CardHeader className="border-b border-white/10">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <CardTitle>Review case</CardTitle>
                  <CardDescription className="mt-1 font-mono text-xs">
                    {selectedCase.id}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={statusVariant(selectedCase.verificationStatus)}
                  >
                    {humanize(selectedCase.verificationStatus)}
                  </Badge>
                  <Badge variant={statusVariant(selectedCase.status)}>
                    {humanize(selectedCase.status)}
                  </Badge>
                  <Badge
                    variant={
                      selectedCase.holdRequired ? "destructive" : "outline"
                    }
                  >
                    {selectedCase.holdRequired ? "Global hold" : "Released"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 p-4 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReferenceValue
                  label="Provider"
                  value={selectedCase.provider}
                />
                <ReferenceValue label="Event" value={selectedCase.eventType} />
                <ReferenceValue
                  label="Provider reference"
                  value={selectedCase.providerReference}
                />
                <ReferenceValue
                  label="Economic reference"
                  value={selectedCase.economicReference}
                />
                <ReferenceValue
                  label="Funding reference"
                  value={selectedCase.fundingReference}
                />
                <ReferenceValue
                  label="Transaction ID"
                  value={selectedCase.transactionId}
                />
                <ReferenceValue label="User ID" value={selectedCase.userId} />
                <ReferenceValue
                  label="Provider status"
                  value={selectedCase.providerStatus}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Verified exposure
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {selectedCase.exposureAmount == null
                      ? "Pending verification"
                      : formatMoney(
                          selectedCase.exposureAmount,
                          selectedCase.currency ?? "NGN",
                        )}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Recovered
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatMoney(
                      selectedCase.recoveredAmount,
                      selectedCase.currency ?? "NGN",
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Remaining case exposure
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatMoney(
                      remainingAmount(selectedCase),
                      selectedCase.currency ?? "NGN",
                    )}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-muted/20 p-4 text-sm leading-6">
                <p className="font-medium">
                  Review reason and operator guidance
                </p>
                <p className="mt-1 text-muted-foreground">
                  {selectedReviewLog?.reason ??
                    (selectedCase.verificationStatus === "UNMATCHED"
                      ? "Independent provider ownership or transaction evidence did not match. Verify Paystack customer and transaction records before releasing this hold."
                      : "No separate review reason is recorded. Re-check the provider status, original funding reference, and exact independently verified amount before deciding.")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Created {formatDateTime(selectedCase.createdAt)} · Updated{" "}
                  {formatDateTime(selectedCase.updatedAt)}
                </p>
              </div>

              {canRecheck(selectedCase) && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-amber-100">
                      Provider recheck
                    </p>
                    <p className="text-sm leading-6 text-amber-100/80">
                      Use this when the original funding or corrected Paystack
                      evidence may now be available. The signed event stored at
                      ingest is reused; provider data cannot be edited here.
                      Rechecking updates evidence and the hold only—no ledger
                      debit is performed.
                    </p>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="funding-recheck-reason">
                        Recheck reason
                      </Label>
                      <textarea
                        id="funding-recheck-reason"
                        value={recheckReason}
                        onChange={(event) =>
                          setRecheckReason(event.target.value)
                        }
                        maxLength={500}
                        minLength={10}
                        rows={3}
                        placeholder="Explain what changed and why provider evidence should be checked again."
                        className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        {recheckReason.trim().length}/500 characters · at least
                        10 required
                      </p>
                    </div>
                    {recheckWarning && (
                      <p
                        role="alert"
                        className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-xs leading-5 text-amber-100"
                      >
                        {recheckWarning}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        onClick={beginRecheck}
                        disabled={recheckMutation.isPending}
                      >
                        {recheckMutation.isPending && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Recheck provider
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Requires an audit reason and a confirmation step.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {selectedCase.holdRequired ? (
                <div className="grid gap-4 border-t border-white/10 pt-5 lg:grid-cols-[220px_1fr]">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="funding-review-action">Decision</Label>
                    <Select
                      value={action}
                      onValueChange={(value) =>
                        setAction(value as ResolutionAction)
                      }
                    >
                      <SelectTrigger
                        id="funding-review-action"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RELEASE_HOLD">
                          Release hold
                        </SelectItem>
                        <SelectItem
                          value="COLLECT"
                          disabled={!canCollect(selectedCase)}
                        >
                          Collect explicit amount
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Collection is enabled only for a VERIFIED, independently
                      processed Paystack refund.
                    </p>
                  </div>

                  <div className="flex flex-col gap-4">
                    {action === "COLLECT" && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="funding-review-amount">
                          Amount to collect
                        </Label>
                        <Input
                          id="funding-review-amount"
                          inputMode="decimal"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                          placeholder="0.00"
                          maxLength={16}
                          aria-describedby="funding-review-amount-help"
                        />
                        <p
                          id="funding-review-amount-help"
                          className="text-xs text-muted-foreground"
                        >
                          Enter an explicit amount only. Remaining case exposure
                          is{" "}
                          {formatMoney(
                            remainingAmount(selectedCase),
                            selectedCase.currency ?? "NGN",
                          )}
                          ; the server rechecks overlapping refunds and wallet
                          balance inside the transaction.
                        </p>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="funding-review-reason">
                        Audit reason
                      </Label>
                      <textarea
                        id="funding-review-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        maxLength={500}
                        minLength={10}
                        rows={3}
                        placeholder="Describe the evidence reviewed and why this decision is appropriate."
                        className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        {reason.trim().length}/500 characters · at least 10
                        required
                      </p>
                    </div>
                    {attemptWarning && (
                      <p
                        role="alert"
                        className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-xs leading-5 text-amber-100"
                      >
                        {attemptWarning}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        onClick={beginResolution}
                        disabled={resolveMutation.isPending}
                      >
                        {resolveMutation.isPending && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {action === "COLLECT"
                          ? "Review collection"
                          : "Review hold release"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        A confirmation step is required; no decision is
                        automatic.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-4 text-sm leading-6 text-emerald-100">
                  This case no longer carries an outbound hold. Review the audit
                  trail for the operator decision and recovery receipt.
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingResolution?.payload.action === "COLLECT"
                ? "Confirm explicit collection"
                : "Confirm hold release"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingResolution?.payload.action === "COLLECT"
                ? `This will request a ledger debit of ${formatMoney(pendingResolution.payload.amount, selectedCase?.currency ?? "NGN")} for the independently verified refund. It is bounded and will never debit below zero.`
                : "This will release the global outbound hold for this case. Confirm that the provider evidence and audit reason are complete."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolveMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmResolution}
              disabled={resolveMutation.isPending}
              variant={
                pendingResolution?.payload.action === "COLLECT"
                  ? "destructive"
                  : "default"
              }
            >
              {resolveMutation.isPending ? "Saving…" : "Confirm decision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={recheckConfirmOpen}
        onOpenChange={setRecheckConfirmOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm provider recheck</AlertDialogTitle>
            <AlertDialogDescription>
              This will re-run independent Paystack verification using the
              stored signed event. It will not debit the wallet or release the
              hold automatically. Confirm that the reason and operator evidence
              are complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recheckMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRecheck}
              disabled={recheckMutation.isPending}
            >
              {recheckMutation.isPending ? "Checking…" : "Confirm recheck"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

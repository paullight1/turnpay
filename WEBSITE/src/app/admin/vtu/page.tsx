"use client";

import { hasAdminAccess } from "@/lib/admin-access";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/lib/auth-provider";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { adminVtuApi } from "@/services/api";
import type {
  AdminVtuPricingRule,
  AdminVtuPricingRulePayload,
  AdminVtuProviderHealth,
  AdminVtuReconciliationException,
  AdminVtuReconciliationExceptions,
  AdminVtuStaleOrder,
} from "@/types";

const DEFAULT_OLDER_THAN_MINUTES = 10;
const DEFAULT_LIMIT = 50;
const ANY_VALUE = "ANY";
const SERVICE_TYPES = ["AIRTIME", "DATA", "CABLE", "ELECTRICITY"] as const;
const SCOPES = ["LOCAL", "INTERNATIONAL"] as const;

const statusVariants: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  SUCCESS: "default",
  PENDING: "secondary",
  PROCESSING: "secondary",
  UNKNOWN: "outline",
  FAILED: "destructive",
  REVERSED: "destructive",
};

const currencyCountries: Record<string, string> = {
  GHS: "GH",
  NGN: "NG",
};

type PricingFormState = {
  countryCode: string;
  serviceType: string;
  provider: string;
  scope: string;
  fixedMargin: string;
  percentMargin: string;
  minAmount: string;
  maxAmount: string;
  priority: string;
  isActive: "true" | "false";
  reason: string;
};

type ReconciliationExceptionRow = AdminVtuReconciliationException & {
  category: keyof AdminVtuReconciliationExceptions;
  risk: "High" | "Review";
};

const defaultPricingForm: PricingFormState = {
  countryCode: "",
  serviceType: ANY_VALUE,
  provider: "",
  scope: ANY_VALUE,
  fixedMargin: "0",
  percentMargin: "0",
  minAmount: "",
  maxAmount: "",
  priority: "0",
  isActive: "true",
  reason: "",
};

function statusVariant(status?: string | null) {
  return statusVariants[status ?? ""] ?? "secondary";
}

function humanize(value?: string | null) {
  if (!value) return "Not provided";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(amount: number | string, currency: string) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${currency} ${String(amount)}`;

  return `${currency} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getCountry(order: AdminVtuStaleOrder) {
  return order.countryCode ?? currencyCountries[order.currency] ?? "N/A";
}

function hasPositiveAmount(value?: number | string | null) {
  return Number(value ?? 0) > 0;
}

function formatProviderBalance(provider: AdminVtuProviderHealth) {
  if (!provider.supportsBalance) return "Not supported";
  if (provider.balance.status !== "available") {
    return provider.balance.status === "error" ? "Unavailable" : "Unknown";
  }

  return formatMoney(
    provider.balance.amount ?? 0,
    provider.balance.currency ?? "NGN",
  );
}

function providerHealthLabel(provider: AdminVtuProviderHealth) {
  if (!provider.enabled) return "Disabled";
  if (!provider.configured) return "Missing config";
  if (provider.balance.status === "error") return "Check failed";
  if (provider.warnings.length > 0) return "Warning";
  return "Healthy";
}

function providerHealthVariant(
  provider: AdminVtuProviderHealth,
): "default" | "secondary" | "destructive" | "outline" {
  if (!provider.configured || provider.balance.status === "error") {
    return "destructive";
  }

  if (!provider.enabled || provider.warnings.length > 0) {
    return "secondary";
  }

  return "default";
}

function toCount(value?: number | null) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function totalExceptionCount(
  exceptions?: Partial<AdminVtuReconciliationExceptions>,
) {
  if (!exceptions) return 0;

  return (
    (exceptions.amountMismatches?.length ?? 0) +
    (exceptions.feeMismatches?.length ?? 0) +
    (exceptions.missingDebits?.length ?? 0) +
    (exceptions.missingReversals?.length ?? 0) +
    (exceptions.staleOrders?.length ?? 0)
  );
}

function buildExceptionRows(
  exceptions?: Partial<AdminVtuReconciliationExceptions>,
): ReconciliationExceptionRow[] {
  if (!exceptions) return [];

  const rows: ReconciliationExceptionRow[] = [];
  const append = (
    category: keyof AdminVtuReconciliationExceptions,
    risk: ReconciliationExceptionRow["risk"],
  ) => {
    for (const exception of exceptions[category] ?? []) {
      rows.push({ ...exception, category, risk });
    }
  };

  append("missingDebits", "High");
  append("missingReversals", "High");
  append("amountMismatches", "High");
  append("feeMismatches", "Review");
  append("staleOrders", "Review");

  return rows.slice(0, 10);
}

function exceptionLabel(category: keyof AdminVtuReconciliationExceptions) {
  const labels: Record<keyof AdminVtuReconciliationExceptions, string> = {
    amountMismatches: "Amount mismatch",
    feeMismatches: "Fee mismatch",
    missingDebits: "Missing debit",
    missingReversals: "Missing reversal",
    staleOrders: "Stale order",
  };

  return labels[category];
}

function exceptionReference(exception: AdminVtuReconciliationException) {
  return (
    exception.transactionReference ??
    exception.reference ??
    exception.orderId ??
    "No reference"
  );
}

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== ANY_VALUE ? trimmed : undefined;
}

function pricingRuleToForm(rule: AdminVtuPricingRule): PricingFormState {
  return {
    countryCode: rule.countryCode ?? "",
    serviceType: rule.serviceType ?? ANY_VALUE,
    provider: rule.provider ?? "",
    scope: rule.scope ?? ANY_VALUE,
    fixedMargin: String(rule.fixedMargin ?? "0"),
    percentMargin: String(rule.percentMargin ?? "0"),
    minAmount: rule.minAmount == null ? "" : String(rule.minAmount),
    maxAmount: rule.maxAmount == null ? "" : String(rule.maxAmount),
    priority: String(rule.priority ?? 0),
    isActive: rule.isActive ? "true" : "false",
    reason: "",
  };
}

function buildPricingPayload(
  form: PricingFormState,
): AdminVtuPricingRulePayload {
  return {
    reason: form.reason.trim(),
    countryCode: normalizeOptional(form.countryCode)?.toUpperCase(),
    serviceType: normalizeOptional(form.serviceType),
    provider: normalizeOptional(form.provider)?.toLowerCase(),
    scope: normalizeOptional(form.scope),
    fixedMargin: form.fixedMargin.trim() || "0",
    percentMargin: form.percentMargin.trim() || "0",
    minAmount: normalizeOptional(form.minAmount),
    maxAmount: normalizeOptional(form.maxAmount),
    priority: Number(form.priority || 0),
    isActive: form.isActive === "true",
  };
}

export default function AdminVtuPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = hasAdminAccess(user) || hasAdminAccess(profile);
  const [olderThanMinutes, setOlderThanMinutes] = useState(
    DEFAULT_OLDER_THAN_MINUTES,
  );
  const [selectedOrder, setSelectedOrder] = useState<AdminVtuStaleOrder | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [requeryAttemptKey, setRequeryAttemptKey] = useState<string | null>(
    null,
  );
  const [pricingDialogMode, setPricingDialogMode] = useState<
    "create" | "edit" | null
  >(null);
  const [selectedPricingRule, setSelectedPricingRule] =
    useState<AdminVtuPricingRule | null>(null);
  const [pricingForm, setPricingForm] =
    useState<PricingFormState>(defaultPricingForm);
  const [pricingAttemptKey, setPricingAttemptKey] = useState<string | null>(
    null,
  );
  const [ruleToDeactivate, setRuleToDeactivate] =
    useState<AdminVtuPricingRule | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateAttemptKey, setDeactivateAttemptKey] = useState<
    string | null
  >(null);

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
  }, [authLoading, profile, user, router]);

  const staleOrdersQuery = useQuery({
    queryKey: ["admin-vtu-stale-orders", olderThanMinutes, DEFAULT_LIMIT],
    queryFn: async () => {
      const res = await adminVtuApi.getStaleOrders({
        olderThanMinutes,
        limit: DEFAULT_LIMIT,
      });
      return res.data;
    },
    enabled: isAdmin,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const pricingRulesQuery = useQuery({
    queryKey: ["admin-vtu-pricing-rules"],
    queryFn: async () => {
      const res = await adminVtuApi.getPricingRules({ limit: DEFAULT_LIMIT });
      return res.data;
    },
    enabled: isAdmin,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const reconciliationQuery = useQuery({
    queryKey: ["admin-vtu-reconciliation", olderThanMinutes, DEFAULT_LIMIT],
    queryFn: async () => {
      const res = await adminVtuApi.getReconciliation({
        olderThanMinutes,
        limit: DEFAULT_LIMIT,
      });
      return res.data;
    },
    enabled: isAdmin,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const providerHealthQuery = useQuery({
    queryKey: ["admin-vtu-provider-health"],
    queryFn: async () => {
      const res = await adminVtuApi.getProviderHealth();
      return res.data;
    },
    enabled: isAdmin,
    staleTime: 60000,
    refetchInterval: 30000,
  });

  const orders = useMemo(
    () => staleOrdersQuery.data?.orders ?? [],
    [staleOrdersQuery.data?.orders],
  );

  const summary = useMemo(() => {
    const pending = orders.filter((order) => order.status === "PENDING").length;
    const processing = orders.filter(
      (order) => order.status === "PROCESSING",
    ).length;
    const unknown = orders.filter((order) => order.status === "UNKNOWN").length;
    const maxAttempts = orders.reduce(
      (max, order) => Math.max(max, order.attempts),
      0,
    );

    return { pending, processing, unknown, maxAttempts };
  }, [orders]);

  const reconciliationExceptions = useMemo(
    () => buildExceptionRows(reconciliationQuery.data?.exceptions),
    [reconciliationQuery.data?.exceptions],
  );

  const reconciliationSummary = reconciliationQuery.data?.summary;
  const reconciliationCurrency =
    reconciliationSummary?.currency ??
    reconciliationQuery.data?.providerBreakdown?.[0]?.currency ??
    "NGN";
  const exceptionCount =
    reconciliationSummary?.highRiskExceptions ??
    totalExceptionCount(reconciliationQuery.data?.exceptions);

  const requeryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("No VTU order selected");
      const idempotencyKey =
        requeryAttemptKey ?? createMoneyAttemptIdempotencyKey("vtu-requery");
      setRequeryAttemptKey(idempotencyKey);

      const res = await adminVtuApi.requeryOrder(
        selectedOrder.transactionReference,
        { reason: reason.trim() },
        idempotencyKey,
      );
      return res.data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-vtu-stale-orders"],
      });
      setSelectedOrder(null);
      setReason("");
      setRequeryAttemptKey(null);
      toast.success(`Requery submitted for ${data.reference}`);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not requery VTU order"));
    },
  });

  const pricingRuleMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPricingPayload(pricingForm);
      const idempotencyKey =
        pricingAttemptKey ?? createMoneyAttemptIdempotencyKey("vtu-pricing");
      setPricingAttemptKey(idempotencyKey);

      if (pricingDialogMode === "edit" && selectedPricingRule) {
        const res = await adminVtuApi.updatePricingRule(
          selectedPricingRule.id,
          payload,
          idempotencyKey,
        );
        return res.data;
      }

      const res = await adminVtuApi.createPricingRule(payload, idempotencyKey);
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-vtu-pricing-rules"],
      });
      setPricingDialogMode(null);
      setSelectedPricingRule(null);
      setPricingForm(defaultPricingForm);
      setPricingAttemptKey(null);
      toast.success("VTU pricing rule saved");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not save pricing rule"));
    },
  });

  const deactivatePricingRuleMutation = useMutation({
    mutationFn: async () => {
      if (!ruleToDeactivate) throw new Error("No pricing rule selected");
      const idempotencyKey =
        deactivateAttemptKey ?? createMoneyAttemptIdempotencyKey("vtu-pricing");
      setDeactivateAttemptKey(idempotencyKey);

      const res = await adminVtuApi.deactivatePricingRule(
        ruleToDeactivate.id,
        { reason: deactivateReason.trim() },
        idempotencyKey,
      );
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-vtu-pricing-rules"],
      });
      setRuleToDeactivate(null);
      setDeactivateReason("");
      setDeactivateAttemptKey(null);
      toast.success("VTU pricing rule deactivated");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not deactivate pricing rule"));
    },
  });

  const openRequeryDialog = (order: AdminVtuStaleOrder) => {
    setSelectedOrder(order);
    setReason("");
    setRequeryAttemptKey(createMoneyAttemptIdempotencyKey("vtu-requery"));
  };

  const openCreatePricingDialog = () => {
    setSelectedPricingRule(null);
    setPricingForm(defaultPricingForm);
    setPricingDialogMode("create");
    setPricingAttemptKey(createMoneyAttemptIdempotencyKey("vtu-pricing"));
  };

  const openEditPricingDialog = (rule: AdminVtuPricingRule) => {
    setSelectedPricingRule(rule);
    setPricingForm(pricingRuleToForm(rule));
    setPricingDialogMode("edit");
    setPricingAttemptKey(createMoneyAttemptIdempotencyKey("vtu-pricing"));
  };

  const submitPricingRule = () => {
    const reason = pricingForm.reason.trim();
    if (reason.length < 10) {
      toast.error("Enter a pricing change reason of at least 10 characters");
      return;
    }

    const minAmount = Number(pricingForm.minAmount || 0);
    const maxAmount = Number(pricingForm.maxAmount || 0);
    if (
      pricingForm.minAmount &&
      pricingForm.maxAmount &&
      minAmount > maxAmount
    ) {
      toast.error("Minimum amount cannot exceed maximum amount");
      return;
    }

    pricingRuleMutation.mutate();
  };

  const openDeactivateDialog = (rule: AdminVtuPricingRule) => {
    setRuleToDeactivate(rule);
    setDeactivateReason("");
    setDeactivateAttemptKey(createMoneyAttemptIdempotencyKey("vtu-pricing"));
  };

  const submitDeactivateRule = () => {
    if (deactivateReason.trim().length < 10) {
      toast.error("Enter a deactivation reason of at least 10 characters");
      return;
    }

    deactivatePricingRuleMutation.mutate();
  };

  const submitRequery = () => {
    if (!reason.trim() || reason.trim().length < 10) {
      toast.error("Enter a requery reason of at least 10 characters");
      return;
    }

    requeryMutation.mutate();
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
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold">VTU operations</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor provider health and resolve delayed orders.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-44">
              <Label htmlFor="older-than">Stale after (minutes)</Label>
              <Input
                id="older-than"
                min={1}
                max={1440}
                type="number"
                value={olderThanMinutes}
                onChange={(event) =>
                  setOlderThanMinutes(
                    Math.min(
                      1440,
                      Math.max(1, Number(event.target.value) || 1),
                    ),
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Card size="sm">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stale orders</p>
              <p className="text-2xl font-semibold">
                {staleOrdersQuery.data?.count ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Older than {olderThanMinutes} minutes</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending</p>
              <p className="text-2xl font-semibold">{summary.pending}</p>
              <p className="text-xs text-muted-foreground">Provider confirmation open</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Processing</p>
              <p className="text-2xl font-semibold">{summary.processing}</p>
              <p className="text-xs text-muted-foreground">Awaiting final state</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Max attempts</p>
              <p className="text-2xl font-semibold">{summary.maxAttempts}</p>
              <p className="text-xs text-muted-foreground">{summary.unknown} unknown status</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Provider status</CardTitle>
              <CardDescription>
                {providerHealthQuery.data?.providers.length ?? 0} provider{providerHealthQuery.data?.providers.length === 1 ? "" : "s"} monitored. Balance checks reflect provider availability.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {providerHealthQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : providerHealthQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertTriangle className="size-8 text-destructive" />
                <p className="text-sm font-medium">
                  Could not load provider health
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {getErrorMessage(
                    providerHealthQuery.error,
                    "Provider health is unavailable. Try again shortly.",
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void providerHealthQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (providerHealthQuery.data?.providers ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No provider health rows are available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead className="hidden xl:table-cell">Checked</TableHead>
                      <TableHead className="min-w-52">Warnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerHealthQuery.data?.providers.map((provider) => (
                      <TableRow key={provider.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">{provider.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {provider.configured
                                ? "Configured"
                                : "Configuration incomplete"}{" "}
                              · {provider.enabled ? "Enabled" : "Disabled"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={providerHealthVariant(provider)}>
                            {providerHealthLabel(provider)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">
                              {formatProviderBalance(provider)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Balance status {humanize(provider.balance.status)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                          {formatDateTime(provider.balance.checkedAt)}
                        </TableCell>
                        <TableCell>
                          {provider.warnings.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              None
                            </span>
                          ) : (
                            <div className="space-y-1">
                              {provider.warnings.slice(0, 3).map((warning) => (
                                <p
                                  key={warning}
                                  className="max-w-64 truncate text-sm text-muted-foreground"
                                >
                                  {warning}
                                </p>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Reconciliation</CardTitle>
              <CardDescription>
                Find missing debits, reversals, and amount mismatches.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {reconciliationQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : reconciliationQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertTriangle className="size-8 text-destructive" />
                <p className="text-sm font-medium">
                  Could not load VTU reconciliation report
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {getErrorMessage(
                    reconciliationQuery.error,
                    "Reconciliation is unavailable. Try again shortly.",
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void reconciliationQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : !reconciliationQuery.data ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No reconciliation report is available yet.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Orders reviewed
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {toCount(reconciliationSummary?.totalOrders)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Exceptions {exceptionCount}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Customer amount
                    </p>
                    <p className="mt-1 text-xl font-semibold">
                      {formatMoney(
                        reconciliationSummary?.totalAmount ?? 0,
                        reconciliationCurrency,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cost{" "}
                      {formatMoney(
                        reconciliationSummary?.totalCostAmount ?? 0,
                        reconciliationCurrency,
                      )}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Fees / margin
                    </p>
                    <p className="mt-1 text-xl font-semibold">
                      {formatMoney(
                        reconciliationSummary?.totalFees ?? 0,
                        reconciliationCurrency,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Margin{" "}
                      {formatMoney(
                        reconciliationSummary?.totalMargin ?? 0,
                        reconciliationCurrency,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Provider commission{" "}
                      {formatMoney(
                        reconciliationSummary?.totalProviderCommission ?? 0,
                        reconciliationCurrency,
                      )}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Risk queue</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {toCount(reconciliationSummary?.missingDebits) +
                        toCount(reconciliationSummary?.missingReversals) +
                        toCount(reconciliationSummary?.amountMismatches)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Missing debits, reversals, and amount breaks
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="mb-3 text-sm font-medium">Exception counts</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          "amountMismatches",
                          "feeMismatches",
                          "missingDebits",
                          "missingReversals",
                          "staleOrders",
                        ] as const
                      ).map((category) => (
                        <div
                          key={category}
                          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                        >
                          <span className="text-xs text-muted-foreground">
                            {exceptionLabel(category)}
                          </span>
                          <span className="font-mono text-sm font-semibold">
                            {reconciliationQuery.data.exceptions[category]
                              ?.length ??
                              toCount(reconciliationSummary?.[category])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <p className="mb-3 text-sm font-medium">Breakdowns</p>
                    {reconciliationQuery.data.providerBreakdown.length === 0 &&
                    reconciliationQuery.data.statusBreakdown.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No provider or status rows in this report.
                      </p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Provider
                          </p>
                          {reconciliationQuery.data.providerBreakdown
                            .slice(0, 4)
                            .map((provider) => (
                              <div
                                key={`${provider.provider ?? "provider"}-${provider.status ?? "all"}`}
                                className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                              >
                                <div>
                                  <p className="text-sm font-medium">
                                    {humanize(provider.provider)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {provider.count} orders · Margin{" "}
                                    {formatMoney(
                                      provider.margin ?? 0,
                                      provider.currency ??
                                        reconciliationCurrency,
                                    )}
                                  </p>
                                </div>
                              </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Status
                          </p>
                          {reconciliationQuery.data.statusBreakdown
                            .slice(0, 4)
                            .map((status) => (
                              <div
                                key={`${status.status ?? "status"}-${status.count}`}
                                className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                              >
                                <Badge variant={statusVariant(status.status)}>
                                  {humanize(status.status)}
                                </Badge>
                                <span className="font-mono text-sm font-semibold">
                                  {status.count}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {reconciliationExceptions.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    No high-risk exceptions in this report.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Risk</TableHead>
                          <TableHead>Exception</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Amount / Fee</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliationExceptions.map((exception, index) => (
                          <TableRow
                            key={`${exception.category}-${exceptionReference(exception)}-${index}`}
                          >
                            <TableCell>
                              <Badge
                                variant={
                                  exception.risk === "High"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {exception.risk}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {exceptionLabel(exception.category)}
                                </p>
                                <p className="max-w-48 truncate text-xs text-muted-foreground">
                                  {exception.reason || "Review ledger state"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {humanize(exception.provider)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {humanize(exception.serviceType)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {exceptionReference(exception)}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-xs">
                                <p>
                                  Amount{" "}
                                  {formatMoney(
                                    exception.actualAmount ??
                                      exception.amount ??
                                      0,
                                    exception.currency ??
                                      reconciliationCurrency,
                                  )}
                                </p>
                                <p className="text-muted-foreground">
                                  Expected{" "}
                                  {formatMoney(
                                    exception.expectedAmount ??
                                      exception.expectedFee ??
                                      exception.fee ??
                                      0,
                                    exception.currency ??
                                      reconciliationCurrency,
                                  )}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {exception.status && (
                                  <Badge
                                    variant={statusVariant(exception.status)}
                                  >
                                    {humanize(exception.status)}
                                  </Badge>
                                )}
                                {exception.transactionStatus && (
                                  <Badge
                                    variant={statusVariant(
                                      exception.transactionStatus,
                                    )}
                                  >
                                    Tx {humanize(exception.transactionStatus)}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(
                                exception.updatedAt ?? exception.createdAt,
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="rounded-md border p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Callback retries</p>
                      <p className="text-xs text-muted-foreground">
                        Redacted VTpass callbacks waiting for automatic retry.
                      </p>
                    </div>
                    <Badge
                      variant={
                        reconciliationQuery.data.callbackFailures.length > 0
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {reconciliationQuery.data.callbackFailures.length}
                    </Badge>
                  </div>
                  {reconciliationQuery.data.callbackFailures.length === 0 ? (
                    <div className="flex items-center justify-between gap-3 py-1 text-sm text-muted-foreground">
                      <span>No failed callbacks awaiting retry.</span>
                      <Badge variant="outline">Clear</Badge>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Provider request</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Attempts</TableHead>
                            <TableHead>Next retry</TableHead>
                            <TableHead>Last error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reconciliationQuery.data.callbackFailures.map(
                            (failure) => (
                              <TableRow key={failure.providerRequestId}>
                                <TableCell className="font-mono text-xs">
                                  {failure.providerRequestId}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={statusVariant(
                                      failure.providerStatus,
                                    )}
                                  >
                                    {humanize(failure.providerStatus)}
                                  </Badge>
                                </TableCell>
                                <TableCell>{failure.attempts}</TableCell>
                                <TableCell className="text-xs">
                                  {formatDateTime(failure.nextAttemptAt)}
                                </TableCell>
                                <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                                  {failure.lastError || "Retry scheduled"}
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1">
            <CardTitle>Delayed orders</CardTitle>
            <CardDescription>
              Orders older than {olderThanMinutes} minutes that may need a requery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {staleOrdersQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : staleOrdersQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm font-medium">
                  Could not load stale VTU orders
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {getErrorMessage(
                    staleOrdersQuery.error,
                    "The queue is unavailable. Try again shortly.",
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void staleOrdersQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : orders.length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-3 py-5 text-sm text-muted-foreground">
                <span>No delayed orders older than {olderThanMinutes} minutes.</span>
                <Badge variant="outline">Clear</Badge>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Country / Amount</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Timestamps</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.orderId}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">
                              {humanize(order.provider)}
                            </p>
                            <p className="max-w-36 truncate font-mono text-xs text-muted-foreground">
                              {order.providerRequestId || "No provider ref"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">
                              {humanize(order.serviceType)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {humanize(order.scope)} · Provider status:{" "}
                              {order.providerStatus || "N/A"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline">{getCountry(order)}</Badge>
                            <p className="font-medium">
                              {formatMoney(order.amount, order.currency)}
                            </p>
                            {hasPositiveAmount(order.fee) && (
                              <p className="text-xs text-muted-foreground">
                                Fee{" "}
                                {formatMoney(order.fee ?? 0, order.currency)}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              Cost{" "}
                              {formatMoney(
                                order.costAmount ?? 0,
                                order.currency,
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Commission{" "}
                              {formatMoney(
                                order.providerCommission ?? 0,
                                order.currency,
                              )}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {order.targetMasked || "Not provided"}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-mono text-xs">
                              {order.transactionReference}
                            </p>
                            <p className="max-w-36 truncate font-mono text-xs text-muted-foreground">
                              {order.providerTransactionId || "No provider tx"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">{order.attempts}</p>
                            <p className="text-xs text-muted-foreground">
                              Last: {formatDateTime(order.lastRequeryAt)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={statusVariant(order.status)}>
                              {humanize(order.status)}
                            </Badge>
                            <Badge
                              variant={statusVariant(order.transactionStatus)}
                            >
                              Tx {humanize(order.transactionStatus)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-xs">
                            <p>Created {formatDateTime(order.createdAt)}</p>
                            <p className="text-muted-foreground">
                              Next {formatDateTime(order.nextRequeryAt)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={requeryMutation.isPending}
                            onClick={() => openRequeryDialog(order)}
                          >
                            Requery
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>VTU pricing</CardTitle>
              <CardDescription>
                Set margin rules by country, service, provider, and amount band.
              </CardDescription>
            </div>
            <Button onClick={openCreatePricingDialog}>
              <Plus className="size-4" />
              Add rule
            </Button>
          </CardHeader>
          <CardContent>
            {pricingRulesQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : pricingRulesQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm font-medium">
                  Could not load pricing rules
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {getErrorMessage(
                    pricingRulesQuery.error,
                    "Pricing rules are unavailable. Try again shortly.",
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void pricingRulesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (pricingRulesQuery.data ?? []).length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-3 py-5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Settings2 className="size-4" />
                  <span>No pricing rules. Purchases currently run at zero margin.</span>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Match</TableHead>
                      <TableHead>Margin</TableHead>
                      <TableHead>Amount band</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pricingRulesQuery.data?.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline">
                                {rule.countryCode || "Any country"}
                              </Badge>
                              <Badge variant="outline">
                                {humanize(rule.serviceType)}
                              </Badge>
                              <Badge variant="outline">
                                {humanize(rule.scope)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Provider: {rule.provider || "Any provider"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">
                              Fixed {formatMoney(rule.fixedMargin, "NGN")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Percent {String(rule.percentMargin)}%
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">
                            {rule.minAmount == null
                              ? "No minimum"
                              : formatMoney(rule.minAmount, "NGN")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {rule.maxAmount == null
                              ? "No maximum"
                              : `to ${formatMoney(rule.maxAmount, "NGN")}`}
                          </p>
                        </TableCell>
                        <TableCell>{rule.priority}</TableCell>
                        <TableCell>
                          <Badge
                            variant={rule.isActive ? "default" : "outline"}
                          >
                            {rule.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(rule.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditPricingDialog(rule)}
                            >
                              Edit
                            </Button>
                            {rule.isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  deactivatePricingRuleMutation.isPending
                                }
                                onClick={() => openDeactivateDialog(rule)}
                              >
                                Deactivate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(selectedOrder)}
        onOpenChange={(open) => {
          if (!open && !requeryMutation.isPending) {
            setSelectedOrder(null);
            setReason("");
            setRequeryAttemptKey(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manual VTU requery</DialogTitle>
            <DialogDescription>
              This checks the provider again and records the reason in the audit
              log.
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Reference</p>
                <p className="font-mono text-xs">
                  {selectedOrder.transactionReference}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Order status</p>
                <Badge variant={statusVariant(selectedOrder.status)}>
                  {humanize(selectedOrder.status)}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Provider</p>
                <p className="font-medium">
                  {humanize(selectedOrder.provider)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="font-medium">
                  {formatMoney(selectedOrder.amount, selectedOrder.currency)}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="requery-reason">Reason</Label>
            <textarea
              id="requery-reason"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              maxLength={500}
              minLength={10}
              placeholder="Example: Pending provider confirmation after customer escalation"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={requeryMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 10 characters. Do not paste provider payloads or secrets.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={requeryMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={requeryMutation.isPending || reason.trim().length < 10}
              onClick={submitRequery}
            >
              {requeryMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Submit requery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pricingDialogMode)}
        onOpenChange={(open) => {
          if (!open && !pricingRuleMutation.isPending) {
            setPricingDialogMode(null);
            setSelectedPricingRule(null);
            setPricingForm(defaultPricingForm);
            setPricingAttemptKey(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {pricingDialogMode === "edit"
                ? "Edit pricing rule"
                : "Create pricing rule"}
            </DialogTitle>
            <DialogDescription>
              The first matching active rule applies by highest priority, then
              newest rule.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pricing-country">Country</Label>
              <Input
                id="pricing-country"
                maxLength={2}
                placeholder="NG, GH, or blank for any"
                value={pricingForm.countryCode}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    countryCode: event.target.value.toUpperCase(),
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>Service</Label>
              <Select
                value={pricingForm.serviceType}
                onValueChange={(value) =>
                  setPricingForm((form) => ({ ...form, serviceType: value }))
                }
                disabled={pricingRuleMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any service</SelectItem>
                  {SERVICE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {humanize(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-provider">Provider</Label>
              <Input
                id="pricing-provider"
                maxLength={50}
                placeholder="mtn, dstv, or blank for any VTpass service"
                value={pricingForm.provider}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    provider: event.target.value.toLowerCase(),
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                value={pricingForm.scope}
                onValueChange={(value) =>
                  setPricingForm((form) => ({ ...form, scope: value }))
                }
                disabled={pricingRuleMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any scope</SelectItem>
                  {SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {humanize(scope)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-fixed">Fixed margin</Label>
              <Input
                id="pricing-fixed"
                inputMode="decimal"
                placeholder="0.00"
                value={pricingForm.fixedMargin}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    fixedMargin: event.target.value,
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-percent">Percent margin</Label>
              <Input
                id="pricing-percent"
                inputMode="decimal"
                placeholder="0.0000"
                value={pricingForm.percentMargin}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    percentMargin: event.target.value,
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-min">Minimum amount</Label>
              <Input
                id="pricing-min"
                inputMode="decimal"
                placeholder="Optional"
                value={pricingForm.minAmount}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    minAmount: event.target.value,
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-max">Maximum amount</Label>
              <Input
                id="pricing-max"
                inputMode="decimal"
                placeholder="Optional"
                value={pricingForm.maxAmount}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    maxAmount: event.target.value,
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="pricing-priority">Priority</Label>
              <Input
                id="pricing-priority"
                min={0}
                max={100000}
                type="number"
                value={pricingForm.priority}
                onChange={(event) =>
                  setPricingForm((form) => ({
                    ...form,
                    priority: event.target.value,
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={pricingForm.isActive}
                onValueChange={(value) =>
                  setPricingForm((form) => ({
                    ...form,
                    isActive: value as "true" | "false",
                  }))
                }
                disabled={pricingRuleMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pricing-reason">Admin reason</Label>
            <textarea
              id="pricing-reason"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              maxLength={500}
              minLength={10}
              placeholder="Example: Configure Ghana airtime margin for pilot launch"
              value={pricingForm.reason}
              onChange={(event) =>
                setPricingForm((form) => ({
                  ...form,
                  reason: event.target.value,
                }))
              }
              disabled={pricingRuleMutation.isPending}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                disabled={pricingRuleMutation.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={
                pricingRuleMutation.isPending ||
                pricingForm.reason.trim().length < 10
              }
              onClick={submitPricingRule}
            >
              {pricingRuleMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(ruleToDeactivate)}
        onOpenChange={(open) => {
          if (!open && !deactivatePricingRuleMutation.isPending) {
            setRuleToDeactivate(null);
            setDeactivateReason("");
            setDeactivateAttemptKey(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Deactivate pricing rule</DialogTitle>
            <DialogDescription>
              Existing transactions are not changed. New VTU purchases will skip
              this rule after deactivation.
            </DialogDescription>
          </DialogHeader>

          {ruleToDeactivate && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {ruleToDeactivate.countryCode || "Any country"} ·{" "}
                {humanize(ruleToDeactivate.serviceType)} ·{" "}
                {ruleToDeactivate.provider || "Any provider"}
              </p>
              <p className="text-muted-foreground">
                Fixed {formatMoney(ruleToDeactivate.fixedMargin, "NGN")} plus{" "}
                {String(ruleToDeactivate.percentMargin)}%
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="deactivate-reason">Reason</Label>
            <textarea
              id="deactivate-reason"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              maxLength={500}
              minLength={10}
              placeholder="Example: Replace old margin with Ghana launch pricing"
              value={deactivateReason}
              onChange={(event) => setDeactivateReason(event.target.value)}
              disabled={deactivatePricingRuleMutation.isPending}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                disabled={deactivatePricingRuleMutation.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={
                deactivatePricingRuleMutation.isPending ||
                deactivateReason.trim().length < 10
              }
              onClick={submitDeactivateRule}
            >
              {deactivatePricingRuleMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Deactivate rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

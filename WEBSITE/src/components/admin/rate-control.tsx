"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskEmail } from "@/lib/privacy";
import { adminExchangeRateApi } from "@/services/api";

type CurrentRate = {
  from: string;
  to: string;
  baseRate: number | string;
  markupPercent: number | string;
  effectiveRate: number | string;
  isStale: boolean;
};

type PendingOverride = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  proposedRate: number | string;
  proposedMarkup: number | string;
  currentRate: number | string;
  deviationPercent: number | string;
  reason: string;
  createdAt: string;
  requestedBy?: { id?: string; email?: string } | null;
};

type UpdateRateResponse = {
  success: boolean;
  requiresApproval?: boolean;
  deviationPercent?: number;
  overrideId?: string;
  message?: string;
};

const CURRENCY_PAIRS = [
  { value: "NGN:GHS", from: "NGN", to: "GHS", label: "NGN → GHS" },
  { value: "GHS:NGN", from: "GHS", to: "NGN", label: "GHS → NGN" },
] as const;

function formatRate(value: number | string | undefined, fractionDigits = 4) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return String(value ?? "0");
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function shortDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export function RateControlCard() {
  const queryClient = useQueryClient();
  const [pair, setPair] = useState<(typeof CURRENCY_PAIRS)[number]["value"]>(
    "NGN:GHS",
  );
  const [rate, setRate] = useState("");
  const [markup, setMarkup] = useState("");
  const [reason, setReason] = useState("");
  const [rateAttemptKey, setRateAttemptKey] = useState<string | null>(null);
  const [prefilledPair, setPrefilledPair] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>(
    {},
  );
  const [pendingOverrideAction, setPendingOverrideAction] = useState<{
    id: string;
    action: "APPROVED" | "REJECTED";
  } | null>(null);

  const selectedPair = useMemo(
    () => CURRENCY_PAIRS.find((item) => item.value === pair) ?? CURRENCY_PAIRS[0],
    [pair],
  );

  const rateQuery = useQuery({
    queryKey: ["admin-exchange-rate", selectedPair.from, selectedPair.to],
    queryFn: async () => {
      const res = await adminExchangeRateApi.getRate(
        selectedPair.from,
        selectedPair.to,
      );
      return res.data as CurrentRate;
    },
    staleTime: 30000,
  });

  const overridesQuery = useQuery({
    queryKey: ["admin-exchange-rate-overrides"],
    queryFn: async () => {
      const res = await adminExchangeRateApi.getPendingOverrides();
      return res.data as PendingOverride[];
    },
    staleTime: 15000,
    refetchInterval: 60000,
  });

  // Prefill the set-rate form from the live rate once per pair (React's
  // "adjust state during render" pattern) so a background refetch never
  // clobbers an admin's in-progress edits.
  if (rateQuery.data && prefilledPair !== selectedPair.value) {
    setPrefilledPair(selectedPair.value);
    setRate(String(rateQuery.data.baseRate ?? ""));
    setMarkup(String(rateQuery.data.markupPercent ?? ""));
    setReason("");
    setRateAttemptKey(null);
  }

  const updateRateMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey =
        rateAttemptKey ?? createMoneyAttemptIdempotencyKey("exchange");
      setRateAttemptKey(idempotencyKey);
      const res = await adminExchangeRateApi.updateRate(
        {
          from: selectedPair.from,
          to: selectedPair.to,
          rate: Number(rate),
          markup: Number(markup),
          reason: reason.trim(),
        },
        idempotencyKey,
      );
      return res.data as UpdateRateResponse;
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-exchange-rate"] }),
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-rate-overrides"],
        }),
      ]);
      setReason("");
      setRateAttemptKey(null);
      if (data.requiresApproval) {
        toast.warning(
          data.message ??
            `Rate change needs a second admin to approve (${data.deviationPercent}% off market).`,
        );
      } else {
        toast.success(data.message ?? "Rate updated");
      }
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not update rate"));
    },
  });

  const reviewOverrideMutation = useMutation({
    mutationFn: async (variables: {
      overrideId: string;
      status: "APPROVED" | "REJECTED";
      reason: string;
    }) => {
      const res = await adminExchangeRateApi.reviewOverride(
        variables.overrideId,
        { status: variables.status, reason: variables.reason },
        createMoneyAttemptIdempotencyKey("exchange"),
      );
      return res.data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin-exchange-rate-overrides"],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin-exchange-rate"] }),
      ]);
      setOverrideReason((state) => {
        const next = { ...state };
        delete next[variables.overrideId];
        return next;
      });
      setPendingOverrideAction(null);
      toast.success(
        variables.status === "APPROVED"
          ? "Rate override approved"
          : "Rate override rejected",
      );
    },
    onError: (error: unknown) => {
      setPendingOverrideAction(null);
      toast.error(getErrorMessage(error, "Could not review rate override"));
    },
  });

  const submitRate = () => {
    const numericRate = Number(rate);
    const numericMarkup = Number(markup);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      toast.error("Enter a positive rate");
      return;
    }
    if (!Number.isFinite(numericMarkup) || numericMarkup <= 0) {
      toast.error("Enter a positive markup percent");
      return;
    }
    if (reason.trim().length < 10) {
      toast.error("Enter a change reason of at least 10 characters");
      return;
    }
    updateRateMutation.mutate();
  };

  const reviewOverride = (
    overrideId: string,
    status: "APPROVED" | "REJECTED",
  ) => {
    const value = (overrideReason[overrideId] ?? "").trim();
    if (value.length < 10) {
      toast.error("Enter a review reason of at least 10 characters");
      return;
    }
    setPendingOverrideAction({ id: overrideId, action: status });
    reviewOverrideMutation.mutate({ overrideId, status, reason: value });
  };

  const reasonRemaining = Math.max(0, 10 - reason.trim().length);
  const overrides = overridesQuery.data ?? [];

  return (
    <Card className="xl:col-span-2">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Exchange rate control</CardTitle>
          <CardDescription>
            Set the base rate and markup. Changes above 5% deviation from the
            market require a second admin to approve.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Select
              value={pair}
              onValueChange={(value) =>
                setPair(value as (typeof CURRENCY_PAIRS)[number]["value"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_PAIRS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={rateQuery.isFetching}
            onClick={() => void rateQuery.refetch()}
            aria-label="Refresh rate"
          >
            <RefreshCw
              className={rateQuery.isFetching ? "size-4 animate-spin" : "size-4"}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Live {selectedPair.label}</p>
              {rateQuery.data?.isStale ? (
                <Badge variant="destructive">Stale</Badge>
              ) : (
                <Badge variant="outline">Live</Badge>
              )}
            </div>
            {rateQuery.isLoading ? (
              <Skeleton className="mt-3 h-16 w-full" />
            ) : rateQuery.isError ? (
              <div className="mt-3 flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">
                  {getErrorMessage(rateQuery.error, "Could not load the rate.")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void rateQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Base</p>
                  <p className="mt-1 font-semibold">
                    {formatRate(rateQuery.data?.baseRate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Markup</p>
                  <p className="mt-1 font-semibold">
                    {formatRate(rateQuery.data?.markupPercent, 2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Effective</p>
                  <p className="mt-1 font-semibold">
                    {formatRate(rateQuery.data?.effectiveRate)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="rate-value">Base rate</Label>
                <Input
                  id="rate-value"
                  inputMode="decimal"
                  placeholder="0.0000"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  disabled={updateRateMutation.isPending}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rate-markup">Markup percent</Label>
                <Input
                  id="rate-markup"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                  disabled={updateRateMutation.isPending}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rate-reason">Change reason</Label>
              <textarea
                id="rate-reason"
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                maxLength={500}
                placeholder="Example: Align GHS rate with morning interbank move"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={updateRateMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Required for the audit log. Minimum 10 characters
                {reasonRemaining > 0 && reason.trim().length > 0
                  ? ` (${reasonRemaining} more needed).`
                  : "."}
              </p>
            </div>
            <div>
              <Button
                onClick={submitRate}
                disabled={
                  updateRateMutation.isPending || reason.trim().length < 10
                }
              >
                {updateRateMutation.isPending ? "Saving..." : "Update rate"}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Pending approvals</p>
            <Badge variant={overrides.length > 0 ? "secondary" : "outline"}>
              {overrides.length}
            </Badge>
          </div>

          {overridesQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : overridesQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {getErrorMessage(
                  overridesQuery.error,
                  "Could not load pending overrides.",
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void overridesQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : overrides.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No rate changes awaiting a second approval.
            </div>
          ) : (
            <div className="space-y-3">
              {overrides.map((override) => {
                const isActing =
                  pendingOverrideAction?.id === override.id &&
                  reviewOverrideMutation.isPending;
                const value = overrideReason[override.id] ?? "";

                return (
                  <div
                    key={override.id}
                    className="rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {override.fromCurrency} → {override.toCurrency}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Requested by {maskEmail(override.requestedBy?.email)} ·{" "}
                          {shortDate(override.createdAt)}
                        </p>
                      </div>
                      <Badge variant="destructive">
                        {formatRate(override.deviationPercent, 2)}% off
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Current</p>
                        <p className="mt-1 font-medium">
                          {formatRate(override.currentRate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Proposed</p>
                        <p className="mt-1 font-medium">
                          {formatRate(override.proposedRate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Markup</p>
                        <p className="mt-1 font-medium">
                          {formatRate(override.proposedMarkup, 2)}%
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {override.reason}
                    </p>
                    <Input
                      className="mt-3"
                      value={value}
                      maxLength={500}
                      placeholder="Review reason (min 10 chars)"
                      onChange={(event) =>
                        setOverrideReason((state) => ({
                          ...state,
                          [override.id]: event.target.value,
                        }))
                      }
                      disabled={reviewOverrideMutation.isPending}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={
                          reviewOverrideMutation.isPending ||
                          value.trim().length < 10
                        }
                        onClick={() => reviewOverride(override.id, "APPROVED")}
                      >
                        {isActing &&
                        pendingOverrideAction?.action === "APPROVED"
                          ? "Approving..."
                          : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          reviewOverrideMutation.isPending ||
                          value.trim().length < 10
                        }
                        onClick={() => reviewOverride(override.id, "REJECTED")}
                      >
                        {isActing &&
                        pendingOverrideAction?.action === "REJECTED"
                          ? "Rejecting..."
                          : "Reject"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

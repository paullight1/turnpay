"use client";

import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { minimumSendForOneUnit } from "@/lib/money";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { adminExchangeRateApi } from "@/services/api";

type CurrentRate = {
  from: string;
  to: string;
  baseRate: number | string | null;
  markupPercent: number | string | null;
  effectiveRate: number | string | null;
  isStale: boolean;
  configured?: boolean;
};

type UpdateRateResponse = {
  success: boolean;
  from: string;
  to: string;
  rate: number | string;
  markup: number | string;
  effectiveRate: number | string;
  message?: string;
};

const CURRENCY_PAIRS = [
  {
    from: "NGN", to: "GHS", title: "Naira to cedis",
    inputLabel: "Cedis for 1 naira", fromName: "naira",
    fromFlag: "🇳🇬", toFlag: "🇬🇭", saveLabel: "Save naira to cedis",
  },
  {
    from: "GHS", to: "NGN", title: "Cedis to naira",
    inputLabel: "Naira for 1 cedi", fromName: "cedi",
    fromFlag: "🇬🇭", toFlag: "🇳🇬", saveLabel: "Save cedis to naira",
  },
] as const;

export function RateControlCard() {
  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-semibold">Exchange rates</h2>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {CURRENCY_PAIRS.map((direction) => (
          <DirectionRateEditor key={direction.from} selectedPair={direction} />
        ))}
      </div>
    </div>
  );
}

function DirectionRateEditor({ selectedPair }: {
  selectedPair: (typeof CURRENCY_PAIRS)[number];
}) {
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("");
  const [rateAttemptKey, setRateAttemptKey] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const inputId = `rate-${selectedPair.from.toLowerCase()}-${selectedPair.to.toLowerCase()}`;

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
    refetchInterval: 10000,
  });

  const numericDraftRate = Number(rate);
  // Prefill each fixed direction once; background refreshes preserve edits.
  if (rateQuery.data && !prefilled) {
    setPrefilled(true);
    setRate(rateQuery.data.configured === false || rateQuery.data.isStale
      ? "" : String(rateQuery.data.effectiveRate ?? ""));
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
          markup: 0,
        },
        idempotencyKey,
      );
      return res.data as UpdateRateResponse;
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(
        ["admin-exchange-rate", selectedPair.from, selectedPair.to],
        (current: CurrentRate | undefined) => ({
          ...current,
          from: selectedPair.from,
          to: selectedPair.to,
          baseRate: data.rate,
          markupPercent: data.markup,
          effectiveRate: data.effectiveRate,
          isStale: false,
          configured: true,
        }),
      );
      setRate(String(data.effectiveRate));
      setRateAttemptKey(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-exchange-rate"] });
      toast.success(data.message ?? "Rate updated");
    },
    onError: (error: unknown) => {
      // A validation rejection cannot have saved a rate. Retrying it needs a
      // new key, otherwise the API replays the persisted validation error.
      // Keep the key for network/server failures where the outcome is unknown.
      if (isAxiosError(error) && error.response?.status === 400) {
        setRateAttemptKey(null);
      }
      toast.error(getErrorMessage(error, "Could not update rate"));
    },
  });

  const submitRate = () => {
    if (!validDraft) {
      toast.error(directionError ?? "Enter a positive rate");
      return;
    }
    updateRateMutation.mutate();
  };

  const positiveDraft = Number.isFinite(numericDraftRate) && numericDraftRate > 0;
  const directionError = positiveDraft &&
    (selectedPair.from === "NGN" ? numericDraftRate >= 1 : numericDraftRate <= 1)
    ? selectedPair.from === "NGN"
      ? "Enter cedis received for ₦1, below 1. A naira-per-cedi price must be inverted first."
      : "Enter naira received for GH₵1, above 1."
    : null;
  const validDraft = positiveDraft && !directionError;
  const minimumCedis = selectedPair.from === "GHS" && validDraft
    ? minimumSendForOneUnit(rate) : null;
  return (
    <section aria-label={selectedPair.title} className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{selectedPair.title}</h3>
        <span role="status" className="shrink-0 text-xs text-muted-foreground">
          {rateQuery.isLoading ? "Loading…" : rateQuery.isError ? "Unavailable" :
            rateQuery.data && numericDraftRate > 0 && numericDraftRate !== Number(rateQuery.data.effectiveRate)
              ? "Unsaved" : rateQuery.data?.configured === false ? "Not set" : rateQuery.data?.isStale ? "Stale" : "Saved"}
        </span>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label htmlFor={`${inputId}-source`} className="text-sm text-muted-foreground">Customer sends</Label>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold">
            <span aria-hidden="true">{selectedPair.fromFlag}</span>{selectedPair.from}
          </span>
        </div>
        <Input id={`${inputId}-source`} value="1" readOnly tabIndex={-1}
          aria-label={`Customer sends 1 ${selectedPair.fromName}`}
          className="h-10 w-full rounded-none border-0 bg-transparent! p-0 text-3xl! font-semibold shadow-none focus-visible:ring-0" />
      </div>
      <div aria-hidden="true" className="flex h-6 items-center justify-center">
        <span className="grid size-8 place-items-center rounded-full border border-border bg-background text-primary">
          <ArrowDown className="size-4" />
        </span>
      </div>
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label htmlFor={inputId} className="text-sm text-muted-foreground">{selectedPair.inputLabel}</Label>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold">
            <span aria-hidden="true">{selectedPair.toFlag}</span>{selectedPair.to}
          </span>
        </div>
        <Input id={inputId} inputMode="decimal" autoComplete="off"
          aria-label={selectedPair.inputLabel} aria-describedby={`${inputId}-preview`}
          placeholder={rateQuery.isLoading ? "Loading…" : "0.00"}
          value={rate} onChange={(event) => { setRate(event.target.value); setRateAttemptKey(null); }}
          disabled={updateRateMutation.isPending || rateQuery.isLoading || rateQuery.isError}
          className="h-10 w-full rounded-none border-0 bg-transparent! p-0 text-3xl! font-semibold shadow-none focus-visible:ring-0" />
      </div>
      <div id={`${inputId}-preview`} className="text-xs text-muted-foreground" aria-live="polite">
        {directionError && <p role="alert" className="text-destructive">{directionError}</p>}
        {validDraft && <p>{`1 ${selectedPair.from} = ${rate.trim()} ${selectedPair.to}`}</p>}
        {minimumCedis && <p>To receive at least 1 NGN, send {minimumCedis} GHS.</p>}
      </div>
      {rateQuery.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>{getErrorMessage(rateQuery.error, "Could not load the rate.")}</p>
          <Button variant="outline" size="sm" onClick={() => void rateQuery.refetch()}>Retry</Button>
        </div>
      )}
      <Button onClick={submitRate} aria-label={selectedPair.saveLabel}
        className="h-12 w-full rounded-full text-base font-semibold"
        disabled={updateRateMutation.isPending || rateQuery.isLoading || rateQuery.isError || !validDraft}>
        {updateRateMutation.isPending ? "Saving..." : "Save rate"}
      </Button>
    </section>
  );
}

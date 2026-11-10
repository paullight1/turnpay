"use client";

import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { minimumSendForOneUnit } from "@/lib/money";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { adminExchangeRateApi } from "@/services/api";

type RateQuoteBasis = "TARGET_PER_SOURCE" | "SOURCE_PER_TARGET";

type CurrentRate = {
  from: string;
  to: string;
  /** Canonical target-per-source rate used by customer quotes. */
  baseRate: number | string | null;
  /** Raw value entered by the administrator in inputRate's quoteBasis. */
  inputRate?: number | string | null;
  quoteBasis?: RateQuoteBasis | null;
  markupPercent: number | string | null;
  effectiveRate: number | string | null;
  isStale: boolean;
  configured?: boolean;
  blockedReason?: string | null;
};

type UpdateRateResponse = {
  success: boolean;
  from: string;
  to: string;
  /** Raw value persisted in the selected basis. */
  rate: number | string;
  inputRate?: number | string;
  quoteBasis?: RateQuoteBasis;
  markup: number | string;
  baseRate?: number | string;
  effectiveRate: number | string;
  message?: string;
};

const CURRENCY_PAIRS = [
  {
    from: "NGN",
    to: "GHS",
    title: "Naira to cedis",
    saveLabel: "Save naira to cedis",
  },
  {
    from: "GHS",
    to: "NGN",
    title: "Cedis to naira",
    saveLabel: "Save cedis to naira",
  },
] as const;

export function RateControlCard({ open }: { open?: boolean }) {
  return (
    <details open={open} className="group/rates rounded-xl border border-border bg-card">
      <summary className="relative isolate flex min-h-20 cursor-pointer list-none items-center justify-between gap-3 overflow-hidden rounded-xl bg-linear-to-r from-teal-950 via-emerald-900 to-cyan-800 px-4 text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-open/rates:mb-3 group-open/rates:rounded-b-none [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 224 80"
          fill="none"
          className="pointer-events-none absolute inset-y-0 right-8 -z-10 h-full w-56 max-w-[68%] text-teal-200 [mask-image:linear-gradient(to_right,transparent,black_55%)]"
        >
          <path d="M0 74C42 60 54 76 92 48S152 12 224 15M0 86C48 70 64 86 102 58s64-38 122-33M0 62C35 50 43 63 81 36s70-36 143-30" stroke="currentColor" strokeOpacity=".28" />
          <circle cx="164" cy="40" r="32" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeOpacity=".42" />
          <circle cx="164" cy="40" r="26" stroke="currentColor" strokeOpacity=".22" />
          <path d="M147 34h31m-6-6 6 6-6 6m9 6h-31m6-6-6 6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M207 40v10m-5-5h10M112 18v8m-4-4h8" stroke="currentColor" strokeOpacity=".6" strokeLinecap="round" />
        </svg>
        Exchange rates
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15">
          <ChevronDown aria-hidden="true" className="size-4 group-open/rates:rotate-180" />
        </span>
      </summary>
      <div className="grid min-w-0 gap-2 px-3 pb-3 lg:grid-cols-2">
        {CURRENCY_PAIRS.map((direction) => (
          <DirectionRateEditor key={direction.from} selectedPair={direction} />
        ))}
      </div>
    </details>
  );
}

function defaultBasis(from: string): RateQuoteBasis {
  // The existing NGN admin value (87) is a source-per-target price. New GHS
  // entries remain the familiar target-per-source multiplier. The API still
  // defaults omitted basis values to TARGET_PER_SOURCE for old clients.
  return from === "NGN" ? "SOURCE_PER_TARGET" : "TARGET_PER_SOURCE";
}

function inputLabel(
  pair: (typeof CURRENCY_PAIRS)[number],
  basis: RateQuoteBasis,
) {
  if (basis === "SOURCE_PER_TARGET") {
    return `${pair.from} per 1 ${pair.to}`;
  }
  return `${pair.to} received for 1 ${pair.from}`;
}

function canonicalRate(value: number, basis: RateQuoteBasis): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (basis === "TARGET_PER_SOURCE") return value;

  // Keep the dashboard preview identical to the backend's six-decimal
  // Decimal.ROUND_DOWN reciprocal. Parsing the decimal string avoids a binary
  // floating-point boundary turning 1/115 into 0.008696.
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  if (!/^\d+(?:\.\d+)?$/.test(coefficient)) return null;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const exponent = exponentText ? Number(exponentText) : 0;
  if (!Number.isInteger(exponent)) return null;
  const decimalPlaces = fraction.length - exponent;
  const ten = BigInt(10);
  const numerator =
    decimalPlaces >= 0 ? digits : digits * ten ** BigInt(-decimalPlaces);
  const denominator =
    decimalPlaces >= 0 ? ten ** BigInt(decimalPlaces) : BigInt(1);
  const scaled = (BigInt(1_000_000) * denominator) / numerator;
  if (scaled <= BigInt(0)) return null;
  const result = Number(scaled) / 1_000_000;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function decimalRatio(value: string | number) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? "";
  const scale = fraction.length - Number(match[3] ?? 0);
  if (Math.abs(scale) > 320) return null;
  const numerator = BigInt(match[1] + fraction);
  return scale >= 0
    ? { numerator, denominator: BigInt(10) ** BigInt(scale) }
    : {
        numerator: numerator * BigInt(10) ** BigInt(-scale),
        denominator: BigInt(1),
      };
}

function createsRoundTripProfit(
  draft: number,
  opposite: CurrentRate | undefined,
) {
  if (
    !opposite ||
    (opposite.configured === false &&
      opposite.blockedReason !== "EXCHANGE_RATE_PAIR_CONFLICT") ||
    opposite.isStale
  )
    return false;
  const forward = decimalRatio(draft);
  const reverse = decimalRatio(String(opposite.baseRate ?? ""));
  const markup = decimalRatio(String(opposite.markupPercent ?? 0));
  if (!forward || !reverse || !markup) return false;
  const hundred = BigInt(100);
  const factor = hundred * markup.denominator - markup.numerator;
  return (
    factor > BigInt(0) &&
    forward.numerator * reverse.numerator * factor >
      forward.denominator * reverse.denominator * hundred * markup.denominator
  );
}

function displayRate(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6).replace(/\.?(0+)$/, "");
}

function DirectionRateEditor({
  selectedPair,
}: {
  selectedPair: (typeof CURRENCY_PAIRS)[number];
}) {
  const queryClient = useQueryClient();
  const [rate, setRate] = useState("");
  const [quoteBasis, setQuoteBasis] = useState<RateQuoteBasis>(
    defaultBasis(selectedPair.from),
  );
  const [rateAttemptKey, setRateAttemptKey] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const inputId = `rate-${selectedPair.from.toLowerCase()}-${selectedPair.to.toLowerCase()}`;
  const basisId = `${inputId}-basis`;

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

  const oppositeRateQuery = useQuery({
    queryKey: ["admin-exchange-rate", selectedPair.to, selectedPair.from],
    queryFn: async () => {
      const res = await adminExchangeRateApi.getRate(
        selectedPair.to,
        selectedPair.from,
      );
      return res.data as CurrentRate;
    },
    staleTime: 30000,
    refetchInterval: 10000,
  });

  // Prefill once. Background refreshes must never overwrite an administrator's
  // in-progress edit or silently switch the units underneath it.
  useEffect(() => {
    if (!rateQuery.data || prefilled) return;
    const serverBasis =
      rateQuery.data.quoteBasis ?? defaultBasis(selectedPair.from);
    /* eslint-disable react-hooks/set-state-in-effect */
    // Hydrating local form state from an async query is the one intentional
    // effect-driven state transition in this editor.
    setPrefilled(true);
    setQuoteBasis(serverBasis);
    setRate(
      (rateQuery.data.configured === false &&
        rateQuery.data.blockedReason !== "EXCHANGE_RATE_PAIR_CONFLICT") ||
        rateQuery.data.isStale
        ? ""
        : String(rateQuery.data.inputRate ?? rateQuery.data.baseRate ?? ""),
    );
    setRateAttemptKey(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [prefilled, rateQuery.data, selectedPair.from]);

  const numericDraftRate = Number(rate);
  const positiveDraft =
    Number.isFinite(numericDraftRate) && numericDraftRate > 0;
  const directionError = useMemo(() => {
    if (!positiveDraft) return null;

    const valid =
      quoteBasis === "SOURCE_PER_TARGET"
        ? selectedPair.from === "NGN"
          ? numericDraftRate > 1
          : numericDraftRate < 1
        : selectedPair.from === "NGN"
          ? numericDraftRate < 1
          : numericDraftRate > 1;

    if (valid) return null;
    if (quoteBasis === "SOURCE_PER_TARGET") {
      return selectedPair.from === "NGN"
        ? "Enter a naira-per-cedi divisor above 1 (for example, 87 NGN per 1 GHS)."
        : "Enter a cedi-per-naira divisor below 1 (for example, 0.0111 GHS per 1 NGN).";
    }
    return selectedPair.from === "NGN"
      ? "Enter cedis received for ₦1, below 1."
      : "Enter naira received for GH₵1, above 1.";
  }, [numericDraftRate, positiveDraft, quoteBasis, selectedPair.from]);
  const directionValid = positiveDraft && !directionError;
  const canonicalDraftRate = directionValid
    ? canonicalRate(numericDraftRate, quoteBasis)
    : null;
  const pairConflict =
    canonicalDraftRate !== null &&
    createsRoundTripProfit(canonicalDraftRate, oppositeRateQuery.data);
  const validDraft = directionValid && !pairConflict;
  const pairError = pairConflict
    ? "These prices allow a profitable round trip. Reduce the amount received or adjust the opposite rate."
    : null;
  const currentInputRate = Number(
    rateQuery.data?.inputRate ?? rateQuery.data?.baseRate,
  );
  const currentBasis =
    rateQuery.data?.quoteBasis ?? defaultBasis(selectedPair.from);
  const hasUnsavedChanges =
    rateQuery.data !== undefined &&
    (numericDraftRate !== currentInputRate || quoteBasis !== currentBasis);
  const minimumSend =
    selectedPair.from === "GHS" && canonicalDraftRate
      ? minimumSendForOneUnit(String(canonicalDraftRate))
      : null;

  const updateRateMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey =
        rateAttemptKey ?? createMoneyAttemptIdempotencyKey("exchange");
      setRateAttemptKey(idempotencyKey);
      const res = await adminExchangeRateApi.updateRate(
        {
          from: selectedPair.from,
          to: selectedPair.to,
          rate: numericDraftRate,
          quoteBasis,
          markup: 0,
        },
        idempotencyKey,
      );
      return res.data as UpdateRateResponse;
    },
    onSuccess: async (data) => {
      const returnedBasis = data.quoteBasis ?? quoteBasis;
      const returnedInputRate = data.inputRate ?? data.rate;
      queryClient.setQueryData(
        ["admin-exchange-rate", selectedPair.from, selectedPair.to],
        (current: CurrentRate | undefined) => ({
          ...current,
          from: selectedPair.from,
          to: selectedPair.to,
          baseRate:
            data.baseRate ??
            canonicalRate(Number(returnedInputRate), returnedBasis),
          inputRate: returnedInputRate,
          quoteBasis: returnedBasis,
          markupPercent: data.markup,
          effectiveRate: data.effectiveRate,
          isStale: false,
          configured: true,
        }),
      );
      setQuoteBasis(returnedBasis);
      setRate(String(returnedInputRate));
      setRateAttemptKey(null);
      await queryClient.invalidateQueries({
        queryKey: ["admin-exchange-rate"],
      });
      toast.success(data.message ?? "Rate updated");
    },
    onError: (error: unknown) => {
      // A validation rejection cannot have saved a rate. Retrying it needs a
      // new key, while network/server failures keep the key for safe replay.
      if (isAxiosError(error) && error.response?.status === 400) {
        setRateAttemptKey(null);
      }
      toast.error(getErrorMessage(error, "Could not update rate"));
    },
  });

  const submitRate = () => {
    if (!validDraft) {
      toast.error(directionError ?? pairError ?? "Enter a positive rate");
      return;
    }
    updateRateMutation.mutate();
  };

  return (
    <section
      aria-label={selectedPair.title}
      className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{selectedPair.title}</h3>
        <span role="status" className="shrink-0 text-xs text-muted-foreground">
          {updateRateMutation.isPending
            ? "Saving…"
            : rateQuery.isLoading
              ? "Loading…"
              : rateQuery.isError
                ? "Unavailable"
                : hasUnsavedChanges
                  ? "Unsaved"
                  : rateQuery.data?.blockedReason ===
                      "EXCHANGE_RATE_PAIR_CONFLICT"
                    ? "Needs attention"
                    : rateQuery.data?.configured === false
                      ? "Not set"
                      : rateQuery.data?.isStale
                        ? "Stale"
                        : "Saved"}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,9rem)_auto] justify-start items-center gap-1.5">
        <Label htmlFor={inputId} className="sr-only">
          {inputLabel(selectedPair, quoteBasis)}
        </Label>
        <Input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          aria-describedby={`${inputId}-preview`}
          placeholder="0.00"
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
            setRateAttemptKey(null);
          }}
          disabled={
            updateRateMutation.isPending ||
            rateQuery.isLoading ||
            rateQuery.isError
          }
          className="h-11 min-w-0 bg-background px-2 text-base! font-semibold tabular-nums"
        />
        <Label htmlFor={basisId} className="sr-only">
          Rate units
        </Label>
        <select
          id={basisId}
          value={quoteBasis}
          onChange={(event) => {
            setQuoteBasis(event.target.value as RateQuoteBasis);
            setRateAttemptKey(null);
          }}
          disabled={
            updateRateMutation.isPending ||
            rateQuery.isLoading ||
            rateQuery.isError
          }
          className="h-11 min-w-0 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        >
          <option value="TARGET_PER_SOURCE">
            {selectedPair.to} for 1 {selectedPair.from}
          </option>
          <option value="SOURCE_PER_TARGET">
            {selectedPair.from} for 1 {selectedPair.to}
          </option>
        </select>
        <Button
          onClick={submitRate}
          aria-label={selectedPair.saveLabel}
          aria-busy={updateRateMutation.isPending}
          className="h-11 px-3 font-semibold"
          disabled={
            updateRateMutation.isPending ||
            rateQuery.isLoading ||
            rateQuery.isError ||
            oppositeRateQuery.isLoading ||
            oppositeRateQuery.isError ||
            !validDraft
          }
        >
          Save
        </Button>
      </div>

      <div
        id={`${inputId}-preview`}
        className="flex flex-wrap gap-x-3 text-xs text-muted-foreground empty:hidden"
        aria-live="polite"
      >
        {directionError && (
          <p role="alert" className="text-destructive">
            {directionError}
          </p>
        )}
        {pairError && (
          <p role="alert" className="text-destructive">
            {pairError}
          </p>
        )}
        {directionValid && canonicalDraftRate && (
          <>
            {quoteBasis === "SOURCE_PER_TARGET" && (
              <p>{`${rate.trim()} ${selectedPair.from} = 1 ${selectedPair.to}`}</p>
            )}
            <p>{`1 ${selectedPair.from} ≈ ${displayRate(canonicalDraftRate)} ${selectedPair.to}`}</p>
          </>
        )}
        {minimumSend && (
          <p>To receive at least 1 NGN, send {minimumSend} GHS.</p>
        )}
      </div>

      {rateQuery.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>{getErrorMessage(rateQuery.error, "Could not load the rate.")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void rateQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
    </section>
  );
}

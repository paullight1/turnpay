"use client";

import { useEffect, useMemo, useState } from "react";
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
    fromName: "naira",
    fromFlag: "🇳🇬",
    toFlag: "🇬🇭",
    saveLabel: "Save naira to cedis",
  },
  {
    from: "GHS",
    to: "NGN",
    title: "Cedis to naira",
    fromName: "cedi",
    fromFlag: "🇬🇭",
    toFlag: "🇳🇬",
    saveLabel: "Save cedis to naira",
  },
] as const;

export function RateControlCard() {
  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-semibold">Exchange rates</h2>
      <p className="text-sm text-muted-foreground">
        Set both prices here. They are checked together to prevent a profitable
        round trip.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {CURRENCY_PAIRS.map((direction) => (
          <DirectionRateEditor key={direction.from} selectedPair={direction} />
        ))}
      </div>
    </div>
  );
}

function defaultBasis(from: string): RateQuoteBasis {
  // The existing NGN admin value (87) is a source-per-target price. New GHS
  // entries remain the familiar target-per-source multiplier. The API still
  // defaults omitted basis values to TARGET_PER_SOURCE for old clients.
  return from === "NGN" ? "SOURCE_PER_TARGET" : "TARGET_PER_SOURCE";
}

function basisLabel(basis: RateQuoteBasis) {
  return basis === "SOURCE_PER_TARGET"
    ? "Source units per 1 destination unit (divisor)"
    : "Destination units received per 1 source unit";
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
    <section aria-label={selectedPair.title} className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{selectedPair.title}</h3>
        <span role="status" className="shrink-0 text-xs text-muted-foreground">
          {rateQuery.isLoading
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

      <div className="rounded-2xl border border-border bg-card p-4">
        <Label htmlFor={basisId} className="text-sm text-muted-foreground">
          How is this rate entered?
        </Label>
        <select
          id={basisId}
          aria-label="Rate units"
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
          className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium"
        >
          <option value="TARGET_PER_SOURCE">
            Destination received for 1 source
          </option>
          <option value="SOURCE_PER_TARGET">
            Source per 1 destination (divisor)
          </option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          {basisLabel(quoteBasis)}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label
            htmlFor={`${inputId}-source`}
            className="text-sm text-muted-foreground"
          >
            Customer sends
          </Label>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-semibold">
            <span aria-hidden="true">{selectedPair.fromFlag}</span>
            {selectedPair.from}
          </span>
        </div>
        <Input
          id={`${inputId}-source`}
          value="1"
          readOnly
          tabIndex={-1}
          aria-label={`Customer sends 1 ${selectedPair.fromName}`}
          className="h-10 w-full rounded-none border-0 bg-transparent! p-0 text-3xl! font-semibold shadow-none focus-visible:ring-0"
        />
      </div>

      <div aria-hidden="true" className="flex h-6 items-center justify-center">
        <span className="grid size-8 place-items-center rounded-full border border-border bg-background text-primary">
          <ArrowDown className="size-4" />
        </span>
      </div>

      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label htmlFor={inputId} className="text-sm text-muted-foreground">
            {inputLabel(selectedPair, quoteBasis)}
          </Label>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold">
            <span aria-hidden="true">
              {quoteBasis === "SOURCE_PER_TARGET"
                ? selectedPair.fromFlag
                : selectedPair.toFlag}
            </span>
            {quoteBasis === "SOURCE_PER_TARGET"
              ? selectedPair.from
              : selectedPair.to}
          </span>
        </div>
        <Input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          aria-label={inputLabel(selectedPair, quoteBasis)}
          aria-describedby={`${inputId}-preview`}
          placeholder={rateQuery.isLoading ? "Loading…" : "0.00"}
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
          className="h-10 w-full rounded-none border-0 bg-transparent! p-0 text-3xl! font-semibold shadow-none focus-visible:ring-0"
        />
      </div>

      <div
        id={`${inputId}-preview`}
        className="text-xs text-muted-foreground"
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
      <Button
        onClick={submitRate}
        aria-label={selectedPair.saveLabel}
        className="h-12 w-full rounded-full text-base font-semibold"
        disabled={
          updateRateMutation.isPending ||
          rateQuery.isLoading ||
          rateQuery.isError ||
          oppositeRateQuery.isLoading ||
          oppositeRateQuery.isError ||
          !validDraft
        }
      >
        {updateRateMutation.isPending ? "Saving..." : "Save rate"}
      </Button>
    </section>
  );
}

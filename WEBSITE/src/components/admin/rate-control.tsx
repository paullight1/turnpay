"use client";

import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { adminExchangeRateApi } from "@/services/api";

type CurrentRate = {
  from: string;
  to: string;
  baseRate: number | string;
  markupPercent: number | string;
  effectiveRate: number | string;
  isStale: boolean;
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
  { value: "NGN:GHS", from: "NGN", to: "GHS", label: "NGN → GHS" },
  { value: "GHS:NGN", from: "GHS", to: "NGN", label: "GHS → NGN" },
] as const;

const CURRENCY_DETAILS = {
  NGN: { name: "Nigerian Naira", flag: "🇳🇬" },
  GHS: { name: "Ghanaian Cedi", flag: "🇬🇭" },
} as const;

export function RateControlCard() {
  const queryClient = useQueryClient();
  const [pair, setPair] = useState<(typeof CURRENCY_PAIRS)[number]["value"]>(
    "NGN:GHS",
  );
  const [rate, setRate] = useState("");
  const [rateAttemptKey, setRateAttemptKey] = useState<string | null>(null);
  const [prefilledPair, setPrefilledPair] = useState<string | null>(null);

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
    refetchInterval: 10000,
  });

  const numericDraftRate = Number(rate);
  // Prefill the set-rate form from the live rate once per pair (React's
  // "adjust state during render" pattern) so a background refetch never
  // clobbers an admin's in-progress edits.
  if (rateQuery.data && prefilledPair !== selectedPair.value) {
    setPrefilledPair(selectedPair.value);
    setRate(String(rateQuery.data.effectiveRate ?? ""));
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
    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      toast.error("Enter a positive rate");
      return;
    }
    updateRateMutation.mutate();
  };

  const currencySelector = (side: "from" | "to") => (
    <Select
      value={selectedPair[side]}
      disabled={updateRateMutation.isPending}
      onValueChange={(currency) => {
        if (currency === selectedPair[side]) return;
        const nextPair = CURRENCY_PAIRS.find((item) => item[side] === currency)!;
        setPair(nextPair.value);
        setRate("");
        setRateAttemptKey(null);
        setPrefilledPair(null);
      }}
    >
      <SelectTrigger aria-label={side === "from" ? "Source currency" : "Receiving currency"}
        className="h-12! w-32 shrink-0 rounded-none border-0 border-l border-border bg-transparent! px-3 text-base shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["NGN", "GHS"] as const).map((currency) => (
          <SelectItem key={currency} value={currency} textValue={currency} className="min-h-11 text-base">
            <span aria-hidden="true" className="text-xl">{CURRENCY_DETAILS[currency].flag}</span>
            <span>{currency}</span>
            <span className="sr-only">{CURRENCY_DETAILS[currency].name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card className="min-w-0 w-full border-0 bg-transparent py-0 shadow-none ring-0">
      <CardHeader className="flex flex-row items-center justify-between px-0">
        <CardTitle>Exchange rate</CardTitle>
        <span role="status" className="text-xs text-muted-foreground">
          {rateQuery.isLoading ? "Loading…" : rateQuery.isError ? "Unavailable" :
            rateQuery.data && numericDraftRate > 0 && numericDraftRate !== Number(rateQuery.data.effectiveRate)
              ? "Unsaved" : rateQuery.data?.isStale ? "Stale" : "Saved"}
        </span>
      </CardHeader>
      <CardContent className="grid gap-4 px-0">
        <div className="grid gap-2">
          <Label htmlFor="source-amount">For</Label>
          <div className="flex min-w-0 items-center overflow-hidden rounded-lg border border-input">
            <Input id="source-amount" value="1" readOnly aria-label="Source amount"
              className="h-14 min-w-0 flex-1 rounded-none border-0 bg-transparent! px-4 text-2xl! shadow-none" />
            {currencySelector("from")}
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rate-value">Customers receive</Label>
          <div className="flex min-w-0 items-center overflow-hidden rounded-lg border border-input">
            <Input id="rate-value" inputMode="decimal" placeholder={rateQuery.isLoading ? "Loading…" : "0.00"}
              value={rate} onChange={(event) => { setRate(event.target.value); setRateAttemptKey(null); }}
              disabled={updateRateMutation.isPending || rateQuery.isLoading || rateQuery.isError}
              className="h-14 min-w-0 flex-1 rounded-none border-0 bg-transparent! px-4 text-2xl! shadow-none" />
            {currencySelector("to")}
          </div>
        </div>
        {rateQuery.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p>{getErrorMessage(rateQuery.error, "Could not load the rate.")}</p>
            <Button variant="outline" size="sm" onClick={() => void rateQuery.refetch()}>Retry</Button>
          </div>
        )}
        <Button onClick={submitRate} className="h-11 sm:w-fit sm:min-w-32"
          disabled={updateRateMutation.isPending || rateQuery.isLoading || rateQuery.isError || !Number.isFinite(numericDraftRate) || numericDraftRate <= 0}>
          {updateRateMutation.isPending ? "Saving..." : "Save rate"}
        </Button>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { exchangeApi } from "@/services/api";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";

import { ExchangeQuote, ApiError } from "@/types";

export default function ExchangePage() {
  const { profile } = useAuth();
  const [from, setFrom] = useState("GHS");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const inFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);

  const currencies = [
    { value: "GHS", label: "GHS (₵)", symbol: "₵" },
    { value: "NGN", label: "NGN (₦)", symbol: "₦" },
  ];

  const getSymbol = (currency: string) =>
    currencies.find((c) => c.value === currency)?.symbol || "";

  const resetAttempt = () => {
    attemptKeyRef.current = null;
  };

  const handleGetQuote = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsLoading(true);
    try {
      const response = await exchangeApi.createQuote({
        from,
        to,
        amount: parseFloat(amount),
      });
      setQuote(response.data);
      resetAttempt();
      toast.success("Quote created");
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Failed to create quote";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!quote) return;
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }
    if (inFlightRef.current) return;

    if (new Date(quote.expiresAt) < new Date()) {
      toast.error("Quote has expired. Please create a new quote.");
      setQuote(null);
      return;
    }

    inFlightRef.current = true;
    setIsExecuting(true);
    try {
      const idempotencyKey =
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("exchange");
      attemptKeyRef.current = idempotencyKey;

      await exchangeApi.executeQuote(quote.id, idempotencyKey);
      toast.success("Exchange completed successfully!");
      setQuote(null);
      setAmount("");
      resetAttempt();
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Exchange failed";
      toast.error(message);
    } finally {
      inFlightRef.current = false;
      setIsExecuting(false);
    }
  };

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
    setQuote(null);
    resetAttempt();
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Currency Exchange</h1>
          <p className="text-muted-foreground mt-1">Convert between GHS and NGN at competitive rates</p>
        </div>

        {moneyGate && (
          <Card>
            <CardHeader>
              <CardTitle>{moneyGate.title}</CardTitle>
              <CardDescription>{moneyGate.message}</CardDescription>
            </CardHeader>
            {moneyGate.actionHref && moneyGate.actionLabel && (
              <CardContent>
                <Button asChild variant="outline">
                  <Link href={moneyGate.actionHref}>{moneyGate.actionLabel}</Link>
                </Button>
              </CardContent>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Exchange</CardTitle>
            <CardDescription>Enter the amount you want to send</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <Label>From</Label>
                <div className="flex gap-2 mt-1">
                  <Select value={from} onValueChange={(v) => { setFrom(v); setQuote(null); resetAttempt(); }}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setQuote(null); resetAttempt(); }}
                    className="flex-1"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <Button variant="outline" size="icon" onClick={handleSwap} className="mb-0.5">
                ⇄
              </Button>

              <div className="flex-1">
                <Label>To</Label>
                <div className="flex gap-2 mt-1">
                  <Select value={to} onValueChange={(v) => { setTo(v); setQuote(null); resetAttempt(); }}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex-1 flex items-center px-3 border rounded-md bg-muted text-muted-foreground">
                    {quote ? `${getSymbol(to)}${quote.receiveAmount?.toFixed(2)}` : "—"}
                  </div>
                </div>
              </div>
            </div>

            <Button onClick={handleGetQuote} disabled={isLoading || !amount || !!moneyGate} className="w-full">
              {isLoading ? "Getting quote..." : "Get Quote"}
            </Button>

            {quote && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You Send</span>
                    <span className="font-semibold">
                      {getSymbol(from)}{quote.sendAmount?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exchange Rate</span>
                    <span className="font-semibold">
                      1 {from} = {quote.rate?.toFixed(4)} {to}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="font-semibold">
                      {getSymbol(from)}{quote.fee?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Markup</span>
                    <Badge variant="secondary">{quote.markupPercent}%</Badge>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg">
                    <span className="font-semibold">They Receive</span>
                    <span className="font-bold text-primary">
                      {getSymbol(to)}{quote.receiveAmount?.toFixed(2)}
                    </span>
                  </div>
                </div>

                <Button
                  onClick={handleExecute}
                  disabled={isExecuting || !!moneyGate}
                  className="w-full"
                  size="lg"
                >
                  {isExecuting ? "Processing..." : "Confirm Exchange"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

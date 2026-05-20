"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { paymentApi } from "@/services/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";

export default function FundPage() {
  const { profile } = useAuth();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [channel, setChannel] = useState("card");
  const [provider, setProvider] = useState("paystack");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const inFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);

  const resetAttempt = () => {
    attemptKeyRef.current = null;
    setIsConfirming(false);
  };

  const handleFund = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (inFlightRef.current) return;

    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const idempotencyKey =
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("fund");
      attemptKeyRef.current = idempotencyKey;

      const response = await paymentApi.fundWallet({
        amount: parseFloat(amount),
        currency,
        channel,
        provider,
      }, idempotencyKey);

      if (response.data.paymentUrl) {
        window.open(response.data.paymentUrl, "_blank");
        toast.success("Redirecting to payment gateway...");
      } else {
        toast.info("Payment initiated. Reference: " + response.data.reference);
      }
      resetAttempt();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to initiate payment"));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Fund Wallet</h1>
          <p className="text-muted-foreground mt-1">Add money to your wallet</p>
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
            <CardTitle>Payment Details</CardTitle>
            <CardDescription>Choose your payment method</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(value) => { setCurrency(value); resetAttempt(); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">NGN (₦)</SelectItem>
                  <SelectItem value="GHS">GHS (₵)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="1000"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); resetAttempt(); }}
                min="1"
                step="0.01"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Payment Method</Label>
              <Select value={channel} onValueChange={(value) => { setChannel(value); resetAttempt(); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="ussd">USSD</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={(value) => { setProvider(value); resetAttempt(); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paystack">Paystack</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isConfirming && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">Review funding attempt</p>
                <p className="mt-1 text-muted-foreground">
                  Confirm funding {currency} {Number(amount || 0).toFixed(2)} with {provider} via {channel}.
                </p>
              </div>
            )}

            <Button onClick={handleFund} disabled={isLoading || !!moneyGate} className="w-full" size="lg">
              {isLoading ? "Processing..." : isConfirming ? "Confirm Funding" : "Review Funding"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              You will be redirected to the payment gateway to complete the transaction.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

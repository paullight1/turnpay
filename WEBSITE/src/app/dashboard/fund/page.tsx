"use client";

import { useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { paymentApi } from "@/services/api";
import { getErrorMessage } from "@/lib/errors";

export default function FundPage() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [channel, setChannel] = useState("card");
  const [provider, setProvider] = useState("paystack");
  const [isLoading, setIsLoading] = useState(false);

  const handleFund = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsLoading(true);
    try {
      const response = await paymentApi.fundWallet({
        amount: parseFloat(amount),
        currency,
        channel,
        provider,
      });

      if (response.data.paymentUrl) {
        window.open(response.data.paymentUrl, "_blank");
        toast.success("Redirecting to payment gateway...");
      } else {
        toast.info("Payment initiated. Reference: " + response.data.reference);
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to initiate payment"));
    } finally {
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

        <Card>
          <CardHeader>
            <CardTitle>Payment Details</CardTitle>
            <CardDescription>Choose your payment method</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
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
                onChange={(e) => setAmount(e.target.value)}
                min="1"
                step="0.01"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Payment Method</Label>
              <Select value={channel} onValueChange={setChannel}>
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
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paystack">Paystack</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleFund} disabled={isLoading} className="w-full" size="lg">
              {isLoading ? "Processing..." : "Fund Wallet"}
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

"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { TrustPayAnimation } from "@/components/animations/trustpay-animation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { paymentApi } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskAccountNumber } from "@/lib/privacy";

export default function WithdrawPage() {
  const { profile } = useAuth();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [transactionPin, setTransactionPin] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const inFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);

  const resetAttempt = () => {
    attemptKeyRef.current = null;
    setIsConfirming(false);
  };

  const { data: banks } = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const res = await paymentApi.listBanks();
      return res.data as Array<{ name: string; code: string; slug: string }>;
    },
    staleTime: 60000 * 60,
  });

  const handleResolve = async () => {
    if (!accountNumber || !bankCode) {
      toast.error("Please enter account number and select a bank");
      return;
    }

    setIsResolving(true);
    try {
      const response = await paymentApi.resolveBank(accountNumber, bankCode);
      setAccountName(response.data.accountName);
      toast.success("Account resolved successfully");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to resolve account"));
    } finally {
      setIsResolving(false);
    }
  };

  const handleWithdraw = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (inFlightRef.current) return;

    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!accountName) {
      toast.error("Please resolve the account first");
      return;
    }

    if (!/^\d{4,6}$/.test(transactionPin)) {
      toast.error("Enter your 4 to 6 digit transaction PIN");
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
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("withdraw");
      attemptKeyRef.current = idempotencyKey;

      await paymentApi.withdraw({
        amount: parseFloat(amount),
        currency,
        bankCode,
        accountNumber,
        accountName,
        transactionPin,
      }, idempotencyKey);
      toast.success("Withdrawal initiated successfully");
      setAmount("");
      setAccountNumber("");
      setAccountName("");
      setBankCode("");
      setTransactionPin("");
      resetAttempt();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Withdrawal failed"));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <TrustPayAnimation
            variant={isLoading ? "loading" : "send"}
            className="size-16 shrink-0"
            label={isLoading ? "Processing withdrawal" : "Withdraw money"}
          />
          <div>
            <h1 className="text-3xl font-bold">Withdraw to bank</h1>
            <p className="text-muted-foreground mt-1">Move money from TrustPay to a bank account</p>
          </div>
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
            <CardTitle>Bank withdrawal details</CardTitle>
            <CardDescription>Enter your bank account information</CardDescription>
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
              <Label>Bank</Label>
              <Select value={bankCode} onValueChange={(value) => { setBankCode(value); setAccountName(""); resetAttempt(); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>
                <SelectContent>
                  {banks?.map((bank) => (
                    <SelectItem key={bank.code} value={bank.code}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Account Number</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="0123456789"
                  value={accountNumber}
                  onChange={(e) => { setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10)); setAccountName(""); resetAttempt(); }}
                  maxLength={10}
                />
                <Button
                  variant="outline"
                  onClick={handleResolve}
                  disabled={isResolving || !accountNumber || !bankCode}
                >
                  {isResolving ? "..." : "Resolve"}
                </Button>
              </div>
            </div>

            {accountName && (
              <div className="p-3 rounded-lg bg-muted">
                <Label className="text-sm">Account Name</Label>
                <p className="font-medium">{accountName}</p>
              </div>
            )}

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

            {isConfirming && (
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex gap-3">
                  <TrustPayAnimation
                    variant="send"
                    className="size-12 shrink-0"
                    label="Review withdrawal"
                  />
                  <div>
                    <p className="font-medium">Review withdrawal</p>
                    <p className="mt-1 text-muted-foreground">
                      Confirm {currency} {Number(amount || 0).toFixed(2)} to {accountName} ({maskAccountNumber(accountNumber)}).
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Transaction PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                placeholder="4 to 6 digits"
                value={transactionPin}
                onChange={(e) => { setTransactionPin(e.target.value.replace(/\D/g, "").slice(0, 6)); resetAttempt(); }}
                minLength={4}
                maxLength={6}
              />
            </div>

            <Button onClick={handleWithdraw} disabled={isLoading || !!moneyGate} className="w-full" size="lg">
              {isLoading ? "Processing..." : isConfirming ? "Confirm Withdrawal" : "Review Withdrawal"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

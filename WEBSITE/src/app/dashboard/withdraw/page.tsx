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
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/errors";

export default function WithdrawPage() {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!accountName) {
      toast.error("Please resolve the account first");
      return;
    }

    setIsLoading(true);
    try {
      await paymentApi.withdraw({
        amount: parseFloat(amount),
        currency,
        bankCode,
        accountNumber,
        accountName,
      });
      toast.success("Withdrawal initiated successfully");
      setAmount("");
      setAccountNumber("");
      setAccountName("");
      setBankCode("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Withdrawal failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Withdraw</h1>
          <p className="text-muted-foreground mt-1">Send money to your bank account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Bank Details</CardTitle>
            <CardDescription>Enter your bank account information</CardDescription>
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
              <Label>Bank</Label>
              <Select value={bankCode} onValueChange={setBankCode}>
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
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
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
                onChange={(e) => setAmount(e.target.value)}
                min="1"
                step="0.01"
              />
            </div>

            <Button onClick={handleWithdraw} disabled={isLoading} className="w-full" size="lg">
              {isLoading ? "Processing..." : "Withdraw"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

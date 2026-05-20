"use client";

import { useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { vtuApi } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskPhone } from "@/lib/privacy";

import { VtuProvider, VtuPackage, ApiError } from "@/types";

const serviceTypes = [
  { id: "airtime", label: "Airtime", icon: "📞" },
  { id: "data", label: "Data", icon: "🌐" },
  { id: "cable", label: "Cable TV", icon: "📺" },
  { id: "electricity", label: "Electricity", icon: "⚡" },
];

function VtuContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "airtime";
  const [activeType, setActiveType] = useState(initialType);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [recipientNumber, setRecipientNumber] = useState("");
  const [smartCardNumber, setSmartCardNumber] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const inFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);

  const resetAttempt = () => {
    attemptKeyRef.current = null;
    setIsConfirming(false);
  };

  const { data: providers = [] } = useQuery({
    queryKey: ["vtu-providers", activeType],
    queryFn: async () => {
      const response = await vtuApi.getProviders(activeType);
      return response.data as VtuProvider[];
    },
  });

  const { data: packages = [] } = useQuery({
    queryKey: ["vtu-packages", selectedProvider],
    queryFn: async () => {
      const response = await vtuApi.getPackages(selectedProvider);
      return response.data as VtuPackage[];
    },
    enabled: !!selectedProvider && activeType === "data",
  });

  const handlePurchase = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (inFlightRef.current) return;

    if (activeType === "airtime" && (!recipientNumber || !amount)) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (activeType === "data" && (!recipientNumber || !selectedPackage)) {
      toast.error("Please select a package and enter phone number");
      return;
    }
    if (activeType === "cable" && (!smartCardNumber || !amount)) {
      toast.error("Please enter your smart card number and amount");
      return;
    }
    if (activeType === "electricity" && (!meterNumber || !amount)) {
      toast.error("Please enter your meter number and amount");
      return;
    }

    const purchaseAmount = activeType === "airtime"
      ? parseFloat(amount)
      : activeType === "data"
        ? packages.find((p) => p.id === selectedPackage)?.price || 0
        : parseFloat(amount);

    if (!purchaseAmount || purchaseAmount <= 0) {
      toast.error("Please select a valid amount");
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    inFlightRef.current = true;
    setIsPurchasing(true);
    try {
      const idempotencyKey =
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("vtu");
      attemptKeyRef.current = idempotencyKey;

      await vtuApi.purchase({
        type: activeType,
        provider: selectedProvider,
        recipientNumber,
        amount: purchaseAmount,
        packageId: selectedPackage || undefined,
        smartCardNumber: smartCardNumber || undefined,
        meterNumber: meterNumber || undefined,
      }, idempotencyKey);

      toast.success("Purchase successful!");
      setRecipientNumber("");
      setSmartCardNumber("");
      setMeterNumber("");
      setSelectedPackage("");
      setAmount("");
      resetAttempt();
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Purchase failed";
      toast.error(message);
    } finally {
      inFlightRef.current = false;
      setIsPurchasing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Airtime, Data & Bills</h1>
          <p className="text-muted-foreground mt-1">Buy airtime, data bundles, and pay bills instantly</p>
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

        <Tabs value={activeType} onValueChange={(value) => {
          setActiveType(value);
          setSelectedProvider("");
          setSelectedPackage("");
          resetAttempt();
        }}>
          <TabsList className="grid grid-cols-4">
            {serviceTypes.map((type) => (
              <TabsTrigger key={type.id} value={type.id}>
                <span className="mr-1">{type.icon}</span>
                <span className="hidden sm:inline">{type.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {serviceTypes.map((type) => (
            <TabsContent key={type.id} value={type.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{type.label}</CardTitle>
                  <CardDescription>
                    {type.id === "airtime" && "Top up any network"}
                    {type.id === "data" && "Buy affordable data bundles"}
                    {type.id === "cable" && "Pay for your cable subscription"}
                    {type.id === "electricity" && "Pay your electricity bill"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div>
                    <Label>Provider</Label>
                    <Select value={selectedProvider} onValueChange={(value) => {
                      setSelectedProvider(value);
                      setSelectedPackage("");
                      resetAttempt();
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(type.id === "airtime" || type.id === "data") && (
                    <div>
                      <Label>Phone Number</Label>
                      <Input
                        type="tel"
                        placeholder="08012345678"
                        value={recipientNumber}
                        onChange={(e) => { setRecipientNumber(e.target.value); resetAttempt(); }}
                      />
                    </div>
                  )}

                  {type.id === "data" && selectedProvider && (
                    <div>
                      <Label>Data Package</Label>
                      <Select value={selectedPackage} onValueChange={(value) => { setSelectedPackage(value); resetAttempt(); }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select package" />
                        </SelectTrigger>
                        <SelectContent>
                          {packages.map((pkg) => (
                            <SelectItem key={pkg.id} value={pkg.id}>
                              {pkg.name} — ₦{pkg.price} ({pkg.validity})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {type.id === "airtime" && (
                    <div>
                      <Label>Amount (₦)</Label>
                      <Input
                        type="number"
                        placeholder="500"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); resetAttempt(); }}
                        min="50"
                      />
                    </div>
                  )}

                  {type.id === "cable" && (
                    <div>
                      <Label>Smart Card Number</Label>
                      <Input
                        placeholder="Enter your smart card number"
                        value={smartCardNumber}
                        onChange={(e) => { setSmartCardNumber(e.target.value); resetAttempt(); }}
                      />
                    </div>
                  )}

                  {type.id === "electricity" && (
                    <div>
                      <Label>Meter Number</Label>
                      <Input
                        placeholder="Enter your meter number"
                        value={meterNumber}
                        onChange={(e) => { setMeterNumber(e.target.value); resetAttempt(); }}
                      />
                    </div>
                  )}

                  {(type.id === "cable" || type.id === "electricity") && (
                    <div>
                      <Label>Amount (₦)</Label>
                      <Input
                        type="number"
                        placeholder="5000"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); resetAttempt(); }}
                        min="50"
                      />
                    </div>
                  )}

                  {isConfirming && (
                    <div className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">Review purchase</p>
                      <p className="mt-1 text-muted-foreground">
                        Confirm {type.label.toLowerCase()} purchase for {recipientNumber ? maskPhone(recipientNumber) : smartCardNumber || meterNumber}.
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handlePurchase}
                    disabled={isPurchasing || !selectedProvider || !!moneyGate}
                    className="w-full"
                  >
                    {isPurchasing ? "Processing..." : isConfirming ? `Confirm ${type.label}` : `Review ${type.label}`}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

export default function VtuPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <VtuContent />
    </Suspense>
  );
}

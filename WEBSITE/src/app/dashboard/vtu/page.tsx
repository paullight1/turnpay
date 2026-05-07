"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { vtuApi } from "@/services/api";

import { VtuProvider, VtuPackage, ApiError } from "@/types";

const serviceTypes = [
  { id: "airtime", label: "Airtime", icon: "📞" },
  { id: "data", label: "Data", icon: "🌐" },
  { id: "cable", label: "Cable TV", icon: "📺" },
  { id: "electricity", label: "Electricity", icon: "⚡" },
];

function VtuContent() {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "airtime";
  const [activeType, setActiveType] = useState(initialType);
  const [providers, setProviders] = useState<VtuProvider[]>([]);
  const [packages, setPackages] = useState<VtuPackage[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [recipientNumber, setRecipientNumber] = useState("");
  const [smartCardNumber, setSmartCardNumber] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);

  useEffect(() => {
    loadProviders();
  }, [activeType]);

  useEffect(() => {
    if (selectedProvider && activeType === "data") {
      loadPackages();
    }
  }, [selectedProvider]);

  const loadProviders = async () => {
    try {
      const response = await vtuApi.getProviders(activeType);
      setProviders(response.data);
    } catch {
      toast.error("Failed to load providers");
    }
  };

  const loadPackages = async () => {
    try {
      const response = await vtuApi.getPackages(selectedProvider);
      setPackages(response.data);
    } catch {
      toast.error("Failed to load packages");
    }
  };

  const handlePurchase = async () => {
    if (activeType === "airtime" && (!recipientNumber || !amount)) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (activeType === "data" && (!recipientNumber || !selectedPackage)) {
      toast.error("Please select a package and enter phone number");
      return;
    }
    if (activeType === "cable" && !smartCardNumber) {
      toast.error("Please enter your smart card number");
      return;
    }
    if (activeType === "electricity" && !meterNumber) {
      toast.error("Please enter your meter number");
      return;
    }

    setIsPurchasing(true);
    try {
      const purchaseAmount = activeType === "airtime"
        ? parseFloat(amount)
        : packages.find((p) => p.id === selectedPackage)?.price || 0;

      await vtuApi.purchase({
        type: activeType,
        provider: selectedProvider,
        recipientNumber,
        amount: purchaseAmount,
        packageId: selectedPackage || undefined,
        smartCardNumber: smartCardNumber || undefined,
        meterNumber: meterNumber || undefined,
      });

      toast.success("Purchase successful!");
      setRecipientNumber("");
      setSmartCardNumber("");
      setMeterNumber("");
      setSelectedPackage("");
      setAmount("");
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Purchase failed";
      toast.error(message);
    } finally {
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

        <Tabs value={activeType} onValueChange={setActiveType}>
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
                    <Select value={selectedProvider} onValueChange={setSelectedProvider}>
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
                        onChange={(e) => setRecipientNumber(e.target.value)}
                      />
                    </div>
                  )}

                  {type.id === "data" && selectedProvider && (
                    <div>
                      <Label>Data Package</Label>
                      <Select value={selectedPackage} onValueChange={setSelectedPackage}>
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
                        onChange={(e) => setAmount(e.target.value)}
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
                        onChange={(e) => setSmartCardNumber(e.target.value)}
                      />
                    </div>
                  )}

                  {type.id === "electricity" && (
                    <div>
                      <Label>Meter Number</Label>
                      <Input
                        placeholder="Enter your meter number"
                        value={meterNumber}
                        onChange={(e) => setMeterNumber(e.target.value)}
                      />
                    </div>
                  )}

                  <Button
                    onClick={handlePurchase}
                    disabled={isPurchasing || !selectedProvider}
                    className="w-full"
                  >
                    {isPurchasing ? "Processing..." : `Buy ${type.label}`}
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

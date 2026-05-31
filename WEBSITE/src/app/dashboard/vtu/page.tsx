"use client";

import { useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { vtuApi } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskPhone } from "@/lib/privacy";
import { Loader2, RefreshCw } from "lucide-react";

import {
  VtuProvider,
  VtuPackage,
  VtuPurchaseResult,
  VtuOrderStatus,
  ApiError,
} from "@/types";

const serviceTypes = [
  { id: "airtime", label: "Airtime", icon: "📞" },
  { id: "data", label: "Data", icon: "🌐" },
  { id: "cable", label: "Cable TV", icon: "📺" },
  { id: "electricity", label: "Electricity", icon: "⚡" },
];

const markets = [
  { code: "NG", name: "Nigeria", status: "Live" },
  { code: "GH", name: "Ghana", status: "Live" },
  { code: "KE", name: "Kenya", status: "Coming soon" },
  { code: "ZA", name: "South Africa", status: "Coming soon" },
  { code: "US", name: "United States", status: "Coming soon" },
  { code: "GB", name: "United Kingdom", status: "Coming soon" },
] as const;

const liveMarkets = new Set(["NG", "GH"]);
const terminalOrderStatuses = new Set(["SUCCESS", "FAILED", "REVERSED"]);
const currencySymbols: Record<string, string> = {
  NGN: "₦",
  GHS: "₵",
};
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "SUCCESS":
      return "default";
    case "FAILED":
    case "REVERSED":
      return "destructive";
    case "PENDING":
    case "PROCESSING":
    case "UNKNOWN":
      return "secondary";
    default:
      return "outline";
  }
}

function formatMoney(currency: string, amount: string) {
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : amount;

  return `${currencySymbols[currency] || currency} ${formatted}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function MarketSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <Label>Service country</Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {markets.map((market) => {
          const isLive = market.status === "Live";
          const isSelected = value === market.code;
          return (
            <Button
              key={market.code}
              type="button"
              variant={isSelected ? "default" : "outline"}
              disabled={!isLive}
              className="h-auto justify-start px-3 py-2 text-left"
              onClick={() => onChange(market.code)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{market.name}</span>
                <span className="text-xs opacity-75">{market.status}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function VtuContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "airtime";
  const [activeType, setActiveType] = useState(initialType);
  const [airtimeScope, setAirtimeScope] = useState<"local" | "international">(
    "local",
  );
  const [selectedCountryCode, setSelectedCountryCode] = useState("GH");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [recipientNumber, setRecipientNumber] = useState("");
  const [smartCardNumber, setSmartCardNumber] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionPin, setTransactionPin] = useState("");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [pendingOrderReference, setPendingOrderReference] = useState<
    string | null
  >(null);
  const [trackedOrder, setTrackedOrder] = useState<VtuOrderStatus | null>(null);
  const [isCheckingOrder, setIsCheckingOrder] = useState(false);
  const inFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);
  const effectiveCountryCode =
    activeType === "airtime" && airtimeScope === "local"
      ? "NG"
      : selectedCountryCode;
  const isReloadlyMarket =
    ["airtime", "data"].includes(activeType) && effectiveCountryCode === "GH";
  const isReloadlyUtilityMarket =
    activeType === "electricity" && effectiveCountryCode === "GH";
  const providerScope =
    isReloadlyMarket ||
    isReloadlyUtilityMarket ||
    (activeType === "airtime" && airtimeScope === "international")
      ? "international"
      : "local";
  const serviceComingSoon =
    !liveMarkets.has(effectiveCountryCode) ||
    (effectiveCountryCode === "GH" && ["cable"].includes(activeType));

  const resetAttempt = () => {
    attemptKeyRef.current = null;
    setIsConfirming(false);
  };

  const { data: providers = [] } = useQuery({
    queryKey: [
      "vtu-providers",
      activeType,
      providerScope,
      effectiveCountryCode,
    ],
    queryFn: async () => {
      const response = await vtuApi.getProviders(activeType, {
        scope: providerScope,
        countryCode:
          providerScope === "international" ? effectiveCountryCode : undefined,
      });
      return response.data as VtuProvider[];
    },
    enabled: !serviceComingSoon,
  });

  const { data: packages = [] } = useQuery({
    queryKey: ["vtu-packages", selectedProvider],
    queryFn: async () => {
      const response = await vtuApi.getPackages(selectedProvider);
      return response.data as VtuPackage[];
    },
    enabled:
      !!selectedProvider && activeType === "data" && providerScope === "local",
  });

  const handleCheckOrderStatus = async () => {
    const reference = trackedOrder?.orderId || pendingOrderReference;
    if (!reference) return;

    setIsCheckingOrder(true);
    try {
      const response = await vtuApi.requeryOrder(
        reference,
        createMoneyAttemptIdempotencyKey("vtu-requery"),
      );
      const order = response.data as VtuOrderStatus;
      setTrackedOrder(order);
      setPendingOrderReference(order.orderId);

      if (order.orderStatus === "SUCCESS") {
        toast.success("VTU purchase confirmed.");
        setTransactionPin("");
        resetAttempt();
      } else if (["FAILED", "REVERSED"].includes(order.orderStatus)) {
        toast.error("VTU purchase failed. Reserved funds were reversed.");
        setTransactionPin("");
        resetAttempt();
      } else {
        toast.info("VTU purchase is still pending provider confirmation.");
      }
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to refresh VTU order status";
      toast.error(message);
    } finally {
      setIsCheckingOrder(false);
    }
  };

  const handlePurchase = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (inFlightRef.current) return;

    if (serviceComingSoon) {
      toast.error(`${activeType} is coming soon in ${effectiveCountryCode}`);
      return;
    }

    if (activeType === "airtime" && (!recipientNumber || !amount)) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (
      activeType === "airtime" &&
      providerScope === "international" &&
      !effectiveCountryCode
    ) {
      toast.error("Select the recipient country");
      return;
    }
    if (
      activeType === "data" &&
      providerScope === "local" &&
      (!recipientNumber || !selectedPackage)
    ) {
      toast.error("Please select a package and enter phone number");
      return;
    }
    if (
      activeType === "data" &&
      providerScope === "international" &&
      (!recipientNumber || !amount)
    ) {
      toast.error("Please enter the phone number and amount");
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

    const purchaseAmount =
      activeType === "airtime"
        ? parseFloat(amount)
        : activeType === "data"
          ? providerScope === "international"
            ? parseFloat(amount)
            : packages.find((p) => p.id === selectedPackage)?.price || 0
          : parseFloat(amount);

    if (!purchaseAmount || purchaseAmount <= 0) {
      toast.error("Please select a valid amount");
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
    setIsPurchasing(true);
    try {
      const idempotencyKey =
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("vtu");
      attemptKeyRef.current = idempotencyKey;

      const response = await vtuApi.purchase(
        {
          type: activeType,
          scope: providerScope,
          provider: providerScope === "local" ? selectedProvider : undefined,
          countryCode:
            providerScope === "international"
              ? effectiveCountryCode
              : undefined,
          operatorId:
            providerScope === "international" ? selectedProvider : undefined,
          recipientNumber,
          amount: purchaseAmount,
          packageId: selectedPackage || undefined,
          smartCardNumber: smartCardNumber || undefined,
          meterNumber: meterNumber || undefined,
          transactionPin,
        },
        idempotencyKey,
      );

      const result = response.data as VtuPurchaseResult;

      if (result.status === "PENDING" || result.success === false) {
        setPendingOrderReference(result.orderId || result.reference || null);
        setTrackedOrder(null);
        toast.info(
          result.message ||
            `Purchase submitted. Reference: ${result.reference || result.orderId}`,
        );
        setIsConfirming(false);
        return;
      }

      toast.success(result.message || "Purchase successful!");
      setPendingOrderReference(null);
      setTrackedOrder(null);
      setRecipientNumber("");
      setSmartCardNumber("");
      setMeterNumber("");
      setSelectedPackage("");
      setAmount("");
      setTransactionPin("");
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
          <p className="text-muted-foreground mt-1">
            Buy airtime, data bundles, and pay bills instantly
          </p>
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
                  <Link href={moneyGate.actionHref}>
                    {moneyGate.actionLabel}
                  </Link>
                </Button>
              </CardContent>
            )}
          </Card>
        )}

        {pendingOrderReference && (
          <Card>
            <CardHeader className="gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">Recent VTU order</CardTitle>
                  <CardDescription>
                    Provider confirmation can take a few minutes for some
                    networks.
                  </CardDescription>
                </div>
                <Badge
                  variant={statusVariant(
                    trackedOrder?.orderStatus || "PENDING",
                  )}
                  className="w-fit"
                >
                  {trackedOrder?.orderStatus || "PENDING"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Reference</p>
                  <p className="break-all font-medium">
                    {trackedOrder?.reference || pendingOrderReference}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Provider</p>
                  <p className="font-medium">
                    {trackedOrder
                      ? trackedOrder.provider === "RELOADLY"
                        ? "Reloadly"
                        : trackedOrder.provider
                      : providerScope === "international"
                        ? "Reloadly"
                        : "VTpass"}
                  </p>
                </div>
                {trackedOrder && (
                  <>
                    <div>
                      <p className="text-muted-foreground">Amount</p>
                      <p className="font-medium">
                        {formatMoney(
                          trackedOrder.currency,
                          trackedOrder.amount,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recipient</p>
                      <p className="font-medium">
                        {trackedOrder.targetMasked || "Masked"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Next check</p>
                      <p className="font-medium">
                        {terminalOrderStatuses.has(trackedOrder.orderStatus)
                          ? "Complete"
                          : formatDateTime(trackedOrder.nextRequeryAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Attempts</p>
                      <p className="font-medium">
                        {trackedOrder.requeryAttempts}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCheckOrderStatus}
                  disabled={
                    isCheckingOrder ||
                    (trackedOrder
                      ? terminalOrderStatuses.has(trackedOrder.orderStatus)
                      : false)
                  }
                >
                  {isCheckingOrder ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  Check status
                </Button>
                <Button asChild type="button" variant="ghost">
                  <Link href="/dashboard/transactions">View transactions</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs
          value={activeType}
          onValueChange={(value) => {
            setActiveType(value);
            setSelectedProvider("");
            setSelectedPackage("");
            setAirtimeScope("local");
            if (value !== "airtime") {
              setSelectedCountryCode("NG");
            }
            resetAttempt();
          }}
        >
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
                  {type.id === "airtime" && (
                    <div className="grid gap-3">
                      <Label>Top-up destination</Label>
                      <Tabs
                        value={airtimeScope}
                        onValueChange={(value) => {
                          setAirtimeScope(value as "local" | "international");
                          setSelectedProvider("");
                          resetAttempt();
                        }}
                      >
                        <TabsList className="grid grid-cols-2">
                          <TabsTrigger value="local">Local</TabsTrigger>
                          <TabsTrigger value="international">
                            International
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  )}

                  {type.id === "airtime" &&
                    airtimeScope === "international" && (
                      <MarketSelector
                        value={selectedCountryCode}
                        onChange={(value) => {
                          setSelectedCountryCode(value);
                          setSelectedProvider("");
                          resetAttempt();
                        }}
                      />
                    )}

                  {type.id !== "airtime" && (
                    <MarketSelector
                      value={effectiveCountryCode}
                      onChange={(value) => {
                        setSelectedCountryCode(value);
                        setSelectedProvider("");
                        setSelectedPackage("");
                        resetAttempt();
                      }}
                    />
                  )}

                  {serviceComingSoon && (
                    <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm">
                      <p className="font-medium">
                        {type.label} is coming soon in {effectiveCountryCode}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Nigeria supports the full VTU set today. Ghana airtime
                        and data are available through Reloadly, Ghana
                        electricity is being enabled through Reloadly Utilities,
                        and cable remains in provider onboarding.
                      </p>
                    </div>
                  )}

                  <div>
                    <Label>
                      {providerScope === "international"
                        ? activeType === "electricity"
                          ? "Biller"
                          : "Operator"
                        : "Provider"}
                    </Label>
                    <Select
                      value={selectedProvider}
                      disabled={serviceComingSoon}
                      onValueChange={(value) => {
                        setSelectedProvider(value);
                        setSelectedPackage("");
                        resetAttempt();
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            providerScope === "international"
                              ? activeType === "electricity"
                                ? "Select biller"
                                : "Select operator"
                              : "Select provider"
                          }
                        />
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
                        onChange={(e) => {
                          setRecipientNumber(e.target.value);
                          resetAttempt();
                        }}
                      />
                    </div>
                  )}

                  {type.id === "data" &&
                    selectedProvider &&
                    providerScope === "local" && (
                      <div>
                        <Label>Data Package</Label>
                        <Select
                          value={selectedPackage}
                          onValueChange={(value) => {
                            setSelectedPackage(value);
                            resetAttempt();
                          }}
                        >
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

                  {(type.id === "airtime" ||
                    (type.id === "data" &&
                      providerScope === "international")) && (
                    <div>
                      <Label>
                        {providerScope === "international"
                          ? "Amount (NGN wallet)"
                          : "Amount (₦)"}
                      </Label>
                      <Input
                        type="number"
                        placeholder="500"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          resetAttempt();
                        }}
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
                        onChange={(e) => {
                          setSmartCardNumber(e.target.value);
                          resetAttempt();
                        }}
                      />
                    </div>
                  )}

                  {type.id === "electricity" && (
                    <div>
                      <Label>Meter Number</Label>
                      <Input
                        placeholder="Enter your meter number"
                        value={meterNumber}
                        onChange={(e) => {
                          setMeterNumber(e.target.value);
                          resetAttempt();
                        }}
                      />
                    </div>
                  )}

                  {(type.id === "cable" || type.id === "electricity") && (
                    <div>
                      <Label>
                        {providerScope === "international"
                          ? "Amount (NGN wallet)"
                          : "Amount (₦)"}
                      </Label>
                      <Input
                        type="number"
                        placeholder="5000"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          resetAttempt();
                        }}
                        min="50"
                      />
                    </div>
                  )}

                  <div>
                    <Label>Transaction PIN</Label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      placeholder="4 to 6 digits"
                      value={transactionPin}
                      onChange={(e) => {
                        setTransactionPin(
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        );
                        resetAttempt();
                      }}
                      minLength={4}
                      maxLength={6}
                    />
                  </div>

                  {isConfirming && (
                    <div className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">Review purchase</p>
                      <p className="mt-1 text-muted-foreground">
                        Confirm {type.label.toLowerCase()} purchase for{" "}
                        {recipientNumber
                          ? maskPhone(recipientNumber)
                          : smartCardNumber || meterNumber}
                        .
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handlePurchase}
                    disabled={
                      isPurchasing ||
                      !selectedProvider ||
                      !!moneyGate ||
                      serviceComingSoon
                    }
                    className="w-full"
                  >
                    {isPurchasing
                      ? "Processing..."
                      : isConfirming
                        ? `Confirm ${type.label}`
                        : `Review ${type.label}`}
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

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
  { code: "NG", name: "Nigeria", enabled: true },
  { code: "GH", name: "Ghana", enabled: false },
  { code: "KE", name: "Kenya", enabled: false },
  { code: "ZA", name: "South Africa", enabled: false },
  { code: "US", name: "United States", enabled: false },
  { code: "GB", name: "United Kingdom", enabled: false },
] as const;

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

function VtuContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") || "airtime";
  const [activeType, setActiveType] = useState(initialType);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [countryCode, setCountryCode] = useState("NG");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [recipientNumber, setRecipientNumber] = useState("");
  const [smartCardNumber, setSmartCardNumber] = useState("");
  const [meterNumber, setMeterNumber] = useState("");
  const [subscriptionType, setSubscriptionType] = useState<"change" | "renew">(
    "change",
  );
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("prepaid");
  const [amount, setAmount] = useState("");
  const [verifiedCustomer, setVerifiedCustomer] = useState<{
    name: string;
    detail?: string;
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<VtuPurchaseResult | null>(
    null,
  );
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
    queryKey: ["vtu-packages", selectedProvider, activeType],
    queryFn: async () => {
      const response = await vtuApi.getPackages(selectedProvider);
      return response.data as VtuPackage[];
    },
    enabled:
      !!selectedProvider &&
      (activeType === "data" ||
        (activeType === "cable" && subscriptionType === "change")),
  });

  const resetVerification = () => {
    setVerifiedCustomer(null);
    resetAttempt();
  };

  const handleValidateCustomer = async () => {
    if (!selectedProvider || !contactPhone) {
      toast.error("Select a provider and enter a contact phone number");
      return;
    }

    setIsValidating(true);
    try {
      const idempotencyKey = createMoneyAttemptIdempotencyKey("vtu-validate");
      if (activeType === "cable") {
        if (!smartCardNumber) {
          toast.error("Enter your smart card number");
          return;
        }
        const response = await vtuApi.validateSmartCard(
          {
            provider: selectedProvider,
            smartCardNumber,
            subscriptionType,
            contactPhone,
          },
          idempotencyKey,
        );
        const customer = response.data as {
          name: string;
          status?: string;
          renewalAmount?: string;
        };
        if (subscriptionType === "renew" && customer.renewalAmount) {
          setAmount(customer.renewalAmount);
        }
        setVerifiedCustomer({ name: customer.name, detail: customer.status });
      } else if (activeType === "electricity") {
        if (!meterNumber) {
          toast.error("Enter your meter number");
          return;
        }
        const response = await vtuApi.validateMeter(
          {
            provider: selectedProvider,
            meterNumber,
            meterType,
            contactPhone,
          },
          idempotencyKey,
        );
        const customer = response.data as { name: string; address?: string };
        setVerifiedCustomer({ name: customer.name, detail: customer.address });
      }
      toast.success("Customer verified");
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      toast.error(
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Customer verification failed",
      );
      setVerifiedCustomer(null);
    } finally {
      setIsValidating(false);
    }
  };

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

    if (activeType === "airtime" && (!recipientNumber || !amount)) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (activeType === "data" && (!recipientNumber || !selectedPackage)) {
      toast.error("Please select a package and enter phone number");
      return;
    }
    if (
      activeType === "cable" &&
      (!smartCardNumber ||
        !verifiedCustomer ||
        (subscriptionType === "change" ? !selectedPackage : !amount))
    ) {
      toast.error("Verify the customer and complete the cable details");
      return;
    }
    if (
      activeType === "electricity" &&
      (!meterNumber || !amount || !verifiedCustomer)
    ) {
      toast.error("Verify the meter and enter an amount");
      return;
    }

    if (!contactPhone) {
      toast.error("Enter a contact phone number");
      return;
    }

    const purchaseAmount =
      activeType === "airtime"
        ? amount
        : activeType === "data" ||
            (activeType === "cable" && subscriptionType === "change")
          ? packages.find((p) => p.id === selectedPackage)?.price || 0
          : amount;

    if (!purchaseAmount || Number(purchaseAmount) <= 0) {
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
          provider: selectedProvider,
          contactPhone,
          amount: String(purchaseAmount),
          ...(activeType === "airtime" || activeType === "data"
            ? { recipientNumber }
            : {}),
          ...(activeType === "data" ||
          (activeType === "cable" && subscriptionType === "change")
            ? { packageId: selectedPackage }
            : {}),
          ...(activeType === "cable"
            ? { smartCardNumber, subscriptionType }
            : {}),
          ...(activeType === "electricity" ? { meterNumber, meterType } : {}),
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
      setLastReceipt(result);
      setPendingOrderReference(null);
      setTrackedOrder(null);
      setRecipientNumber("");
      setSmartCardNumber("");
      setMeterNumber("");
      setVerifiedCustomer(null);
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
                    {trackedOrder?.provider || "VTpass"}
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

        {(lastReceipt?.purchasedCode || trackedOrder?.purchasedCode) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery receipt</CardTitle>
              <CardDescription>
                Keep this code private. It is shown only in your authenticated
                order view.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="break-all font-mono text-lg font-semibold">
                {lastReceipt?.purchasedCode || trackedOrder?.purchasedCode}
              </p>
            </CardContent>
          </Card>
        )}

        <Tabs
          value={activeType}
          onValueChange={(value) => {
            setActiveType(value);
            setSelectedProvider("");
            setSelectedPackage("");
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
                  <div>
                    <Label htmlFor={`${type.id}-country`}>Country</Label>
                    <Select value={countryCode} onValueChange={setCountryCode}>
                      <SelectTrigger
                        id={`${type.id}-country`}
                        aria-label="Country"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {markets.map((market) => (
                          <SelectItem
                            key={market.code}
                            value={market.code}
                            disabled={!market.enabled}
                          >
                            {market.name}
                            {!market.enabled ? " — Coming soon" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor={`${type.id}-provider`}>
                      VTpass provider
                    </Label>
                    <Select
                      value={selectedProvider}
                      onValueChange={(value) => {
                        setSelectedProvider(value);
                        setSelectedPackage("");
                        resetVerification();
                      }}
                    >
                      <SelectTrigger
                        id={`${type.id}-provider`}
                        aria-label="VTpass provider"
                      >
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
                      <Label htmlFor={`${type.id}-recipient`}>
                        Recipient phone number
                      </Label>
                      <Input
                        id={`${type.id}-recipient`}
                        type="tel"
                        placeholder="08012345678"
                        value={recipientNumber}
                        onChange={(e) => {
                          setRecipientNumber(e.target.value);
                          if (!contactPhone) setContactPhone(e.target.value);
                          resetAttempt();
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor={`${type.id}-contact`}>
                      Contact phone number
                    </Label>
                    <Input
                      id={`${type.id}-contact`}
                      type="tel"
                      placeholder="08012345678"
                      value={contactPhone}
                      onChange={(event) => {
                        setContactPhone(event.target.value);
                        resetVerification();
                      }}
                    />
                  </div>

                  {(type.id === "data" ||
                    (type.id === "cable" && subscriptionType === "change")) &&
                    selectedProvider && (
                      <div>
                        <Label>
                          {type.id === "data"
                            ? "Data package"
                            : "Cable package"}
                        </Label>
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

                  {type.id === "airtime" && (
                    <div>
                      <Label htmlFor={`${type.id}-amount`}>Amount (₦)</Label>
                      <Input
                        id={`${type.id}-amount`}
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
                    <>
                      <div>
                        <Label>Subscription type</Label>
                        <Select
                          value={subscriptionType}
                          onValueChange={(value: "change" | "renew") => {
                            setSubscriptionType(value);
                            setSelectedPackage("");
                            setAmount("");
                            resetVerification();
                          }}
                        >
                          <SelectTrigger aria-label="Subscription type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="change">
                              Change package
                            </SelectItem>
                            <SelectItem value="renew">
                              Renew current package
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="smart-card-number">
                          Smart card number
                        </Label>
                        <Input
                          id="smart-card-number"
                          placeholder="Enter your smart card number"
                          value={smartCardNumber}
                          onChange={(e) => {
                            setSmartCardNumber(e.target.value);
                            resetVerification();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {type.id === "electricity" && (
                    <>
                      <div>
                        <Label>Meter type</Label>
                        <Select
                          value={meterType}
                          onValueChange={(value: "prepaid" | "postpaid") => {
                            setMeterType(value);
                            resetVerification();
                          }}
                        >
                          <SelectTrigger aria-label="Meter type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="prepaid">Prepaid</SelectItem>
                            <SelectItem value="postpaid">Postpaid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="meter-number">Meter number</Label>
                        <Input
                          id="meter-number"
                          placeholder="Enter your meter number"
                          value={meterNumber}
                          onChange={(e) => {
                            setMeterNumber(e.target.value);
                            resetVerification();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {(type.id === "cable" || type.id === "electricity") && (
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleValidateCustomer}
                        disabled={isValidating || !selectedProvider}
                      >
                        {isValidating ? "Verifying…" : "Verify customer"}
                      </Button>
                      {verifiedCustomer && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                          <p className="font-medium">{verifiedCustomer.name}</p>
                          {verifiedCustomer.detail && (
                            <p>{verifiedCustomer.detail}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(type.id === "electricity" ||
                    (type.id === "cable" && subscriptionType === "renew")) && (
                    <div>
                      <Label htmlFor={`${type.id}-amount`}>Amount (₦)</Label>
                      <Input
                        id={`${type.id}-amount`}
                        type="number"
                        placeholder="5000"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          resetAttempt();
                        }}
                        min="50"
                        readOnly={
                          type.id === "cable" && subscriptionType === "renew"
                        }
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor={`${type.id}-pin`}>Transaction PIN</Label>
                    <Input
                      id={`${type.id}-pin`}
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
                    disabled={isPurchasing || !selectedProvider || !!moneyGate}
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

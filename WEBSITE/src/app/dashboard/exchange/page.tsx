"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Bell,
  ExternalLink,
  ReceiptText,
  RefreshCw,
  Send,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { exchangeApi } from "@/services/api";
import { useAuth } from "@/lib/auth-provider";
import { getMoneyActionGate } from "@/lib/account-status";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { config } from "@/lib/config";

import { ExchangeQuote, ApiError } from "@/types";

type ManualExchangeReceipt = {
  id: string;
  amount: string | number;
  expectedCreditAmount: string | number;
  rate: string | number;
  bankReference: string;
  senderName: string;
  senderBankName?: string | null;
  receiptUrl: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  reviewReason?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  creditedAt?: string | null;
  transaction?: {
    id?: string;
    reference?: string;
    status?: string;
    createdAt?: string;
  } | null;
};

type ExchangePayout = {
  id: string;
  status: string;
  sourceAmount: string;
  destinationAmount: string;
  rate: string;
  fee: string;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationBankName: string;
  destinationBankCode?: string | null;
  destinationAccountNumber: string;
  destinationAccountName: string;
  adminPaymentReceipt?: string | null;
  notificationSent: boolean;
  adminNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  transaction?: {
    reference?: string;
    status?: string;
    createdAt?: string;
  } | null;
};

const payoutStatusColors: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING_APPROVAL: "secondary",
  APPROVED: "outline",
  PROCESSING: "outline",
  SENT: "default",
  FAILED: "destructive",
  REVERSED: "destructive",
};

function receiptVerificationStatus(receipt: ManualExchangeReceipt) {
  const value = receipt.metadata?.providerVerificationStatus;
  return typeof value === "string" ? value : null;
}

const currencies = [
  { value: "GHS", label: "GHS (₵)", symbol: "₵" },
  { value: "NGN", label: "NGN (₦)", symbol: "₦" },
];

const statusColors: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  SUBMITTED: "secondary",
  UNDER_REVIEW: "outline",
  APPROVED: "default",
  CREDITED: "default",
  NEEDS_MORE_INFO: "outline",
  REJECTED: "destructive",
};

const amountPattern = /^\d+(\.\d{1,2})?$/;

function humanize(value?: string | null) {
  if (!value) return "Not set";
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(value: string | number, currency: string) {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

const smallNumberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const tensNumberWords = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

const scaleNumberWords = [
  { value: 1_000_000_000_000, label: "trillion" },
  { value: 1_000_000_000, label: "billion" },
  { value: 1_000_000, label: "million" },
  { value: 1_000, label: "thousand" },
];

const currencyWordLabels: Record<string, { major: string; minor: string }> = {
  NGN: { major: "naira", minor: "kobo" },
  GHS: { major: "cedis", minor: "pesewas" },
};

function sanitizeDecimalInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...decimalParts] = cleaned.split(".");
  const decimals = decimalParts.join("").slice(0, 2);

  return decimalParts.length > 0 ? `${whole}.${decimals}` : whole;
}

function formatLargeAmount(value: string | number) {
  const rawValue = typeof value === "number" ? value.toFixed(2) : value;
  if (!rawValue) return "";

  const [whole = "0", decimals = ""] = rawValue.replaceAll(",", "").split(".");
  const formattedWhole = new Intl.NumberFormat("en-NG").format(
    Number(whole || "0"),
  );

  return decimals ? `${formattedWhole}.${decimals.slice(0, 2)}` : formattedWhole;
}

function amountToWords(value: string | number, currency: string) {
  const rawValue = String(value).replaceAll(",", "").trim();
  if (!rawValue || Number(rawValue) <= 0 || !amountPattern.test(rawValue)) {
    return "Enter an amount";
  }

  const [wholePart, decimalPart = ""] = rawValue.split(".");
  const whole = Number(wholePart);
  const decimals = Number(decimalPart.padEnd(2, "0").slice(0, 2));
  const labels = currencyWordLabels[currency] ?? {
    major: currency,
    minor: "minor units",
  };

  if (!Number.isSafeInteger(whole)) {
    return "Amount is too large to spell out";
  }

  const majorWords = `${numberToWords(whole)} ${labels.major}`;
  if (decimals > 0) {
    return `${majorWords}, ${numberToWords(decimals)} ${labels.minor}`;
  }

  return majorWords;
}

function numberToWords(value: number): string {
  if (value < 20) return smallNumberWords[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const remainder = value % 10;
    return remainder
      ? `${tensNumberWords[tens]} ${smallNumberWords[remainder]}`
      : tensNumberWords[tens];
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    return remainder
      ? `${smallNumberWords[hundreds]} hundred ${numberToWords(remainder)}`
      : `${smallNumberWords[hundreds]} hundred`;
  }

  for (const scale of scaleNumberWords) {
    if (value >= scale.value) {
      const scaleCount = Math.floor(value / scale.value);
      const remainder = value % scale.value;
      return remainder
        ? `${numberToWords(scaleCount)} ${scale.label} ${numberToWords(remainder)}`
        : `${numberToWords(scaleCount)} ${scale.label}`;
    }
  }

  return String(value);
}

export default function ExchangePage() {
  const { profile } = useAuth();
  const [from, setFrom] = useState("GHS");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [transactionPin, setTransactionPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isQuoteExpired, setIsQuoteExpired] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);
  const inFlightRef = useRef(false);
  const receiptInFlightRef = useRef(false);
  const payoutInFlightRef = useRef(false);
  const attemptKeyRef = useRef<string | null>(null);
  const receiptAttemptKeyRef = useRef<string | null>(null);
  const payoutAttemptKeyRef = useRef<string | null>(null);
  const moneyGate = getMoneyActionGate(profile);

  // --- Payout state ---
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutBankName, setPayoutBankName] = useState("");
  const [payoutBankCode, setPayoutBankCode] = useState("");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState("");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [payoutPin, setPayoutPin] = useState("");
  const [payoutQuote, setPayoutQuote] = useState<{
    rate: number;
    receiveAmount: string;
    fee: string;
    sendAmount: string;
  } | null>(null);
  const [isPayoutLoading, setIsPayoutLoading] = useState(false);
  const [isPayoutSubmitting, setIsPayoutSubmitting] = useState(false);

  const {
    data: payouts,
    isLoading: isPayoutsLoading,
    isError: isPayoutsError,
    refetch: refetchPayouts,
  } = useQuery({
    queryKey: ["exchange-payouts"],
    queryFn: async () => {
      const res = await exchangeApi.getPayouts();
      return res.data as ExchangePayout[];
    },
  });
  const manualAccount = config.manualExchangeAccount;
  const hasManualAccount =
    manualAccount.bankName &&
    manualAccount.accountName &&
    manualAccount.accountNumber;
  const {
    data: receipts,
    isLoading: isReceiptsLoading,
    isError: isReceiptsError,
    refetch: refetchReceipts,
  } = useQuery({
    queryKey: ["exchange-receipts"],
    queryFn: async () => {
      const res = await exchangeApi.getReceipts();
      return res.data as ManualExchangeReceipt[];
    },
  });

  const resetAttempt = () => {
    attemptKeyRef.current = null;
  };

  const resetReceiptAttempt = () => {
    receiptAttemptKeyRef.current = null;
  };

  // ── Countdown timer for quote expiry ──────────────────────────
  useEffect(() => {
    if (!quote) {
      setCountdown(null);
      setIsQuoteExpired(false);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(quote.expiresAt).getTime() - Date.now()) / 1000),
      );
      setCountdown(remaining);
      setIsQuoteExpired(remaining <= 0);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [quote]);

  // ── Auto-dismiss success animation ────────────────────────────
  useEffect(() => {
    if (!showSuccessAnimation) return;
    const timer = setTimeout(() => setShowSuccessAnimation(false), 2500);
    return () => clearTimeout(timer);
  }, [showSuccessAnimation]);

  // ── Handlers ──────────────────────────────────────────────────

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
      toast.error(message, {
        duration: 8000,
        action: { label: "Retry", onClick: () => handleGetQuote() },
      });
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

    if (!/^\d{4,6}$/.test(transactionPin)) {
      toast.error("Enter your 4 to 6 digit transaction PIN");
      return;
    }

    inFlightRef.current = true;
    setIsExecuting(true);
    try {
      const idempotencyKey =
        attemptKeyRef.current ?? createMoneyAttemptIdempotencyKey("exchange");
      attemptKeyRef.current = idempotencyKey;

      await exchangeApi.executeQuote(quote.id, idempotencyKey, transactionPin);
      setShowSuccessAnimation(true);
      toast.success("Exchange completed successfully");
      setQuote(null);
      setAmount("");
      setTransactionPin("");
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

  const handleSubmitReceipt = async (event: React.FormEvent) => {
    event.preventDefault();

    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (receiptInFlightRef.current) return;

    if (!amountPattern.test(receiptAmount) || Number(receiptAmount) <= 0) {
      toast.error("Enter the NGN amount you paid");
      return;
    }

    receiptInFlightRef.current = true;
    setIsSubmittingReceipt(true);
    try {
      const idempotencyKey =
        receiptAttemptKeyRef.current ??
        createMoneyAttemptIdempotencyKey("exchange");
      receiptAttemptKeyRef.current = idempotencyKey;

      await exchangeApi.createMonnifyDepositIntent(
        { amount: receiptAmount },
        idempotencyKey,
      );

      toast.success("Monnify deposit instruction created");
      setReceiptAmount("");
      resetReceiptAttempt();
      await refetchReceipts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not submit receipt"));
    } finally {
      receiptInFlightRef.current = false;
      setIsSubmittingReceipt(false);
    }
  };

  const handleGetPayoutQuote = async () => {
    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (!payoutAmount || parseFloat(payoutAmount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsPayoutLoading(true);
    try {
      const response = await exchangeApi.createQuote({
        from: "NGN",
        to: "GHS",
        amount: parseFloat(payoutAmount),
      });
      const quote = response.data;
      setPayoutQuote({
        rate: quote.rate,
        receiveAmount: quote.receiveAmount,
        fee: quote.fee,
        sendAmount: quote.sendAmount,
      });
      toast.success("Rate quote ready");
    } catch (error) {
      const err = error as { response?: { data?: ApiError } };
      const message =
        typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Failed to get quote";
      toast.error(message);
    } finally {
      setIsPayoutLoading(false);
    }
  };

  const handleSubmitPayout = async (event: React.FormEvent) => {
    event.preventDefault();

    if (moneyGate) {
      toast.error(moneyGate.title);
      return;
    }

    if (payoutInFlightRef.current) return;

    if (!amountPattern.test(payoutAmount) || Number(payoutAmount) <= 0) {
      toast.error("Enter a valid NGN amount");
      return;
    }

    if (!payoutBankName.trim()) {
      toast.error("Enter the destination bank name");
      return;
    }

    if (!/^\d{10,20}$/.test(payoutAccountNumber)) {
      toast.error("Enter a valid account number (10-20 digits)");
      return;
    }

    if (!payoutAccountName.trim()) {
      toast.error("Enter the destination account name");
      return;
    }

    if (!/^\d{4,6}$/.test(payoutPin)) {
      toast.error("Enter your 4 to 6 digit transaction PIN");
      return;
    }

    if (!payoutQuote) {
      toast.error("Get a quote first");
      return;
    }

    payoutInFlightRef.current = true;
    setIsPayoutSubmitting(true);
    try {
      const idempotencyKey =
        payoutAttemptKeyRef.current ??
        createMoneyAttemptIdempotencyKey("exchange");
      payoutAttemptKeyRef.current = idempotencyKey;

      await exchangeApi.createPayout(
        {
          sourceAmount: payoutAmount,
          destinationBankName: payoutBankName.trim(),
          destinationBankCode: payoutBankCode.trim() || undefined,
          destinationAccountNumber: payoutAccountNumber.trim(),
          destinationAccountName: payoutAccountName.trim(),
          transactionPin: payoutPin,
        },
        idempotencyKey,
      );

      toast.success("Payout request submitted for admin review");
      setPayoutAmount("");
      setPayoutBankName("");
      setPayoutBankCode("");
      setPayoutAccountNumber("");
      setPayoutAccountName("");
      setPayoutPin("");
      setPayoutQuote(null);
      payoutAttemptKeyRef.current = null;
      await refetchPayouts();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not submit payout request"));
    } finally {
      payoutInFlightRef.current = false;
      setIsPayoutSubmitting(false);
    }
  };

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
    setQuote(null);
    resetAttempt();
  };

  const selectedFromCurrency = currencies.find(
    (currency) => currency.value === from,
  );
  const selectedToCurrency = currencies.find(
    (currency) => currency.value === to,
  );
  const receiveAmount = quote?.receiveAmount ?? null;

  return (
    <DashboardLayout>
      {/* Success animation overlay */}
      {showSuccessAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-card p-8 shadow-2xl animate-in zoom-in-95 duration-500">
            <div className="flex size-20 items-center justify-center rounded-full bg-green-100">
              <svg className="size-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-green-700">Exchange Complete!</h2>
            <p className="text-muted-foreground">Your currency has been exchanged successfully.</p>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Currency Exchange</h1>
          <p className="mt-1 text-muted-foreground">
            Convert between GHS and NGN, or submit an NGN transfer receipt for GHS credit.
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
                  <Link href={moneyGate.actionHref}>{moneyGate.actionLabel}</Link>
                </Button>
              </CardContent>
            )}
          </Card>
        )}

        <Tabs defaultValue="wallet" className="flex flex-col gap-4">
          <TabsList className="grid w-full grid-cols-2 md:w-fit">
            <TabsTrigger value="wallet" className="gap-2">
              <ArrowLeftRight className="size-4" />
              Wallet exchange
            </TabsTrigger>
            <TabsTrigger value="receipt" className="gap-2">
              <ReceiptText className="size-4" />
              Deposit receipt
            </TabsTrigger>
            <TabsTrigger value="payout" className="gap-2">
              <Send className="size-4" />
              Request Payout
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wallet">
            <Card>
              <CardHeader>
                <CardTitle>Exchange from wallet</CardTitle>
                <CardDescription>
                  Use this when the source wallet already has enough balance.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
                  <div className="rounded-lg border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="exchangeAmount">You send</Label>
                      <Select value={from} onValueChange={(v) => { setFrom(v); setQuote(null); resetAttempt(); }}>
                        <SelectTrigger className="h-9 w-[132px]">
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
                    </div>

                    <div className="mt-5 flex min-w-0 items-end gap-3">
                      <span className="pb-1 text-2xl font-semibold text-muted-foreground">
                        {selectedFromCurrency?.symbol}
                      </span>
                      <Input
                        id="exchangeAmount"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => {
                          setAmount(sanitizeDecimalInput(e.target.value));
                          setQuote(null);
                          resetAttempt();
                        }}
                        className="h-auto min-w-0 overflow-x-auto border-0 bg-transparent p-0 text-right text-3xl font-semibold tracking-normal shadow-none focus-visible:ring-0 md:text-4xl"
                      />
                    </div>

                    <p className="mt-3 min-h-5 text-sm capitalize text-muted-foreground">
                      {amountToWords(amount, from)}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleSwap}
                    aria-label="Swap currencies"
                    className="mx-auto size-11 rounded-full"
                  >
                    <ArrowLeftRight className="size-4" />
                  </Button>

                  <div className="rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Label>You receive</Label>
                      <Select value={to} onValueChange={(v) => { setTo(v); setQuote(null); resetAttempt(); }}>
                        <SelectTrigger className="h-9 w-[132px] bg-background">
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
                    </div>

                    <div className="mt-5 flex min-w-0 items-end gap-3">
                      <span className="pb-1 text-2xl font-semibold text-muted-foreground">
                        {selectedToCurrency?.symbol}
                      </span>
                      {isLoading ? (
                        <Skeleton className="h-10 w-32" />
                      ) : (
                        <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-right text-3xl font-semibold tracking-normal md:text-4xl">
                          {receiveAmount === null
                            ? "0.00"
                            : formatLargeAmount(receiveAmount.toFixed(2))}
                        </div>
                      )}
                    </div>

                    <p className="mt-3 min-h-5 text-sm capitalize text-muted-foreground">
                      {receiveAmount === null
                        ? "Awaiting quote"
                        : amountToWords(receiveAmount.toFixed(2), to)}
                    </p>
                  </div>
                </div>

                <Button onClick={handleGetQuote} disabled={isLoading || !amount || !!moneyGate} className="w-full">
                  {isLoading ? "Getting quote..." : "Get Quote"}
                </Button>

                {quote && (
                  <>
                    <Separator />
                    <div className="rounded-lg border bg-primary/5 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-medium">Quote ready</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Review the receiving amount above, then enter your transaction PIN.
                          </p>
                        </div>
                        <Badge
                          variant={isQuoteExpired ? "destructive" : countdown !== null && countdown <= 30 ? "secondary" : "secondary"}
                          className={`w-fit ${countdown !== null && countdown <= 30 && !isQuoteExpired ? "animate-pulse" : ""}`}
                        >
                          {isQuoteExpired
                            ? "Expired"
                            : countdown !== null
                              ? `Expires in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`
                              : `Expires ${new Date(quote.expiresAt).toLocaleTimeString()}`}
                        </Badge>
                      </div>
                    </div>

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
                        disabled={isQuoteExpired}
                      />
                    </div>

                    {isQuoteExpired && (
                      <Button
                        onClick={handleGetQuote}
                        variant="outline"
                        className="w-full"
                      >
                        Get New Quote
                      </Button>
                    )}

                    <Button
                      onClick={handleExecute}
                      disabled={isExecuting || isQuoteExpired || !!moneyGate}
                      className="w-full"
                      size="lg"
                      title={isQuoteExpired ? "Quote has expired" : undefined}
                    >
                      {isQuoteExpired
                        ? "Quote Expired"
                        : isExecuting
                          ? "Processing..."
                          : "Confirm Exchange"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipt">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Monnify verified deposit</CardTitle>
                  <CardDescription>
                    Create an exchange reference, then transfer NGN with that reference.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {hasManualAccount ? (
                    <div className="grid gap-3 text-sm">
                      <div className="rounded-md border p-3">
                        <p className="text-muted-foreground">Bank</p>
                        <p className="mt-1 font-medium">{manualAccount.bankName}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-muted-foreground">Account name</p>
                        <p className="mt-1 font-medium">{manualAccount.accountName}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-muted-foreground">Account number</p>
                        <p className="mt-1 font-mono text-lg font-semibold tracking-normal">
                          {manualAccount.accountNumber}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Collection account details are not configured for this environment yet.
                    </div>
                  )}

                  <Separator />

                  <div className="grid gap-3 text-sm">
                    <div className="flex items-start gap-3">
                      <Badge variant="secondary">1</Badge>
                      <p>Enter the NGN amount to create a unique exchange reference.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="secondary">2</Badge>
                      <p>Send NGN to the Monnify account and include the reference in narration.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="secondary">3</Badge>
                      <p>Monnify verifies the inflow, then finance credits your GHS wallet.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Create deposit instruction</CardTitle>
                  <CardDescription>
                    The GHS credit amount is fixed when this instruction is created.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitReceipt} className="flex flex-col gap-4">
                    <div className="grid gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="receiptAmount">NGN amount to deposit</Label>
                        <Input
                          id="receiptAmount"
                          inputMode="decimal"
                          placeholder="50000.00"
                          value={receiptAmount}
                          onChange={(e) => { setReceiptAmount(e.target.value); resetReceiptAttempt(); }}
                          disabled={isSubmittingReceipt}
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmittingReceipt || !!moneyGate}
                      className="w-full"
                    >
                      {isSubmittingReceipt ? "Creating..." : "Create Monnify reference"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Receipt history</CardTitle>
                  <CardDescription>
                    Track finance review and GHS wallet credit status.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refetchReceipts()}
                  disabled={isReceiptsLoading}
                  className="w-fit gap-2"
                >
                  <RefreshCw className="size-4" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {isReceiptsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading receipts...</p>
                ) : isReceiptsError ? (
                  <div className="rounded-md border p-4 text-sm">
                    <p className="text-muted-foreground">Could not load receipt history.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void refetchReceipts()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : receipts && receipts.length > 0 ? (
                  receipts.map((receipt) => (
                    <div
                      key={receipt.id}
                      className="grid gap-3 rounded-md border p-4 text-sm md:grid-cols-[1fr_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {receipt.transaction?.reference ?? receipt.bankReference}
                          </p>
                          <Badge variant={statusColors[receipt.status] ?? "secondary"}>
                            {humanize(receipt.status)}
                          </Badge>
                        </div>
                        <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                          <p>Paid {formatMoney(receipt.amount, "NGN")}</p>
                          <p>Expected {formatMoney(receipt.expectedCreditAmount, "GHS")}</p>
                          <p>Rate {receipt.rate}</p>
                          <p>
                            Provider {humanize(receiptVerificationStatus(receipt) ?? "pending")}
                          </p>
                          <p>Submitted {new Date(receipt.createdAt).toLocaleString()}</p>
                        </div>
                        {receipt.reviewReason && (
                          <p className="mt-2 text-muted-foreground">
                            Review note: {receipt.reviewReason}
                          </p>
                        )}
                      </div>
                      {receipt.receiptUrl.startsWith("monnify://") ? (
                        <Badge variant="outline" className="w-fit">
                          Monnify tracked
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit gap-2"
                          onClick={async () => {
                            try {
                              const response = await exchangeApi.getReceiptProofUrl(receipt.id);
                              window.open(response.data.url, "_blank", "noopener,noreferrer");
                            } catch (error: unknown) {
                              toast.error(getErrorMessage(error, "Could not open receipt proof"));
                            }
                          }}
                        >
                          <ExternalLink className="size-4" />
                          Proof
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No manual exchange receipts submitted yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payout">
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                How payouts work
              </p>
              <p className="mt-1 text-muted-foreground">
                Your NGN is swapped to GHS at the admin-set rate. An admin reviews
                and approves your payout, then manually transfers GHS to your
                Ghana bank account. You will be notified when the money is on its way.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Request GHS payout</CardTitle>
                  <CardDescription>
                    Swap NGN from your wallet and request GHS transfer to your
                    bank account.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitPayout} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutAmount">NGN amount to swap</Label>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-muted-foreground">₦</span>
                        <Input
                          id="payoutAmount"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={payoutAmount}
                          onChange={(e) => {
                            setPayoutAmount(sanitizeDecimalInput(e.target.value));
                            setPayoutQuote(null);
                          }}
                          disabled={isPayoutSubmitting}
                        />
                      </div>
                      <p className="min-h-5 text-sm capitalize text-muted-foreground">
                        {amountToWords(payoutAmount, "NGN")}
                      </p>
                    </div>

                    {payoutQuote && (
                      <div className="rounded-lg border bg-primary/5 p-3 text-sm">
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Rate</span>
                            <span className="font-medium">{payoutQuote.rate.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Fee</span>
                            <span className="font-medium">₦{formatLargeAmount(payoutQuote.fee)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">You send (total)</span>
                            <span className="font-medium">₦{formatLargeAmount(payoutQuote.sendAmount)}</span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">You receive</span>
                            <span className="font-semibold text-emerald-600">
                              ₵{formatLargeAmount(payoutQuote.receiveAmount)}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Rate set by admin. GHS will be sent to your bank
                          account after admin approval.
                        </p>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleGetPayoutQuote}
                      disabled={isPayoutLoading || !payoutAmount || !!moneyGate}
                      className="w-full"
                    >
                      {isPayoutLoading ? "Getting quote..." : "Get Quote"}
                    </Button>

                    <Separator />

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutBankName">Destination bank name</Label>
                      <Input
                        id="payoutBankName"
                        placeholder="GCB Bank, Ecobank, etc."
                        value={payoutBankName}
                        onChange={(e) => setPayoutBankName(e.target.value)}
                        disabled={isPayoutSubmitting}
                        maxLength={120}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutBankCode">
                        Bank sort code <span className="text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="payoutBankCode"
                        placeholder="e.g. 230117"
                        value={payoutBankCode}
                        onChange={(e) => setPayoutBankCode(e.target.value.replace(/\D/g, "").slice(0, 20))}
                        disabled={isPayoutSubmitting}
                        maxLength={20}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutAccountNumber">Account number</Label>
                      <Input
                        id="payoutAccountNumber"
                        inputMode="numeric"
                        placeholder="10-20 digits"
                        value={payoutAccountNumber}
                        onChange={(e) => setPayoutAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 20))}
                        disabled={isPayoutSubmitting}
                        maxLength={20}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutAccountName">Account name</Label>
                      <Input
                        id="payoutAccountName"
                        placeholder="Name on bank account"
                        value={payoutAccountName}
                        onChange={(e) => setPayoutAccountName(e.target.value)}
                        disabled={isPayoutSubmitting}
                        maxLength={120}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="payoutPin">Transaction PIN</Label>
                      <Input
                        id="payoutPin"
                        type="password"
                        inputMode="numeric"
                        placeholder="4 to 6 digits"
                        value={payoutPin}
                        onChange={(e) => setPayoutPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        minLength={4}
                        maxLength={6}
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={isPayoutSubmitting || !payoutQuote || !!moneyGate}
                      className="w-full"
                      size="lg"
                    >
                      {isPayoutSubmitting ? "Submitting..." : "Confirm & Request Payout"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Payout history</CardTitle>
                    <CardDescription>
                      Track your payout requests and admin status.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refetchPayouts()}
                    disabled={isPayoutsLoading}
                    className="w-fit gap-2"
                  >
                    <RefreshCw className="size-4" />
                    Refresh
                  </Button>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {isPayoutsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading payouts...</p>
                  ) : isPayoutsError ? (
                    <div className="rounded-md border p-4 text-sm">
                      <p className="text-muted-foreground">Could not load payout history.</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => void refetchPayouts()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : payouts && payouts.length > 0 ? (
                    payouts.map((payout) => (
                      <div
                        key={payout.id}
                        className="grid gap-3 rounded-md border p-4 text-sm md:grid-cols-[1fr_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {payout.transaction?.reference ?? payout.id.slice(0, 12)}
                            </p>
                            <Badge variant={payoutStatusColors[payout.status] ?? "secondary"}>
                              {humanize(payout.status)}
                            </Badge>
                            {payout.notificationSent && (
                              <Bell className="size-3.5 text-emerald-500" />
                            )}
                          </div>
                          <div className="mt-2 grid gap-1 text-muted-foreground md:grid-cols-2">
                            <p>Sent {formatMoney(payout.sourceAmount, "NGN")}</p>
                            <p>Receive {formatMoney(payout.destinationAmount, "GHS")}</p>
                            <p>Bank {payout.destinationBankName}</p>
                            <p>A/C {payout.destinationAccountNumber}</p>
                            <p>Rate {Number(payout.rate).toFixed(4)}</p>
                            <p>Created {new Date(payout.createdAt).toLocaleString()}</p>
                          </div>
                          {payout.notificationSent && (
                            <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-600 dark:text-emerald-400">
                              <Bell className="size-3" />
                              Approved — money incoming soon. Check your {payout.destinationBankName}{" "}
                              account ({payout.destinationAccountNumber}).
                            </div>
                          )}
                          {payout.adminNote && (
                            <p className="mt-2 text-muted-foreground">
                              Admin note: {payout.adminNote}
                            </p>
                          )}
                          {payout.adminPaymentReceipt && (
                            <a
                              href={payout.adminPaymentReceipt}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                            >
                              <ExternalLink className="size-3" />
                              View payment receipt
                            </a>
                          )}
                        </div>
                        <Badge
                          variant={
                            payout.status === "SENT"
                              ? "default"
                              : payout.status === "PENDING_APPROVAL"
                                ? "secondary"
                                : "outline"
                          }
                          className="h-fit w-fit"
                        >
                          {payout.status === "PENDING_APPROVAL"
                            ? "Awaiting admin"
                            : payout.status === "APPROVED"
                              ? "Approved"
                              : payout.status === "SENT"
                                ? "Sent"
                                : humanize(payout.status)}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No payout requests yet. Swap NGN and request a GHS bank transfer.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

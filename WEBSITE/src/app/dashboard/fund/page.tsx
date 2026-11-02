"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { TrustPayAnimation } from "@/components/animations/trustpay-animation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bankingApi, paymentApi } from "@/services/api";
import { useMoneyActionGate } from "@/lib/use-money-action-gate";
import { useAuth } from "@/lib/auth-provider";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { maskEmail, maskPhone } from "@/lib/privacy";

function accountStatusVariant(status?: string) {
  if (status === "ACTIVE") return "default";
  if (status === "FAILED" || status === "DISABLED") return "destructive";
  return "secondary";
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">
        {value || "Not provided"}
      </p>
    </div>
  );
}

function FundingSteps({ hasAccount }: { hasAccount: boolean }) {
  const steps = [
    { label: "Confirm profile", done: true },
    { label: "Request account", done: hasAccount },
    { label: "Transfer funds", done: false },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-md border bg-card p-3 duration-300"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                step.done
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step.done ? <CheckCircle2 className="size-3.5" /> : index + 1}
            </span>
            <p className="text-sm font-medium">{step.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FundPage() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const moneyGate = useMoneyActionGate(profile, { action: "fund" });
  const email = profile?.email ?? user?.email ?? "";
  const phone = profile?.phone ?? user?.user_metadata?.phone ?? "";
  const [fundingAmount, setFundingAmount] = useState("");
  const [accountConsent, setAccountConsent] = useState(false);
  const [checkoutReference, setCheckoutReference] = useState<string | null>(null);
  const [isVerifyingCheckout, setIsVerifyingCheckout] = useState(false);
  const checkoutKeyRef = useRef<string | null>(null);
  const accountProvisionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedReference = window.sessionStorage.getItem(
          "trustpay.paystack.checkout.reference",
        );
        if (storedReference) setCheckoutReference(storedReference);
      } catch {
        // Session storage can be unavailable in private browsing.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const accountsQuery = useQuery({
    queryKey: ["virtual-accounts"],
    queryFn: async () => {
      const response = await bankingApi.getVirtualAccounts();
      return response.data;
    },
  });

  const provisioningQuery = useQuery({
    queryKey: ["virtual-account-provisioning"],
    queryFn: async () => (await bankingApi.getProvisioningStatus()).data,
    staleTime: 15_000,
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["payment-capabilities"],
    queryFn: async () => (await paymentApi.getCapabilities()).data,
    staleTime: 60_000,
  });

  const ngnAccount = useMemo(
    () =>
      accountsQuery.data?.find(
        (account) =>
          account.currency === "NGN" &&
          account.provider?.toUpperCase() === "PAYSTACK" &&
          account.status?.toUpperCase() === "ACTIVE" &&
          Boolean(account.accountNumber || account.accountNumberMasked),
      ) ?? null,
    [accountsQuery.data],
  );
  const pendingNgnAccount = useMemo(
    () =>
      accountsQuery.data?.find(
        (account) =>
          account.currency === "NGN" &&
          account.provider?.toUpperCase() === "PAYSTACK" &&
          !account.accountNumber &&
          !account.accountNumberMasked &&
          account.status?.toUpperCase() === "PENDING",
      ) ?? null,
    [accountsQuery.data],
  );
  const legacyNgnAccounts = useMemo(
    () =>
      accountsQuery.data?.filter(
        (account) =>
          account.currency === "NGN" &&
          account.provider?.toUpperCase() !== "PAYSTACK",
      ) ?? [],
    [accountsQuery.data],
  );

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const response = await bankingApi.provisionVirtualAccount(
        {
          currency: "NGN",
          country: "NG",
          consentAccepted: true,
        },
        (accountProvisionKeyRef.current ??=
          createMoneyAttemptIdempotencyKey("fund")),
      );
      return response.data;
    },
    onSuccess: (account) => {
      accountProvisionKeyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["virtual-accounts"] });
      void queryClient.invalidateQueries({
        queryKey: ["virtual-account-provisioning"],
      });
      const status = account.status?.toUpperCase();
      if (status === "PENDING") {
        toast.success("Paystack is preparing your receiving account. Refresh shortly.");
      } else if (status === "ACTION_REQUIRED") {
        toast.error(
          account.message ??
            "Paystack needs more information before this receiving account can be created.",
        );
      } else {
        toast.success("Paystack account is ready for wallet funding.");
      }
    },
    onError: (error) => {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      // A provider/eligibility rejection is terminal for this attempt. Clear
      // its key so the next user-confirmed retry is a new idempotent attempt;
      // transport failures deliberately keep the key for safe replay.
      if (status !== undefined && status >= 400 && status < 500) {
        accountProvisionKeyRef.current = null;
      }
      toast.error(getErrorMessage(error, "Could not request account"));
    },
  });

  const isProvisioningPending =
    pendingNgnAccount !== null ||
    provisioningQuery.data?.status?.toUpperCase() === "PENDING";
  const isProvisioningActionRequired =
    provisioningQuery.data?.status?.toUpperCase() === "ACTION_REQUIRED";
  const checkoutMinimumAmount = useMemo(() => {
    const configured = Number(capabilitiesQuery.data?.checkoutMinimumAmount);
    return Number.isFinite(configured) && configured > 0 ? configured : 50;
  }, [capabilitiesQuery.data?.checkoutMinimumAmount]);
  const refreshFundingState = () => {
    void accountsQuery.refetch();
    void provisioningQuery.refetch();
  };
  const canRequestAccount =
    !moneyGate &&
    capabilitiesQuery.data?.virtualAccounts === true &&
    accountConsent &&
    !isProvisioningPending &&
    !provisionMutation.isPending;

  const initializeCheckout = async () => {
    const amount = Number(fundingAmount);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(fundingAmount) ||
      !Number.isFinite(amount) ||
      amount < checkoutMinimumAmount
    ) {
      toast.error(`Enter at least NGN ${checkoutMinimumAmount.toFixed(2)}`);
      return;
    }
    if (checkoutReference) {
      toast.info("Check the saved payment status before starting another attempt.");
      return;
    }
    try {
      checkoutKeyRef.current ??= createMoneyAttemptIdempotencyKey("fund");
      const result = (await paymentApi.initialize(
        { amount: fundingAmount, currency: "NGN" },
        checkoutKeyRef.current,
      )).data;
      const status = result.status.toUpperCase();
      if (result.reference) {
        setCheckoutReference(result.reference);
        try {
          window.sessionStorage.setItem(
            "trustpay.paystack.checkout.reference",
            result.reference,
          );
        } catch {
          // Keep the reference in memory when session storage is unavailable.
        }
      }
      if (status === "SUCCESS") {
        toast.success("Your wallet funding was already confirmed.");
        checkoutKeyRef.current = null;
        setCheckoutReference(null);
        try {
          window.sessionStorage.removeItem("trustpay.paystack.checkout.reference");
        } catch {
          // Ignore storage cleanup failures.
        }
        return;
      }
      if (status === "FAILED") {
        checkoutKeyRef.current = null;
        setCheckoutReference(null);
        try {
          window.sessionStorage.removeItem("trustpay.paystack.checkout.reference");
        } catch {
          // Ignore storage cleanup failures.
        }
        toast.error(result.message ?? "Paystack could not start this payment.");
        return;
      }
      if (!result.authorizationUrl) {
        toast.info(result.message ?? "Your Paystack payment is pending. We’ll update your wallet after confirmation.");
        return;
      }
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== "https:" || !url.host) {
        throw new Error("Unsafe payment URL");
      }
      window.location.assign(url.toString());
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status !== undefined && status >= 400 && status < 500) {
        checkoutKeyRef.current = null;
      }
      toast.error(getErrorMessage(error, "Could not open Paystack checkout"));
    }
  };

  const verifyCheckout = async () => {
    if (!checkoutReference || isVerifyingCheckout) return;
    setIsVerifyingCheckout(true);
    try {
      const result = (await paymentApi.verify(checkoutReference)).data;
      if (result.status.toUpperCase() === "SUCCESS") {
        checkoutKeyRef.current = null;
        setCheckoutReference(null);
        try {
          window.sessionStorage.removeItem("trustpay.paystack.checkout.reference");
        } catch {
          // Ignore storage cleanup failures.
        }
        await queryClient.invalidateQueries({ queryKey: ["wallets"] });
        toast.success("Payment confirmed. Your wallet balance will refresh shortly.");
      } else if (result.status.toUpperCase() === "FAILED") {
        checkoutKeyRef.current = null;
        setCheckoutReference(null);
        try {
          window.sessionStorage.removeItem("trustpay.paystack.checkout.reference");
        } catch {
          // Ignore storage cleanup failures.
        }
        toast.error("Paystack marked this payment as failed. Start a new attempt when ready.");
      } else {
        toast.info("Payment is still pending. Complete checkout or check again shortly.");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not verify Paystack payment status"));
    } finally {
      setIsVerifyingCheckout(false);
    }
  };

  const copyAccountNumber = async () => {
    const accountNumber = ngnAccount?.accountNumber;
    if (!accountNumber) {
      toast.error("Full account number is not available yet.");
      return;
    }

    await navigator.clipboard.writeText(accountNumber);
    toast.success("Account number copied.");
  };

  const copyAccountName = async () => {
    if (!ngnAccount?.accountName) return;
    await navigator.clipboard.writeText(ngnAccount.accountName);
    toast.success("Account name copied.");
  };

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Fund wallet</h1>
            <p className="mt-1 text-muted-foreground">
              Fund your wallet through a Paystack receiving account or secure checkout.
            </p>
          </div>
          <Badge variant={ngnAccount ? "default" : "secondary"}>
            {ngnAccount
              ? "Account ready"
              : isProvisioningPending
                ? "Paystack setup pending"
                : isProvisioningActionRequired
                  ? "Action required"
                  : "Request required"}
          </Badge>
        </div>

        <FundingSteps hasAccount={Boolean(ngnAccount)} />

        {moneyGate && (
          <Card className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
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

        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="animate-in fade-in-0 slide-in-from-left-3 duration-300">
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserRound className="size-5 text-primary" />
                <CardTitle>Your details</CardTitle>
              </div>
              <CardDescription>
                These details are used to request your funding account.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <DetailRow label="Email" value={maskEmail(email)} />
              <DetailRow label="Phone" value={maskPhone(phone)} />
              <DetailRow label="Name" value={profile?.fullName} />
              <DetailRow label="KYC status" value={profile?.kycStatus} />
              <DetailRow
                label="KYC tier"
                value={profile?.kycTier ?? "TIER_0"}
              />
            </CardContent>
          </Card>

          <Card className="animate-in fade-in-0 slide-in-from-right-3 duration-300">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Landmark className="size-5 text-primary" />
                <CardTitle>Paystack funding account</CardTitle>
              </div>
              <CardDescription>
                Use this account for NGN wallet funding. Paystack confirms transfers
                on the server before your wallet is credited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accountsQuery.isLoading ? (
                <div className="flex min-h-52 items-center justify-center rounded-md border border-dashed">
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <TrustPayAnimation
                      variant="loading"
                      className="size-20"
                      label="Loading account status"
                    />
                    <span>Loading account status</span>
                  </div>
                </div>
              ) : ngnAccount ? (
                <div className="grid gap-4">
                  <div className="rounded-lg border bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,107,10,0.08),transparent_70%)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <TrustPayAnimation
                          variant="success"
                          className="size-14 shrink-0"
                          loop={false}
                          label="Funding account ready"
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-muted-foreground">
                            Account number
                          </p>
                          <p className="mt-1 break-words text-2xl font-semibold tracking-wide">
                            {ngnAccount.accountNumber ??
                              ngnAccount.accountNumberMasked}
                          </p>
                        </div>
                      </div>
                      <Badge variant={accountStatusVariant(ngnAccount.status)}>
                        {ngnAccount.status}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <DetailRow
                        label="Account name"
                        value={ngnAccount.accountName}
                      />
                      <DetailRow label="Bank" value={ngnAccount.bankName} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button onClick={copyAccountNumber} className="sm:w-fit">
                      <Copy className="mr-2 size-4" />
                      Copy account number
                    </Button>
                    <Button
                      variant="outline"
                      onClick={copyAccountName}
                      className="sm:w-fit"
                    >
                      <Copy className="mr-2 size-4" />
                      Copy account name
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void accountsQuery.refetch()}
                      disabled={accountsQuery.isFetching}
                    >
                      {accountsQuery.isFetching ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 size-4" />
                      )}
                      Refresh
                    </Button>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Transfer only NGN to this account. Your wallet is credited
                    after Paystack sends a verified completion event.
                  </div>
                </div>
              ) : isProvisioningActionRequired ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-6 text-center text-amber-950">
                  <ShieldCheck className="size-10 text-amber-700" />
                  <p className="font-medium">Paystack account setup needs attention</p>
                  <p className="max-w-md text-sm text-amber-800">
                    {provisioningQuery.data?.message ??
                      "Paystack could not complete the request. Review your verification details and retry, or contact support."}
                  </p>
                  <label className="flex max-w-md cursor-pointer items-start gap-3 text-left text-sm leading-5">
                    <input
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      type="checkbox"
                      checked={accountConsent}
                      onChange={(event) => setAccountConsent(event.target.checked)}
                    />
                    <span>
                      I authorize TRUSTPAY to retry creating a Paystack dedicated
                      NGN receiving account for me.
                    </span>
                  </label>
                  <Button
                    disabled={!canRequestAccount}
                    onClick={() => provisionMutation.mutate()}
                  >
                    {provisionMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Retry Paystack account setup
                  </Button>
                </div>
              ) : isProvisioningPending ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center">
                  <TrustPayAnimation
                    variant="loading"
                    className="size-16"
                    label="Paystack account pending"
                  />
                  <p className="font-medium">Paystack is preparing your NGN account</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Your request was accepted. Refresh this page shortly; the
                    account number will appear only after the server confirms it.
                  </p>
                  <Button
                    variant="outline"
                    onClick={refreshFundingState}
                    disabled={accountsQuery.isFetching || provisioningQuery.isFetching}
                  >
                    {accountsQuery.isFetching || provisioningQuery.isFetching
                      ? "Refreshing…"
                      : "Refresh status"}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm leading-5">
                    <input
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      type="checkbox"
                      checked={accountConsent}
                      onChange={(event) => setAccountConsent(event.target.checked)}
                    />
                    <span>
                      I authorize TRUSTPAY to create a Paystack dedicated NGN
                      receiving account for me after identity verification.
                    </span>
                  </label>
                  <Button
                    size="lg"
                    disabled={!canRequestAccount}
                    onClick={() => provisionMutation.mutate()}
                  >
                    {provisionMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 size-4" />
                    )}
                    Request Paystack account
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Your verified Paystack identity is used. We never ask for
                    your BVN or NIN again on this funding page.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {legacyNgnAccounts.length > 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Previous receiving account</CardTitle>
              <CardDescription>
                This legacy account record is kept for reconciliation and history.
                Use your Paystack account above for new NGN wallet funding; we do
                not relabel or close the previous provider record here.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {legacyNgnAccounts.map((account) => (
                <div
                  key={account.id}
                  className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-4"
                >
                  <DetailRow
                    label="Previous provider"
                    value={account.provider || "Legacy provider"}
                  />
                  <DetailRow
                    label="Account number"
                    value={account.accountNumberMasked || account.accountNumber}
                  />
                  <DetailRow label="Bank" value={account.bankName} />
                  <DetailRow label="Status" value={account.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {capabilitiesQuery.data?.checkout ? (
          <Card>
            <CardHeader>
              <CardTitle>Pay with card or bank transfer</CardTitle>
              <CardDescription>
                Paystack will open a secure hosted checkout. TRUSTPAY verifies
                the reference on the server before crediting your wallet.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-2">
                <Label htmlFor="funding-amount">Amount (NGN)</Label>
                <Input
                  id="funding-amount"
                  value={fundingAmount}
                  onChange={(event) =>
                    setFundingAmount(event.target.value.replace(/[^0-9.]/g, ""))
                  }
                  inputMode="decimal"
                  min={checkoutMinimumAmount}
                  placeholder="e.g. 5000"
                />
              </div>
              <Button
                onClick={initializeCheckout}
                disabled={!fundingAmount || Boolean(checkoutReference)}
              >
                {checkoutReference ? "Payment pending" : "Open Paystack checkout"}
              </Button>
              {checkoutReference ? (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    Checkout reference saved. Return here after payment to verify it securely.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void verifyCheckout()}
                    disabled={isVerifyingCheckout}
                  >
                    {isVerifyingCheckout ? "Checking…" : "Check payment status"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

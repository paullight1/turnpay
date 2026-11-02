"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Clock3,
  ArrowRight,
  Landmark,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskKycId } from "@/lib/privacy";
import { kycTierRank } from "@/lib/account-status";
import { kycApi, paymentApi } from "@/services/api";
import { useAuth } from "@/lib/auth-provider";
import type { KycDocument } from "@/types";

const statusVariants: Record<
  string,
  "secondary" | "default" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  SUBMITTED: "secondary",
  VERIFIED: "default",
  REJECTED: "destructive",
  FAILED: "destructive",
  REVIEW_REQUIRED: "outline",
};

function humanize(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "Not set";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTier(value?: string | number | null) {
  return `Tier ${kycTierRank(value)}`;
}

function verifiedTypes(documents: KycDocument[]) {
  return new Set(
    documents
      .filter((document) => document.status === "VERIFIED")
      .map((document) => document.type),
  );
}

export default function KycPage() {
  const { refreshProfile, user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [bvnOpen, setBvnOpen] = useState(false);
  const [ninOpen, setNinOpen] = useState(false);
  const [ninNumber, setNinNumber] = useState("");
  const [ninDob, setNinDob] = useState("");
  const [ninConsent, setNinConsent] = useState(false);
  const ninAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [isNinSubmitting, setIsNinSubmitting] = useState(false);
  const [idNumber, setIdNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [accountSetupConsent, setAccountSetupConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualNinConsent, setManualNinConsent] = useState(false);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);
  const inFlightRef = useRef(false);
  const kycAttemptKeyRef = useRef<string | null>(null);
  const kycAttemptFingerprintRef = useRef<string | null>(null);
  const manualNinAttemptKeyRef = useRef<string | null>(null);
  const manualNinAttemptFingerprintRef = useRef<string | null>(null);

  const {
    data: overview,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["kyc-status", user?.id],
    enabled: !!user,
    queryFn: async () => (await kycApi.getStatus()).data,
    refetchInterval: (query) =>
      query.state.data?.providerValidationStatus === "PENDING" ? 15_000 : false,
  });
  const { data: banks = [] } = useQuery({
    queryKey: ["banks"],
    queryFn: async () =>
      (await paymentApi.listBanks()).data as Array<{
        name: string;
        code: string;
      }>,
    staleTime: 3_600_000,
  });
  const syncedTier = useRef<string | number | null>(null);
  useEffect(() => {
    if (overview && overview.kycTier !== syncedTier.current) {
      syncedTier.current = overview.kycTier;
      void refreshProfile().catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["wallets"] });
    }
  }, [overview, refreshProfile, queryClient]);

  const documents = overview?.documents ?? [];
  const isTierTwo = kycTierRank(overview?.kycTier) >= 2;
  const hasNin = verifiedTypes(documents).has("NIN");
  const paystackDocumentBvn = documents.some(
    (document) =>
      document.type.toUpperCase() === "BVN" &&
      document.status === "VERIFIED" &&
      document.provider?.toUpperCase() === "PAYSTACK",
  );
  const paystackValidationStatus =
    overview?.providerValidationStatus?.toUpperCase() ??
    (paystackDocumentBvn ? "VERIFIED" : "UNVERIFIED");
  const paystackValidated = paystackValidationStatus === "VERIFIED";
  const paystackValidationPending = paystackValidationStatus === "PENDING";
  const ninDocument = documents.find((document) => document.type === "NIN");
  const ninPending = ["PENDING", "SUBMITTED", "REVIEW_REQUIRED"].includes(
    ninDocument?.status ?? "",
  );
  const restricted =
    overview?.isSuspended === true || profile?.isSuspended === true;
  const active =
    !restricted &&
    kycTierRank(overview?.kycTier) >= 1 &&
    overview?.kycStatus === "VERIFIED";
  const title = restricted
    ? "Your account is under review"
    : isTierTwo && paystackValidated
      ? "You’re fully verified"
      : active
        ? "Your account is active"
        : paystackValidationPending
          ? "We’re checking your BVN"
          : "Activate your account";
  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      restricted ||
      inFlightRef.current ||
      paystackValidated ||
      paystackValidationPending
    ) {
      return;
    }
    if (!/^\d{11}$/.test(idNumber)) {
      toast.error("Enter your 11-digit BVN");
      return;
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      toast.error("Enter the 10-digit bank account connected to your BVN");
      return;
    }
    if (!/^\d{3,6}$/.test(bankCode)) {
      toast.error("Enter a valid bank code");
      return;
    }
    if (!dateOfBirth || dateOfBirth > today) {
      toast.error("Enter a valid date of birth");
      return;
    }
    if (!consentAccepted) {
      toast.error("Confirm consent before verification");
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const fingerprint = [
        "bvn",
        idNumber,
        dateOfBirth,
        bankCode,
        accountNumber,
        accountSetupConsent ? "account" : "identity",
      ].join("|");
      if (kycAttemptFingerprintRef.current !== fingerprint) {
        kycAttemptFingerprintRef.current = fingerprint;
        kycAttemptKeyRef.current = createMoneyAttemptIdempotencyKey("mutation");
      }
      const response = await kycApi.verifyIdentity(
        {
          country: "NG",
          type: "BVN",
          idNumber,
          dateOfBirth,
          bankCode,
          accountNumber,
          accountSetupConsent,
          consentAccepted: true,
        },
        kycAttemptKeyRef.current!,
      );
      const result = response.data;
      kycAttemptKeyRef.current = null;
      kycAttemptFingerprintRef.current = null;
      toast.success(
        result.accountProvisioning?.status === "READY"
          ? "Identity confirmed. Your NGN account is ready."
          : result.accountProvisioning?.status === "PENDING"
            ? "Identity confirmed. We’re preparing your NGN account; you can request it later from Accounts."
            : "BVN check submitted. We’ll update this page when Paystack confirms it.",
      );
      setIdNumber("");
      setDateOfBirth("");
      setConsentAccepted(false);
      setBankCode("");
      setAccountNumber("");
      setAccountSetupConsent(false);
      await refetch();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Identity verification failed"));
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleManualNinSubmit = async () => {
    if (restricted || !manualFile || isManualSubmitting) return;
    if (!manualNinConsent) {
      toast.error("Confirm consent before submitting NIN evidence");
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        manualFile.type,
      )
    ) {
      toast.error("Choose a JPG, PNG, WEBP, or PDF document");
      return;
    }
    if (!/^\d{11}$/.test(idNumber)) {
      toast.error("Enter your 11-digit NIN before uploading it");
      return;
    }
    if (manualFile.size <= 0 || manualFile.size > 8 * 1024 * 1024) {
      toast.error("NIN evidence must be 8 MiB or smaller");
      return;
    }
    setIsManualSubmitting(true);
    try {
      const manualFingerprint = [
        "nin",
        idNumber,
        manualFile.name,
        manualFile.size,
        manualFile.type,
        manualFile.lastModified,
      ].join("|");
      if (manualNinAttemptFingerprintRef.current !== manualFingerprint) {
        manualNinAttemptFingerprintRef.current = manualFingerprint;
        manualNinAttemptKeyRef.current =
          createMoneyAttemptIdempotencyKey("mutation");
      }
      const upload = (
        await kycApi.createDocumentUploadUrl(
          {
            fileName: manualFile.name,
            contentType: manualFile.type || "application/octet-stream",
            fileSize: manualFile.size,
          },
          manualNinAttemptKeyRef.current!,
        )
      ).data as { signedUrl: string; objectKey: string };
      const signedUrl = new URL(upload.signedUrl);
      if (signedUrl.protocol !== "https:" || !signedUrl.host) {
        throw new Error("The document upload URL is not secure");
      }
      const uploadResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": manualFile.type },
        body: manualFile,
      });
      if (!uploadResponse.ok) throw new Error("Document upload failed");
      await kycApi.submitManualDocument(
        {
          type: "NIN",
          idNumber,
          objectKey: upload.objectKey,
          consentAccepted: true,
        },
        manualNinAttemptKeyRef.current!,
      );
      manualNinAttemptKeyRef.current = null;
      manualNinAttemptFingerprintRef.current = null;
      toast.success("NIN submitted for manual review.");
      setManualFile(null);
      setManualNinConsent(false);
      setIdNumber("");
      await refetch();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not submit NIN for review"));
    } finally {
      setIsManualSubmitting(false);
    }
  };

  const handleNinSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      restricted ||
      isNinSubmitting ||
      !ninConsent ||
      !/^\d{11}$/.test(ninNumber) ||
      !ninDob ||
      ninDob > today ||
      !paystackValidated ||
      ninPending ||
      hasNin
    )
      return;
    setIsNinSubmitting(true);
    try {
      const fingerprint = `${ninNumber}|${ninDob}`;
      if (ninAttempt.current?.fingerprint !== fingerprint)
        ninAttempt.current = {
          fingerprint,
          key: createMoneyAttemptIdempotencyKey("mutation"),
        };
      const result = (
        await kycApi.verifyIdentity(
          {
            country: "NG",
            type: "NIN",
            idNumber: ninNumber,
            dateOfBirth: ninDob,
            consentAccepted: true,
          },
          ninAttempt.current!.key,
        )
      ).data;
      ninAttempt.current = null;
      setNinNumber("");
      setNinDob("");
      setNinConsent(false);
      setNinOpen(false);
      if (
        ["REJECTED", "FAILED"].includes(
          result.verificationStatus ?? result.status,
        )
      ) {
        toast.error(
          "Your NIN could not be matched. Review your details or contact support. Tier 1 stays active.",
        );
      } else {
        toast.success(
          result.verificationStatus === "VERIFIED"
            ? "NIN verified. Your account has been upgraded."
            : "NIN check received. Your Tier 1 account stays active.",
        );
      }
      await refetch();
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not complete your NIN check"));
    } finally {
      setIsNinSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <main className="mx-auto w-full max-w-2xl space-y-7 pb-10">
        <header className="space-y-3">
          <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-primary/8 text-primary">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Identity verification
            </p>
            <Badge variant="outline">
              {restricted
                ? "Under review"
                : active
                  ? `${formatTier(overview?.kycTier)} active`
                  : "Not verified"}
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="max-w-lg text-sm leading-6 text-muted-foreground">
            {restricted
              ? "Money actions are unavailable while your account is under review. Contact support for help."
              : isTierTwo && paystackValidated
                ? "Your BVN and NIN are verified. Your account is on Tier 2."
                : active
                  ? "Transact within your Tier 1 limits. Add NIN when you’re ready to upgrade."
                  : paystackValidationPending
                    ? "Your bank identity check is in progress. We’ll update your status here."
                    : "Verify your BVN to get a bank account and start transacting within Tier 1 limits."}
          </p>
        </header>
        {restricted && (
          <Button variant="outline" asChild>
            <Link href="/dashboard/support">Contact support</Link>
          </Button>
        )}
        {isLoading && (
          <div aria-label="Loading verification">
            <Skeleton className="h-52 rounded-2xl" />
          </div>
        )}
        {isError && (
          <div role="alert" className="rounded-xl border p-5">
            <p className="text-sm">
              We could not load your verification status.
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {overview && !isError && (
          <>
            <section
              className="overflow-hidden rounded-2xl border bg-card"
              aria-labelledby="tier-one-title"
            >
              <div className="space-y-5 p-5 sm:p-7">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium ${paystackValidated ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                  >
                    {paystackValidated ? (
                      <BadgeCheck aria-hidden="true" className="size-5" />
                    ) : (
                      "1"
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Tier 1
                    </p>
                    <h2
                      id="tier-one-title"
                      className="mt-1 text-base font-semibold"
                    >
                      Bank verification
                    </h2>
                  </div>
                  <Badge variant="secondary">
                    {paystackValidated
                      ? "Verified"
                      : paystackValidationPending
                        ? "In progress"
                        : "Get started"}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {restricted
                    ? "Your verification history is saved. Contact support about this restriction."
                    : paystackValidated
                      ? "Your BVN is verified. Tier 1 lets you send, withdraw, pay bills and exchange within your account limits."
                      : paystackValidationPending
                        ? "Your BVN and linked bank details are being checked. There’s no need to submit them again."
                        : "Have your 11-digit BVN and an existing bank account linked to it ready."}
                </p>
                {paystackValidationStatus === "FAILED" && (
                  <p
                    role="alert"
                    className="flex gap-2 text-sm text-destructive"
                  >
                    <TriangleAlert
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                    We couldn’t match your bank details. Review them or contact
                    support.
                  </p>
                )}
                {!restricted &&
                  !paystackValidated &&
                  !paystackValidationPending &&
                  !bvnOpen && (
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => setBvnOpen(true)}
                    >
                      Verify BVN
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                {paystackValidationPending && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={() => refetch()}
                      disabled={isSubmitting}
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                      Check status
                    </Button>
                    <Button variant="ghost" asChild>
                      <Link href="/dashboard/support">Get help</Link>
                    </Button>
                  </div>
                )}
                {!restricted &&
                  !paystackValidated &&
                  !paystackValidationPending &&
                  bvnOpen && (
                    <form
                      onSubmit={handleSubmit}
                      className="border-t pt-6"
                      aria-busy={isSubmitting}
                    >
                      <fieldset disabled={isSubmitting} className="space-y-5">
                        {overview.fullName && (
                          <p className="text-sm text-muted-foreground">
                            Verifying as{" "}
                            <span className="font-medium text-foreground">
                              {overview.fullName}
                            </span>
                          </p>
                        )}
                        <div className="grid gap-5 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="kyc-bvn">BVN</Label>
                            <Input
                              id="kyc-bvn"
                              value={idNumber}
                              onChange={(event) =>
                                setIdNumber(
                                  event.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 11),
                                )
                              }
                              placeholder="11-digit BVN"
                              inputMode="numeric"
                              autoComplete="off"
                              pattern="[0-9]{11}"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="kyc-dob">Date of birth</Label>
                            <Input
                              id="kyc-dob"
                              type="date"
                              value={dateOfBirth}
                              onChange={(event) =>
                                setDateOfBirth(event.target.value)
                              }
                              max={today}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="kyc-bank">Bank</Label>
                            <select
                              id="kyc-bank"
                              value={bankCode}
                              onChange={(event) =>
                                setBankCode(event.target.value)
                              }
                              required
                              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <option value="">Select your bank</option>
                              {banks.map((bank) => (
                                <option key={bank.code} value={bank.code}>
                                  {bank.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="kyc-account">
                              Linked account number
                            </Label>
                            <Input
                              id="kyc-account"
                              value={accountNumber}
                              onChange={(event) =>
                                setAccountNumber(
                                  event.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 10),
                                )
                              }
                              placeholder="10-digit account number"
                              inputMode="numeric"
                              autoComplete="off"
                              pattern="[0-9]{10}"
                              required
                            />
                          </div>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Use a bank account in your legal name that is linked
                          to this BVN.
                        </p>
                        <label className="flex items-start gap-3 text-sm leading-6">
                          <input
                            type="checkbox"
                            checked={consentAccepted}
                            onChange={(event) =>
                              setConsentAccepted(event.target.checked)
                            }
                            className="mt-1 size-4 shrink-0 accent-primary"
                          />
                          <span>
                            I agree to share my BVN and bank details securely
                            with Paystack for verification.{" "}
                            <Link
                              href="/legal#privacy"
                              className="underline underline-offset-2"
                            >
                              Privacy notice
                            </Link>
                          </span>
                        </label>
                        <label className="flex items-start gap-3 text-sm leading-6">
                          <input
                            type="checkbox"
                            checked={accountSetupConsent}
                            onChange={(event) =>
                              setAccountSetupConsent(event.target.checked)
                            }
                            className="mt-1 size-4 shrink-0 accent-primary"
                          />
                          <span>
                            I also agree to an NGN receiving account being
                            prepared after my BVN is verified.
                          </span>
                        </label>
                        <Button
                          type="submit"
                          disabled={!consentAccepted || isSubmitting}
                          className="w-full sm:w-auto"
                        >
                          {isSubmitting ? "Submitting…" : "Submit BVN"}
                        </Button>
                      </fieldset>
                    </form>
                  )}
                {paystackValidated && !restricted && (
                  <Link
                    href="/dashboard/fund"
                    className="flex items-center gap-3 rounded-xl bg-muted/50 p-4 text-sm"
                  >
                    <Landmark
                      aria-hidden="true"
                      className="size-5 text-muted-foreground"
                    />
                    <span className="flex-1">
                      <span className="block font-medium">
                        {["ACTIVE", "SUCCESS", "READY", "COMPLETED"].includes(
                          overview.accountProvisioning?.status ?? "",
                        )
                          ? "Your bank account is ready"
                          : ["PENDING", "PROCESSING", "QUEUED"].includes(
                                overview.accountProvisioning?.status ?? "",
                              )
                            ? "Preparing your bank account"
                            : "Set up your bank account"}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        View your NGN receiving account and setup status
                      </span>
                    </span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                )}
              </div>
            </section>
            <section
              className="rounded-2xl border bg-card p-5 sm:p-7"
              aria-labelledby="tier-two-title"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground">
                  {hasNin ? (
                    <BadgeCheck
                      aria-hidden="true"
                      className="size-5 text-emerald-600"
                    />
                  ) : (
                    "2"
                  )}
                </span>
                <div className="flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Tier 2
                  </p>
                  <h2
                    id="tier-two-title"
                    className="mt-1 text-base font-semibold"
                  >
                    NIN verification
                  </h2>
                </div>
                {hasNin && <Badge variant="secondary">Verified</Badge>}
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {restricted
                  ? "An identity upgrade will not remove your account restriction."
                  : hasNin
                    ? "Your NIN upgrade is complete."
                    : ninPending
                      ? "Your NIN is under review. Tier 1 stays active."
                      : paystackValidated
                        ? "Add your NIN to upgrade your account limits. You can keep using Tier 1."
                        : "Available after BVN verification"}
              </p>
              {!restricted &&
                paystackValidated &&
                !hasNin &&
                !ninPending &&
                !ninOpen && (
                  <Button
                    variant="outline"
                    className="mt-5 w-full sm:w-auto"
                    onClick={() => {
                      setNinOpen(true);
                      setIdNumber("");
                    }}
                  >
                    Upgrade to Tier 2
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Button>
                )}
              {ninPending && (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 aria-hidden="true" className="size-4" />
                  We’ll update your status after verification.
                </p>
              )}
              {ninOpen &&
                !restricted &&
                paystackValidated &&
                !hasNin &&
                !ninPending &&
                (overview.ninVerificationAvailable ? (
                  <form
                    onSubmit={handleNinSubmit}
                    className="mt-6 space-y-5 border-t pt-6"
                  >
                    <fieldset disabled={isNinSubmitting} className="space-y-5">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="nin-number">NIN</Label>
                          <Input
                            id="nin-number"
                            value={ninNumber}
                            onChange={(event) =>
                              setNinNumber(
                                event.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 11),
                              )
                            }
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="11-digit NIN"
                            pattern="[0-9]{11}"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="nin-dob">Date of birth</Label>
                          <Input
                            id="nin-dob"
                            value={ninDob}
                            type="date"
                            max={today}
                            onChange={(event) => setNinDob(event.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <label className="flex items-start gap-3 text-sm leading-6">
                        <input
                          type="checkbox"
                          checked={ninConsent}
                          onChange={(event) =>
                            setNinConsent(event.target.checked)
                          }
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span>
                          I agree that my NIN, legal name and date of birth will
                          be shared securely with Ninja for verification.
                        </span>
                      </label>
                      <Button
                        type="submit"
                        disabled={
                          !ninConsent ||
                          isNinSubmitting ||
                          ninNumber.length !== 11 ||
                          !ninDob
                        }
                      >
                        {isNinSubmitting ? "Checking…" : "Verify NIN"}
                      </Button>
                    </fieldset>
                  </form>
                ) : (
                  <div className="mt-6 space-y-5 border-t pt-6">
                    <p className="text-sm text-muted-foreground">
                      Upload your NIN evidence for a secure manual review. Your
                      upgrade stays pending until an authorized reviewer
                      verifies it.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="manual-nin-number">NIN</Label>
                      <Input
                        id="manual-nin-number"
                        value={idNumber}
                        onChange={(event) =>
                          setIdNumber(
                            event.target.value.replace(/\D/g, "").slice(0, 11),
                          )
                        }
                        placeholder="11-digit NIN"
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manual-nin-file">NIN evidence</Label>
                      <Input
                        id="manual-nin-file"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) =>
                          setManualFile(event.target.files?.[0] ?? null)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        JPG, PNG, WebP or PDF. Up to 8 MiB.
                      </p>
                    </div>
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        type="checkbox"
                        checked={manualNinConsent}
                        onChange={(event) =>
                          setManualNinConsent(event.target.checked)
                        }
                        className="mt-1 size-4 shrink-0 accent-primary"
                      />
                      <span>
                        I agree to secure storage and authorized review of my
                        NIN evidence.
                      </span>
                    </label>
                    <Button
                      onClick={handleManualNinSubmit}
                      disabled={
                        !manualFile || !manualNinConsent || isManualSubmitting
                      }
                    >
                      {isManualSubmitting
                        ? "Uploading…"
                        : "Submit NIN for review"}
                    </Button>
                  </div>
                ))}
            </section>
            {overview.tierOneLimits && active && !isTierTwo && (
              <section aria-label="Tier 1 limits" className="px-1">
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Your Tier 1 limits
                </h2>
                <dl className="mt-3 divide-y text-sm">
                  {[
                    ["Per transaction", overview.tierOneLimits.perTransaction],
                    ["Daily spending", overview.tierOneLimits.daily],
                    ["Wallet balance", overview.tierOneLimits.maxBalance],
                  ].map(([label, value]) => (
                    <div
                      className="flex justify-between gap-4 py-3"
                      key={label}
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        NGN{" "}
                        {Number(value).toLocaleString("en-NG", {
                          minimumFractionDigits: 2,
                        })}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <details className="rounded-xl border">
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
                Verification history
              </summary>
              <div className="divide-y border-t px-5">
                {documents.length ? (
                  documents.map((document) => (
                    <div
                      className="flex items-center justify-between gap-3 py-4 text-sm"
                      key={document.id}
                    >
                      <div>
                        <p className="font-medium">{document.type}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {maskKycId(document.idNumber)}
                        </p>
                      </div>
                      <Badge
                        variant={statusVariants[document.status] ?? "secondary"}
                      >
                        {humanize(document.status)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="py-5 text-sm text-muted-foreground">
                    Your identity checks will appear here.
                  </p>
                )}
              </div>
            </details>
            <p className="flex items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
              Your identity details are encrypted and kept private.
            </p>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}

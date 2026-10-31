"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Clock3,
  MapPin,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/dashboard-layout";
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
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { maskKycId } from "@/lib/privacy";
import { kycApi } from "@/services/api";
import type { KycDocument, KycStatusOverview } from "@/types";

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
  const tier = String(value ?? "0").replace(/^TIER[_\s-]?/i, "");
  return `Tier ${tier}`;
}

function tierRank(value?: string | number | null) {
  const parsed = Number(String(value ?? "0").replace(/\D/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function verifiedTypes(documents: KycDocument[]) {
  return new Set(
    documents
      .filter((document) => document.status === "VERIFIED")
      .map((document) => document.type),
  );
}

function nextStep(
  documents: KycDocument[],
  tier?: string | number,
  providerValidationStatus?: string,
) {
  const paystackStatus = providerValidationStatus?.toUpperCase();
  if (paystackStatus === "PENDING") {
    return "Paystack is reviewing your BVN and linked bank account.";
  }
  if (paystackStatus !== "VERIFIED") {
    return "Complete Paystack BVN and linked bank validation before using a new NGN account.";
  }
  if (tierRank(tier) >= 2) {
    return "Your identity checks are complete for transfers and withdrawals.";
  }
  const verified = verifiedTypes(documents);
  if (verified.has("BVN")) return "Submit your NIN evidence for manual review to reach Tier 2.";
  if (verified.has("NIN")) return "Complete your Paystack BVN and linked bank check to reach Tier 2.";
  return "Start with your BVN and the Nigerian bank account linked to it.";
}

function VerificationState({ overview }: { overview: KycStatusOverview }) {
  const status = overview.latestVerification?.status;
  const hasPaystackBvn = overview.documents.some(
    (document) =>
      document.type.toUpperCase() === "BVN" &&
      document.status === "VERIFIED" &&
      document.provider?.toUpperCase() === "PAYSTACK",
  );
  const paystackStatus =
    overview.providerValidationStatus?.toUpperCase() ??
    (hasPaystackBvn ? "VERIFIED" : undefined);

  if (paystackStatus === "PENDING") {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
        <Clock3
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div>
          <p className="font-medium">Paystack BVN validation is in progress.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your existing KYC tier remains unchanged. We will enable new NGN
            funding features after Paystack confirms the linked bank account.
          </p>
        </div>
      </div>
    );
  }

  if (tierRank(overview.kycTier) >= 2 && paystackStatus === "VERIFIED") {
    return (
      <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
        <BadgeCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <div>
          <p className="font-medium">Identity verification complete</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Paystack identity validation is complete and your existing KYC
            access is preserved. You do not need to submit anything else here.
          </p>
        </div>
      </div>
    );
  }

  if (tierRank(overview.kycTier) >= 2 && paystackStatus !== "VERIFIED") {
    return (
      <div className="flex gap-3 rounded-xl border border-sky-500/25 bg-sky-500/8 p-4">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400"
        />
        <div>
          <p className="font-medium">Existing KYC access is preserved.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete the Paystack validation below before requesting a new NGN
            receiving account. Your current tier is not being downgraded.
          </p>
        </div>
      </div>
    );
  }

  if (status === "REVIEW_REQUIRED") {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
        <Clock3
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div>
          <p className="font-medium">
            Your identity check needs a manual review.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can retry if any detail was entered incorrectly. Otherwise, we
            will update this page after review.
          </p>
        </div>
      </div>
    );
  }

  if (status === "REJECTED") {
    return (
      <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive"
        />
        <div>
          <p className="font-medium">
            We could not match those identity details.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check the number, name on your TRUSTPAY profile, and date of birth,
            then try again.
          </p>
        </div>
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive"
        />
        <div>
          <p className="font-medium">
            The identity service could not complete your check.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            No verification was completed. Please wait a moment and try again.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default function KycPage() {
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
    queryKey: ["kyc-status"],
    queryFn: async () => (await kycApi.getStatus()).data,
  });

  const documents = overview?.documents ?? [];
  const isTierTwo = tierRank(overview?.kycTier) >= 2;
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
  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || paystackValidated || paystackValidationPending) {
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
    if (!manualFile || isManualSubmitting) return;
    if (!manualNinConsent) {
      toast.error("Confirm consent before submitting NIN evidence");
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(manualFile.type)) {
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
        manualNinAttemptKeyRef.current = createMoneyAttemptIdempotencyKey("mutation");
      }
      const upload = (await kycApi.createDocumentUploadUrl({
        fileName: manualFile.name,
        contentType: manualFile.type || "application/octet-stream",
        fileSize: manualFile.size,
      }, manualNinAttemptKeyRef.current!)).data as { signedUrl: string; objectKey: string };
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
        { type: "NIN", idNumber, objectKey: upload.objectKey, consentAccepted: true },
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

  return (
    <DashboardLayout>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="max-w-xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Account security
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Identity verification
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Verify your BVN with the Nigerian bank account connected to it.
          </p>
        </header>

        {isLoading ? (
          <section aria-label="Loading identity status" className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-80 w-full rounded-xl" />
          </section>
        ) : null}

        {isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm"
          >
            <div>
              <p className="font-medium">We could not load your KYC status.</p>
              <p className="mt-1 text-muted-foreground">
                Check your connection and try again.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        {overview && !isError ? (
          <>
            <section className="grid gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div>
                <p className="text-muted-foreground">Next step</p>
                <p className="mt-1 font-medium">
                  {nextStep(
                    documents,
                    overview.kycTier,
                    paystackValidationStatus,
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:border-l sm:pl-4">
                <MapPin
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <span>Nigeria</span>
              </div>
              <div className="flex items-center gap-2 sm:border-l sm:pl-4">
                <span className="text-muted-foreground">Access</span>
                <Badge variant="secondary">
                  {formatTier(overview.kycTier)}
                </Badge>
              </div>
            </section>

            <VerificationState overview={overview} />

            {!paystackValidated && !paystackValidationPending ? (
              <Card>
                <CardHeader className="border-b pb-4">
                  <CardTitle>Verify your BVN</CardTitle>
                  <CardDescription>
                    Paystack validates your BVN against an existing Nigerian
                    bank account. This check is asynchronous.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-5"
                    onSubmit={handleSubmit}
                    aria-busy={isSubmitting}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="kyc-id-number">Identity number</Label>
                        <Input
                          id="kyc-id-number"
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
                          pattern="[0-9]{11}"
                          minLength={11}
                          maxLength={11}
                          autoComplete="off"
                          spellCheck={false}
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Enter digits only.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="kyc-bank-code">Bank code</Label>
                        <Input id="kyc-bank-code" value={bankCode} onChange={(event) => setBankCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="e.g. 058" inputMode="numeric" required />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="kyc-account-number">BVN-linked account number</Label>
                        <Input id="kyc-account-number" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit account number" inputMode="numeric" required />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="kyc-date-of-birth">Date of birth</Label>
                        <Input
                          id="kyc-date-of-birth"
                          type="date"
                          value={dateOfBirth}
                          max={today}
                          onChange={(event) =>
                            setDateOfBirth(event.target.value)
                          }
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          It must match the identity record.
                        </p>
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm leading-5">
                      <input
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        type="checkbox"
                        checked={consentAccepted}
                        onChange={(event) =>
                          setConsentAccepted(event.target.checked)
                        }
                      />
                      <span>
                        I agree that my BVN and bank details will be shared securely
                        with Paystack for identity verification. See our{" "}
                        <Link
                          className="underline underline-offset-2"
                          href="/legal#privacy"
                        >
                          privacy notice
                        </Link>
                        .
                      </span>
                    </label>

                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm leading-5">
                      <input className="mt-0.5 size-4 shrink-0 accent-primary" type="checkbox" checked={accountSetupConsent} onChange={(event) => setAccountSetupConsent(event.target.checked)} />
                      <span>I also consent to creating a dedicated NGN receiving account after my BVN is verified.</span>
                    </label>

                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck aria-hidden="true" className="size-4" />
                        Your full identity number is never shown in history.
                      </p>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting
                          ? "Submitting…"
                          : accountSetupConsent
                            ? "Submit and prepare account"
                            : "Submit BVN check"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            {paystackValidated && !hasNin && !isTierTwo ? (
              <Card>
                <CardHeader>
                  <CardTitle>Reach Tier 2 with a manual NIN review</CardTitle>
                  <CardDescription>
                    Withdrawals require Tier 2. Upload your NIN evidence for an authorized review; a typed NIN is never treated as verified automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="manual-nin-number">NIN number</Label><Input id="manual-nin-number" value={idNumber} onChange={(event) => setIdNumber(event.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11-digit NIN" inputMode="numeric" /></div>
                  <div className="space-y-2"><Label htmlFor="manual-nin-file">NIN evidence</Label><Input id="manual-nin-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setManualFile(event.target.files?.[0] ?? null)} /></div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm leading-5">
                    <input className="mt-0.5 size-4 shrink-0 accent-primary" type="checkbox" checked={manualNinConsent} onChange={(event) => setManualNinConsent(event.target.checked)} />
                    <span>I consent to secure storage and authorized manual review of this NIN evidence.</span>
                  </label>
                  <Button type="button" onClick={handleManualNinSubmit} disabled={!manualFile || !manualNinConsent || isManualSubmitting}>{isManualSubmitting ? "Uploading…" : "Submit NIN for review"}</Button>
                </CardContent>
              </Card>
            ) : null}

            <section aria-labelledby="verification-history-title">
              <div className="mb-2 flex items-center justify-between">
                <h2
                  id="verification-history-title"
                  className="text-sm font-medium"
                >
                  Verification history
                </h2>
                <span className="text-xs text-muted-foreground">
                  Identifiers are masked
                </span>
              </div>
              {documents.length ? (
                <div className="divide-y rounded-xl border bg-card">
                  {documents.map((document) => (
                    <div
                      key={document.id}
                      className="flex items-center justify-between gap-4 p-4 text-sm"
                    >
                      <div>
                        <p className="font-medium">{humanize(document.type)}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {maskKycId(document.idNumber)}
                        </p>
                      </div>
                      <Badge
                        variant={statusVariants[document.status] ?? "secondary"}
                      >
                        {humanize(document.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-7 text-center">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mx-auto size-5 text-muted-foreground"
                  />
                  <p className="mt-3 text-sm font-medium">
                    No identity checks yet.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start with BVN; NIN upgrades are submitted as evidence for manual review.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </DashboardLayout>
  );
}

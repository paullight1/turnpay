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
import { maskKycId } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import { kycApi } from "@/services/api";
import type { KycDocument, KycStatusOverview } from "@/types";

type IdentityType = "BVN" | "NIN";

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

function suggestedIdentityType(documents: KycDocument[]): IdentityType {
  const verified = verifiedTypes(documents);
  if (verified.has("BVN") && !verified.has("NIN")) return "NIN";
  return "BVN";
}

function nextStep(documents: KycDocument[], tier?: string | number) {
  if (tierRank(tier) >= 2) {
    return "Your identity checks are complete for transfers and withdrawals.";
  }
  const verified = verifiedTypes(documents);
  if (verified.has("BVN")) return "Verify your NIN to reach Tier 2.";
  if (verified.has("NIN")) return "Verify your BVN to reach Tier 2.";
  return "Start with either one. You will need both BVN and NIN for Tier 2.";
}

function VerificationState({ overview }: { overview: KycStatusOverview }) {
  const status = overview.latestVerification?.status;

  if (tierRank(overview.kycTier) >= 2) {
    return (
      <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
        <BadgeCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <div>
          <p className="font-medium">Identity verification complete</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your BVN and NIN checks are complete. You do not need to submit
            anything else here.
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
  const [selectedType, setSelectedType] = useState<IdentityType | null>(null);
  const [idNumber, setIdNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlightRef = useRef(false);

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
  const effectiveType = selectedType ?? suggestedIdentityType(documents);
  const isTierTwo = tierRank(overview?.kycTier) >= 2;
  const today = new Date().toISOString().slice(0, 10);

  const handleIdentityTypeChange = (value: IdentityType) => {
    setSelectedType(value);
    setIdNumber("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlightRef.current || isTierTwo) return;
    if (!/^\d{11}$/.test(idNumber)) {
      toast.error(`Enter the 11-digit ${effectiveType}`);
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
      await kycApi.verifyIdentity(
        {
          country: "NG",
          type: effectiveType,
          idNumber,
          dateOfBirth,
          consentAccepted: true,
        },
        crypto.randomUUID(),
      );
      toast.success("Identity check complete");
      setIdNumber("");
      setDateOfBirth("");
      setConsentAccepted(false);
      setSelectedType(null);
      await refetch();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Identity verification failed"));
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
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
            Verify your Nigerian identity details. No document upload is
            required.
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
                  {nextStep(documents, overview.kycTier)}
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

            {!isTierTwo ? (
              <Card>
                <CardHeader className="border-b pb-4">
                  <CardTitle>Verify an identity</CardTitle>
                  <CardDescription>
                    Choose the identity record you want to check.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-5"
                    onSubmit={handleSubmit}
                    aria-busy={isSubmitting}
                  >
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">
                        Identity type
                      </legend>
                      <div className="grid grid-cols-2 gap-2">
                        {(["BVN", "NIN"] as const).map((identityType) => (
                          <button
                            key={identityType}
                            type="button"
                            aria-pressed={effectiveType === identityType}
                            onClick={() =>
                              handleIdentityTypeChange(identityType)
                            }
                            className={cn(
                              "h-10 rounded-lg border text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                              effectiveType === identityType
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {identityType}
                          </button>
                        ))}
                      </div>
                    </fieldset>

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
                          placeholder={`11-digit ${effectiveType}`}
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
                        I agree that my identity details will be shared securely
                        with Ninja for this verification. See our{" "}
                        <Link
                          className="underline underline-offset-2"
                          href="/legal#privacy"
                        >
                          privacy notice
                        </Link>
                        .
                      </span>
                    </label>

                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck aria-hidden="true" className="size-4" />
                        Your full identity number is never shown in history.
                      </p>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting
                          ? "Verifying…"
                          : `Verify ${effectiveType}`}
                      </Button>
                    </div>
                  </form>
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
                    Choose BVN or NIN above to begin.
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

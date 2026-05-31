"use client";

import { useMemo, useState } from "react";
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
import { bankingApi } from "@/services/api";
import { getMoneyActionGate } from "@/lib/account-status";
import { useAuth } from "@/lib/auth-provider";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import { maskEmail, maskPhone } from "@/lib/privacy";
import type { VirtualAccount } from "@/types";

function splitNameFromEmail(email?: string | null) {
  const local = email
    ?.split("@")[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  const [first = "", ...rest] = local ? local.split(/\s+/) : [];
  return {
    firstName: first ? first[0].toUpperCase() + first.slice(1) : "",
    lastName: rest.length > 0 ? rest.join(" ") : "",
  };
}

function splitName(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;
  const [firstName = "", ...rest] = normalized.split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

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
  const moneyGate = getMoneyActionGate(profile);
  const email = profile?.email ?? user?.email ?? "";
  const phone = profile?.phone ?? user?.user_metadata?.phone ?? "";
  const nameSeed = useMemo(
    () => splitName(profile?.fullName) ?? splitNameFromEmail(email),
    [email, profile?.fullName],
  );
  const [firstName, setFirstName] = useState(nameSeed.firstName);
  const [lastName, setLastName] = useState(nameSeed.lastName);
  const [middleName, setMiddleName] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const resolvedFirstName = firstName.trim() || nameSeed.firstName;
  const resolvedLastName = lastName.trim() || nameSeed.lastName;

  const accountsQuery = useQuery({
    queryKey: ["virtual-accounts"],
    queryFn: async () => {
      const response = await bankingApi.getVirtualAccounts();
      return response.data;
    },
  });

  const ngnAccount = useMemo(
    () =>
      accountsQuery.data?.find(
        (account) =>
          account.currency === "NGN" &&
          account.provider?.toLowerCase() === "monnify",
      ) ?? null,
    [accountsQuery.data],
  );

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const response = await bankingApi.provisionVirtualAccount(
        {
          currency: "NGN",
          provider: "monnify",
          firstName: resolvedFirstName,
          lastName: resolvedLastName,
          middleName: middleName.trim() || undefined,
          country: "NG",
          bvn: bvn.trim() || undefined,
          nin: nin.trim() || undefined,
        },
        createMoneyAttemptIdempotencyKey("fund"),
      );
      return response.data;
    },
    onSuccess: (account) => {
      queryClient.setQueryData<VirtualAccount[]>(
        ["virtual-accounts"],
        (current) => {
          const rest =
            current?.filter(
              (item) =>
                !(
                  item.provider === account.provider &&
                  item.currency === account.currency
                ),
            ) ?? [];
          return [account, ...rest];
        },
      );
      toast.success("Monnify account is ready for wallet funding.");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Could not request account"));
    },
  });

  const canRequestAccount =
    resolvedFirstName.length >= 2 &&
    resolvedLastName.length >= 2 &&
    !moneyGate &&
    !provisionMutation.isPending;

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
              Request your Monnify account, then transfer from your bank app.
            </p>
          </div>
          <Badge variant={ngnAccount ? "default" : "secondary"}>
            {ngnAccount ? "Account ready" : "Request required"}
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
                <CardTitle>Monnify funding account</CardTitle>
              </div>
              <CardDescription>
                Use this account for NGN wallet funding. Transfers are confirmed
                by Monnify webhook.
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
                    after Monnify sends the transaction completion webhook.
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input
                        id="firstName"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        placeholder="First name"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input
                        id="lastName"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="middleName">Middle name optional</Label>
                    <Input
                      id="middleName"
                      value={middleName}
                      onChange={(event) => setMiddleName(event.target.value)}
                      placeholder="Middle name"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="bvn">BVN optional</Label>
                      <Input
                        id="bvn"
                        value={bvn}
                        onChange={(event) =>
                          setBvn(
                            event.target.value.replace(/\D/g, "").slice(0, 11),
                          )
                        }
                        inputMode="numeric"
                        placeholder="11 digits"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="nin">NIN optional</Label>
                      <Input
                        id="nin"
                        value={nin}
                        onChange={(event) =>
                          setNin(
                            event.target.value.replace(/\D/g, "").slice(0, 11),
                          )
                        }
                        inputMode="numeric"
                        placeholder="11 digits"
                      />
                    </div>
                  </div>
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
                    Request Monnify account
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    You only need to request this once. After it is created, the
                    account remains attached to your TRUSTPAY profile.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

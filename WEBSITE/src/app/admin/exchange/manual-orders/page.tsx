"use client";

import { hasAdminAccess } from "@/lib/admin-access";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-provider";
import { getErrorMessage, getErrorStatus } from "@/lib/errors";
import { createManualExchangeIdempotencyKey } from "@/lib/idempotency";
import { maskAccountNumber } from "@/lib/privacy";
import {
  adminManualExchangeApi,
  adminUserApi,
  type AdminManualExchangeOrder,
  type AdminManualExchangePayoutOutcome,
  type AdminManualExchangeReviewAction,
  type AdminManualExchangeReviewInput,
  type ManualExchangeProofKind,
} from "@/services/api";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  FileCheck2,
  Info,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Upload,
  WalletCards,
  XCircle,
} from "lucide-react";
import { z } from "zod";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

const ORDER_STATUS_FILTERS = [
  "ALL",
  "AWAITING_TRANSFER",
  "AWAITING_CONFIRMATION",
  "NEEDS_MORE_INFO",
  "CREDITED",
  "PAYOUT_PENDING",
  "PAYOUT_PROCESSING",
  "PAYOUT_SENT",
  "COMPLETED",
  "REJECTED",
] as const;

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;

const reasonSchema = z
  .string()
  .trim()
  .min(10, "Enter a reason of at least 10 characters")
  .max(500, "Reason must be 500 characters or fewer");
const referenceSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._-]{4,100}$/,
    "Use 4–100 letters, numbers, dots, underscores, or hyphens",
  );
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals")
  .max(16, "Amount must be 16 characters or fewer")
  .refine(
    (value) =>
      value
        .replace(".", "")
        .split("")
        .some((digit) => digit !== "0"),
    "Amount must be greater than zero",
  );

type ActionPanel =
  | "CREDIT_WALLET"
  | "CONFIRM_DEPOSIT"
  | "REQUEST_INFO"
  | "REJECT"
  | "CLAIM_PAYOUT"
  | "HANDOVER_PAYOUT"
  | "MARK_SENT"
  | "RECORD_CEDIS_SENT"
  | "RECORD_PAYOUT_SENT"
  | "COMPLETE";

type AttemptIdentity = {
  orderId: string;
  action: string;
};

type DeepLinkState = "idle" | "loading" | "found" | "not-found" | "error";

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusLabel(value: string) {
  switch (value) {
    case "AWAITING_CONFIRMATION":
      return "Awaiting Confirmation";
    case "CREDITED":
      return "Credited to Wallet";
    case "PAYOUT_PENDING":
      return "Deposit Confirmed — Payout Pending";
    case "PAYOUT_PROCESSING":
      return "Payout Being Processed";
    case "PAYOUT_SENT":
      return "Payout Sent";
    case "NEEDS_MORE_INFO":
      return "More Information Needed";
    case "COMPLETED":
      return "Completed";
    case "REJECTED":
      return "Rejected";
    case "AWAITING_TRANSFER":
      return "Awaiting Transfer";
    default:
      return humanize(value);
  }
}

function formatMoney(value: string, currency: string) {
  const normalized = value.trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return `${currency} ${value}`;

  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "") || "0";
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = match[2] ?? "";
  const displayFraction =
    fraction.length === 0
      ? "00"
      : fraction.length === 1
        ? `${fraction}0`
        : fraction;
  return `${currency} ${groupedWhole}.${displayFraction}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusVariant(status: string) {
  if (["CREDITED", "COMPLETED"].includes(status)) return "default" as const;
  if (status === "REJECTED") return "destructive" as const;
  if (status === "NEEDS_MORE_INFO") return "secondary" as const;
  return "outline" as const;
}

function statusTone(status: string) {
  if (["CREDITED", "COMPLETED"].includes(status)) {
    return "border-emerald-500/25 bg-emerald-500/10";
  }
  if (status === "REJECTED") return "border-red-500/25 bg-red-500/10";
  if (["PAYOUT_PENDING", "PAYOUT_PROCESSING"].includes(status)) {
    return "border-amber-500/25 bg-amber-500/10";
  }
  return "border-border bg-muted/30";
}

function isDepositReviewStatus(status: string) {
  return status === "AWAITING_CONFIRMATION" || status === "NEEDS_MORE_INFO";
}

function isOrderExpired(order: AdminManualExchangeOrder) {
  const expiresAt = new Date(order.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function actionLabel(
  action: ActionPanel,
  order?: AdminManualExchangeOrder | null,
) {
  switch (action) {
    case "CREDIT_WALLET":
      return order?.sourceCurrency === "GHS" && order.targetCurrency === "NGN"
        ? "Confirm cedis and credit naira"
        : "Approve and credit wallet";
    case "CONFIRM_DEPOSIT":
      return order?.sourceCurrency === "NGN" && order.targetCurrency === "GHS"
        ? "Confirm naira received"
        : order?.sourceCurrency === "GHS"
          ? "Confirm cedis received"
          : "Confirm deposit and queue payout";
    case "REQUEST_INFO":
      return "Request more information";
    case "REJECT":
      return "Reject order";
    case "CLAIM_PAYOUT":
      return order?.targetCurrency === "GHS"
        ? "Start cedi transfer"
        : order?.payoutWorkflow === "ADMIN_EXTERNAL"
          ? "Start naira transfer"
          : "Claim payout";
    case "HANDOVER_PAYOUT":
      return "Handover payout under supervision";
    case "MARK_SENT":
      return "Mark payout as sent";
    case "RECORD_CEDIS_SENT":
      return "Confirm cedis sent";
    case "RECORD_PAYOUT_SENT":
      return "Confirm naira sent";
    case "COMPLETE":
      return "Complete settlement";
  }
}

function reviewSuccessMessage(action: AdminManualExchangeReviewAction) {
  switch (action) {
    case "CREDIT_WALLET":
      return "Wallet credited and order completed";
    case "CONFIRM_DEPOSIT":
      return "Deposit confirmed; payout is pending";
    case "REQUEST_INFO":
      return "More information requested";
    case "REJECT":
      return "Order rejected";
    case "CLAIM_PAYOUT":
      return "Payout claimed for this admin";
    case "HANDOVER_PAYOUT":
      return "Payout handover recorded; no automatic resend was made";
    case "MARK_SENT":
      return "Payout marked as sent";
    case "RECORD_CEDIS_SENT":
      return "Cedi transfer recorded and exchange completed";
    case "RECORD_PAYOUT_SENT":
      return "Naira transfer recorded and exchange completed";
    case "COMPLETE":
      return "Settlement completed";
  }
}

function payoutOutcomeLabel(value: AdminManualExchangePayoutOutcome) {
  switch (value) {
    case "NOT_SENT":
      return "Confirmed not sent — new owner may send";
    case "CONFIRMED_FAILED":
      return "Confirmed failed — new owner may retry";
    case "ALREADY_SENT":
      return "Already sent — record evidence only";
    case "UNKNOWN":
      return "Unknown — do not reassign or send";
  }
}

function sanitizeFileName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._() -]/g, "")
    .slice(0, 120);
  return sanitized || "payout-proof";
}

function validateUpload(file: File) {
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return "Use a JPEG, PNG, WebP, or PDF file.";
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE) {
    return "The proof file must be smaller than 8 MiB.";
  }
  return null;
}

function destinationPreview(order: AdminManualExchangeOrder) {
  return (
    order.destinationAccountMasked ??
    (order.destinationAccount
      ? maskAccountNumber(order.destinationAccount)
      : null)
  );
}

function DetailValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          mono ? "mt-1 break-all font-mono text-sm" : "mt-1 text-sm font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}

export default function AdminManualExchangeOrdersPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] =
    useState<(typeof ORDER_STATUS_FILTERS)[number]>("ALL");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [actionPanel, setActionPanel] = useState<ActionPanel | null>(null);
  const [reason, setReason] = useState("");
  const [depositReference, setDepositReference] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [acceptExpiredQuote, setAcceptExpiredQuote] = useState(false);
  const [payoutReference, setPayoutReference] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [handoverToAdminId, setHandoverToAdminId] = useState("");
  const [payoutOutcome, setPayoutOutcome] = useState<
    AdminManualExchangePayoutOutcome | ""
  >("");
  const [payoutProofFile, setPayoutProofFile] = useState<File | null>(null);
  const [payoutProofObjectKey, setPayoutProofObjectKey] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [proofLoading, setProofLoading] =
    useState<ManualExchangeProofKind | null>(null);
  const [isForeground, setIsForeground] = useState(true);
  const attemptKeysRef = useRef<Map<string, string>>(new Map());
  const deepLinkAttemptRef = useRef<string | null>(null);
  const deepLinkLastIdRef = useRef<string | null | undefined>(undefined);
  const [deepLinkState, setDeepLinkState] = useState<DeepLinkState>("idle");
  const deepLinkedOrderId = searchParams.get("orderId");

  const isAdmin = hasAdminAccess(user) || hasAdminAccess(profile);

  useEffect(() => {
    const updateVisibility = () => {
      setIsForeground(document.visibilityState === "visible");
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (
      !authLoading &&
      user &&
      profile &&
      !hasAdminAccess(user) &&
      !hasAdminAccess(profile)
    ) {
      router.push("/dashboard");
    }
  }, [authLoading, profile, router, user]);

  const getAttemptKey = useCallback(
    ({ orderId, action }: AttemptIdentity) => {
      const accountId = user?.id ?? "admin";
      const identity = `${accountId}:${orderId}:${action}`;
      const storageKey = `trustpay:manual-exchange:${identity}`;
      const memoryKey = attemptKeysRef.current.get(identity);
      if (memoryKey) return memoryKey;

      if (typeof window !== "undefined") {
        try {
          const persistedKey = window.sessionStorage.getItem(storageKey);
          if (persistedKey) {
            attemptKeysRef.current.set(identity, persistedKey);
            return persistedKey;
          }
        } catch {
          // Session storage may be unavailable in a restricted browser context.
        }
      }

      const nextKey = createManualExchangeIdempotencyKey();
      attemptKeysRef.current.set(identity, nextKey);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(storageKey, nextKey);
        } catch {
          // The in-memory key still protects a retry during this page session.
        }
      }
      return nextKey;
    },
    [user?.id],
  );

  const clearAttemptKey = useCallback(
    ({ orderId, action }: AttemptIdentity) => {
      const accountId = user?.id ?? "admin";
      const identity = `${accountId}:${orderId}:${action}`;
      attemptKeysRef.current.delete(identity);
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem(
            `trustpay:manual-exchange:${identity}`,
          );
        } catch {
          // There is no sensitive data to recover if storage is unavailable.
        }
      }
    },
    [user?.id],
  );

  const ordersQuery = useInfiniteQuery({
    queryKey: ["admin-manual-exchange-orders", user?.id, statusFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await adminManualExchangeApi.queue(statusFilter, pageParam)).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isAdmin,
    staleTime: 10000,
    // An infinite-query refresh fetches every loaded page. Budget at most six
    // automatic queue requests per minute, even when browsing deep history.
    refetchInterval: (query) =>
      isForeground
        ? Math.max(15000, (query.state.data?.pages.length ?? 1) * 10000)
        : false,
    refetchOnWindowFocus: false,
  });
  const {
    fetchNextPage: fetchNextManualOrdersPage,
    hasNextPage: hasNextManualOrdersPage,
    isError: isManualOrdersError,
    isFetchingNextPage: isFetchingNextManualOrdersPage,
    isPending: isManualOrdersPending,
  } = ordersQuery;

  const reconciliationQuery = useQuery({
    queryKey: ["admin-manual-exchange-reconciliation", user?.id],
    queryFn: async () => {
      const response = await adminManualExchangeApi.getReconciliation();
      return response.data;
    },
    enabled: isAdmin,
    staleTime: 30_000,
    refetchInterval: isForeground ? 60_000 : false,
  });

  const adminDirectoryQuery = useQuery({
    queryKey: ["manual-exchange-admin-directory", user?.id],
    queryFn: async () => (await adminUserApi.getUsers("ADMIN")).data.users,
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const orders = useMemo(
    () => ordersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [ordersQuery.data],
  );
  const latestReconciliation = reconciliationQuery.data?.[0] ?? null;
  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? null;
  const handoverAdmins = (adminDirectoryQuery.data ?? []).filter(
    (admin) =>
      !admin.isSuspended && admin.id !== selectedOrder?.payoutClaimedBy,
  );

  const queueCounts = useMemo(() => {
    const counts = ordersQuery.data?.pages[0]?.counts ?? {};
    return {
      needsReview:
        (counts.AWAITING_CONFIRMATION ?? 0) + (counts.NEEDS_MORE_INFO ?? 0),
      payouts:
        (counts.PAYOUT_PENDING ?? 0) +
        (counts.PAYOUT_PROCESSING ?? 0) +
        (counts.PAYOUT_SENT ?? 0),
      completed: (counts.CREDITED ?? 0) + (counts.COMPLETED ?? 0),
    };
  }, [ordersQuery.data]);

  const resetActionState = useCallback(() => {
    setActionPanel(null);
    setReason("");
    setDepositReference("");
    setActualAmount("");
    setAcceptExpiredQuote(false);
    setPayoutReference("");
    setPayoutAmount("");
    setHandoverToAdminId("");
    setPayoutOutcome("");
    setPayoutProofFile(null);
    setPayoutProofObjectKey(null);
    setFormError(null);
  }, []);

  useEffect(() => {
    if (deepLinkLastIdRef.current === deepLinkedOrderId) return;

    deepLinkLastIdRef.current = deepLinkedOrderId;
    deepLinkAttemptRef.current = null;

    if (!deepLinkedOrderId) {
      startTransition(() => setDeepLinkState("idle"));
      return;
    }

    // A notification may be opened while an operator is looking at a
    // restrictive status. Return to the full queue before resolving the UUID.
    startTransition(() => {
      setDeepLinkState("loading");
      setSelectedOrderId(null);
      resetActionState();
      if (statusFilter !== "ALL") setStatusFilter("ALL");
    });
  }, [deepLinkedOrderId, resetActionState, statusFilter]);

  useEffect(() => {
    if (
      !deepLinkedOrderId ||
      deepLinkAttemptRef.current === deepLinkedOrderId
    ) {
      return;
    }

    const matchingOrder = orders.find(
      (order) => order.id === deepLinkedOrderId,
    );
    if (matchingOrder) {
      deepLinkAttemptRef.current = deepLinkedOrderId;
      startTransition(() => {
        setDeepLinkState("found");
        setSelectedOrderId(matchingOrder.id);
      });
      return;
    }

    if (isManualOrdersPending || isFetchingNextManualOrdersPage) return;

    if (isManualOrdersError) {
      startTransition(() => setDeepLinkState("error"));
      return;
    }

    // Older orders can be beyond the first cursor page. Keep following the
    // existing queue cursor until the requested order is found.
    if (hasNextManualOrdersPage && !isFetchingNextManualOrdersPage) {
      void fetchNextManualOrdersPage();
      return;
    }

    startTransition(() => setDeepLinkState("not-found"));
  }, [
    deepLinkedOrderId,
    fetchNextManualOrdersPage,
    hasNextManualOrdersPage,
    isFetchingNextManualOrdersPage,
    isManualOrdersError,
    isManualOrdersPending,
    orders,
  ]);

  const reviewMutation = useMutation({
    mutationFn: ({
      orderId,
      input,
      idempotencyKey,
    }: {
      orderId: string;
      input: AdminManualExchangeReviewInput;
      idempotencyKey: string;
    }) => adminManualExchangeApi.review(orderId, input, idempotencyKey),
    onSuccess: async (_response, variables) => {
      clearAttemptKey({
        orderId: variables.orderId,
        action: `review:${variables.input.action}`,
      });
      resetActionState();
      await queryClient.invalidateQueries({
        queryKey: ["admin-manual-exchange-orders"],
      });
      toast.success(reviewSuccessMessage(variables.input.action));
    },
    onError: (error: unknown, variables) => {
      const status = getErrorStatus(error);
      // A definitive rejection can be corrected as a new attempt. Keep unknown outcomes and conflicts on the original key.
      if (status !== undefined && [400, 401, 403, 404, 422].includes(status))
        clearAttemptKey({
          orderId: variables.orderId,
          action: `review:${variables.input.action}`,
        });
      void queryClient.invalidateQueries({
        queryKey: ["admin-manual-exchange-orders", user?.id],
      });
      const message = getErrorMessage(
        error,
        "Could not save the manual exchange action",
      );
      setFormError(message);
      // The inline alert keeps the failure visible without covering the retry
      // controls on small viewports.
    },
  });

  const uploadProofMutation = useMutation({
    mutationFn: async ({ orderId, file }: { orderId: string; file: File }) => {
      const isHandover = actionPanel === "HANDOVER_PAYOUT";
      const uploadAction = isHandover
        ? "upload:handover-payout-proof"
        : "upload:payout-proof";
      const idempotencyKey = getAttemptKey({
        orderId,
        action: uploadAction,
      });
      const uploadRequest = {
        fileName: sanitizeFileName(file.name),
        contentType: file.type,
        fileSize: file.size,
      };
      const response = isHandover
        ? await adminManualExchangeApi.createHandoverUploadUrl(
            orderId,
            uploadRequest,
            idempotencyKey,
          )
        : await adminManualExchangeApi.createUploadUrl(
            orderId,
            uploadRequest,
            idempotencyKey,
          );
      const upload = response.data;
      const putResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });

      if (!putResponse.ok) {
        throw new Error("The proof upload was not accepted by storage.");
      }

      clearAttemptKey({ orderId, action: uploadAction });
      return { objectKey: upload.objectKey };
    },
    onSuccess: ({ objectKey }) => {
      setPayoutProofObjectKey(objectKey);
      setFormError(null);
      toast.success("Payout proof uploaded securely");
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, "Could not upload payout proof");
      setFormError(message);
      toast.error(message);
    },
  });

  const openAction = (action: ActionPanel) => {
    resetActionState();
    setActionPanel(action);
  };

  const selectOrder = (orderId: string) => {
    resetActionState();
    setSelectedOrderId(orderId);
  };

  const submitReview = () => {
    if (!selectedOrder || !actionPanel) return;

    const reasonResult = reasonSchema.safeParse(reason);
    if (!reasonResult.success) {
      setFormError(
        reasonResult.error.issues[0]?.message ?? "Enter a valid reason",
      );
      return;
    }

    const input: AdminManualExchangeReviewInput = {
      action: actionPanel,
      reason: reasonResult.data,
    };

    if (["CREDIT_WALLET", "CONFIRM_DEPOSIT"].includes(actionPanel)) {
      const depositResult = referenceSchema.safeParse(depositReference);
      const amountResult = amountSchema.safeParse(actualAmount);
      if (!depositResult.success) {
        setFormError(
          depositResult.error.issues[0]?.message ?? "Enter a deposit reference",
        );
        return;
      }
      if (!amountResult.success) {
        setFormError(
          amountResult.error.issues[0]?.message ??
            "Enter the actual deposit amount",
        );
        return;
      }
      input.depositReference = depositResult.data;
      input.actualAmount = amountResult.data;
      if (isOrderExpired(selectedOrder)) {
        if (!acceptExpiredQuote) {
          setFormError(
            "Confirm that you are honoring the original quoted terms for this expired order",
          );
          return;
        }
        input.acceptExpiredQuote = true;
      }
    }

    if (
      actionPanel === "MARK_SENT" ||
      actionPanel === "RECORD_CEDIS_SENT" ||
      actionPanel === "RECORD_PAYOUT_SENT"
    ) {
      const payoutResult = referenceSchema.safeParse(payoutReference);
      if (!payoutResult.success) {
        setFormError(
          payoutResult.error.issues[0]?.message ?? "Enter a payout reference",
        );
        return;
      }
      if (!payoutProofObjectKey) {
        setFormError(
          "Upload the protected payout proof before marking the payout as sent",
        );
        return;
      }
      if (
        actionPanel === "RECORD_CEDIS_SENT" ||
        actionPanel === "RECORD_PAYOUT_SENT"
      ) {
        const amount = amountSchema.safeParse(payoutAmount);
        if (!amount.success) {
          setFormError("Enter the actual amount sent.");
          return;
        }
        input.payoutAmount = amount.data;
      }
      input.payoutReference = payoutResult.data;
      input.payoutProofObjectKey = payoutProofObjectKey;
    }

    if (actionPanel === "HANDOVER_PAYOUT") {
      if (!handoverToAdminId) {
        setFormError(
          "Choose an active administrator to receive this payout claim",
        );
        return;
      }
      if (!payoutOutcome) {
        setFormError("Classify the real bank or MoMo payout outcome first");
        return;
      }
      if (payoutOutcome === "UNKNOWN") {
        setFormError(
          "An unknown outcome cannot be handed over. Reconcile the original payout before acting.",
        );
        return;
      }
      if (!payoutProofObjectKey) {
        setFormError(
          "Upload the protected evidence of the checked payout outcome before handing over",
        );
        return;
      }
      input.handoverToAdminId = handoverToAdminId;
      input.payoutOutcome = payoutOutcome;
      input.payoutProofObjectKey = payoutProofObjectKey;
      if (payoutOutcome === "ALREADY_SENT") {
        const payoutResult = referenceSchema.safeParse(payoutReference);
        const amountResult = amountSchema.safeParse(payoutAmount);
        if (!payoutResult.success) {
          setFormError(
            payoutResult.error.issues[0]?.message ??
              "Enter the confirmed payout reference",
          );
          return;
        }
        if (!amountResult.success) {
          setFormError("Enter the exact frozen payout amount already sent");
          return;
        }
        input.payoutReference = payoutResult.data;
        input.payoutAmount = amountResult.data;
      }
    }

    const idempotencyKey = getAttemptKey({
      orderId: selectedOrder.id,
      action: `review:${actionPanel}`,
    });
    setFormError(null);
    reviewMutation.mutate({
      orderId: selectedOrder.id,
      input,
      idempotencyKey,
    });
  };

  const uploadPayoutProof = () => {
    if (!selectedOrder || !payoutProofFile) {
      setFormError("Choose a payout proof file first");
      return;
    }
    const fileError = validateUpload(payoutProofFile);
    if (fileError) {
      setFormError(fileError);
      return;
    }
    setFormError(null);
    uploadProofMutation.mutate({
      orderId: selectedOrder.id,
      file: payoutProofFile,
    });
  };

  const openProtectedProof = async (
    order: AdminManualExchangeOrder,
    kind: ManualExchangeProofKind,
  ) => {
    setProofLoading(kind);
    const action = `proof-view:${kind}`;
    const idempotencyKey = getAttemptKey({ orderId: order.id, action });
    try {
      const response = await adminManualExchangeApi.getProofUrl(
        order.id,
        kind,
        idempotencyKey,
      );
      const url = response.data.url;
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) {
        throw new Error("The protected proof link is invalid");
      }
      window.open(url, "_blank", "noopener,noreferrer");
      clearAttemptKey({ orderId: order.id, action });
    } catch (error: unknown) {
      const message = getErrorMessage(
        error,
        "Could not open the protected proof",
      );
      toast.error(message);
    } finally {
      setProofLoading(null);
    }
  };

  if (authLoading || !user || !profile) {
    return (
      <DashboardLayout>
        <Skeleton className="h-72 w-full" />
      </DashboardLayout>
    );
  }

  if (!isAdmin) return null;

  const canReviewDeposit = selectedOrder
    ? isDepositReviewStatus(selectedOrder.status)
    : false;
  const selectedOrderExpired = selectedOrder
    ? isOrderExpired(selectedOrder)
    : false;
  const canClaimPayout = selectedOrder?.status === "PAYOUT_PENDING";
  const ownsPayoutClaim =
    Boolean(user.id) && selectedOrder?.payoutClaimedBy === user.id;
  const canMarkSent =
    selectedOrder?.status === "PAYOUT_PROCESSING" && ownsPayoutClaim;
  const canHandoverPayout =
    selectedOrder?.status === "PAYOUT_PROCESSING" &&
    Boolean(selectedOrder.payoutClaimedBy) &&
    !ownsPayoutClaim;
  const canComplete = selectedOrder?.status === "PAYOUT_SENT";
  const reviewDisabled =
    reviewMutation.isPending || uploadProofMutation.isPending;

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Exchange requests
              </h1>
              <Badge variant="secondary">
                Cedis ↔ Naira · Admin confirmation
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Verify incoming payments, send the quoted amount to the recorded
              bank or MoMo account, then record the completed payment here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/exchange/provider">Kora payment queue</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin?tab=exchange">
                <ArrowLeftRight className="size-4" />
                Rates & settlement
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Needs review
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {queueCounts.needsReview}
                </p>
              </div>
              <FileCheck2 className="size-5 text-amber-400" />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Payouts
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {queueCounts.payouts}
                </p>
              </div>
              <Landmark className="size-5 text-red-400" />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Completed
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {queueCounts.completed}
                </p>
              </div>
              <CheckCircle2 className="size-5 text-emerald-400" />
            </CardContent>
          </Card>
        </div>
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck
            className={
              latestReconciliation?.mismatchCount
                ? "size-4 text-amber-400"
                : "size-4 text-emerald-400"
            }
          />
          <span>
            Reconciliation:{" "}
            {reconciliationQuery.isLoading
              ? "checking…"
              : latestReconciliation
                ? `${latestReconciliation.checkedCount} checked · ${latestReconciliation.mismatchCount} mismatches`
                : "not run yet"}
          </span>
        </div>
        <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
          <Card className="min-w-0">
            <CardHeader className="gap-3 border-b border-border/80 pb-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <CardTitle>Review queue</CardTitle>
                  <CardDescription>
                    Select an order to view evidence and take action.
                  </CardDescription>
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(
                      value as (typeof ORDER_STATUS_FILTERS)[number],
                    );
                    resetActionState();
                    setSelectedOrderId(null);
                  }}
                >
                  <SelectTrigger
                    className="w-full sm:w-52"
                    aria-label="Filter manual exchange orders"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUS_FILTERS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status === "ALL"
                          ? "All statuses"
                          : statusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {ordersQuery.isError && ordersQuery.data && (
                <p
                  role="alert"
                  className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
                >
                  Refresh failed. Showing the last loaded requests; updates will
                  retry automatically.
                </p>
              )}
              {ordersQuery.isLoading ? (
                <div className="space-y-3 p-4">
                  {[1, 2, 3, 4].map((item) => (
                    <Skeleton key={item} className="h-16 w-full" />
                  ))}
                </div>
              ) : ordersQuery.isError && !ordersQuery.data ? (
                <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                  <CircleAlert className="size-6 text-red-400" />
                  <p className="text-sm text-muted-foreground">
                    Could not load the manual exchange queue.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void ordersQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                  <Clock3 className="size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">No orders in this view</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Try another status filter or wait for the queue to update.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Path</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Review</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orders.map((order) => {
                          const selected = order.id === selectedOrderId;
                          return (
                            <TableRow
                              key={order.id}
                              data-state={selected ? "selected" : undefined}
                              className={selected ? "bg-primary/5" : undefined}
                            >
                              <TableCell className="min-w-40">
                                <p className="font-mono text-xs font-medium">
                                  {order.reference}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatDate(order.createdAt)}
                                </p>
                              </TableCell>
                              <TableCell className="min-w-28">
                                <p className="font-mono text-xs">
                                  {order.userId.slice(0, 10)}…
                                </p>
                                {order.destinationInstitution && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {order.destinationInstitution}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {order.settlementMode}
                                </Badge>
                                {destinationPreview(order) && (
                                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                                    {destinationPreview(order)}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <p className="font-medium">
                                  {formatMoney(
                                    order.amount,
                                    order.sourceCurrency,
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  →{" "}
                                  {formatMoney(
                                    order.targetAmount,
                                    order.targetCurrency,
                                  )}
                                </p>
                              </TableCell>
                              <TableCell>
                                <Badge variant={statusVariant(order.status)}>
                                  {statusLabel(order.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant={selected ? "default" : "outline"}
                                  onClick={() => selectOrder(order.id)}
                                  aria-label={`Review ${order.reference}`}
                                >
                                  {selected ? "Selected" : "Review"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {ordersQuery.hasNextPage && (
                    <div className="border-t p-4">
                      <Button
                        variant="outline"
                        disabled={ordersQuery.isFetchingNextPage}
                        onClick={() => void ordersQuery.fetchNextPage()}
                      >
                        {ordersQuery.isFetchingNextPage
                          ? "Loading requests…"
                          : "Load more requests"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 self-start 2xl:sticky 2xl:top-24">
            {!selectedOrder ? (
              <CardContent className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                {deepLinkedOrderId && deepLinkState === "not-found" ? (
                  <>
                    <CircleAlert className="size-8 text-amber-400" />
                    <p className="font-medium">Order not found</p>
                    <p
                      className="max-w-sm text-sm text-muted-foreground"
                      data-testid="manual-order-deeplink-not-found"
                    >
                      We could not find this exchange request in the admin
                      queue. It may have been removed or you may not have access
                      to it.
                    </p>
                  </>
                ) : deepLinkedOrderId && deepLinkState === "error" ? (
                  <>
                    <CircleAlert className="size-8 text-red-400" />
                    <p className="font-medium">Exchange request unavailable</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      The requested order could not be loaded. Retry the queue
                      to try again.
                    </p>
                  </>
                ) : (
                  <>
                    <WalletCards className="size-8 text-muted-foreground" />
                    <p className="font-medium">Select an order to review</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Deposit evidence, payout details, and actions will appear
                      here.
                    </p>
                  </>
                )}
              </CardContent>
            ) : (
              <>
                <CardHeader className="border-b border-border/80 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate font-mono text-base">
                        {selectedOrder.reference}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        User {selectedOrder.userId}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={statusVariant(selectedOrder.status)}
                      className="shrink-0"
                    >
                      {statusLabel(selectedOrder.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div
                      className={`rounded-xl border p-3 ${statusTone(selectedOrder.status)}`}
                    >
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        Deposit
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {formatMoney(
                          selectedOrder.amount,
                          selectedOrder.sourceCurrency,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Expected{" "}
                        {formatMoney(
                          selectedOrder.targetAmount,
                          selectedOrder.targetCurrency,
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {`Rate (${selectedOrder.targetCurrency} per ${selectedOrder.sourceCurrency})`}
                      </p>
                      <p className="mt-1 text-lg font-semibold">
                        {selectedOrder.rate}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fee{" "}
                        {formatMoney(
                          selectedOrder.fee,
                          selectedOrder.sourceCurrency,
                        )}
                      </p>
                    </div>
                  </div>

                  {selectedOrderExpired && canReviewDeposit && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      <p>
                        This order is past its quoted expiry. Deposit
                        confirmation requires an explicit attestation to honor
                        the original frozen terms.
                      </p>
                    </div>
                  )}

                  <dl className="grid gap-4 rounded-xl border border-border bg-muted/10 p-4 sm:grid-cols-2">
                    <DetailValue
                      label="Settlement mode"
                      value={humanize(selectedOrder.settlementMode)}
                    />
                    <DetailValue
                      label="Expires"
                      value={formatDate(selectedOrder.expiresAt)}
                    />
                    <DetailValue
                      label="Created"
                      value={formatDate(selectedOrder.createdAt)}
                    />
                    <DetailValue
                      label="Collection bank"
                      value={selectedOrder.collectionAccount.bankName}
                    />
                    <DetailValue
                      label="Collection account"
                      value={`${selectedOrder.collectionAccount.accountName} · ${selectedOrder.collectionAccount.accountNumber}`}
                      mono
                    />
                    {selectedOrder.destinationInstitution && (
                      <DetailValue
                        label="Destination institution"
                        value={selectedOrder.destinationInstitution}
                      />
                    )}
                    {selectedOrder.destinationAccount && (
                      <DetailValue
                        label="Destination account"
                        value={selectedOrder.destinationAccount}
                        mono
                      />
                    )}
                    {selectedOrder.destinationName && (
                      <DetailValue
                        label="Destination name"
                        value={selectedOrder.destinationName}
                      />
                    )}
                    {selectedOrder.bankReference && (
                      <DetailValue
                        label="Customer bank reference"
                        value={selectedOrder.bankReference}
                        mono
                      />
                    )}
                    {selectedOrder.depositReference && (
                      <DetailValue
                        label="Verified deposit reference"
                        value={selectedOrder.depositReference}
                        mono
                      />
                    )}
                    {selectedOrder.payoutReference && (
                      <DetailValue
                        label="Payout reference"
                        value={selectedOrder.payoutReference}
                        mono
                      />
                    )}
                  </dl>

                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-start gap-3">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium">
                          Protected evidence
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Links expire and are fetched only after this admin
                          request. Object keys and signed URLs are never shown
                          in the queue.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedOrder.hasProof ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void openProtectedProof(selectedOrder, "DEPOSIT")
                          }
                          disabled={proofLoading !== null}
                        >
                          {proofLoading === "DEPOSIT" ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                          View deposit receipt
                        </Button>
                      ) : (
                        <Badge variant="outline">
                          No deposit receipt attached
                        </Badge>
                      )}
                      {selectedOrder.hasPayoutProof && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void openProtectedProof(selectedOrder, "PAYOUT")
                          }
                          disabled={proofLoading !== null}
                        >
                          {proofLoading === "PAYOUT" ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                          View payout proof
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Audit timeline</p>
                      <Badge variant="outline">
                        {selectedOrder.events.length} events
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {selectedOrder.events.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No events recorded yet.
                        </p>
                      ) : (
                        selectedOrder.events.map((event, index) => (
                          <div
                            key={`${event.createdAt}-${event.status}-${index}`}
                            className="flex gap-3 text-sm"
                          >
                            <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                              {index === selectedOrder.events.length - 1 ? (
                                <Clock3 className="size-3 text-primary" />
                              ) : (
                                <CheckCircle2 className="size-3 text-emerald-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium">
                                {statusLabel(event.status)}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {event.reason}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatDate(event.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {selectedOrder.reviewReason && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                      <div className="flex items-start gap-2">
                        <Info className="mt-0.5 size-4 shrink-0 text-amber-300" />
                        <div>
                          <p className="font-medium">Latest review reason</p>
                          <p className="mt-1 text-muted-foreground">
                            {selectedOrder.reviewReason}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Available actions
                    </p>
                    {selectedOrder.sourceCurrency === "GHS" &&
                      selectedOrder.targetCurrency === "NGN" &&
                      selectedOrder.settlementMode === "WALLET" && (
                        <p className="text-sm text-muted-foreground">
                          Confirm only after the cedis appear in your statement.
                          The frozen naira amount will be credited to this
                          customer’s TrustPay wallet.
                        </p>
                      )}
                    {selectedOrder.sourceCurrency === "NGN" &&
                      selectedOrder.targetCurrency === "GHS" &&
                      selectedOrder.settlementMode !== "WALLET" && (
                        <p className="text-sm text-muted-foreground">
                          Claim this order before paying. Send the exact cedi
                          amount through your bank or MoMo app, then record the
                          completed transfer below. Do not send again after a
                          page error.
                        </p>
                      )}
                    {selectedOrder.payoutWorkflow === "ADMIN_EXTERNAL" && (
                      <p className="text-sm text-muted-foreground">
                        Claim this order before paying. Send the exact naira
                        amount to the recorded Nigerian bank beneficiary through
                        your business bank, then record the completed transfer
                        below. Do not send again after a page error.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {canReviewDeposit && (
                        <>
                          <Button
                            onClick={() =>
                              openAction(
                                selectedOrder.settlementMode === "WALLET"
                                  ? "CREDIT_WALLET"
                                  : "CONFIRM_DEPOSIT",
                              )
                            }
                            disabled={reviewDisabled}
                          >
                            {selectedOrder.settlementMode === "WALLET"
                              ? selectedOrder.sourceCurrency === "GHS" &&
                                selectedOrder.targetCurrency === "NGN"
                                ? "Confirm cedis & credit naira"
                                : "Approve & credit wallet"
                              : selectedOrder.sourceCurrency === "NGN"
                                ? "Confirm naira received"
                                : "Confirm cedis received"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => openAction("REQUEST_INFO")}
                            disabled={reviewDisabled}
                          >
                            Request info
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => openAction("REJECT")}
                            disabled={reviewDisabled}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {canClaimPayout && (
                        <Button
                          onClick={() => openAction("CLAIM_PAYOUT")}
                          disabled={reviewDisabled}
                        >
                          {selectedOrder.targetCurrency === "GHS"
                            ? "Start cedi transfer"
                            : selectedOrder.payoutWorkflow === "ADMIN_EXTERNAL"
                              ? "Start naira transfer"
                              : "Claim payout"}
                        </Button>
                      )}
                      {selectedOrder.status === "PAYOUT_PROCESSING" &&
                        !ownsPayoutClaim && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            <CircleAlert className="mt-0.5 size-4 shrink-0" />
                            <span>
                              {selectedOrder.payoutClaimedBy
                                ? "This payout is claimed by another admin. Check the real bank/MoMo outcome before a supervised handover; an unknown outcome must not be reassigned."
                                : "Claim ownership is required before sending evidence."}
                            </span>
                          </div>
                        )}
                      {canHandoverPayout && (
                        <Button
                          variant="outline"
                          onClick={() => openAction("HANDOVER_PAYOUT")}
                          disabled={reviewDisabled}
                        >
                          <ShieldCheck className="size-4" />
                          Supervised handover
                        </Button>
                      )}
                      {canMarkSent && (
                        <Button
                          onClick={() =>
                            openAction(
                              selectedOrder.sourceCurrency === "NGN" &&
                                selectedOrder.targetCurrency === "GHS"
                                ? "RECORD_CEDIS_SENT"
                                : selectedOrder.payoutWorkflow ===
                                    "ADMIN_EXTERNAL"
                                  ? "RECORD_PAYOUT_SENT"
                                  : "MARK_SENT",
                            )
                          }
                          disabled={reviewDisabled}
                        >
                          {selectedOrder.sourceCurrency === "NGN" &&
                          selectedOrder.targetCurrency === "GHS"
                            ? "I sent the cedis"
                            : selectedOrder.payoutWorkflow === "ADMIN_EXTERNAL"
                              ? "I sent the naira"
                              : "Mark sent"}
                        </Button>
                      )}
                      {canComplete && (
                        <Button
                          onClick={() => openAction("COMPLETE")}
                          disabled={reviewDisabled}
                        >
                          Complete
                        </Button>
                      )}
                      {!canReviewDeposit &&
                        !canClaimPayout &&
                        !canHandoverPayout &&
                        !canMarkSent &&
                        !canComplete &&
                        selectedOrder.status !== "PAYOUT_PROCESSING" && (
                          <p className="text-sm text-muted-foreground">
                            No action is available for this status.
                          </p>
                        )}
                    </div>
                  </div>

                  {actionPanel && (
                    <form
                      className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitReview();
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {actionLabel(actionPanel, selectedOrder)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          This action is recorded in the append-only order
                          timeline. Network errors leave the same idempotency
                          key ready for retry.
                        </p>
                      </div>

                      {["CREDIT_WALLET", "CONFIRM_DEPOSIT"].includes(
                        actionPanel,
                      ) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="manual-deposit-reference">
                              Actual deposit reference
                            </Label>
                            <Input
                              id="manual-deposit-reference"
                              value={depositReference}
                              onChange={(event) =>
                                setDepositReference(event.target.value)
                              }
                              placeholder="Reference from the received bank or MoMo payment"
                              maxLength={120}
                              disabled={reviewMutation.isPending}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="manual-actual-amount">
                              Actual deposit amount
                            </Label>
                            <Input
                              id="manual-actual-amount"
                              inputMode="decimal"
                              value={actualAmount}
                              onChange={(event) =>
                                setActualAmount(event.target.value)
                              }
                              placeholder={`Exact ${selectedOrder.sourceCurrency} inflow`}
                              maxLength={40}
                              disabled={reviewMutation.isPending}
                            />
                          </div>
                        </div>
                      )}

                      {["CREDIT_WALLET", "CONFIRM_DEPOSIT"].includes(
                        actionPanel,
                      ) &&
                        selectedOrderExpired && (
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                            <input
                              type="checkbox"
                              checked={acceptExpiredQuote}
                              onChange={(event) =>
                                setAcceptExpiredQuote(event.target.checked)
                              }
                              disabled={reviewMutation.isPending}
                              className="mt-0.5 size-4 shrink-0 accent-amber-500"
                            />
                            <span>
                              <span className="flex items-center gap-1.5 font-medium text-amber-100">
                                <CircleAlert className="size-4" />
                                Honor the original quoted amount for this
                                expired order
                              </span>
                              <span className="mt-1 block text-xs text-amber-100/75">
                                Record the actual deposit and preserve the
                                frozen rate. This does not reprice the order.
                              </span>
                            </span>
                          </label>
                        )}

                      {actionPanel === "HANDOVER_PAYOUT" && (
                        <div className="space-y-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                          <div className="space-y-2">
                            <Label htmlFor="manual-handover-admin">
                              Receiving administrator
                            </Label>
                            <Select
                              value={handoverToAdminId}
                              onValueChange={setHandoverToAdminId}
                              disabled={reviewDisabled}
                            >
                              <SelectTrigger id="manual-handover-admin">
                                <SelectValue placeholder="Choose an active admin" />
                              </SelectTrigger>
                              <SelectContent>
                                {handoverAdmins.map((admin) => (
                                  <SelectItem key={admin.id} value={admin.id}>
                                    {admin.fullName?.trim() || admin.email}
                                    {admin.fullName?.trim()
                                      ? ` · ${admin.email}`
                                      : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {handoverAdmins.length === 0 && (
                              <p className="text-xs text-amber-100/80">
                                No other active administrator is available. Do
                                not release this claim manually.
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="manual-payout-outcome">
                              Real-world payout outcome
                            </Label>
                            <Select
                              value={payoutOutcome}
                              onValueChange={(value) =>
                                setPayoutOutcome(
                                  value as AdminManualExchangePayoutOutcome,
                                )
                              }
                              disabled={reviewDisabled}
                            >
                              <SelectTrigger id="manual-payout-outcome">
                                <SelectValue placeholder="Choose the checked outcome" />
                              </SelectTrigger>
                              <SelectContent>
                                {(
                                  [
                                    "NOT_SENT",
                                    "CONFIRMED_FAILED",
                                    "ALREADY_SENT",
                                  ] as const
                                ).map((outcome) => (
                                  <SelectItem key={outcome} value={outcome}>
                                    {payoutOutcomeLabel(outcome)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              An unknown or pending provider result cannot be
                              handed over or resent. Reconcile the original
                              claim first.
                            </p>
                          </div>
                        </div>
                      )}

                      {(actionPanel === "MARK_SENT" ||
                        actionPanel === "RECORD_CEDIS_SENT" ||
                        actionPanel === "RECORD_PAYOUT_SENT" ||
                        actionPanel === "HANDOVER_PAYOUT") && (
                        <div className="space-y-4">
                          {(actionPanel === "RECORD_CEDIS_SENT" ||
                            actionPanel === "RECORD_PAYOUT_SENT") && (
                            <div className="space-y-2">
                              <p className="text-sm text-muted-foreground">
                                Record the completed transfer to this recipient.
                                This button does not send money.
                              </p>
                              <Label htmlFor="manual-payout-amount">
                                {actionPanel === "RECORD_PAYOUT_SENT"
                                  ? "Naira actually sent"
                                  : "Cedis actually sent"}
                              </Label>
                              <Input
                                id="manual-payout-amount"
                                value={payoutAmount}
                                onChange={(event) =>
                                  setPayoutAmount(event.target.value)
                                }
                                inputMode="decimal"
                                maxLength={16}
                                placeholder={selectedOrder.targetAmount}
                                disabled={reviewDisabled}
                              />
                            </div>
                          )}
                          {(actionPanel !== "HANDOVER_PAYOUT" ||
                            payoutOutcome === "ALREADY_SENT") && (
                            <div className="space-y-2">
                              <Label htmlFor="manual-payout-reference">
                                {actionPanel === "HANDOVER_PAYOUT"
                                  ? "Confirmed payout reference"
                                  : "Actual payout reference"}
                              </Label>
                              <Input
                                id="manual-payout-reference"
                                value={payoutReference}
                                onChange={(event) =>
                                  setPayoutReference(event.target.value)
                                }
                                placeholder={
                                  actionPanel === "HANDOVER_PAYOUT"
                                    ? "Reference from the settled transfer"
                                    : "Reference from the external transfer"
                                }
                                maxLength={120}
                                disabled={
                                  reviewMutation.isPending ||
                                  uploadProofMutation.isPending
                                }
                              />
                            </div>
                          )}
                          {actionPanel === "HANDOVER_PAYOUT" &&
                            payoutOutcome === "ALREADY_SENT" && (
                              <div className="space-y-2">
                                <Label htmlFor="manual-payout-amount">
                                  Exact amount already sent
                                </Label>
                                <Input
                                  id="manual-payout-amount"
                                  value={payoutAmount}
                                  onChange={(event) =>
                                    setPayoutAmount(event.target.value)
                                  }
                                  inputMode="decimal"
                                  maxLength={16}
                                  placeholder={selectedOrder.targetAmount}
                                  disabled={reviewDisabled}
                                />
                              </div>
                            )}
                          <div className="space-y-2">
                            <Label htmlFor="manual-payout-proof">
                              Protected payout proof
                            </Label>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Input
                                id="manual-payout-proof"
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                onChange={(event) => {
                                  const file = event.target.files?.[0] ?? null;
                                  if (
                                    selectedOrder &&
                                    payoutProofFile &&
                                    file &&
                                    (payoutProofFile.name !== file.name ||
                                      payoutProofFile.type !== file.type ||
                                      payoutProofFile.size !== file.size ||
                                      payoutProofFile.lastModified !==
                                        file.lastModified)
                                  ) {
                                    clearAttemptKey({
                                      orderId: selectedOrder.id,
                                      action:
                                        actionPanel === "HANDOVER_PAYOUT"
                                          ? "upload:handover-payout-proof"
                                          : "upload:payout-proof",
                                    });
                                  }
                                  setPayoutProofFile(file);
                                  setPayoutProofObjectKey(null);
                                  setFormError(
                                    file ? validateUpload(file) : null,
                                  );
                                }}
                                disabled={
                                  reviewMutation.isPending ||
                                  uploadProofMutation.isPending
                                }
                                className="h-auto py-1.5 text-xs"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={uploadPayoutProof}
                                disabled={
                                  !payoutProofFile ||
                                  uploadProofMutation.isPending ||
                                  reviewMutation.isPending
                                }
                                className="shrink-0"
                              >
                                {uploadProofMutation.isPending ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  <Upload className="size-4" />
                                )}
                                {payoutProofObjectKey
                                  ? "Uploaded"
                                  : "Upload proof"}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              JPEG, PNG, WebP, or PDF up to 8 MiB. The signed
                              upload request carries no API bearer token.
                            </p>
                            {payoutProofObjectKey && (
                              <p className="flex items-center gap-1.5 text-xs text-emerald-300">
                                <CheckCircle2 className="size-3.5" />
                                Proof uploaded and ready to attach to this
                                action.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="manual-review-reason">Reason</Label>
                        <textarea
                          id="manual-review-reason"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="Record what you verified and why this action is approved."
                          minLength={10}
                          maxLength={500}
                          rows={4}
                          disabled={reviewMutation.isPending}
                          className="flex min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                        />
                        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                          <span>10–500 characters</span>
                          <span>{reason.length}/500</span>
                        </div>
                      </div>

                      {formError && (
                        <p
                          role="alert"
                          className="flex items-start gap-2 text-sm text-red-300"
                        >
                          <XCircle className="mt-0.5 size-4 shrink-0" />
                          {formError}
                        </p>
                      )}

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setActionPanel(null)}
                          disabled={
                            reviewMutation.isPending ||
                            uploadProofMutation.isPending
                          }
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          variant={
                            actionPanel === "REJECT" ? "destructive" : "default"
                          }
                          disabled={
                            reviewMutation.isPending ||
                            uploadProofMutation.isPending
                          }
                        >
                          {reviewMutation.isPending ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : actionPanel === "REJECT" ? (
                            <XCircle className="size-4" />
                          ) : (
                            <CheckCircle2 className="size-4" />
                          )}
                          {reviewMutation.isPending
                            ? "Saving…"
                            : actionLabel(actionPanel, selectedOrder)}
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

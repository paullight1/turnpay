"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { createMoneyAttemptIdempotencyKey } from "@/lib/idempotency";
import {
  adminInternalTransferReversalApi,
  type AdminInternalTransferReversal,
} from "@/services/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReviewAction = "approve" | "reject";

const money = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

function formatMoney(value: string | number, currency: "NGN" | "GHS") {
  return money.formatToParts(Number(value)).map((part) =>
    part.type === "currency" ? currency : part.value,
  ).join("");
}

function statusVariant(status: AdminInternalTransferReversal["status"]) {
  if (status === "COMPLETED") return "default" as const;
  if (status === "PENDING_APPROVAL") return "secondary" as const;
  return "destructive" as const;
}

export function InternalTransferReversalQueue() {
  const queryClient = useQueryClient();
  const [reference, setReference] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestAttemptKey, setRequestAttemptKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminInternalTransferReversal | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reviewAttemptKey, setReviewAttemptKey] = useState<string | null>(null);

  const reversalsQuery = useQuery({
    queryKey: ["admin-internal-transfer-reversals"],
    queryFn: async () => (await adminInternalTransferReversalApi.list()).data,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const requestMutation = useMutation({
    mutationFn: (input: { key: string }) =>
      adminInternalTransferReversalApi.request(
        reference.trim(),
        { reason: requestReason.trim() },
        input.key,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-internal-transfer-reversals"],
      });
      setReference("");
      setRequestReason("");
      setRequestAttemptKey(null);
      toast.success("Reversal request queued for independent approval");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Could not request reversal"));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { key: string; action: ReviewAction }) => {
      if (!selected) throw new Error("No reversal selected");
      const data = { reason: reviewReason.trim() };
      return input.action === "approve"
        ? adminInternalTransferReversalApi.approve(selected.id, data, input.key)
        : adminInternalTransferReversalApi.reject(selected.id, data, input.key);
    },
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-internal-transfer-reversals"],
      });
      toast.success(
        input.action === "approve"
          ? "Reversal approval processed"
          : "Reversal request rejected",
      );
      closeReview();
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Could not review reversal"));
    },
  });

  const submitRequest = () => {
    if (!reference.trim() || requestReason.trim().length < 10) {
      toast.error("Enter a transfer reference and a reason of at least 10 characters");
      return;
    }
    const key =
      requestAttemptKey ?? createMoneyAttemptIdempotencyKey("transfer-reversal");
    if (!requestAttemptKey) setRequestAttemptKey(key);
    requestMutation.mutate({ key });
  };

  const openReview = (
    reversal: AdminInternalTransferReversal,
    action: ReviewAction,
  ) => {
    setSelected(reversal);
    setReviewAction(action);
    setReviewReason("");
    setConfirmation("");
    setReviewAttemptKey(createMoneyAttemptIdempotencyKey(`reversal-${action}`));
  };

  const closeReview = () => {
    if (reviewMutation.isPending) return;
    setSelected(null);
    setReviewAction(null);
    setReviewReason("");
    setConfirmation("");
    setReviewAttemptKey(null);
  };

  const submitReview = () => {
    if (!reviewAction || !reviewAttemptKey) return;
    const expected = reviewAction === "approve" ? "APPROVE" : "REJECT";
    if (reviewReason.trim().length < 10 || confirmation !== expected) {
      toast.error(`Enter a reason and type ${expected} to confirm`);
      return;
    }
    reviewMutation.mutate({ key: reviewAttemptKey, action: reviewAction });
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="size-5" />
            Internal transfer reversals
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reversalsQuery.refetch()}
            disabled={reversalsQuery.isFetching}
          >
            <RefreshCw className={reversalsQuery.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Full, append-only reversals require a second administrator. Original ledger entries never change.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="reversal-reference">Original transfer reference</Label>
            <Input
              id="reversal-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="IT-…"
              disabled={requestMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reversal-request-reason">Operations case and reason</Label>
            <Input
              id="reversal-request-reason"
              value={requestReason}
              onChange={(event) => setRequestReason(event.target.value)}
              placeholder="OPS-1234 — customer dispute confirmed"
              disabled={requestMutation.isPending}
            />
          </div>
          <Button onClick={submitRequest} disabled={requestMutation.isPending}>
            {requestMutation.isPending ? "Submitting…" : "Request reversal"}
          </Button>
        </div>

        {reversalsQuery.isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((row) => <Skeleton key={row} className="h-12 w-full" />)}
          </div>
        ) : reversalsQuery.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
            <p className="font-medium">Could not load the reversal queue.</p>
            <p className="mt-1 text-muted-foreground">
              {getErrorMessage(reversalsQuery.error, "Retry the queue request")}
            </p>
          </div>
        ) : (reversalsQuery.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No reversal requests have been recorded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reversalsQuery.data?.map((reversal) => (
                  <TableRow key={reversal.id}>
                    <TableCell className="font-mono text-xs">
                      {reversal.originalTransferReference}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {formatMoney(reversal.amount, reversal.currency)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {reversal.requesterAdminId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(reversal.status)}>
                        {reversal.status.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(reversal.requestedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => openReview(reversal, "approve")}
                          disabled={reversal.status !== "PENDING_APPROVAL"}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openReview(reversal, "reject")}
                          disabled={reversal.status !== "PENDING_APPROVAL"}
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(selected && reviewAction)} onOpenChange={(open) => !open && closeReview()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "Approve full reversal" : "Reject reversal request"}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve"
                ? "This will debit the recipient and credit the sender in one transaction. Partial and force-negative reversals are not supported."
                : "Rejection records the review decision without moving money."}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div><p className="text-muted-foreground">Amount</p><p className="font-semibold tabular-nums">{formatMoney(selected.amount, selected.currency)}</p></div>
                <div><p className="text-muted-foreground">Transfer</p><p className="font-mono text-xs">{selected.originalTransferReference}</p></div>
                <div><p className="text-muted-foreground">Sender</p><p className="font-mono text-xs">{selected.senderUserId}</p></div>
                <div><p className="text-muted-foreground">Recipient</p><p className="font-mono text-xs">{selected.recipientUserId}</p></div>
                <div><p className="text-muted-foreground">Requester</p><p className="font-mono text-xs">{selected.requesterAdminId}</p></div>
                <div><p className="text-muted-foreground">Request reason</p><p>{selected.requestReason}</p></div>
              </div>
              {reviewAction === "approve" ? (
                <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
                  <p>Confirm the case independently. If the recipient lacks the full amount, the request becomes blocked and no sender credit is posted.</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="reversal-review-reason">Independent review reason</Label>
                <textarea
                  id="reversal-review-reason"
                  className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  disabled={reviewMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reversal-confirmation">
                  Type {reviewAction === "approve" ? "APPROVE" : "REJECT"} to confirm
                </Label>
                <Input
                  id="reversal-confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={reviewMutation.isPending}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeReview} disabled={reviewMutation.isPending}>Cancel</Button>
            <Button
              variant={reviewAction === "reject" ? "destructive" : "default"}
              onClick={submitReview}
              disabled={
                reviewMutation.isPending ||
                reviewReason.trim().length < 10 ||
                confirmation !== (reviewAction === "approve" ? "APPROVE" : "REJECT")
              }
            >
              {reviewMutation.isPending
                ? "Processing…"
                : reviewAction === "approve"
                  ? "Approve full reversal"
                  : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

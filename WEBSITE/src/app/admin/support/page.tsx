"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-provider";
import { getErrorMessage } from "@/lib/errors";
import { supportApi } from "@/services/api";
import type { SupportTicket } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type AdminSupportResponse = {
  tickets: SupportTicket[];
  total: number;
  page: number;
  totalPages: number;
};

const statusFilters = ["ALL", "OPEN", "UNDER_REVIEW", "ESCALATED", "RESOLVED", "CLOSED"];
const actionStatuses = ["RESOLVED", "CLOSED", "ESCALATED"] as const;

function statusVariant(status: string) {
  if (status === "RESOLVED") return "default";
  if (status === "ESCALATED" || status === "UNDER_REVIEW") return "secondary";
  if (status === "CLOSED") return "outline";
  return "secondary";
}

function maskTail(value?: string, visible = 4) {
  if (!value) return "Not provided";
  if (value.length <= visible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(4, value.length - visible))}${value.slice(-visible)}`;
}

export default function AdminSupportPage() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN" || profile?.role === "ADMIN";
  const [status, setStatus] = useState("OPEN");
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [actionStatus, setActionStatus] = useState<(typeof actionStatuses)[number]>("RESOLVED");
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    if (
      !authLoading &&
      user &&
      profile &&
      user.role !== "ADMIN" &&
      profile.role !== "ADMIN"
    ) {
      router.push("/dashboard");
    }
  }, [authLoading, profile, user, router]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-support-tickets", status],
    queryFn: async () => {
      const res = await supportApi.getAdminTickets(
        1,
        50,
        status === "ALL" ? undefined : status,
      );
      return res.data as AdminSupportResponse;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) throw new Error("No support ticket selected");
      return supportApi.resolveAdminTicket(selectedTicket.id, {
        status: actionStatus,
        resolution: resolution.trim() || undefined,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      setSelectedTicket(null);
      setReason("");
      setResolution("");
      setActionStatus("RESOLVED");
      toast.success("Support ticket updated");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not update support ticket"));
    },
  });

  if (authLoading || !user || !profile) {
    return (
      <DashboardLayout>
        <Skeleton className="h-72 w-full" />
      </DashboardLayout>
    );
  }

  if (!isAdmin) return null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-semibold">Support queue</h1>
            <p className="mt-1 text-muted-foreground">
              Review customer care cases for payments, VTU, exchange, KYC, and account access.
            </p>
          </div>
          <div className="w-full md:w-56">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusFilters.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cases ({data?.total ?? 0})
              {isFetching && !isLoading && (
                <span className="text-xs font-normal text-muted-foreground">
                  Refreshing…
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Admin decisions require a reason and are written to the audit log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((item) => (
                  <Skeleton key={item} className="h-12 w-full" />
                ))}
              </div>
            ) : data?.tickets.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                No support cases for this filter
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{ticket.user?.email}</p>
                          <p className="text-sm text-muted-foreground">
                            {maskTail(ticket.user?.phone)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{ticket.type}</p>
                        <p className="max-w-xs truncate text-sm text-muted-foreground">
                          {ticket.description}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {ticket.transaction?.reference || "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(ticket.status)}>
                          {ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(ticket.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setResolution(ticket.resolution || "");
                          }}
                        >
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selectedTicket && (
          <Card>
            <CardHeader>
              <CardTitle>Review support case</CardTitle>
              <CardDescription>
                Case {selectedTicket.id} for {selectedTicket.user?.email}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <p className="font-medium">{selectedTicket.type}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Transaction</p>
                  <p className="font-mono text-sm">
                    {selectedTicket.transaction?.reference || "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current status</p>
                  <Badge variant={statusVariant(selectedTicket.status)}>
                    {selectedTicket.status}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-6">
                {selectedTicket.description}
              </div>

              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="flex flex-col gap-2">
                  <Label>Decision</Label>
                  <Select
                    value={actionStatus}
                    onValueChange={(value) =>
                      setActionStatus(value as (typeof actionStatuses)[number])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {actionStatuses.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Admin reason</Label>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                    placeholder="Required for audit log"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for the audit log. Minimum 10 characters
                    {reason.trim().length > 0 && reason.trim().length < 10
                      ? ` (${10 - reason.trim().length} more needed).`
                      : "."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Customer-facing resolution</Label>
                <textarea
                  className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  placeholder="Explain what support checked or what happens next."
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => resolveMutation.mutate()}
                  disabled={resolveMutation.isPending || reason.trim().length < 10}
                >
                  {resolveMutation.isPending ? "Saving..." : "Save decision"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedTicket(null);
                    setReason("");
                    setResolution("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

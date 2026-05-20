"use client";

import { FormEvent, useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/errors";
import { supportApi } from "@/services/api";
import type { SupportTicket } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const supportCategories = [
  { value: "ACCOUNT", label: "Account access" },
  { value: "KYC", label: "KYC and limits" },
  { value: "WALLET", label: "Wallet balance" },
  { value: "TRANSACTION", label: "Transaction status" },
  { value: "WITHDRAWAL", label: "Withdrawal" },
  { value: "EXCHANGE", label: "Exchange" },
  { value: "VTU", label: "Airtime, data, bills" },
  { value: "OTHER", label: "Other" },
];

type SupportTicketsResponse = {
  tickets: SupportTicket[];
  total: number;
  page: number;
  totalPages: number;
};

function statusVariant(status: string) {
  if (status === "RESOLVED") return "default";
  if (status === "ESCALATED" || status === "UNDER_REVIEW") return "secondary";
  if (status === "CLOSED") return "outline";
  return "secondary";
}

export default function DashboardSupportPage() {
  const [category, setCategory] = useState("TRANSACTION");
  const [transactionReference, setTransactionReference] = useState("");
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: async () => {
      const res = await supportApi.getTickets(1, 10);
      return res.data as SupportTicketsResponse;
    },
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      supportApi.createTicket({
        category,
        description,
        transactionReference: transactionReference.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setTransactionReference("");
      setDescription("");
      toast.success("Support case sent to customer care");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Could not create support case"));
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (description.trim().length < 20) {
      toast.error("Describe the issue in at least 20 characters");
      return;
    }
    createMutation.mutate();
  };

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-semibold">Customer care</h1>
            <p className="mt-1 text-muted-foreground">
              Send payment, VTU, exchange, KYC, and account issues to the admin support queue.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit">
            <ShieldCheck className="mr-1 size-3.5" />
            Never share OTPs or passwords
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="size-5 text-primary" />
                Open a support case
              </CardTitle>
              <CardDescription>
                Use the transaction reference when the issue is tied to a payment or bill.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-2">
                  <Label>Issue type</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose issue type" />
                    </SelectTrigger>
                    <SelectContent>
                      {supportCategories.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="support-reference">Transaction reference</Label>
                  <Input
                    id="support-reference"
                    value={transactionReference}
                    onChange={(event) => setTransactionReference(event.target.value)}
                    placeholder="Optional, for example WD-..."
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="support-description">What happened?</Label>
                  <textarea
                    id="support-description"
                    className="min-h-36 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe the issue, amount, date, and masked account or phone details. Do not include passwords or OTPs."
                  />
                </div>

                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Sending..." : "Send to customer care"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent cases</CardTitle>
              <CardDescription>
                Customer care updates appear here after admin review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-24 w-full" />
                  ))}
                </div>
              ) : data?.tickets.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No support cases yet
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.tickets.map((ticket) => (
                    <div key={ticket.id} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{ticket.type}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {ticket.transaction?.reference || "No transaction reference"}
                          </p>
                        </div>
                        <Badge variant={statusVariant(ticket.status)}>
                          {ticket.status}
                        </Badge>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                        {ticket.description}
                      </p>
                      {ticket.resolution && (
                        <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                          {ticket.resolution}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

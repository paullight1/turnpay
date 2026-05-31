"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-provider";
import { apiClient } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { maskEmail, maskKycId, maskPhone } from "@/lib/privacy";
import type { KycDocument } from "@/types";

type AdminKycDocument = KycDocument & {
  documentUrl?: string;
  createdAt: string;
  user?: {
    email?: string;
    phone?: string;
    kycStatus?: string;
    kycTier?: string | number | null;
  };
};

type AdminKycResponse = {
  documents: AdminKycDocument[];
  total: number;
  page: number;
  totalPages: number;
};

const statusVariants: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "secondary",
  SUBMITTED: "default",
  VERIFIED: "default",
  APPROVED: "default",
  REJECTED: "destructive",
  FAILED: "destructive",
  REVIEW_REQUIRED: "outline",
};

function humanize(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "Not set";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTier(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "Tier 0";
  const tier = String(value).replace(/^TIER[_\s-]?/i, "");
  return `Tier ${tier}`;
}

function statusVariant(status?: string | null) {
  return statusVariants[status ?? ""] ?? "secondary";
}

function documentTypeLabel(type: string) {
  return humanize(type).toLowerCase();
}

function verificationLine(doc: AdminKycDocument) {
  const providerStatus = doc.verificationStatus ?? doc.providerStatus;
  const manualReview =
    doc.manualReviewStatus ??
    (doc.manualReviewRequired || doc.requiresManualReview ? "pending" : null);

  if (!providerStatus && !manualReview) return "Awaiting review";
  if (providerStatus && manualReview) {
    return `Provider ${humanize(providerStatus)}; manual ${humanize(manualReview)}`;
  }
  if (providerStatus) return `Provider ${humanize(providerStatus)}`;
  return `Manual ${humanize(manualReview)}`;
}

export default function AdminKycPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN";
  const [page, setPage] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState<AdminKycDocument | null>(null);
  const [reviewDocumentUrl, setReviewDocumentUrl] = useState<string | null>(null);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [pendingReviewStatus, setPendingReviewStatus] = useState<"VERIFIED" | "REJECTED" | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push("/dashboard");
    }
  }, [authLoading, isAdmin, router]);

  const { data: kycData, isLoading } = useQuery({
    queryKey: ["admin-kyc", page],
    queryFn: async () => {
      const res = await apiClient.get(
        `/api/admin/kyc/pending?page=${page}&limit=20`,
      );
      return res.data as AdminKycResponse;
    },
    enabled: isAdmin,
    staleTime: 30000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      documentId,
      status,
      rejectionNote,
    }: {
      documentId: string;
      status: string;
      rejectionNote?: string;
    }) => {
      const res = await apiClient.put(`/api/admin/kyc/${documentId}/review`, {
        status,
        rejectionNote,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-kyc"] });
      setSelectedDoc(null);
      setReviewDocumentUrl(null);
      setReviewReason("");
      setPendingReviewStatus(null);
      toast.success("KYC document reviewed successfully");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Failed to review KYC"));
    },
  });

  if (authLoading || !user || isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!isAdmin) {
    return null;
  }

  const requestReview = (status: "VERIFIED" | "REJECTED") => {
    if (!reviewReason.trim()) {
      toast.error("Enter a review reason before continuing");
      return;
    }

    setPendingReviewStatus(status);
  };

  const openDocumentForReview = async (doc: AdminKycDocument) => {
    setSelectedDoc(doc);
    setReviewDocumentUrl(null);
    setReviewReason("");
    setPendingReviewStatus(null);
    setLoadingDocumentId(doc.id);

    try {
      const res = await apiClient.post(`/api/admin/kyc/${doc.id}/document-url`);
      setReviewDocumentUrl(res.data.documentUrl);
    } catch (error: unknown) {
      setSelectedDoc(null);
      toast.error(getErrorMessage(error, "Failed to open KYC document"));
    } finally {
      setLoadingDocumentId(null);
    }
  };

  const confirmReview = () => {
    if (!selectedDoc || !pendingReviewStatus) return;

    reviewMutation.mutate({
      documentId: selectedDoc.id,
      status: pendingReviewStatus,
      rejectionNote: reviewReason.trim(),
    });
  };

  return (
    <DashboardLayout>
      <header className="hidden border-b bg-background">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <span className="text-xl font-bold text-primary">
            TrustPay Admin — KYC Review
          </span>
          <Button variant="outline" onClick={() => window.history.back()}>
            Back to Admin
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-semibold">KYC review</h1>
            <p className="mt-1 text-muted-foreground">
              Review submitted identity documents with masked user details.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending KYC Documents ({kycData?.total || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {kycData?.documents?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No pending KYC documents
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>User KYC</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kycData?.documents?.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{maskEmail(doc.user?.email)}</p>
                          <p className="text-sm text-muted-foreground">
                            {maskPhone(doc.user?.phone)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusVariant(doc.user?.kycStatus ?? doc.status)}>
                            {humanize(doc.user?.kycStatus ?? doc.status)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTier(doc.user?.kycTier ?? doc.kycTier)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium capitalize">
                            {documentTypeLabel(doc.type)}
                          </p>
                          <p className="font-mono text-sm text-muted-foreground">
                            {maskKycId(doc.idNumber)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] text-sm text-muted-foreground">
                        {verificationLine(doc)}
                      </TableCell>
                      <TableCell>
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={loadingDocumentId === doc.id}
                            onClick={() => openDocumentForReview(doc)}
                          >
                            {loadingDocumentId === doc.id ? "Opening..." : "View"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {kycData && kycData.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {kycData.page} of {kycData.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= (kycData.totalPages || 1)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedDoc && (
          <Card>
            <CardHeader>
              <CardTitle>Review KYC Document</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">User</p>
                  <p className="font-medium">{maskEmail(selectedDoc.user?.email)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Phone</p>
                  <p className="font-medium">{maskPhone(selectedDoc.user?.phone)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">ID Type</p>
                  <p className="font-medium capitalize">
                    {documentTypeLabel(selectedDoc.type)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">ID Number</p>
                  <p className="font-mono">{maskKycId(selectedDoc.idNumber)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">User KYC</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant={statusVariant(selectedDoc.user?.kycStatus ?? selectedDoc.status)}>
                      {humanize(selectedDoc.user?.kycStatus ?? selectedDoc.status)}
                    </Badge>
                    <Badge variant="outline">
                      {formatTier(selectedDoc.user?.kycTier ?? selectedDoc.kycTier)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Document status</p>
                  <Badge className="mt-1" variant={statusVariant(selectedDoc.status)}>
                    {humanize(selectedDoc.status)}
                  </Badge>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Verification route</p>
                  <p className="font-medium">{verificationLine(selectedDoc)}</p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-sm mb-2">Document</p>
                {reviewDocumentUrl ? (
                  <a
                    href={reviewDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    View Document →
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Preparing secure document link...
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Review reason
                </label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Required reason for approval or rejection..."
                  value={reviewReason}
                  onChange={(e) => {
                    setReviewReason(e.target.value);
                    setPendingReviewStatus(null);
                  }}
                />
              </div>

              {pendingReviewStatus && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    Confirm {pendingReviewStatus === "VERIFIED" ? "approval" : "rejection"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    This will mark the masked {documentTypeLabel(selectedDoc.type)} submission as {pendingReviewStatus.toLowerCase()}.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                {pendingReviewStatus ? (
                  <Button
                    variant={pendingReviewStatus === "REJECTED" ? "destructive" : "default"}
                    onClick={confirmReview}
                    disabled={reviewMutation.isPending}
                  >
                    {reviewMutation.isPending ? "Processing..." : `Confirm ${pendingReviewStatus === "VERIFIED" ? "approval" : "rejection"}`}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => requestReview("VERIFIED")}
                      disabled={reviewMutation.isPending}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => requestReview("REJECTED")}
                      disabled={reviewMutation.isPending}
                    >
                      Reject
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedDoc(null);
                    setReviewDocumentUrl(null);
                    setReviewReason("");
                    setPendingReviewStatus(null);
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

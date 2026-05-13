"use client";

import { useState } from "react";
import { apiClient } from "@/services/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

type AdminKycDocument = {
  id: string;
  type: string;
  idNumber: string;
  status: string;
  documentUrl: string;
  createdAt: string;
  user?: {
    email?: string;
    phone?: string;
  };
};

type AdminKycResponse = {
  documents: AdminKycDocument[];
  total: number;
  page: number;
  totalPages: number;
};

export default function AdminKycPage() {
  const [page, setPage] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState<AdminKycDocument | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");
  const queryClient = useQueryClient();

  const { data: kycData, isLoading } = useQuery({
    queryKey: ["admin-kyc", page],
    queryFn: async () => {
      const res = await apiClient.get(`/api/admin/kyc/pending?page=${page}&limit=20`);
      return res.data as AdminKycResponse;
    },
    staleTime: 30000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ documentId, status, rejectionNote }: { documentId: string; status: string; rejectionNote?: string }) => {
      const res = await apiClient.put(`/api/admin/kyc/${documentId}/review`, {
        status,
        rejectionNote,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-kyc"] });
      setSelectedDoc(null);
      setRejectionNote("");
      toast.success("KYC document reviewed successfully");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Failed to review KYC"));
    },
  });

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <span className="text-xl font-bold text-primary">TrustPay Admin — KYC Review</span>
          <Button variant="outline" onClick={() => window.history.back()}>
            Back to Admin
          </Button>
        </div>
      </header>

      <main className="container mx-auto p-6 flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Pending KYC Documents ({kycData?.total || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {kycData?.documents?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No pending KYC documents</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>ID Type</TableHead>
                    <TableHead>ID Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kycData?.documents?.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{doc.user?.email}</p>
                          <p className="text-sm text-muted-foreground">{doc.user?.phone}</p>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{doc.type.toLowerCase().replace("_", " ")}</TableCell>
                      <TableCell className="font-mono text-sm">{doc.idNumber}</TableCell>
                      <TableCell>
                        <Badge variant={doc.status === "SUBMITTED" ? "default" : "secondary"}>
                          {doc.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedDoc(doc)}
                          >
                            View
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
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= (kycData.totalPages || 1)} onClick={() => setPage((p) => p + 1)}>
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
                  <p className="font-medium">{selectedDoc.user?.email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Phone</p>
                  <p className="font-medium">{selectedDoc.user?.phone}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">ID Type</p>
                  <p className="font-medium capitalize">{selectedDoc.type.toLowerCase().replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">ID Number</p>
                  <p className="font-mono">{selectedDoc.idNumber}</p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-sm mb-2">Document</p>
                <a
                  href={selectedDoc.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  View Document →
                </a>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Rejection Note (optional)</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Reason for rejection..."
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() =>
                    reviewMutation.mutate({
                      documentId: selectedDoc.id,
                      status: "VERIFIED",
                    })
                  }
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? "Processing..." : "Verify"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    reviewMutation.mutate({
                      documentId: selectedDoc.id,
                      status: "REJECTED",
                      rejectionNote,
                    })
                  }
                  disabled={reviewMutation.isPending}
                >
                  Reject
                </Button>
                <Button variant="outline" onClick={() => { setSelectedDoc(null); setRejectionNote(""); }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

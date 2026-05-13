"use client";

import { useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiClient } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/errors";

type KycDocument = {
  id: string;
  type: string;
  idNumber: string;
  status: string;
};

const kycTypes = [
  { value: "BVN", label: "BVN (Bank Verification Number)" },
  { value: "NIN", label: "NIN (National Identity Number)" },
  { value: "PASSPORT", label: "International Passport" },
  { value: "DRIVERS_LICENSE", label: "Driver's License" },
  { value: "VOTERS_CARD", label: "Voter's Card" },
];

export default function KycPage() {
  const [type, setType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: kycDocs, refetch } = useQuery({
    queryKey: ["kyc-documents"],
    queryFn: async () => {
      const res = await apiClient.get("/api/kyc/documents");
      return res.data as KycDocument[];
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!type || !idNumber || !documentUrl) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.post("/api/kyc/submit", {
        type,
        idNumber,
        documentUrl,
      });
      toast.success("KYC document submitted successfully");
      setType("");
      setIdNumber("");
      setDocumentUrl("");
      refetch();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to submit KYC"));
    } finally {
      setIsLoading(false);
    }
  };

  const statusColors: Record<string, "secondary" | "default" | "destructive"> = {
    PENDING: "secondary",
    SUBMITTED: "default",
    VERIFIED: "default",
    REJECTED: "destructive",
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">KYC Verification</h1>
          <p className="text-muted-foreground mt-1">
            Submit your identity document to verify your account
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Submit Document</CardTitle>
            <CardDescription>
              Upload a valid government-issued ID for verification
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>ID Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select ID type" />
                  </SelectTrigger>
                  <SelectContent>
                    {kycTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>ID Number</Label>
                <Input
                  placeholder="Enter your ID number"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Document URL</Label>
                <Input
                  placeholder="https://example.com/document.jpg"
                  type="url"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Upload your document to a secure storage and paste the URL here
                </p>
              </div>

              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Submitting..." : "Submit for Verification"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {kycDocs && kycDocs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Submitted Documents</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {kycDocs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium">{kycTypes.find((t) => t.value === doc.type)?.label}</p>
                    <p className="text-sm text-muted-foreground">{doc.idNumber}</p>
                  </div>
                  <Badge variant={statusColors[doc.status] || "secondary"}>
                    {doc.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

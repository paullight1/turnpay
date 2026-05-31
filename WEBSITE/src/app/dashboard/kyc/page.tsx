"use client";

import { useRef, useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { kycApi } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/errors";
import { maskKycId } from "@/lib/privacy";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-provider";
import type { KycDocument } from "@/types";

const kycTypes = [
  { value: "BVN", label: "BVN (Bank Verification Number)" },
  { value: "NIN", label: "NIN (National Identity Number)" },
  { value: "PASSPORT", label: "International Passport" },
  { value: "DRIVERS_LICENSE", label: "Driver's License" },
  { value: "VOTERS_CARD", label: "Voter's Card" },
];

const allowedDocumentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const maxDocumentSize = 8 * 1024 * 1024;

const statusColors: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
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

function latestDocument(documents?: KycDocument[]) {
  return documents?.[0];
}

function reviewRoute(document?: KycDocument) {
  if (!document) return "Start with BVN or NIN and upload a matching document.";

  const providerStatus =
    document.verificationStatus ?? document.providerStatus ?? document.status;
  const needsManualReview =
    document.manualReviewRequired || document.requiresManualReview || document.manualReviewStatus;

  if (document.status === "VERIFIED") return "Verification complete. Your account limits now follow the approved tier.";
  if (document.status === "REJECTED") return "Review the rejection note and submit updated identity details.";
  if (needsManualReview) return `Provider check is ${humanize(providerStatus)}. Manual review is ${humanize(document.manualReviewStatus ?? "pending")}.`;
  return `Provider check is ${humanize(providerStatus)}. We will update your tier after review.`;
}

export default function KycPage() {
  const { profile } = useAuth();
  const [type, setType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    data: kycDocs,
    isLoading: isDocsLoading,
    isError: isDocsError,
    refetch,
  } = useQuery({
    queryKey: ["kyc-documents"],
    queryFn: async () => {
      const res = await kycApi.getDocuments();
      return res.data as KycDocument[];
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (inFlightRef.current) return;

    if (!type || !idNumber || !documentFile) {
      toast.error("Please fill in all fields");
      return;
    }

    if (!allowedDocumentTypes.includes(documentFile.type)) {
      toast.error("Upload a JPG, PNG, WEBP, or PDF document");
      return;
    }

    if (documentFile.size > maxDocumentSize) {
      toast.error("Document must be 8MB or smaller");
      return;
    }

    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const uploadUrlResponse = await kycApi.createDocumentUploadUrl({
        fileName: documentFile.name,
        contentType: documentFile.type,
        fileSize: documentFile.size,
      });
      const upload = uploadUrlResponse.data as {
        bucket: string;
        objectKey: string;
        token: string;
      };

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.objectKey, upload.token, documentFile, {
          contentType: documentFile.type,
        });

      if (uploadError) {
        throw uploadError;
      }

      await kycApi.submit({
        type,
        idNumber,
        documentObjectKey: upload.objectKey,
      });
      toast.success("KYC document submitted successfully");
      setType("");
      setIdNumber("");
      setDocumentFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refetch();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to submit KYC"));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const currentDocument = latestDocument(kycDocs);
  const currentStatus = profile?.kycStatus ?? currentDocument?.status ?? "PENDING";
  const currentTier = profile?.kycTier ?? currentDocument?.kycTier;

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">KYC Verification</h1>
          <p className="text-muted-foreground mt-1">
            Confirm your current tier and submit identity details for review.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account verification</CardTitle>
            <CardDescription>
              Your wallet limits follow the tier and status shown here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={statusColors[currentStatus] || "secondary"} className="mt-1">
                {humanize(currentStatus)}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">KYC tier</p>
              <p className="mt-1 font-medium">{formatTier(currentTier)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Review path</p>
              <p className="mt-1 font-medium">{reviewRoute(currentDocument)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submit Document</CardTitle>
            <CardDescription>
              BVN and NIN are preferred for faster provider checks. Upload a matching document for manual review when needed.
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
                <Label>Identity document</Label>
                <Input
                  ref={fileInputRef}
                  name="identityDocument"
                  type="file"
                  accept={allowedDocumentTypes.join(",")}
                  onChange={(e) =>
                    setDocumentFile(e.target.files?.[0] ?? null)
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  JPG, PNG, WEBP, or PDF. Maximum 8MB.
                </p>
              </div>

              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Submitting..." : "Submit for Verification"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submitted Documents</CardTitle>
            <CardDescription>
              Sensitive identifiers stay masked. Storage keys and provider references are not shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isDocsLoading ? (
              <p className="text-sm text-muted-foreground">Loading submitted documents...</p>
            ) : isDocsError ? (
              <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
                <p className="text-muted-foreground">Unable to load submitted documents.</p>
                <Button variant="outline" size="sm" className="w-fit" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : kycDocs && kycDocs.length > 0 ? (
              kycDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="grid gap-3 rounded-lg border p-3 text-sm md:grid-cols-[1fr_auto]"
                >
                  <div>
                    <p className="font-medium">
                      {kycTypes.find((t) => t.value === doc.type)?.label ?? humanize(doc.type)}
                    </p>
                    <p className="text-muted-foreground">{maskKycId(doc.idNumber)}</p>
                    {(doc.providerStatus || doc.verificationStatus || doc.manualReviewStatus) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Provider {humanize(doc.verificationStatus ?? doc.providerStatus)}
                        {(doc.manualReviewRequired ||
                          doc.requiresManualReview ||
                          doc.manualReviewStatus) &&
                          `; manual review ${humanize(doc.manualReviewStatus ?? "pending")}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2 md:justify-end">
                    <Badge variant={statusColors[doc.status] || "secondary"}>
                      {humanize(doc.status)}
                    </Badge>
                    {doc.kycTier !== undefined && doc.kycTier !== null && (
                      <Badge variant="outline">{formatTier(doc.kycTier)}</Badge>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                No identity documents submitted yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isVendor } from "@/lib/rbac";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ShieldCheck,
  Upload,
  FileText,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Tag,
} from "lucide-react";

interface ComplianceDocument {
  id: string;
  type: string;
  fileName: string;
  status: "valid" | "expiring_soon" | "expired" | "pending";
  expirationDate: string | null;
  uploadedAt: string;
}

export default function VendorCompliancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState<ComplianceDocument | null>(null);

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: documents, isLoading } = useQuery<ComplianceDocument[]>({
    queryKey: ["/api/vendor/compliance-documents"],
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "valid":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-status-valid"><CheckCircle2 className="w-3 h-3 mr-1" />Valid</Badge>;
      case "expiring_soon":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid="badge-status-expiring"><Clock className="w-3 h-3 mr-1" />Expiring Soon</Badge>;
      case "expired":
        return <Badge variant="destructive" data-testid="badge-status-expired"><AlertTriangle className="w-3 h-3 mr-1" />Expired</Badge>;
      default:
        return <Badge variant="outline" data-testid="badge-status-pending"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const getStatusDescription = (status: string) => {
    switch (status) {
      case "valid": return "This document is current and accepted.";
      case "expiring_soon": return "This document will expire soon. Please renew it.";
      case "expired": return "This document has expired. Upload a renewed version.";
      default: return "This document is pending review.";
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Compliance Documents</h1>
          <p className="text-muted-foreground mt-1">Click any document to view full details.</p>
        </div>
        <Button data-testid="button-upload-document">
          <Upload className="w-4 h-4 mr-2" />
          Upload Document
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-coi-status">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Certificate of Insurance</p>
                <p className="text-lg font-semibold" data-testid="text-coi-status">
                  {documents?.find(d => d.type === "COI")?.status === "valid" ? "Current" : "Needs Attention"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-w9-status">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">W-9 Form</p>
                <p className="text-lg font-semibold" data-testid="text-w9-status">
                  {documents?.find(d => d.type === "W9")?.status === "valid" ? "On File" : "Not Uploaded"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-license-status">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">License / Certification</p>
                <p className="text-lg font-semibold" data-testid="text-license-status">
                  {documents?.find(d => d.type === "LICENSE")?.status === "valid" ? "Current" : "Needs Attention"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-documents-title">Document History</CardTitle>
          <CardDescription>Click any document to see full details</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : documents && documents.length > 0 ? (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  data-testid={`row-document-${doc.id}`}
                  onClick={() => setSelectedDoc(doc)}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium" data-testid={`text-doc-name-${doc.id}`}>{doc.fileName}</p>
                      <p className="text-sm text-muted-foreground">{doc.type} &middot; Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {doc.expirationDate && (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Expires {new Date(doc.expirationDate).toLocaleDateString()}
                      </span>
                    )}
                    {getStatusBadge(doc.status)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground" data-testid="text-no-documents">No compliance documents uploaded yet</p>
              <p className="text-sm text-muted-foreground mt-1">Upload your COI, W-9, and licenses to stay compliant with contractor requirements.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedDoc} onOpenChange={(open) => { if (!open) setSelectedDoc(null); }}>
        <DialogContent className="max-w-lg" data-testid="modal-compliance-detail">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Compliance Document Details
            </DialogTitle>
          </DialogHeader>

          {selectedDoc && (
            <div className="space-y-5 pt-1">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">File Name</p>
                <p className="text-base font-semibold break-all" data-testid="text-modal-filename">{selectedDoc.fileName}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Document Type
                  </p>
                  <p className="text-sm font-medium" data-testid="text-modal-type">{selectedDoc.type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                  {getStatusBadge(selectedDoc.status)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">
                {getStatusDescription(selectedDoc.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Uploaded
                  </p>
                  <p className="text-sm" data-testid="text-modal-uploadedat">
                    {new Date(selectedDoc.uploadedAt).toLocaleDateString("en-US", {
                      year: "numeric", month: "long", day: "numeric",
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Expiration
                  </p>
                  <p className="text-sm" data-testid="text-modal-expiration">
                    {selectedDoc.expirationDate
                      ? new Date(selectedDoc.expirationDate).toLocaleDateString("en-US", {
                          year: "numeric", month: "long", day: "numeric",
                        })
                      : <span className="text-muted-foreground">No expiration</span>}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

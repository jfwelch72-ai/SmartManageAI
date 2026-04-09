import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Compliance Documents</h1>
          <p className="text-muted-foreground mt-1">Upload and manage your insurance certificates, W-9s, and other compliance documents required by contractors.</p>
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
          <CardDescription>All compliance documents you've submitted to contractors</CardDescription>
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
                <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`row-document-${doc.id}`}>
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
    </div>
  );
}

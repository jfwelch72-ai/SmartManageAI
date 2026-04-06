import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Shield, Image, Calendar, AlertTriangle, Clock, FileCheck,
  Upload, Eye, History
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { DocumentType, DocumentSummary, OrganizationDocument, TypesResponse } from "./types";
import { DocumentUploadDialog, DocumentHistoryDialog } from "./CompanyBrandingTab";

interface CompanyProfileTabProps {
  activeDocTab: string;
}

export function CompanyProfileTab({ activeDocTab }: CompanyProfileTabProps) {
  const { user } = useAuth();
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const [historyDocType, setHistoryDocType] = useState<string>("");

  const { data: documents = [], isLoading: loadingDocuments } = useQuery<OrganizationDocument[]>({
    queryKey: ["/api/organization-documents"],
    enabled: !!user && user.role === "ADMIN"
  });

  const { data: typesData, isLoading: loadingTypes } = useQuery<TypesResponse>({
    queryKey: ["/api/organization-documents/types"],
    enabled: !!user && user.role === "ADMIN"
  });

  const { data: summary } = useQuery<DocumentSummary>({
    queryKey: ["/api/organization-documents/summary"],
    enabled: !!user && user.role === "ADMIN"
  });

  const { data: historyDocs = [] } = useQuery<OrganizationDocument[]>({
    queryKey: ["/api/organization-documents/history", historyDocType],
    enabled: !!historyDocType && showHistoryDialog
  });

  const insuranceDocs = documents.filter(d => d.category === "INSURANCE" && d.isActive);
  const getDocForType = (type: string) => documents.find(d => d.type === type && d.isActive);

  const openUploadDialog = (docType: string) => {
    setSelectedDocType(docType);
    setShowUploadDialog(true);
  };

  const openHistoryDialog = (docType: string) => {
    setHistoryDocType(docType);
    setShowHistoryDialog(true);
  };

  const renderDocumentCard = (docType: DocumentType, doc?: OrganizationDocument) => {
    const isInsurance = docType.category === "INSURANCE";
    return (
      <Card key={docType.value} className="relative">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">{docType.label}</CardTitle>
              {doc && (
                <CardDescription className="mt-1">v{doc.version} - {doc.uploadedByName || "Unknown"}</CardDescription>
              )}
            </div>
            {doc ? (
              <div className="flex items-center gap-1">
                {doc.isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                {doc.isExpiringSoon && !doc.isExpired && (
                  <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Expiring Soon</Badge>
                )}
                {!doc.isExpired && !doc.isExpiringSoon && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>
                )}
              </div>
            ) : (
              <Badge variant="outline" className="text-xs">Not Uploaded</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {doc ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>Uploaded {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}</span>
                </div>
                {isInsurance && doc.expiresAt && (
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" />
                    <span>Expires {format(new Date(doc.expiresAt), "MMM d, yyyy")}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => window.open(doc.fileUrl, "_blank")} data-testid={`button-view-${docType.value}`}>
                  <Eye className="h-3 w-3 mr-1" /> View
                </Button>
                <Button size="sm" variant="outline" onClick={() => openUploadDialog(docType.value)} data-testid={`button-replace-${docType.value}`}>
                  <Upload className="h-3 w-3 mr-1" /> Replace
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openHistoryDialog(docType.value)} data-testid={`button-history-${docType.value}`}>
                  <History className="h-3 w-3 mr-1" /> History
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No document uploaded yet</p>
              <Button size="sm" onClick={() => openUploadDialog(docType.value)} data-testid={`button-upload-${docType.value}`}>
                <Upload className="h-4 w-4 mr-2" /> Upload
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Image className="h-4 w-4" /> Branding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.branding.uploaded}/{summary.branding.total}</div>
              <p className="text-xs text-muted-foreground">Documents uploaded</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" /> Insurance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.insurance.uploaded}/{summary.insurance.total}</div>
              <div className="flex gap-2 mt-1">
                {summary.insurance.expiringSoon > 0 && (
                  <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    {summary.insurance.expiringSoon} expiring soon
                  </Badge>
                )}
                {summary.insurance.expired > 0 && (
                  <Badge variant="destructive" className="text-xs">{summary.insurance.expired} expired</Badge>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileCheck className="h-4 w-4" /> Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.compliance.uploaded}/{summary.compliance.total}</div>
              <p className="text-xs text-muted-foreground">Documents uploaded</p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeDocTab === "branding" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Branding & Identity</h2>
            <p className="text-sm text-muted-foreground">Upload your company logos and letterhead for use in documents and reports</p>
          </div>
          {loadingDocuments || loadingTypes ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {typesData?.types.filter(t => t.category === "BRANDING").map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
            </div>
          )}
        </div>
      )}

      {activeDocTab === "insurance" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Insurance Certificates</h2>
            <p className="text-sm text-muted-foreground">Manage your insurance certificates with expiration tracking</p>
          </div>
          {insuranceDocs.some(d => d.isExpired) && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>You have expired insurance certificates. Please update them immediately.</AlertDescription>
            </Alert>
          )}
          {insuranceDocs.some(d => d.isExpiringSoon && !d.isExpired) && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>Some insurance certificates are expiring within 30 days. Consider renewing them.</AlertDescription>
            </Alert>
          )}
          {loadingDocuments || loadingTypes ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {typesData?.types.filter(t => t.category === "INSURANCE").map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
            </div>
          )}
        </div>
      )}

      {activeDocTab === "compliance" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Compliance & Business Documents</h2>
            <p className="text-sm text-muted-foreground">Manage W9s, licenses, and other business documentation</p>
          </div>
          {loadingDocuments || loadingTypes ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {typesData?.types.filter(t => t.category === "COMPLIANCE").map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
            </div>
          )}
        </div>
      )}

      <DocumentUploadDialog
        open={showUploadDialog}
        onOpenChange={(open) => { setShowUploadDialog(open); if (!open) setSelectedDocType(""); }}
        selectedDocType={selectedDocType}
        typesData={typesData}
        organizationId={user?.organizationId || undefined}
        onSuccess={() => setSelectedDocType("")}
      />

      <DocumentHistoryDialog
        open={showHistoryDialog}
        onOpenChange={setShowHistoryDialog}
        historyDocType={historyDocType}
        typesData={typesData}
        historyDocs={historyDocs}
      />
    </>
  );
}

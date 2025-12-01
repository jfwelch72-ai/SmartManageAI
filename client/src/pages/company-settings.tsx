import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@/components/ObjectUploader";
import { 
  Building2, 
  Upload, 
  FileText, 
  Shield, 
  Image, 
  Calendar, 
  AlertTriangle, 
  CheckCircle2,
  Download,
  Eye,
  History,
  Trash2,
  Clock,
  FileCheck
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface DocumentType {
  value: string;
  label: string;
  category: string;
}

interface DocumentSummary {
  branding: {
    total: number;
    uploaded: number;
  };
  insurance: {
    total: number;
    uploaded: number;
    expiringSoon: number;
    expired: number;
  };
  compliance: {
    total: number;
    uploaded: number;
  };
}

interface OrganizationDocument {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  description: string | null;
  fileUrl: string;
  objectKey: string | null;
  mimeType: string | null;
  fileSize: number | null;
  visibility: string;
  version: number;
  uploadedById: string | null;
  effectiveDate: string | null;
  expiresAt: string | null;
  notes: string | null;
  replacesDocumentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  typeLabel: string;
  visibilityLabel: string;
  uploadedByName: string | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
  category: string;
}

interface TypesResponse {
  types: DocumentType[];
  visibilities: { value: string; label: string }[];
  categories: { value: string; label: string; types: string[] }[];
}

export default function CompanySettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("branding");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const [historyDocType, setHistoryDocType] = useState<string>("");
  
  const [uploadForm, setUploadForm] = useState({
    name: "",
    description: "",
    visibility: "INTERNAL",
    effectiveDate: "",
    expiresAt: "",
    notes: ""
  });

  const { data: documents = [], isLoading: loadingDocuments } = useQuery<OrganizationDocument[]>({
    queryKey: ["/api/organization-documents"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN"].includes(user.role)
  });

  const { data: typesData, isLoading: loadingTypes } = useQuery<TypesResponse>({
    queryKey: ["/api/organization-documents/types"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN"].includes(user.role)
  });

  const { data: summary } = useQuery<DocumentSummary>({
    queryKey: ["/api/organization-documents/summary"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN"].includes(user.role)
  });

  const { data: historyDocs = [] } = useQuery<OrganizationDocument[]>({
    queryKey: ["/api/organization-documents/history", historyDocType],
    enabled: !!historyDocType && showHistoryDialog
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/organization-documents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents/summary"] });
      toast({ title: "Document uploaded successfully" });
      setShowUploadDialog(false);
      resetUploadForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload document", variant: "destructive" });
    }
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/organization-documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization-documents/summary"] });
      toast({ title: "Document removed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove document", variant: "destructive" });
    }
  });

  const resetUploadForm = () => {
    setUploadForm({
      name: "",
      description: "",
      visibility: "INTERNAL",
      effectiveDate: "",
      expiresAt: "",
      notes: ""
    });
    setSelectedDocType("");
  };

  const getUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "Upload failed", variant: "destructive" });
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL?.split('?')[0] || "";
    
    if (!user?.organizationId) {
      toast({ title: "Error", description: "Organization not found", variant: "destructive" });
      return;
    }

    const documentData = {
      organizationId: user.organizationId,
      type: selectedDocType,
      name: uploadForm.name || uploadedFile.name,
      description: uploadForm.description || null,
      fileUrl: fileUrl,
      objectKey: null,
      mimeType: uploadedFile.type || null,
      fileSize: uploadedFile.size || null,
      visibility: uploadForm.visibility,
      effectiveDate: uploadForm.effectiveDate || null,
      expiresAt: uploadForm.expiresAt || null,
      notes: uploadForm.notes || null,
    };

    createDocumentMutation.mutate(documentData);
  };

  const openUploadDialog = (docType: string) => {
    const typeInfo = typesData?.types.find(t => t.value === docType);
    setSelectedDocType(docType);
    setUploadForm({
      ...uploadForm,
      name: typeInfo?.label || ""
    });
    setShowUploadDialog(true);
  };

  const openHistoryDialog = (docType: string) => {
    setHistoryDocType(docType);
    setShowHistoryDialog(true);
  };

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view company settings</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  const brandingDocs = documents.filter(d => d.category === "BRANDING" && d.isActive);
  const insuranceDocs = documents.filter(d => d.category === "INSURANCE" && d.isActive);
  const complianceDocs = documents.filter(d => d.category === "COMPLIANCE" && d.isActive);

  const getDocForType = (type: string) => documents.find(d => d.type === type && d.isActive);

  const renderDocumentCard = (docType: DocumentType, doc?: OrganizationDocument) => {
    const isInsurance = docType.category === "INSURANCE";
    
    return (
      <Card key={docType.value} className="relative">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">{docType.label}</CardTitle>
              {doc && (
                <CardDescription className="mt-1">
                  v{doc.version} - {doc.uploadedByName || "Unknown"}
                </CardDescription>
              )}
            </div>
            {doc ? (
              <div className="flex items-center gap-1">
                {doc.isExpired && (
                  <Badge variant="destructive" className="text-xs">
                    Expired
                  </Badge>
                )}
                {doc.isExpiringSoon && !doc.isExpired && (
                  <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    Expiring Soon
                  </Badge>
                )}
                {!doc.isExpired && !doc.isExpiringSoon && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    Active
                  </Badge>
                )}
              </div>
            ) : (
              <Badge variant="outline" className="text-xs">
                Not Uploaded
              </Badge>
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(doc.fileUrl, "_blank")}
                  data-testid={`button-view-${docType.value}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openUploadDialog(docType.value)}
                  data-testid={`button-replace-${docType.value}`}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openHistoryDialog(docType.value)}
                  data-testid={`button-history-${docType.value}`}
                >
                  <History className="h-3 w-3 mr-1" />
                  History
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No document uploaded yet
              </p>
              <Button
                size="sm"
                onClick={() => openUploadDialog(docType.value)}
                data-testid={`button-upload-${docType.value}`}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            Company Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your organization's branding, insurance, and compliance documents
          </p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Image className="h-4 w-4" />
                Branding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.branding.uploaded}/{summary.branding.total}
              </div>
              <p className="text-xs text-muted-foreground">Documents uploaded</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Insurance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.insurance.uploaded}/{summary.insurance.total}
              </div>
              <div className="flex gap-2 mt-1">
                {summary.insurance.expiringSoon > 0 && (
                  <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    {summary.insurance.expiringSoon} expiring soon
                  </Badge>
                )}
                {summary.insurance.expired > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {summary.insurance.expired} expired
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileCheck className="h-4 w-4" />
                Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.compliance.uploaded}/{summary.compliance.total}
              </div>
              <p className="text-xs text-muted-foreground">Documents uploaded</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-company-settings">
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Image className="h-4 w-4 mr-2" />
            Branding
          </TabsTrigger>
          <TabsTrigger value="insurance" data-testid="tab-insurance">
            <Shield className="h-4 w-4 mr-2" />
            Insurance
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">
            <FileText className="h-4 w-4 mr-2" />
            Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Branding & Identity</h2>
                <p className="text-sm text-muted-foreground">
                  Upload your company logos and letterhead for use in documents and reports
                </p>
              </div>
            </div>
            
            {loadingDocuments || loadingTypes ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {typesData?.types
                  .filter(t => t.category === "BRANDING")
                  .map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="insurance" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Insurance Certificates</h2>
                <p className="text-sm text-muted-foreground">
                  Manage your insurance certificates with expiration tracking
                </p>
              </div>
            </div>

            {insuranceDocs.some(d => d.isExpired) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  You have expired insurance certificates. Please update them immediately.
                </AlertDescription>
              </Alert>
            )}

            {insuranceDocs.some(d => d.isExpiringSoon && !d.isExpired) && (
              <Alert>
                <Clock className="h-4 w-4" />
                <AlertDescription>
                  Some insurance certificates are expiring within 30 days. Consider renewing them.
                </AlertDescription>
              </Alert>
            )}
            
            {loadingDocuments || loadingTypes ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {typesData?.types
                  .filter(t => t.category === "INSURANCE")
                  .map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="compliance" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Compliance & Business Documents</h2>
                <p className="text-sm text-muted-foreground">
                  Manage W9s, licenses, and other business documentation
                </p>
              </div>
            </div>
            
            {loadingDocuments || loadingTypes ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {typesData?.types
                  .filter(t => t.category === "COMPLIANCE")
                  .map(docType => renderDocumentCard(docType, getDocForType(docType.value)))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showUploadDialog} onOpenChange={(open) => {
        setShowUploadDialog(open);
        if (!open) resetUploadForm();
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Upload {typesData?.types.find(t => t.value === selectedDocType)?.label}
            </DialogTitle>
            <DialogDescription>
              {selectedDocType.includes("INSURANCE") 
                ? "Upload your insurance certificate. Make sure to set the expiration date."
                : "Upload your document. It will be available for use in generated reports."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Document Name</Label>
              <Input
                id="doc-name"
                value={uploadForm.name}
                onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                placeholder="Enter document name"
                data-testid="input-doc-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-description">Description (Optional)</Label>
              <Textarea
                id="doc-description"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                placeholder="Add a description"
                rows={2}
                data-testid="input-doc-description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-visibility">Visibility</Label>
              <Select
                value={uploadForm.visibility}
                onValueChange={(value) => setUploadForm({ ...uploadForm, visibility: value })}
              >
                <SelectTrigger data-testid="select-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typesData?.visibilities.map(v => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedDocType.includes("INSURANCE") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="effective-date">Effective Date</Label>
                  <Input
                    id="effective-date"
                    type="date"
                    value={uploadForm.effectiveDate}
                    onChange={(e) => setUploadForm({ ...uploadForm, effectiveDate: e.target.value })}
                    data-testid="input-effective-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expiry-date">Expiration Date</Label>
                  <Input
                    id="expiry-date"
                    type="date"
                    value={uploadForm.expiresAt}
                    onChange={(e) => setUploadForm({ ...uploadForm, expiresAt: e.target.value })}
                    data-testid="input-expiry-date"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="doc-notes">Notes (Optional)</Label>
              <Textarea
                id="doc-notes"
                value={uploadForm.notes}
                onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                placeholder="Add any notes"
                rows={2}
                data-testid="input-doc-notes"
              />
            </div>

            <div className="pt-2">
              <ObjectUploader
                maxNumberOfFiles={1}
                maxFileSize={52428800}
                allowedFileTypes={
                  selectedDocType.includes("LOGO") 
                    ? ["image/png", "image/jpeg", "image/svg+xml", "image/webp"]
                    : ["image/png", "image/jpeg", "application/pdf"]
                }
                onGetUploadParameters={getUploadParameters}
                onComplete={handleUploadComplete}
                buttonVariant="default"
                buttonClassName="w-full"
                testId="button-select-file"
              >
                <Upload className="h-4 w-4 mr-2" />
                Select File to Upload
              </ObjectUploader>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Version History - {typesData?.types.find(t => t.value === historyDocType)?.label}
            </DialogTitle>
            <DialogDescription>
              View previous versions of this document
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4 max-h-96 overflow-y-auto">
            {historyDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No version history available
              </p>
            ) : (
              historyDocs.map((doc) => (
                <div
                  key={doc.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    doc.isActive ? "bg-primary/5 border-primary/20" : ""
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Version {doc.version}</span>
                      {doc.isActive && (
                        <Badge variant="secondary" className="text-xs">Current</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {doc.uploadedByName || "Unknown"} - {format(new Date(doc.createdAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(doc.fileUrl, "_blank")}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

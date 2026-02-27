import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { mapOnboardingTradeIdToLegacy, formatTradeCategoryLabel, getTradeDisplayName } from "@shared/tradeTypeUtils";
import type { Trade } from "@/hooks/use-library-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  FileCheck,
  Wrench,
  RefreshCw,
  Loader2,
  Users,
  UserPlus,
  Mail,
  X,
  Copy,
  Link2
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";

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

interface TradeConfigResponse {
  organization: {
    id: string;
    name: string;
    tradeType: string;
    tradeName: string | null;
  };
  sowItemCount: number;
  tradeTypes: { value: string; label: string }[];
}

interface HustlerLinkRequest {
  id: string;
  hustlerUserId: string | null;
  hustlerEmail: string | null;
  requestType: string;
  status: string;
  roleOverride: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
  respondedAt: string | null;
}

interface PayrollSettings {
  id: string;
  organizationId: string;
  workWeekStartDay: "SUNDAY" | "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
  overtimeThresholdHours: string;
  workWeekEndNotificationEnabled: boolean;
  autoGenerateWeeklyReports: boolean;
  createdAt: string;
  updatedAt: string | null;
}

const DAYS_OF_WEEK = [
  { value: "SUNDAY", label: "Sunday" },
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
];

export default function CompanySettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("trade");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const [historyDocType, setHistoryDocType] = useState<string>("");
  const [selectedTradeType, setSelectedTradeType] = useState<string>("");
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const [tradeName, setTradeName] = useState("");
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [showInviteHustlerDialog, setShowInviteHustlerDialog] = useState(false);
  const [hustlerEmail, setHustlerEmail] = useState("");
  const [hustlerMessage, setHustlerMessage] = useState("");
  const [hustlerRoleOverride, setHustlerRoleOverride] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  
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

  const { data: tradeConfig, isLoading: loadingTradeConfig } = useQuery<TradeConfigResponse>({
    queryKey: ["/api/organization/trade-config"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "HUSTLER"].includes(user.role)
  });

  const { data: hustlerLinkRequests = { requests: [] }, isLoading: loadingHustlerRequests } = useQuery<{ requests: HustlerLinkRequest[] }>({
    queryKey: ["/api/hustler/link-requests/organization"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN"].includes(user.role)
  });

  const { data: payrollSettings, isLoading: loadingPayroll } = useQuery<PayrollSettings>({
    queryKey: ["/api/payroll/settings"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "OFFICE_MANAGER"].includes(user.role)
  });

  const { data: allTradesData } = useQuery<{ categories: string[]; trades: Trade[] }>({
    queryKey: ["/api/onboarding-library/trades"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "HUSTLER"].includes(user.role),
    staleTime: 5 * 60 * 1000,
  });

  const groupedLibraryTrades = useMemo(() => {
    if (!allTradesData?.trades) return [];
    const groups: Record<string, Trade[]> = {};
    for (const trade of allTradesData.trades) {
      const cat = trade.trade_category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(trade);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, trades]) => ({
        category,
        label: formatTradeCategoryLabel(category),
        trades: trades.sort((a, b) => a.trade_name.localeCompare(b.trade_name)),
      }));
  }, [allTradesData?.trades]);

  const [payrollForm, setPayrollForm] = useState({
    workWeekStartDay: "SUNDAY" as PayrollSettings["workWeekStartDay"],
    overtimeThresholdHours: 40,
    notifyOnWeekComplete: true
  });

  const updatePayrollMutation = useMutation({
    mutationFn: async (data: typeof payrollForm) => {
      return await apiRequest("PUT", "/api/payroll/settings", {
        workWeekStartDay: data.workWeekStartDay,
        overtimeThresholdHours: String(data.overtimeThresholdHours),
        workWeekEndNotificationEnabled: data.notifyOnWeekComplete,
        autoGenerateWeeklyReports: data.notifyOnWeekComplete,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/settings"] });
      toast({ title: "Payroll settings updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update payroll settings", variant: "destructive" });
    }
  });

  const inviteHustlerMutation = useMutation({
    mutationFn: async (data: { hustlerEmail: string; message?: string; roleOverride?: string }) => {
      return await apiRequest("POST", "/api/hustler/link-requests/invite", data);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/link-requests/organization"] });
      toast({ 
        title: "Invite sent!", 
        description: `An invite has been created for ${hustlerEmail}`
      });
      if (data.inviteLink) {
        setCopiedLink(data.inviteLink);
      }
      setShowInviteHustlerDialog(false);
      setHustlerEmail("");
      setHustlerMessage("");
      setHustlerRoleOverride("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create invite", variant: "destructive" });
    }
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest("POST", `/api/hustler/link-requests/${requestId}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hustler/link-requests/organization"] });
      toast({ title: "Invite revoked" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to revoke invite", variant: "destructive" });
    }
  });

  const updateTradeTypeMutation = useMutation({
    mutationFn: async (data: { tradeType: string; tradeName?: string }) => {
      return await apiRequest("POST", "/api/organization/update-trade-type", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/trade-config"] });
      toast({ title: "Trade type updated successfully" });
      setSelectedTradeType("");
      setSelectedTradeId("");
      setTradeName("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update trade type", variant: "destructive" });
    }
  });

  const reinitializeSowMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/organization/reinitialize-sow", {});
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/organization/trade-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ 
        title: "SOW Items Regenerated", 
        description: `Created ${data.newItemsCreated} items across ${data.categories?.length || 0} categories`
      });
      setShowRebuildConfirm(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to regenerate SOW items", variant: "destructive" });
    }
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

  const onGetUploadParameters = async () => {
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

  useEffect(() => {
    if (payrollSettings) {
      setPayrollForm({
        workWeekStartDay: payrollSettings.workWeekStartDay,
        overtimeThresholdHours: parseInt(payrollSettings.overtimeThresholdHours) || 40,
        notifyOnWeekComplete: payrollSettings.workWeekEndNotificationEnabled
      });
    }
  }, [payrollSettings]);

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
        <TabsList className="grid w-full grid-cols-6" data-testid="tabs-company-settings">
          <TabsTrigger value="trade" data-testid="tab-trade">
            <Wrench className="h-4 w-4 mr-2" />
            Trade
          </TabsTrigger>
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
          <TabsTrigger value="payroll" data-testid="tab-payroll">
            <Clock className="h-4 w-4 mr-2" />
            Payroll
          </TabsTrigger>
          <TabsTrigger value="hustler" data-testid="tab-hustler">
            <Users className="h-4 w-4 mr-2" />
            Hustler Oversight
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trade" className="mt-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Trade Configuration</h2>
                <p className="text-sm text-muted-foreground">
                  Manage your organization's trade type and scope of work templates
                </p>
              </div>
            </div>

            {loadingTradeConfig ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            ) : tradeConfig ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Wrench className="h-5 w-5" />
                      Current Trade Type
                    </CardTitle>
                    <CardDescription>
                      Your organization's trade specialization
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Badge 
                        variant="secondary" 
                        className={`text-sm px-3 py-1 ${
                          tradeConfig.organization.tradeType === 'GENERAL_CONTRACTOR' 
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : tradeConfig.organization.tradeType === 'OTHER'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                        }`}
                        data-testid="badge-trade-type"
                      >
                        {tradeConfig.organization.tradeName || getTradeDisplayName(tradeConfig.organization.tradeType as any)}
                      </Badge>
                      {tradeConfig.organization.tradeName && (
                        <span className="text-sm text-muted-foreground">
                          ({getTradeDisplayName(tradeConfig.organization.tradeType as any)})
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">{tradeConfig.sowItemCount}</span> active scope items
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Change Trade Type</CardTitle>
                    <CardDescription>
                      Update your organization's trade specialization
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="trade-type">New Trade Type</Label>
                      {groupedLibraryTrades.length > 0 ? (
                        <Select
                          value={selectedTradeId ? `${selectedTradeId}::${tradeName}` : ""}
                          onValueChange={(compositeValue) => {
                            const [tradeId, tradeDisplayName] = compositeValue.split("::");
                            const legacyType = mapOnboardingTradeIdToLegacy(tradeId);
                            setSelectedTradeId(tradeId);
                            setSelectedTradeType(legacyType);
                            setTradeName(tradeDisplayName || "");
                          }}
                        >
                          <SelectTrigger data-testid="select-trade-type">
                            <SelectValue placeholder="Select a trade specialization">
                              {tradeName || (selectedTradeType ? getTradeDisplayName(selectedTradeType as any) : "Select a trade specialization")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-h-80">
                            {groupedLibraryTrades.map((group) => (
                              <SelectGroup key={group.category}>
                                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {group.label}
                                </SelectLabel>
                                {group.trades.map((trade) => (
                                  <SelectItem
                                    key={trade.trade_id}
                                    value={`${trade.trade_id}::${trade.trade_name}`}
                                    data-testid={`select-trade-item-${trade.trade_id}`}
                                  >
                                    {trade.trade_name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select
                          value={selectedTradeType || tradeConfig.organization.tradeType}
                          onValueChange={(value) => setSelectedTradeType(value)}
                        >
                          <SelectTrigger data-testid="select-trade-type">
                            <SelectValue placeholder="Select trade type" />
                          </SelectTrigger>
                          <SelectContent>
                            {tradeConfig.tradeTypes.map(t => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {selectedTradeType && tradeName && (
                      <div className="text-sm text-muted-foreground">
                        Maps to legacy type: <Badge variant="outline" className="text-xs">{getTradeDisplayName(selectedTradeType as any)}</Badge>
                      </div>
                    )}

                    <Button
                      onClick={() => {
                        if (selectedTradeType && selectedTradeType !== tradeConfig.organization.tradeType) {
                          updateTradeTypeMutation.mutate({ 
                            tradeType: selectedTradeType,
                            tradeName: tradeName || undefined
                          });
                        } else if (selectedTradeType && tradeName !== tradeConfig.organization.tradeName) {
                          updateTradeTypeMutation.mutate({ 
                            tradeType: selectedTradeType,
                            tradeName: tradeName || undefined
                          });
                        }
                      }}
                      disabled={
                        updateTradeTypeMutation.isPending || 
                        !selectedTradeType ||
                        (selectedTradeType === tradeConfig.organization.tradeType && tradeName === (tradeConfig.organization.tradeName || ""))
                      }
                      data-testid="button-update-trade"
                    >
                      {updateTradeTypeMutation.isPending && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Update Trade Type
                    </Button>
                  </CardContent>
                </Card>

                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <RefreshCw className="h-5 w-5" />
                      Rebuild SOW Templates
                    </CardTitle>
                    <CardDescription>
                      Regenerate scope of work items from trade templates
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        This will regenerate SOW templates based on your current trade type. 
                        Custom items you've created will remain active.
                      </AlertDescription>
                    </Alert>
                    
                    {!showRebuildConfirm ? (
                      <Button 
                        variant="outline" 
                        onClick={() => setShowRebuildConfirm(true)}
                        data-testid="button-rebuild-sow"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Rebuild SOW Items from Trade Type
                      </Button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Button
                          variant="destructive"
                          onClick={() => reinitializeSowMutation.mutate()}
                          disabled={reinitializeSowMutation.isPending}
                          data-testid="button-confirm-rebuild"
                        >
                          {reinitializeSowMutation.isPending && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          Confirm Rebuild
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowRebuildConfirm(false)}
                          data-testid="button-cancel-rebuild"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  Unable to load trade configuration. Please try again.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </TabsContent>

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

        <TabsContent value="payroll" className="mt-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Payroll & Work Week Settings</h2>
                <p className="text-sm text-muted-foreground">
                  Configure your work week schedule for time tracking and payroll reports
                </p>
              </div>
            </div>

            {loadingPayroll ? (
              <Card>
                <CardContent className="py-8">
                  <Skeleton className="h-48" />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Work Week Configuration
                    </CardTitle>
                    <CardDescription>
                      Define when your work week starts and overtime thresholds
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="work-week-start">Work Week Start Day</Label>
                      <Select
                        value={payrollForm.workWeekStartDay}
                        onValueChange={(value: PayrollSettings["workWeekStartDay"]) => 
                          setPayrollForm(prev => ({ ...prev, workWeekStartDay: value }))
                        }
                      >
                        <SelectTrigger data-testid="select-work-week-start">
                          <SelectValue placeholder="Select start day" />
                        </SelectTrigger>
                        <SelectContent>
                          {DAYS_OF_WEEK.map(day => (
                            <SelectItem key={day.value} value={day.value}>
                              {day.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Weekly reports will be generated for the 7-day period starting on this day
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="overtime-threshold">Weekly Overtime Threshold (hours)</Label>
                      <Input
                        id="overtime-threshold"
                        type="number"
                        min={1}
                        max={168}
                        value={payrollForm.overtimeThresholdHours}
                        onChange={(e) => setPayrollForm(prev => ({ 
                          ...prev, 
                          overtimeThresholdHours: parseInt(e.target.value) || 40 
                        }))}
                        data-testid="input-overtime-threshold"
                      />
                      <p className="text-xs text-muted-foreground">
                        Hours worked beyond this threshold will be classified as overtime
                      </p>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <input
                        type="checkbox"
                        id="notify-week-complete"
                        checked={payrollForm.notifyOnWeekComplete}
                        onChange={(e) => setPayrollForm(prev => ({ 
                          ...prev, 
                          notifyOnWeekComplete: e.target.checked 
                        }))}
                        className="h-4 w-4 rounded border-gray-300"
                        data-testid="checkbox-notify-week-complete"
                      />
                      <div className="space-y-0.5">
                        <Label htmlFor="notify-week-complete" className="cursor-pointer">
                          Notify office administrators when weekly reports are ready
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Send notifications when all shifts for a week have been approved
                        </p>
                      </div>
                    </div>

                    <Button
                      onClick={() => updatePayrollMutation.mutate(payrollForm)}
                      disabled={updatePayrollMutation.isPending}
                      className="mt-4"
                      data-testid="button-save-payroll"
                    >
                      {updatePayrollMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Save Settings
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Weekly Reports
                    </CardTitle>
                    <CardDescription>
                      Automated end-of-week hour summaries
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Alert>
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>
                        Weekly payroll reports are automatically generated when all time clock shifts 
                        for a work week have been approved by a superintendent or manager.
                      </AlertDescription>
                    </Alert>
                    
                    <div className="text-sm space-y-2">
                      <h4 className="font-medium">Report includes:</h4>
                      <ul className="list-disc list-inside text-muted-foreground space-y-1">
                        <li>Total hours worked per employee</li>
                        <li>Regular hours and overtime breakdown</li>
                        <li>Week start and end dates</li>
                      </ul>
                    </div>

                    <div className="text-sm space-y-2">
                      <h4 className="font-medium">Current work week:</h4>
                      <p className="text-muted-foreground">
                        Starts on {DAYS_OF_WEEK.find(d => d.value === payrollForm.workWeekStartDay)?.label || "Sunday"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="hustler" className="mt-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-semibold">Hustler Oversight</h2>
                <p className="text-sm text-muted-foreground">
                  Invite business owners (HUSTLERs) to have oversight access to your organization
                </p>
              </div>
              <Button onClick={() => setShowInviteHustlerDialog(true)} data-testid="button-invite-hustler">
                <UserPlus className="h-4 w-4 mr-2" />
                Invite HUSTLER
              </Button>
            </div>

            {copiedLink && (
              <Alert>
                <Link2 className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
                  <span>Invite link created! Share this with your HUSTLER:</span>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted px-2 py-1 rounded text-sm">
                      {window.location.origin}{copiedLink}
                    </code>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${copiedLink}`);
                        toast({ title: "Link copied to clipboard!" });
                      }}
                      data-testid="button-copy-link"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => setCopiedLink(null)}
                      data-testid="button-dismiss-link"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {loadingHustlerRequests ? (
              <div className="space-y-4">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : hustlerLinkRequests.requests.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    No HUSTLER invites or requests yet. Invite a business owner to give them oversight access.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {hustlerLinkRequests.requests.map((request) => (
                  <Card key={request.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Mail className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{request.hustlerEmail}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>
                                {request.requestType === "INVITE" ? "Invited" : "Requested"} {" "}
                                {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                              </span>
                              {request.roleOverride && (
                                <Badge variant="secondary" className="text-xs">
                                  Role: {request.roleOverride}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={
                              request.status === "PENDING" ? "secondary" :
                              request.status === "APPROVED" ? "default" :
                              "destructive"
                            }
                            data-testid={`badge-status-${request.id}`}
                          >
                            {request.status}
                          </Badge>
                          {request.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revokeInviteMutation.mutate(request.id)}
                              disabled={revokeInviteMutation.isPending}
                              data-testid={`button-revoke-${request.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {request.message && (
                        <p className="mt-2 text-sm text-muted-foreground pl-14">
                          "{request.message}"
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showInviteHustlerDialog} onOpenChange={setShowInviteHustlerDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite HUSTLER</DialogTitle>
            <DialogDescription>
              Send an invite to a business owner to give them oversight access to your organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hustler-email">HUSTLER Email</Label>
              <Input
                id="hustler-email"
                type="email"
                value={hustlerEmail}
                onChange={(e) => setHustlerEmail(e.target.value)}
                placeholder="Enter email address"
                data-testid="input-hustler-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hustler-role">Role Override (Optional)</Label>
              <Select
                value={hustlerRoleOverride}
                onValueChange={setHustlerRoleOverride}
              >
                <SelectTrigger data-testid="select-hustler-role">
                  <SelectValue placeholder="Default: Read-only oversight" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Read-only oversight (default)</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                  <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                  <SelectItem value="OFFICE_MANAGER">Office Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hustler-message">Message (Optional)</Label>
              <Textarea
                id="hustler-message"
                value={hustlerMessage}
                onChange={(e) => setHustlerMessage(e.target.value)}
                placeholder="Add a personal message..."
                rows={2}
                data-testid="input-hustler-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteHustlerDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => inviteHustlerMutation.mutate({
                hustlerEmail,
                message: hustlerMessage || undefined,
                roleOverride: hustlerRoleOverride && hustlerRoleOverride !== "NONE" ? hustlerRoleOverride : undefined,
              })}
              disabled={!hustlerEmail || inviteHustlerMutation.isPending}
              data-testid="button-send-invite"
            >
              {inviteHustlerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !uploadForm.effectiveDate && "text-muted-foreground"
                        )}
                        data-testid="input-effective-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {uploadForm.effectiveDate ? format(parseISO(uploadForm.effectiveDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={uploadForm.effectiveDate ? parseISO(uploadForm.effectiveDate) : undefined}
                        onSelect={(date) => setUploadForm({ ...uploadForm, effectiveDate: date ? format(date, "yyyy-MM-dd") : "" })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expiry-date">Expiration Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !uploadForm.expiresAt && "text-muted-foreground"
                        )}
                        data-testid="input-expiry-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {uploadForm.expiresAt ? format(parseISO(uploadForm.expiresAt), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={uploadForm.expiresAt ? parseISO(uploadForm.expiresAt) : undefined}
                        onSelect={(date) => setUploadForm({ ...uploadForm, expiresAt: date ? format(date, "yyyy-MM-dd") : "" })}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
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
                onGetUploadParameters={onGetUploadParameters}
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

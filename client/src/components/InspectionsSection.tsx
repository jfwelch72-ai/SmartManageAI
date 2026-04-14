import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Plus, ClipboardCheck, Calendar, CheckCircle, XCircle, Clock, Building, User, Mail, Phone, FileText, Download, Eye, Edit2, Loader2, Send, Ban, ClipboardList } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectInspection } from "@shared/schema";

interface InspectionsSectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const INSPECTION_TYPE_OPTIONS = [
  { value: "CITY_OFFICIAL", label: "City Official", icon: Building },
  { value: "GC_REPRESENTATIVE", label: "GC Representative", icon: User },
  { value: "OWNER_REPRESENTATIVE", label: "Owner Representative", icon: User },
];

const REQUEST_METHOD_OPTIONS = [
  { value: "CALL", label: "Phone Call" },
  { value: "EMAIL", label: "Email" },
  { value: "PORTAL", label: "Online Portal" },
  { value: "OTHER", label: "Other" },
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REQUESTED: "secondary",
  SCHEDULED: "default",
  PASSED: "outline",
  FAILED: "destructive",
  CANCELLED: "outline"
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  REQUESTED: Clock,
  SCHEDULED: Calendar,
  PASSED: CheckCircle,
  FAILED: XCircle,
  CANCELLED: Ban
};

export function InspectionsSection({ projectId, projectCode, userRole }: InspectionsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<ProjectInspection | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [formData, setFormData] = useState({
    inspectionType: "",
    title: "",
    description: "",
    requestMethod: "",
    requestedDate: "",
    scheduledDate: "",
    inspectorName: "",
    inspectorCompany: "",
    inspectorPhone: "",
    inspectorEmail: "",
    gcRepName: "",
    gcRepCompany: "",
    gcRepPhone: "",
    gcRepEmail: "",
    ownerRepName: "",
    ownerRepCompany: "",
    ownerRepPhone: "",
    ownerRepEmail: ""
  });

  const [resultFormData, setResultFormData] = useState({
    resultNotes: "",
    punchListItems: "",
    reinspectionRequired: false,
    reinspectionDate: ""
  });

  const canCreateInspection = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canEditInspection = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canPassFail = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canSchedule = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";

  const { data: inspections = [], isLoading } = useQuery<ProjectInspection[]>({
    queryKey: ["/api/projects", projectId, "inspections"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/inspections`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch inspections");
      return response.json();
    },
    enabled: !!projectId,
  });

  const createInspection = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", `/api/projects/${projectId}/inspections`, {
        inspectionType: data.inspectionType,
        title: data.title,
        description: data.description || null,
        requestMethod: data.requestMethod || null,
        requestedDate: new Date(data.requestedDate).toISOString(),
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate).toISOString() : null,
        inspectorName: data.inspectorName || null,
        inspectorCompany: data.inspectorCompany || null,
        inspectorPhone: data.inspectorPhone || null,
        inspectorEmail: data.inspectorEmail || null,
        gcRepName: data.gcRepName || null,
        gcRepCompany: data.gcRepCompany || null,
        gcRepPhone: data.gcRepPhone || null,
        gcRepEmail: data.gcRepEmail || null,
        ownerRepName: data.ownerRepName || null,
        ownerRepCompany: data.ownerRepCompany || null,
        ownerRepPhone: data.ownerRepPhone || null,
        ownerRepEmail: data.ownerRepEmail || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Success", description: "Inspection request created" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create inspection", variant: "destructive" });
    },
  });

  const updateInspection = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const payload: any = {};
      if (data.inspectionType) payload.inspectionType = data.inspectionType;
      if (data.title) payload.title = data.title;
      if (data.description !== undefined) payload.description = data.description;
      if (data.requestMethod !== undefined) payload.requestMethod = data.requestMethod;
      if (data.requestedDate) payload.requestedDate = new Date(data.requestedDate).toISOString();
      if (data.scheduledDate !== undefined) payload.scheduledDate = data.scheduledDate ? new Date(data.scheduledDate).toISOString() : null;
      if (data.inspectorName !== undefined) payload.inspectorName = data.inspectorName;
      if (data.inspectorCompany !== undefined) payload.inspectorCompany = data.inspectorCompany;
      if (data.inspectorPhone !== undefined) payload.inspectorPhone = data.inspectorPhone;
      if (data.inspectorEmail !== undefined) payload.inspectorEmail = data.inspectorEmail;
      if (data.gcRepName !== undefined) payload.gcRepName = data.gcRepName;
      if (data.gcRepCompany !== undefined) payload.gcRepCompany = data.gcRepCompany;
      if (data.gcRepPhone !== undefined) payload.gcRepPhone = data.gcRepPhone;
      if (data.gcRepEmail !== undefined) payload.gcRepEmail = data.gcRepEmail;
      if (data.ownerRepName !== undefined) payload.ownerRepName = data.ownerRepName;
      if (data.ownerRepCompany !== undefined) payload.ownerRepCompany = data.ownerRepCompany;
      if (data.ownerRepPhone !== undefined) payload.ownerRepPhone = data.ownerRepPhone;
      if (data.ownerRepEmail !== undefined) payload.ownerRepEmail = data.ownerRepEmail;
      return apiRequest("PATCH", `/api/inspections/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      setShowEditDialog(false);
      setSelectedInspection(null);
      resetForm();
      toast({ title: "Success", description: "Inspection updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update inspection", variant: "destructive" });
    },
  });

  const scheduleInspection = useMutation({
    mutationFn: async ({ id, scheduledDate }: { id: string; scheduledDate: string }) => {
      return apiRequest("POST", `/api/inspections/${id}/schedule`, { 
        scheduledDate: new Date(scheduledDate).toISOString() 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      toast({ title: "Success", description: "Inspection scheduled" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to schedule inspection", variant: "destructive" });
    },
  });

  const passInspection = useMutation({
    mutationFn: async ({ id, resultNotes }: { id: string; resultNotes?: string }) => {
      return apiRequest("POST", `/api/inspections/${id}/pass`, { resultNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      setShowDetailDialog(false);
      setSelectedInspection(null);
      toast({ title: "Success", description: "Inspection marked as passed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to pass inspection", variant: "destructive" });
    },
  });

  const failInspection = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof resultFormData }) => {
      return apiRequest("POST", `/api/inspections/${id}/fail`, {
        resultNotes: data.resultNotes || null,
        punchListItems: data.punchListItems || null,
        reinspectionRequired: data.reinspectionRequired,
        reinspectionDate: data.reinspectionDate ? new Date(data.reinspectionDate).toISOString() : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      setShowDetailDialog(false);
      setSelectedInspection(null);
      resetResultForm();
      toast({ title: "Success", description: "Inspection marked as failed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to fail inspection", variant: "destructive" });
    },
  });

  const cancelInspection = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/inspections/${id}/cancel`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      toast({ title: "Success", description: "Inspection cancelled" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to cancel inspection", variant: "destructive" });
    },
  });

  const createPunchItemFromInspection = useMutation({
    mutationFn: async ({ inspectionId }: { inspectionId: string }) => {
      return apiRequest("POST", `/api/projects/${projectCode}/inspections/${inspectionId}/punch-list`, {
        trade: "GENERAL",
        priority: "HIGH",
      });
    },
    onSuccess: (data: any) => {
      const count = Array.isArray(data) ? data.length : 1;
      toast({
        title: `${count} punch list item${count !== 1 ? "s" : ""} created`,
        description: "Items added to the project punch list.",
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create punch list items", variant: "destructive" });
    },
  });

  const sendNotification = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/inspections/${id}/send-notification`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inspections"] });
      toast({ title: "Success", description: "Notification sent" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to send notification", variant: "destructive" });
    },
  });

  const [pdfLoading, setPdfLoading] = useState(false);
  const generatePDF = {
    mutate: async (id: string) => {
      try {
        setPdfLoading(true);
        const response = await fetch(`/api/inspections/${id}/pdf`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error('Failed to generate PDF');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        toast({ title: "Success", description: "PDF opened in new tab" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message || "Failed to generate PDF", variant: "destructive" });
      } finally {
        setPdfLoading(false);
      }
    },
    isPending: pdfLoading,
  };

  const resetForm = () => {
    setFormData({
      inspectionType: "",
      title: "",
      description: "",
      requestMethod: "",
      requestedDate: "",
      scheduledDate: "",
      inspectorName: "",
      inspectorCompany: "",
      inspectorPhone: "",
      inspectorEmail: "",
      gcRepName: "",
      gcRepCompany: "",
      gcRepPhone: "",
      gcRepEmail: "",
      ownerRepName: "",
      ownerRepCompany: "",
      ownerRepPhone: "",
      ownerRepEmail: ""
    });
  };

  const resetResultForm = () => {
    setResultFormData({
      resultNotes: "",
      punchListItems: "",
      reinspectionRequired: false,
      reinspectionDate: ""
    });
  };

  const handleEdit = (inspection: ProjectInspection) => {
    setSelectedInspection(inspection);
    setFormData({
      inspectionType: inspection.inspectionType,
      title: inspection.title,
      description: inspection.description || "",
      requestMethod: inspection.requestMethod || "",
      requestedDate: inspection.requestedDate ? format(new Date(inspection.requestedDate), "yyyy-MM-dd'T'HH:mm") : "",
      scheduledDate: inspection.scheduledDate ? format(new Date(inspection.scheduledDate), "yyyy-MM-dd'T'HH:mm") : "",
      inspectorName: inspection.inspectorName || "",
      inspectorCompany: inspection.inspectorCompany || "",
      inspectorPhone: inspection.inspectorPhone || "",
      inspectorEmail: inspection.inspectorEmail || "",
      gcRepName: inspection.gcRepName || "",
      gcRepCompany: inspection.gcRepCompany || "",
      gcRepPhone: inspection.gcRepPhone || "",
      gcRepEmail: inspection.gcRepEmail || "",
      ownerRepName: inspection.ownerRepName || "",
      ownerRepCompany: inspection.ownerRepCompany || "",
      ownerRepPhone: inspection.ownerRepPhone || "",
      ownerRepEmail: inspection.ownerRepEmail || ""
    });
    setShowEditDialog(true);
  };

  const handleViewDetails = (inspection: ProjectInspection) => {
    setSelectedInspection(inspection);
    setShowDetailDialog(true);
  };

  const filteredInspections = inspections.filter((i: ProjectInspection) => {
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    if (typeFilter !== "all" && i.inspectionType !== typeFilter) return false;
    return true;
  });

  const pendingCount = inspections.filter((i: ProjectInspection) => i.status === "REQUESTED" || i.status === "SCHEDULED").length;
  const passedCount = inspections.filter((i: ProjectInspection) => i.status === "PASSED").length;
  const failedCount = inspections.filter((i: ProjectInspection) => i.status === "FAILED").length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading inspections...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Inspections
            </CardTitle>
            <CardDescription>
              Schedule and track inspections for this project
            </CardDescription>
          </div>
          {canCreateInspection && (
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-inspection">
              <Plus className="h-4 w-4 mr-2" />
              New Inspection
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-green-600">{passedCount}</div>
                <div className="text-sm text-muted-foreground">Passed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-red-600">{failedCount}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-4 mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="REQUESTED">Requested</SelectItem>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="PASSED">Passed</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="CITY_OFFICIAL">City Official</SelectItem>
                <SelectItem value="GC_REPRESENTATIVE">GC Representative</SelectItem>
                <SelectItem value="OWNER_REPRESENTATIVE">Owner Representative</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredInspections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No inspections found. {canCreateInspection && "Click 'New Inspection' to create one."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredInspections.map((inspection: ProjectInspection) => {
                const StatusIcon = STATUS_ICONS[inspection.status] || Clock;
                const typeOption = INSPECTION_TYPE_OPTIONS.find(t => t.value === inspection.inspectionType);
                const TypeIcon = typeOption?.icon || Building;

                return (
                  <Card key={inspection.id} className="hover-elevate cursor-pointer" onClick={() => handleViewDetails(inspection)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <TypeIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{inspection.title}</span>
                            <Badge variant={STATUS_COLORS[inspection.status]}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {inspection.status}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {inspection.inspectionNumber} | {typeOption?.label || inspection.inspectionType}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {inspection.scheduledDate ? (
                              <span className="text-primary">
                                Scheduled: {format(new Date(inspection.scheduledDate), "MMM d, yyyy h:mm a")}
                              </span>
                            ) : (
                              <span>Requested: {format(new Date(inspection.requestedDate), "MMM d, yyyy")}</span>
                            )}
                          </div>
                          {inspection.inspectorName && (
                            <div className="text-sm text-muted-foreground mt-1">
                              Inspector: {inspection.inspectorName}
                              {inspection.inspectorCompany && ` (${inspection.inspectorCompany})`}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                          {canEditInspection && inspection.status === "REQUESTED" && (
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(inspection)} data-testid={`button-edit-inspection-${inspection.id}`}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                          {inspection.requestPdfUrl && (
                            <Button variant="ghost" size="icon" onClick={() => window.open(inspection.requestPdfUrl!, "_blank")} data-testid={`button-download-pdf-${inspection.id}`}>
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Inspection Request</DialogTitle>
            <DialogDescription>Schedule an inspection with city officials, GC, or owner representatives</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createInspection.mutate(formData); }}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="inspectionType">Inspection Type *</Label>
                  <Select value={formData.inspectionType} onValueChange={(value) => setFormData(prev => ({ ...prev, inspectionType: value }))}>
                    <SelectTrigger id="inspectionType" data-testid="select-inspection-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {INSPECTION_TYPE_OPTIONS.map(type => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="requestMethod">Request Method</Label>
                  <Select value={formData.requestMethod} onValueChange={(value) => setFormData(prev => ({ ...prev, requestMethod: value }))}>
                    <SelectTrigger id="requestMethod" data-testid="select-request-method">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_METHOD_OPTIONS.map(method => (
                        <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Footing Inspection, Rough Electrical"
                  required
                  data-testid="input-inspection-title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Additional details about the inspection"
                  data-testid="input-inspection-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="requestedDate">Requested Date *</Label>
                  <DateTimePicker
                    value={formData.requestedDate ? parseISO(formData.requestedDate) : undefined}
                    onChange={(date) => setFormData(prev => ({ 
                      ...prev, 
                      requestedDate: date ? format(date, "yyyy-MM-dd'T'HH:mm") : "" 
                    }))}
                    placeholder="Select date and time"
                    required
                    data-testid="input-requested-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheduledDate">Scheduled Date</Label>
                  <DateTimePicker
                    value={formData.scheduledDate ? parseISO(formData.scheduledDate) : undefined}
                    onChange={(date) => setFormData(prev => ({ 
                      ...prev, 
                      scheduledDate: date ? format(date, "yyyy-MM-dd'T'HH:mm") : "" 
                    }))}
                    placeholder="Select date and time"
                    data-testid="input-scheduled-date"
                  />
                </div>
              </div>

              <Tabs defaultValue="inspector" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="inspector">Inspector</TabsTrigger>
                  <TabsTrigger value="gc">GC Rep</TabsTrigger>
                  <TabsTrigger value="owner">Owner Rep</TabsTrigger>
                </TabsList>
                <TabsContent value="inspector" className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={formData.inspectorName}
                        onChange={(e) => setFormData(prev => ({ ...prev, inspectorName: e.target.value }))}
                        placeholder="Inspector name"
                        data-testid="input-inspector-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={formData.inspectorCompany}
                        onChange={(e) => setFormData(prev => ({ ...prev, inspectorCompany: e.target.value }))}
                        placeholder="Company/Agency"
                        data-testid="input-inspector-company"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={formData.inspectorPhone}
                        onChange={(e) => setFormData(prev => ({ ...prev, inspectorPhone: e.target.value }))}
                        placeholder="Phone number"
                        data-testid="input-inspector-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={formData.inspectorEmail}
                        onChange={(e) => setFormData(prev => ({ ...prev, inspectorEmail: e.target.value }))}
                        placeholder="Email address"
                        data-testid="input-inspector-email"
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="gc" className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={formData.gcRepName}
                        onChange={(e) => setFormData(prev => ({ ...prev, gcRepName: e.target.value }))}
                        placeholder="GC Rep name"
                        data-testid="input-gc-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={formData.gcRepCompany}
                        onChange={(e) => setFormData(prev => ({ ...prev, gcRepCompany: e.target.value }))}
                        placeholder="Company"
                        data-testid="input-gc-company"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={formData.gcRepPhone}
                        onChange={(e) => setFormData(prev => ({ ...prev, gcRepPhone: e.target.value }))}
                        placeholder="Phone number"
                        data-testid="input-gc-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={formData.gcRepEmail}
                        onChange={(e) => setFormData(prev => ({ ...prev, gcRepEmail: e.target.value }))}
                        placeholder="Email address"
                        data-testid="input-gc-email"
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="owner" className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={formData.ownerRepName}
                        onChange={(e) => setFormData(prev => ({ ...prev, ownerRepName: e.target.value }))}
                        placeholder="Owner Rep name"
                        data-testid="input-owner-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={formData.ownerRepCompany}
                        onChange={(e) => setFormData(prev => ({ ...prev, ownerRepCompany: e.target.value }))}
                        placeholder="Company"
                        data-testid="input-owner-company"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={formData.ownerRepPhone}
                        onChange={(e) => setFormData(prev => ({ ...prev, ownerRepPhone: e.target.value }))}
                        placeholder="Phone number"
                        data-testid="input-owner-phone"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={formData.ownerRepEmail}
                        onChange={(e) => setFormData(prev => ({ ...prev, ownerRepEmail: e.target.value }))}
                        placeholder="Email address"
                        data-testid="input-owner-email"
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createInspection.isPending} data-testid="button-submit-inspection">
                {createInspection.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Inspection
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Inspection</DialogTitle>
            <DialogDescription>Update inspection details</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (selectedInspection) updateInspection.mutate({ id: selectedInspection.id, data: formData }); }}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-inspectionType">Inspection Type *</Label>
                  <Select value={formData.inspectionType} onValueChange={(value) => setFormData(prev => ({ ...prev, inspectionType: value }))}>
                    <SelectTrigger id="edit-inspectionType">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {INSPECTION_TYPE_OPTIONS.map(type => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-requestMethod">Request Method</Label>
                  <Select value={formData.requestMethod} onValueChange={(value) => setFormData(prev => ({ ...prev, requestMethod: value }))}>
                    <SelectTrigger id="edit-requestMethod">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_METHOD_OPTIONS.map(method => (
                        <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-title">Title *</Label>
                <Input
                  id="edit-title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Footing Inspection, Rough Electrical"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Additional details about the inspection"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-requestedDate">Requested Date *</Label>
                  <DateTimePicker
                    value={formData.requestedDate ? parseISO(formData.requestedDate) : undefined}
                    onChange={(date) => setFormData(prev => ({ 
                      ...prev, 
                      requestedDate: date ? format(date, "yyyy-MM-dd'T'HH:mm") : "" 
                    }))}
                    placeholder="Select date and time"
                    required
                    data-testid="input-edit-requested-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-scheduledDate">Scheduled Date</Label>
                  <DateTimePicker
                    value={formData.scheduledDate ? parseISO(formData.scheduledDate) : undefined}
                    onChange={(date) => setFormData(prev => ({ 
                      ...prev, 
                      scheduledDate: date ? format(date, "yyyy-MM-dd'T'HH:mm") : "" 
                    }))}
                    placeholder="Select date and time"
                    data-testid="input-edit-scheduled-date"
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => { setShowEditDialog(false); setSelectedInspection(null); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateInspection.isPending}>
                {updateInspection.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Inspection Details
            </DialogTitle>
          </DialogHeader>
          {selectedInspection && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{selectedInspection.title}</h3>
                  <p className="text-sm text-muted-foreground">{selectedInspection.inspectionNumber}</p>
                </div>
                <Badge variant={STATUS_COLORS[selectedInspection.status]} className="text-sm">
                  {selectedInspection.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="font-medium">{INSPECTION_TYPE_OPTIONS.find(t => t.value === selectedInspection.inspectionType)?.label}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Request Method</Label>
                  <p className="font-medium">{REQUEST_METHOD_OPTIONS.find(m => m.value === selectedInspection.requestMethod)?.label || "N/A"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Requested Date</Label>
                  <p className="font-medium">{format(new Date(selectedInspection.requestedDate), "MMM d, yyyy h:mm a")}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Scheduled Date</Label>
                  <p className="font-medium">{selectedInspection.scheduledDate ? format(new Date(selectedInspection.scheduledDate), "MMM d, yyyy h:mm a") : "Not scheduled"}</p>
                </div>
              </div>

              {selectedInspection.description && (
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="mt-1">{selectedInspection.description}</p>
                </div>
              )}

              {(selectedInspection.inspectorName || selectedInspection.gcRepName || selectedInspection.ownerRepName) && (
                <div className="space-y-4">
                  <Label className="text-muted-foreground">Contacts</Label>
                  {selectedInspection.inspectorName && (
                    <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                      <Building className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{selectedInspection.inspectorName}</p>
                        <p className="text-sm text-muted-foreground">{selectedInspection.inspectorCompany}</p>
                        {selectedInspection.inspectorEmail && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {selectedInspection.inspectorEmail}
                          </p>
                        )}
                        {selectedInspection.inspectorPhone && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {selectedInspection.inspectorPhone}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedInspection.resultNotes && (
                <div>
                  <Label className="text-muted-foreground">Result Notes</Label>
                  <p className="mt-1">{selectedInspection.resultNotes}</p>
                </div>
              )}

              {selectedInspection.punchListItems && (
                <div>
                  <Label className="text-muted-foreground">Punch List Items (from inspection)</Label>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{selectedInspection.punchListItems}</p>
                  {selectedInspection.status === "FAILED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 text-orange-700 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                      disabled={createPunchItemFromInspection.isPending}
                      onClick={() => {
                        createPunchItemFromInspection.mutate({
                          inspectionId: selectedInspection.id,
                        });
                      }}
                      data-testid="button-create-punch-from-inspection"
                    >
                      {createPunchItemFromInspection.isPending
                        ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        : <ClipboardList className="h-4 w-4 mr-1.5" />}
                      Add to Punch List
                    </Button>
                  )}
                </div>
              )}

              {selectedInspection.reinspectionRequired && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">Reinspection Required</p>
                  {selectedInspection.reinspectionDate && (
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Scheduled for: {format(new Date(selectedInspection.reinspectionDate), "MMM d, yyyy")}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-4 border-t">
                {canSchedule && selectedInspection.status === "REQUESTED" && (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      const date = prompt("Enter scheduled date (YYYY-MM-DD HH:MM):");
                      if (date) {
                        scheduleInspection.mutate({ id: selectedInspection.id, scheduledDate: date });
                      }
                    }}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Schedule
                  </Button>
                )}

                {canPassFail && (selectedInspection.status === "SCHEDULED" || selectedInspection.status === "REQUESTED") && (
                  <>
                    <Button 
                      variant="outline" 
                      className="text-green-600 border-green-600"
                      onClick={() => {
                        const notes = prompt("Enter any notes (optional):");
                        passInspection.mutate({ id: selectedInspection.id, resultNotes: notes || undefined });
                      }}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Pass
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="text-red-600 border-red-600">
                          <XCircle className="h-4 w-4 mr-2" />
                          Fail
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Record Failed Inspection</AlertDialogTitle>
                          <AlertDialogDescription>
                            Document the issues and schedule a reinspection if needed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Result Notes</Label>
                            <Textarea
                              value={resultFormData.resultNotes}
                              onChange={(e) => setResultFormData(prev => ({ ...prev, resultNotes: e.target.value }))}
                              placeholder="Describe the issues found"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Punch List Items</Label>
                            <Textarea
                              value={resultFormData.punchListItems}
                              onChange={(e) => setResultFormData(prev => ({ ...prev, punchListItems: e.target.value }))}
                              placeholder="List items that need to be fixed"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="reinspectionRequired"
                              checked={resultFormData.reinspectionRequired}
                              onChange={(e) => setResultFormData(prev => ({ ...prev, reinspectionRequired: e.target.checked }))}
                            />
                            <Label htmlFor="reinspectionRequired">Reinspection Required</Label>
                          </div>
                          {resultFormData.reinspectionRequired && (
                            <div className="space-y-2">
                              <Label>Reinspection Date</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    type="button"
                                    className={cn(
                                      "w-full justify-start text-left font-normal",
                                      !resultFormData.reinspectionDate && "text-muted-foreground"
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {resultFormData.reinspectionDate ? format(parseISO(resultFormData.reinspectionDate), "PPP") : "Pick a date"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <CalendarPicker
                                    mode="single"
                                    selected={resultFormData.reinspectionDate ? parseISO(resultFormData.reinspectionDate) : undefined}
                                    onSelect={(date) => setResultFormData(prev => ({ ...prev, reinspectionDate: date ? format(date, "yyyy-MM-dd") : "" }))}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          )}
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={resetResultForm}>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => failInspection.mutate({ id: selectedInspection.id, data: resultFormData })}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            Record Failure
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}

                {selectedInspection.status !== "CANCELLED" && selectedInspection.status !== "PASSED" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" className="text-muted-foreground">
                        <Ban className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Inspection</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to cancel this inspection? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>No, keep it</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelInspection.mutate(selectedInspection.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Yes, cancel inspection
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <div className="flex-1" />

                <Button 
                  variant="outline"
                  onClick={() => generatePDF.mutate(selectedInspection.id)}
                  disabled={generatePDF.isPending}
                >
                  {generatePDF.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  Generate PDF
                </Button>

                {(selectedInspection.inspectorEmail || selectedInspection.gcRepEmail || selectedInspection.ownerRepEmail) && (
                  <Button 
                    variant="default"
                    onClick={() => sendNotification.mutate(selectedInspection.id)}
                    disabled={sendNotification.isPending}
                  >
                    {sendNotification.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send Notification
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default InspectionsSection;

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Plus, CloudRain, Clock, Building, Truck, FileWarning, CheckCircle, AlertTriangle, Send, Undo2, FileText, ExternalLink, DollarSign, Loader2, Mail, Download, Eye, Edit2, CalendarIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ProjectDelay, ChangeOrder } from "@shared/schema";
import { WeatherEvidenceCard } from "./WeatherEvidenceCard";

interface DelaySectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const DELAY_REASON_OPTIONS = [
  { value: "WEATHER", label: "Weather", icon: CloudRain },
  { value: "GC_SCHEDULING", label: "GC Scheduling", icon: Clock },
  { value: "OTHER_CONTRACTORS", label: "Other Contractors", icon: Building },
  { value: "MATERIAL_DELIVERY", label: "Material Delivery", icon: Truck },
  { value: "PERMIT_ISSUES", label: "Permit Issues", icon: FileWarning },
  { value: "INSPECTION_DELAY", label: "Inspection Delay", icon: CheckCircle },
  { value: "OWNER_DIRECTIVE", label: "Owner Directive", icon: FileText },
  { value: "DESIGN_CHANGES", label: "Design Changes", icon: FileText },
  { value: "SITE_CONDITIONS", label: "Site Conditions", icon: AlertTriangle },
  { value: "LABOR_SHORTAGE", label: "Labor Shortage", icon: Building },
  { value: "OTHER", label: "Other", icon: AlertTriangle },
];

const RESPONSIBILITY_OPTIONS = [
  { value: "OWNER", label: "Owner" },
  { value: "GC", label: "General Contractor" },
  { value: "SUBCONTRACTOR", label: "Subcontractor" },
  { value: "TFR", label: "Contractor (Self)" },
  { value: "FORCE_MAJEURE", label: "Force Majeure (Weather/Act of God)" },
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  SUBMITTED: "default",
  ACKNOWLEDGED: "default",
  RESOLVED: "outline"
};

interface ExtendedDelay extends ProjectDelay {
  reasonLabel?: string;
  responsibilityLabel?: string;
  linkedChangeOrder?: ChangeOrder | null;
}

interface DelayNotification {
  id: string;
  delayId: string;
  recipientType: "OWNER_REP" | "GC_REP" | "OTHER";
  recipientName: string;
  recipientCompany: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
  status: "DRAFT" | "FINALIZED";
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

const RECIPIENT_TYPE_OPTIONS = [
  { value: "OWNER_REP", label: "Owner's Representative" },
  { value: "GC_REP", label: "General Contractor" },
  { value: "OTHER", label: "Other Party" },
];

export function DelaysSection({ projectId, projectCode, userRole }: DelaySectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedDelay, setSelectedDelay] = useState<ExtendedDelay | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [scheduleImpactDialog, setScheduleImpactDialog] = useState<{ delayId: string; impactDays: number; criticalPathAffected: boolean } | null>(null);

  const [formData, setFormData] = useState({
    reason: "",
    reasonNotes: "",
    startDateTime: "",
    endDateTime: "",
    estimatedDuration: "",
    ownerRepName: "",
    gcRepName: "",
    financiallyResponsible: "",
    changeOrderRequired: false,
    proceedToWorkDate: "",
    proceedToWorkNotes: ""
  });

  const [showNotificationDialog, setShowNotificationDialog] = useState(false);
  const [selectedDelayForNotification, setSelectedDelayForNotification] = useState<ExtendedDelay | null>(null);
  const [notificationMode, setNotificationMode] = useState<"create" | "edit" | "view">("create");
  const [selectedNotification, setSelectedNotification] = useState<DelayNotification | null>(null);
  const [notificationFormData, setNotificationFormData] = useState({
    recipientType: "OWNER_REP" as "OWNER_REP" | "GC_REP" | "OTHER",
    recipientName: "",
    recipientCompany: "",
    recipientEmail: "",
    subject: "",
    body: ""
  });

  const canCreateDelay = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canGenerateNotification = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canAcknowledge = userRole === "ADMIN" || userRole === "MANAGER";
  const canCreateChangeOrder = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";

  const { data: delays = [], isLoading } = useQuery<ExtendedDelay[]>({
    queryKey: ["/api/projects", projectId, "delays"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/delays`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch delays");
      return response.json();
    },
    enabled: !!projectId,
  });

  const createDelay = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/delays`, {
        reason: data.reason,
        reasonNotes: data.reasonNotes || null,
        startDateTime: new Date(data.startDateTime).toISOString(),
        endDateTime: data.endDateTime ? new Date(data.endDateTime).toISOString() : null,
        estimatedDuration: data.estimatedDuration ? parseInt(data.estimatedDuration) : null,
        ownerRepName: data.ownerRepName || null,
        gcRepName: data.gcRepName || null,
        financiallyResponsible: data.financiallyResponsible,
        changeOrderRequired: data.changeOrderRequired,
        proceedToWorkDate: data.proceedToWorkDate ? new Date(data.proceedToWorkDate).toISOString() : null,
        proceedToWorkNotes: data.proceedToWorkNotes || null
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Success", description: "Delay report created" });
      if (data?.scheduleImpact?.criticalPathAffected && data?.id) {
        setScheduleImpactDialog({
          delayId: data.id,
          impactDays: data.scheduleImpact.impactDays,
          criticalPathAffected: true,
        });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create delay", variant: "destructive" });
    },
  });

  const updateDelay = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const payload: any = {};
      if (data.reason) payload.reason = data.reason;
      if (data.reasonNotes !== undefined) payload.reasonNotes = data.reasonNotes;
      if (data.startDateTime) payload.startDateTime = new Date(data.startDateTime).toISOString();
      if (data.endDateTime !== undefined) payload.endDateTime = data.endDateTime ? new Date(data.endDateTime).toISOString() : null;
      if (data.estimatedDuration !== undefined) payload.estimatedDuration = data.estimatedDuration ? parseInt(data.estimatedDuration) : null;
      if (data.ownerRepName !== undefined) payload.ownerRepName = data.ownerRepName;
      if (data.gcRepName !== undefined) payload.gcRepName = data.gcRepName;
      if (data.financiallyResponsible) payload.financiallyResponsible = data.financiallyResponsible;
      if (data.changeOrderRequired !== undefined) payload.changeOrderRequired = data.changeOrderRequired;
      if (data.proceedToWorkDate !== undefined) payload.proceedToWorkDate = data.proceedToWorkDate ? new Date(data.proceedToWorkDate).toISOString() : null;
      if (data.proceedToWorkNotes !== undefined) payload.proceedToWorkNotes = data.proceedToWorkNotes;
      const res = await apiRequest("PATCH", `/api/delays/${id}`, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      setShowEditDialog(false);
      setSelectedDelay(null);
      resetForm();
      toast({ title: "Success", description: "Delay updated" });
      if (data?.scheduleImpact?.criticalPathAffected && data?.id) {
        setScheduleImpactDialog({
          delayId: data.id,
          impactDays: data.scheduleImpact.impactDays,
          criticalPathAffected: true,
        });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update delay", variant: "destructive" });
    },
  });

  const createDraftCOFromImpact = useMutation({
    mutationFn: async (delayId: string) => {
      return apiRequest("POST", `/api/delays/${delayId}/create-change-order`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      setScheduleImpactDialog(null);
      toast({ title: "Draft Change Order Created", description: "A draft change order has been created from the schedule impact analysis." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create change order", variant: "destructive" });
    },
  });

  const submitDelay = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delays/${id}/submit`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      toast({ title: "Success", description: "Delay submitted for acknowledgment" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to submit delay", variant: "destructive" });
    },
  });

  const acknowledgeDelay = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delays/${id}/acknowledge`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      toast({ title: "Success", description: "Delay acknowledged" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to acknowledge delay", variant: "destructive" });
    },
  });

  const resolveDelay = useMutation({
    mutationFn: async ({ id, proceedData }: { id: string; proceedData?: { proceedToWorkDate?: string; proceedToWorkNotes?: string } }) => {
      return apiRequest("POST", `/api/delays/${id}/resolve`, proceedData || {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      toast({ title: "Success", description: "Delay resolved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to resolve delay", variant: "destructive" });
    },
  });

  const revertToDraft = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delays/${id}/revert-to-draft`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      toast({ title: "Success", description: "Delay reverted to draft" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to revert delay", variant: "destructive" });
    },
  });

  const createChangeOrder = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delays/${id}/create-change-order`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "change-orders"] });
      toast({ title: "Success", description: "Change order created from delay" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create change order", variant: "destructive" });
    },
  });

  const generateNotification = useMutation({
    mutationFn: async (data: { delayId: string; recipientType: string; recipientName: string; recipientCompany?: string; recipientEmail?: string }): Promise<DelayNotification> => {
      const response = await apiRequest("POST", `/api/delays/${data.delayId}/notifications/generate`, {
        recipientType: data.recipientType,
        recipientName: data.recipientName,
        recipientCompany: data.recipientCompany || null,
        recipientEmail: data.recipientEmail || null
      });
      return response.json();
    },
    onSuccess: (data: DelayNotification) => {
      queryClient.invalidateQueries({ queryKey: ["/api/delays", selectedDelayForNotification?.id, "notifications"] });
      setSelectedNotification(data);
      setNotificationFormData({
        recipientType: data.recipientType,
        recipientName: data.recipientName,
        recipientCompany: data.recipientCompany || "",
        recipientEmail: data.recipientEmail || "",
        subject: data.subject,
        body: data.body
      });
      setNotificationMode("edit");
      toast({ title: "Success", description: "Notification draft generated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to generate notification", variant: "destructive" });
    },
  });

  const updateNotification = useMutation({
    mutationFn: async (data: { delayId: string; notificationId: string; updates: Partial<typeof notificationFormData> & { status?: string } }): Promise<DelayNotification> => {
      const response = await apiRequest("PATCH", `/api/delays/${data.delayId}/notifications/${data.notificationId}`, data.updates);
      return response.json();
    },
    onSuccess: (data: DelayNotification) => {
      queryClient.invalidateQueries({ queryKey: ["/api/delays", selectedDelayForNotification?.id, "notifications"] });
      setSelectedNotification(data);
      toast({ title: "Success", description: "Notification updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update notification", variant: "destructive" });
    },
  });

  const { data: delayNotifications = [], refetch: refetchNotifications } = useQuery<DelayNotification[]>({
    queryKey: ["/api/delays", selectedDelayForNotification?.id, "notifications"],
    queryFn: async () => {
      if (!selectedDelayForNotification?.id) return [];
      const response = await fetch(`/api/delays/${selectedDelayForNotification.id}/notifications`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return response.json();
    },
    enabled: !!selectedDelayForNotification?.id && showNotificationDialog,
  });

  const openNotificationDialog = (delay: ExtendedDelay) => {
    setSelectedDelayForNotification(delay);
    setNotificationMode("create");
    setSelectedNotification(null);
    setNotificationFormData({
      recipientType: "OWNER_REP",
      recipientName: delay.ownerRepName || "",
      recipientCompany: "",
      recipientEmail: "",
      subject: "",
      body: ""
    });
    setShowNotificationDialog(true);
  };

  const handleDownloadPDF = async (notification: DelayNotification) => {
    if (!selectedDelayForNotification) return;
    try {
      const response = await fetch(`/api/delays/${selectedDelayForNotification.id}/notifications/${notification.id}/pdf`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to generate PDF");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Delay-Notification-${selectedDelayForNotification.delayNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "Success", description: "PDF downloaded" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  const selectExistingNotification = (notification: DelayNotification) => {
    setSelectedNotification(notification);
    setNotificationFormData({
      recipientType: notification.recipientType,
      recipientName: notification.recipientName,
      recipientCompany: notification.recipientCompany || "",
      recipientEmail: notification.recipientEmail || "",
      subject: notification.subject,
      body: notification.body
    });
    setNotificationMode(notification.status === "FINALIZED" ? "view" : "edit");
  };

  const resetForm = () => {
    setFormData({
      reason: "",
      reasonNotes: "",
      startDateTime: "",
      endDateTime: "",
      estimatedDuration: "",
      ownerRepName: "",
      gcRepName: "",
      financiallyResponsible: "",
      changeOrderRequired: false,
      proceedToWorkDate: "",
      proceedToWorkNotes: ""
    });
  };

  const openEditDialog = (delay: ExtendedDelay) => {
    setSelectedDelay(delay);
    setFormData({
      reason: delay.reason,
      reasonNotes: delay.reasonNotes || "",
      startDateTime: delay.startDateTime ? new Date(delay.startDateTime).toISOString().slice(0, 16) : "",
      endDateTime: delay.endDateTime ? new Date(delay.endDateTime).toISOString().slice(0, 16) : "",
      estimatedDuration: delay.estimatedDuration?.toString() || "",
      ownerRepName: delay.ownerRepName || "",
      gcRepName: delay.gcRepName || "",
      financiallyResponsible: delay.financiallyResponsible,
      changeOrderRequired: delay.changeOrderRequired,
      proceedToWorkDate: delay.proceedToWorkDate ? new Date(delay.proceedToWorkDate).toISOString().slice(0, 16) : "",
      proceedToWorkNotes: delay.proceedToWorkNotes || ""
    });
    setShowEditDialog(true);
  };

  const filteredDelays = delays.filter(delay => {
    if (statusFilter !== "all" && delay.status !== statusFilter) return false;
    if (reasonFilter !== "all" && delay.reason !== reasonFilter) return false;
    return true;
  });

  const getReasonIcon = (reason: string) => {
    const option = DELAY_REASON_OPTIONS.find(o => o.value === reason);
    return option ? option.icon : AlertTriangle;
  };

  const activeDelaysCount = delays.filter(d => d.status !== "RESOLVED").length;
  const pendingAckCount = delays.filter(d => d.status === "SUBMITTED").length;
  const needsChangeOrderCount = delays.filter(d => d.changeOrderRequired && !d.linkedChangeOrderId).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Project Delays</h2>
          <p className="text-sm text-muted-foreground">Track weather, scheduling, and contractor delays affecting this project</p>
        </div>
        {canCreateDelay && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-delay">
            <Plus className="h-4 w-4 mr-2" />
            Report Delay
          </Button>
        )}
      </div>

      {(activeDelaysCount > 0 || pendingAckCount > 0 || needsChangeOrderCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-2xl font-bold text-orange-700">{activeDelaysCount}</p>
                  <p className="text-sm text-orange-600">Active Delays</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {pendingAckCount > 0 && (
            <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-8 w-8 text-yellow-600" />
                  <div>
                    <p className="text-2xl font-bold text-yellow-700">{pendingAckCount}</p>
                    <p className="text-sm text-yellow-600">Pending Acknowledgment</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {needsChangeOrderCount > 0 && (
            <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <DollarSign className="h-8 w-8 text-red-600" />
                  <div>
                    <p className="text-2xl font-bold text-red-700">{needsChangeOrderCount}</p>
                    <p className="text-sm text-red-600">Needs Change Order</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-reason-filter">
            <SelectValue placeholder="Filter by reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {DELAY_REASON_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredDelays.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {delays.length === 0 
                ? "No delays reported for this project yet" 
                : "No delays match the current filters"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredDelays.map((delay) => {
            const ReasonIcon = getReasonIcon(delay.reason);
            return (
              <Card key={delay.id} className="hover-elevate" data-testid={`delay-card-${delay.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <ReasonIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base">{delay.delayNumber}</CardTitle>
                          <Badge variant={STATUS_COLORS[delay.status]}>{delay.status}</Badge>
                          {delay.changeOrderRequired && !delay.linkedChangeOrderId && (
                            <Badge variant="destructive" className="gap-1">
                              <DollarSign className="h-3 w-3" />
                              CO Required
                            </Badge>
                          )}
                          {delay.linkedChangeOrderId && (
                            <Badge variant="outline" className="gap-1">
                              <ExternalLink className="h-3 w-3" />
                              CO Linked
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="mt-1">
                          {delay.reasonLabel || delay.reason} - {delay.responsibilityLabel || delay.financiallyResponsible}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {delay.status === "DRAFT" && canCreateDelay && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEditDialog(delay)} data-testid={`button-edit-delay-${delay.id}`}>
                            Edit
                          </Button>
                          <Button size="sm" onClick={() => submitDelay.mutate(delay.id)} disabled={submitDelay.isPending} data-testid={`button-submit-delay-${delay.id}`}>
                            <Send className="h-4 w-4 mr-1" />
                            Submit
                          </Button>
                        </>
                      )}
                      {delay.status === "SUBMITTED" && canAcknowledge && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => revertToDraft.mutate(delay.id)} disabled={revertToDraft.isPending}>
                            <Undo2 className="h-4 w-4 mr-1" />
                            Revise
                          </Button>
                          <Button size="sm" onClick={() => acknowledgeDelay.mutate(delay.id)} disabled={acknowledgeDelay.isPending} data-testid={`button-acknowledge-delay-${delay.id}`}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Acknowledge
                          </Button>
                        </>
                      )}
                      {delay.status === "ACKNOWLEDGED" && canCreateDelay && (
                        <Button size="sm" onClick={() => resolveDelay.mutate({ id: delay.id })} disabled={resolveDelay.isPending} data-testid={`button-resolve-delay-${delay.id}`}>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      )}
                      {delay.changeOrderRequired && !delay.linkedChangeOrderId && canCreateChangeOrder && delay.status !== "DRAFT" && (
                        <Button size="sm" variant="destructive" onClick={() => createChangeOrder.mutate(delay.id)} disabled={createChangeOrder.isPending} data-testid={`button-create-co-delay-${delay.id}`}>
                          <DollarSign className="h-4 w-4 mr-1" />
                          Create CO
                        </Button>
                      )}
                      {delay.status !== "DRAFT" && canGenerateNotification && (
                        <Button size="sm" variant="outline" onClick={() => openNotificationDialog(delay)} data-testid={`button-notify-delay-${delay.id}`}>
                          <Mail className="h-4 w-4 mr-1" />
                          Notify
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Start</p>
                      <p className="font-medium">{format(new Date(delay.startDateTime), "MMM d, yyyy h:mm a")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">End</p>
                      <p className="font-medium">{delay.endDateTime ? format(new Date(delay.endDateTime), "MMM d, yyyy h:mm a") : "Ongoing"}</p>
                    </div>
                    {delay.ownerRepName && (
                      <div>
                        <p className="text-muted-foreground">Owner Rep</p>
                        <p className="font-medium">{delay.ownerRepName}</p>
                      </div>
                    )}
                    {delay.gcRepName && (
                      <div>
                        <p className="text-muted-foreground">GC Rep</p>
                        <p className="font-medium">{delay.gcRepName}</p>
                      </div>
                    )}
                  </div>
                  {delay.reasonNotes && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-sm text-muted-foreground">{delay.reasonNotes}</p>
                    </div>
                  )}
                  {delay.proceedToWorkDate && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Proceed to Work: </span>
                        <span className="font-medium">{format(new Date(delay.proceedToWorkDate), "MMM d, yyyy")}</span>
                        {delay.proceedToWorkNotes && <span className="text-muted-foreground"> - {delay.proceedToWorkNotes}</span>}
                      </p>
                    </div>
                  )}
                  {delay.reason === "WEATHER" && delay.weatherEvidenceJson && typeof delay.weatherEvidenceJson === 'object' && (
                    <WeatherEvidenceCard evidence={delay.weatherEvidenceJson} compact />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Report New Delay</DialogTitle>
            <DialogDescription>Document a delay that has impacted project schedule or costs</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="reason">Reason for Delay *</Label>
                <Select value={formData.reason} onValueChange={(v) => setFormData({ ...formData, reason: v })}>
                  <SelectTrigger data-testid="select-delay-reason">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_REASON_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="financiallyResponsible">Financially Responsible *</Label>
                <Select value={formData.financiallyResponsible} onValueChange={(v) => setFormData({ ...formData, financiallyResponsible: v })}>
                  <SelectTrigger data-testid="select-responsibility">
                    <SelectValue placeholder="Select party" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESPONSIBILITY_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date/Time *</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !formData.startDateTime && "text-muted-foreground"
                        )}
                        data-testid="button-start-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.startDateTime
                          ? format(parseISO(formData.startDateTime), "MMM d, yyyy")
                          : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.startDateTime ? parseISO(formData.startDateTime) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const time = formData.startDateTime
                              ? formData.startDateTime.split("T")[1] || "08:00"
                              : "08:00";
                            setFormData({ ...formData, startDateTime: `${format(date, "yyyy-MM-dd")}T${time}` });
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    className="w-28"
                    value={formData.startDateTime?.split("T")[1] || ""}
                    onChange={(e) => {
                      const date = formData.startDateTime?.split("T")[0] || format(new Date(), "yyyy-MM-dd");
                      setFormData({ ...formData, startDateTime: `${date}T${e.target.value}` });
                    }}
                    data-testid="input-start-time"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>End Date/Time (optional)</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !formData.endDateTime && "text-muted-foreground"
                        )}
                        data-testid="button-end-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.endDateTime
                          ? format(parseISO(formData.endDateTime), "MMM d, yyyy")
                          : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.endDateTime ? parseISO(formData.endDateTime) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const time = formData.endDateTime
                              ? formData.endDateTime.split("T")[1] || "17:00"
                              : "17:00";
                            setFormData({ ...formData, endDateTime: `${format(date, "yyyy-MM-dd")}T${time}` });
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    className="w-28"
                    value={formData.endDateTime?.split("T")[1] || ""}
                    onChange={(e) => {
                      const date = formData.endDateTime?.split("T")[0] || format(new Date(), "yyyy-MM-dd");
                      setFormData({ ...formData, endDateTime: `${date}T${e.target.value}` });
                    }}
                    data-testid="input-end-time"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reasonNotes">Delay Details</Label>
              <Textarea
                id="reasonNotes"
                value={formData.reasonNotes}
                onChange={(e) => setFormData({ ...formData, reasonNotes: e.target.value })}
                placeholder="Describe the delay circumstances, impact, and any relevant details..."
                rows={3}
                data-testid="textarea-reason-notes"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ownerRepName">Owner Rep Name</Label>
                <Input
                  id="ownerRepName"
                  value={formData.ownerRepName}
                  onChange={(e) => setFormData({ ...formData, ownerRepName: e.target.value })}
                  placeholder="Name of owner representative"
                  data-testid="input-owner-rep"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gcRepName">GC Rep Name</Label>
                <Input
                  id="gcRepName"
                  value={formData.gcRepName}
                  onChange={(e) => setFormData({ ...formData, gcRepName: e.target.value })}
                  placeholder="Name of GC representative"
                  data-testid="input-gc-rep"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <Label htmlFor="changeOrderRequired" className="font-medium">Change Order Required</Label>
                <p className="text-sm text-muted-foreground">Mark if this delay will require a change order for cost recovery</p>
              </div>
              <Switch
                id="changeOrderRequired"
                checked={formData.changeOrderRequired}
                onCheckedChange={(checked) => setFormData({ ...formData, changeOrderRequired: checked })}
                data-testid="switch-co-required"
              />
            </div>
            {!formData.endDateTime && (
              <div className="space-y-2">
                <Label htmlFor="estimatedDuration">Estimated Duration (days)</Label>
                <Input
                  id="estimatedDuration"
                  type="number"
                  value={formData.estimatedDuration}
                  onChange={(e) => setFormData({ ...formData, estimatedDuration: e.target.value })}
                  placeholder="Estimated number of delay days"
                  data-testid="input-estimated-duration"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>Cancel</Button>
            <Button 
              onClick={() => createDelay.mutate(formData)} 
              disabled={createDelay.isPending || !formData.reason || !formData.financiallyResponsible || !formData.startDateTime}
              data-testid="button-save-delay"
            >
              {createDelay.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Delay Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Delay Report</DialogTitle>
            <DialogDescription>Update the delay details before submitting</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-reason">Reason for Delay *</Label>
                <Select value={formData.reason} onValueChange={(v) => setFormData({ ...formData, reason: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_REASON_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-financiallyResponsible">Financially Responsible *</Label>
                <Select value={formData.financiallyResponsible} onValueChange={(v) => setFormData({ ...formData, financiallyResponsible: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select party" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESPONSIBILITY_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date/Time *</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !formData.startDateTime && "text-muted-foreground"
                        )}
                        data-testid="button-edit-start-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.startDateTime
                          ? format(parseISO(formData.startDateTime), "MMM d, yyyy")
                          : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.startDateTime ? parseISO(formData.startDateTime) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const time = formData.startDateTime
                              ? formData.startDateTime.split("T")[1] || "08:00"
                              : "08:00";
                            setFormData({ ...formData, startDateTime: `${format(date, "yyyy-MM-dd")}T${time}` });
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    className="w-28"
                    value={formData.startDateTime?.split("T")[1] || ""}
                    onChange={(e) => {
                      const date = formData.startDateTime?.split("T")[0] || format(new Date(), "yyyy-MM-dd");
                      setFormData({ ...formData, startDateTime: `${date}T${e.target.value}` });
                    }}
                    data-testid="input-edit-start-time"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>End Date/Time (optional)</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !formData.endDateTime && "text-muted-foreground"
                        )}
                        data-testid="button-edit-end-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.endDateTime
                          ? format(parseISO(formData.endDateTime), "MMM d, yyyy")
                          : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={formData.endDateTime ? parseISO(formData.endDateTime) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const time = formData.endDateTime
                              ? formData.endDateTime.split("T")[1] || "17:00"
                              : "17:00";
                            setFormData({ ...formData, endDateTime: `${format(date, "yyyy-MM-dd")}T${time}` });
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    className="w-28"
                    value={formData.endDateTime?.split("T")[1] || ""}
                    onChange={(e) => {
                      const date = formData.endDateTime?.split("T")[0] || format(new Date(), "yyyy-MM-dd");
                      setFormData({ ...formData, endDateTime: `${date}T${e.target.value}` });
                    }}
                    data-testid="input-edit-end-time"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reasonNotes">Delay Details</Label>
              <Textarea
                id="edit-reasonNotes"
                value={formData.reasonNotes}
                onChange={(e) => setFormData({ ...formData, reasonNotes: e.target.value })}
                placeholder="Describe the delay circumstances..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-ownerRepName">Owner Rep Name</Label>
                <Input
                  id="edit-ownerRepName"
                  value={formData.ownerRepName}
                  onChange={(e) => setFormData({ ...formData, ownerRepName: e.target.value })}
                  placeholder="Name of owner representative"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-gcRepName">GC Rep Name</Label>
                <Input
                  id="edit-gcRepName"
                  value={formData.gcRepName}
                  onChange={(e) => setFormData({ ...formData, gcRepName: e.target.value })}
                  placeholder="Name of GC representative"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <Label htmlFor="edit-changeOrderRequired" className="font-medium">Change Order Required</Label>
                <p className="text-sm text-muted-foreground">Mark if this delay will require a change order</p>
              </div>
              <Switch
                id="edit-changeOrderRequired"
                checked={formData.changeOrderRequired}
                onCheckedChange={(checked) => setFormData({ ...formData, changeOrderRequired: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditDialog(false); setSelectedDelay(null); resetForm(); }}>Cancel</Button>
            <Button 
              onClick={() => selectedDelay && updateDelay.mutate({ id: selectedDelay.id, data: formData })} 
              disabled={updateDelay.isPending || !formData.reason || !formData.financiallyResponsible || !formData.startDateTime}
            >
              {updateDelay.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNotificationDialog} onOpenChange={(open) => {
        setShowNotificationDialog(open);
        if (!open) {
          setSelectedDelayForNotification(null);
          setSelectedNotification(null);
          setNotificationMode("create");
        }
      }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Delay Notification
              {selectedDelayForNotification && (
                <Badge variant="outline">{selectedDelayForNotification.delayNumber}</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Generate a professional notification for responsible parties about this project delay
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="compose" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="compose" data-testid="tab-compose">Compose</TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">Previous Notifications ({delayNotifications.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="compose" className="flex-1 overflow-auto mt-4 space-y-4">
              {notificationMode === "create" ? (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-3">
                      Select recipient details below and we'll auto-generate a professional notification letter.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Recipient Type *</Label>
                      <Select 
                        value={notificationFormData.recipientType} 
                        onValueChange={(v: "OWNER_REP" | "GC_REP" | "OTHER") => setNotificationFormData({ ...notificationFormData, recipientType: v })}
                      >
                        <SelectTrigger data-testid="select-recipient-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECIPIENT_TYPE_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Recipient Name *</Label>
                      <Input
                        value={notificationFormData.recipientName}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientName: e.target.value })}
                        placeholder="Full name of recipient"
                        data-testid="input-recipient-name"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Company (optional)</Label>
                      <Input
                        value={notificationFormData.recipientCompany}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientCompany: e.target.value })}
                        placeholder="Company name"
                        data-testid="input-recipient-company"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email (optional)</Label>
                      <Input
                        type="email"
                        value={notificationFormData.recipientEmail}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientEmail: e.target.value })}
                        placeholder="email@company.com"
                        data-testid="input-recipient-email"
                      />
                    </div>
                  </div>
                  <Button 
                    onClick={() => selectedDelayForNotification && generateNotification.mutate({
                      delayId: selectedDelayForNotification.id,
                      recipientType: notificationFormData.recipientType,
                      recipientName: notificationFormData.recipientName,
                      recipientCompany: notificationFormData.recipientCompany || undefined,
                      recipientEmail: notificationFormData.recipientEmail || undefined
                    })}
                    disabled={generateNotification.isPending || !notificationFormData.recipientName}
                    className="w-full"
                    data-testid="button-generate-notification"
                  >
                    {generateNotification.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                    Generate Notification Draft
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {notificationMode === "view" && (
                        <Badge variant="outline" className="text-green-600 border-green-600">Finalized</Badge>
                      )}
                      {notificationMode === "edit" && (
                        <Badge variant="secondary">Draft</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setNotificationMode("create");
                          setSelectedNotification(null);
                          setNotificationFormData({
                            recipientType: "OWNER_REP",
                            recipientName: selectedDelayForNotification?.ownerRepName || "",
                            recipientCompany: "",
                            recipientEmail: "",
                            subject: "",
                            body: ""
                          });
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        New
                      </Button>
                      {selectedNotification && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleDownloadPDF(selectedNotification)}
                          data-testid="button-download-pdf"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download PDF
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Recipient</Label>
                      <Input
                        value={notificationFormData.recipientName}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientName: e.target.value })}
                        disabled={notificationMode === "view"}
                        data-testid="input-edit-recipient-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={notificationFormData.recipientCompany}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientCompany: e.target.value })}
                        disabled={notificationMode === "view"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={notificationFormData.recipientEmail}
                        onChange={(e) => setNotificationFormData({ ...notificationFormData, recipientEmail: e.target.value })}
                        disabled={notificationMode === "view"}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input
                      value={notificationFormData.subject}
                      onChange={(e) => setNotificationFormData({ ...notificationFormData, subject: e.target.value })}
                      disabled={notificationMode === "view"}
                      data-testid="input-notification-subject"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Letter Body</Label>
                    <Textarea
                      value={notificationFormData.body}
                      onChange={(e) => setNotificationFormData({ ...notificationFormData, body: e.target.value })}
                      disabled={notificationMode === "view"}
                      rows={12}
                      className="font-mono text-sm"
                      data-testid="textarea-notification-body"
                    />
                  </div>

                  {notificationMode === "edit" && selectedNotification && (
                    <div className="flex gap-2 justify-end">
                      <Button 
                        variant="outline"
                        onClick={() => selectedDelayForNotification && updateNotification.mutate({
                          delayId: selectedDelayForNotification.id,
                          notificationId: selectedNotification.id,
                          updates: {
                            recipientName: notificationFormData.recipientName,
                            recipientCompany: notificationFormData.recipientCompany || undefined,
                            recipientEmail: notificationFormData.recipientEmail || undefined,
                            subject: notificationFormData.subject,
                            body: notificationFormData.body
                          }
                        })}
                        disabled={updateNotification.isPending}
                        data-testid="button-save-draft"
                      >
                        {updateNotification.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Edit2 className="h-4 w-4 mr-2" />}
                        Save Draft
                      </Button>
                      <Button 
                        onClick={() => selectedDelayForNotification && updateNotification.mutate({
                          delayId: selectedDelayForNotification.id,
                          notificationId: selectedNotification.id,
                          updates: {
                            recipientName: notificationFormData.recipientName,
                            recipientCompany: notificationFormData.recipientCompany || undefined,
                            recipientEmail: notificationFormData.recipientEmail || undefined,
                            subject: notificationFormData.subject,
                            body: notificationFormData.body,
                            status: "FINALIZED"
                          }
                        })}
                        disabled={updateNotification.isPending}
                        data-testid="button-finalize"
                      >
                        {updateNotification.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                        Finalize & Download
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="flex-1 overflow-auto mt-4">
              {delayNotifications.length === 0 ? (
                <div className="text-center py-12">
                  <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No notifications have been created for this delay yet</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {delayNotifications.map((notification) => (
                      <Card 
                        key={notification.id} 
                        className={`cursor-pointer hover-elevate ${selectedNotification?.id === notification.id ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => selectExistingNotification(notification)}
                        data-testid={`notification-card-${notification.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={notification.status === "FINALIZED" ? "default" : "secondary"} className="text-xs">
                                  {notification.status}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {RECIPIENT_TYPE_OPTIONS.find(o => o.value === notification.recipientType)?.label}
                                </Badge>
                              </div>
                              <p className="font-medium truncate">{notification.recipientName}</p>
                              <p className="text-sm text-muted-foreground truncate">{notification.subject}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(notification.createdAt), "MMM d, yyyy h:mm a")}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectExistingNotification(notification);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownloadPDF(notification);
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowNotificationDialog(false)} data-testid="button-close-notification-dialog">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleImpactDialog} onOpenChange={() => setScheduleImpactDialog(null)}>
        <DialogContent data-testid="dialog-schedule-impact">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Critical Path Impact Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This delay impacts the project critical path by <strong>{scheduleImpactDialog?.impactDays} day(s)</strong>.
              This may push the project completion date. Would you like to create a draft Change Order to document this impact?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setScheduleImpactDialog(null)} data-testid="button-dismiss-impact">
                Dismiss
              </Button>
              <Button
                variant="destructive"
                onClick={() => scheduleImpactDialog && createDraftCOFromImpact.mutate(scheduleImpactDialog.delayId)}
                disabled={createDraftCOFromImpact.isPending}
                data-testid="button-create-draft-co-from-impact"
              >
                {createDraftCOFromImpact.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
                Create Draft Change Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DelaysSection;

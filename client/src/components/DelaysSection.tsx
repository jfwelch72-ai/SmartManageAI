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
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Plus, CloudRain, Clock, Building, Truck, FileWarning, CheckCircle, AlertTriangle, Send, Undo2, FileText, ExternalLink, DollarSign, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ProjectDelay, ChangeOrder } from "@shared/schema";

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
  { value: "TFR", label: "TFR Construction" },
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

export function DelaysSection({ projectId, projectCode, userRole }: DelaySectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedDelay, setSelectedDelay] = useState<ExtendedDelay | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");

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

  const canCreateDelay = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canAcknowledge = userRole === "ADMIN" || userRole === "MANAGER";
  const canCreateChangeOrder = userRole === "ADMIN" || userRole === "MANAGER";

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
      return apiRequest("POST", `/api/projects/${projectId}/delays`, {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Success", description: "Delay report created" });
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
      return apiRequest("PATCH", `/api/delays/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "delays"] });
      setShowEditDialog(false);
      setSelectedDelay(null);
      resetForm();
      toast({ title: "Success", description: "Delay updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update delay", variant: "destructive" });
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <Label htmlFor="startDateTime">Start Date/Time *</Label>
                <Input
                  id="startDateTime"
                  type="datetime-local"
                  value={formData.startDateTime}
                  onChange={(e) => setFormData({ ...formData, startDateTime: e.target.value })}
                  data-testid="input-start-datetime"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDateTime">End Date/Time (optional)</Label>
                <Input
                  id="endDateTime"
                  type="datetime-local"
                  value={formData.endDateTime}
                  onChange={(e) => setFormData({ ...formData, endDateTime: e.target.value })}
                  data-testid="input-end-datetime"
                />
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <Label htmlFor="edit-startDateTime">Start Date/Time *</Label>
                <Input
                  id="edit-startDateTime"
                  type="datetime-local"
                  value={formData.startDateTime}
                  onChange={(e) => setFormData({ ...formData, startDateTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-endDateTime">End Date/Time (optional)</Label>
                <Input
                  id="edit-endDateTime"
                  type="datetime-local"
                  value={formData.endDateTime}
                  onChange={(e) => setFormData({ ...formData, endDateTime: e.target.value })}
                />
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
    </div>
  );
}

export default DelaysSection;

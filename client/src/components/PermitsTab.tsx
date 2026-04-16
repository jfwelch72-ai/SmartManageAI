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
import { format, differenceInDays, parseISO } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, FileCheck, AlertTriangle, Clock, CheckCircle, XCircle,
  Shield, Building, Edit2, Trash2, Loader2, ArrowRight,
  CalendarDays, Hash,
} from "lucide-react";
import type { ProjectPermit } from "@shared/schema";

interface PermitsTabProps {
  projectId: string;
  userRole: string;
}

const PERMIT_TYPE_OPTIONS = [
  { value: "BUILDING", label: "Building Permit" },
  { value: "DEMOLITION", label: "Demolition Permit" },
  { value: "EXCAVATION", label: "Excavation Permit" },
  { value: "ELECTRICAL", label: "Electrical Permit" },
  { value: "PLUMBING", label: "Plumbing Permit" },
  { value: "MECHANICAL", label: "Mechanical Permit" },
  { value: "FIRE_SAFETY", label: "Fire Safety Permit" },
  { value: "ENVIRONMENTAL", label: "Environmental Permit" },
  { value: "OCCUPANCY", label: "Occupancy Permit" },
  { value: "CUSTOM", label: "Custom" },
];

const STATUS_OPTIONS = [
  { value: "APPLIED", label: "Applied" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRED", label: "Expired" },
  { value: "RENEWED", label: "Renewed" },
];

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  APPLIED: "secondary",
  UNDER_REVIEW: "secondary",
  APPROVED: "default",
  ACTIVE: "default",
  EXPIRED: "destructive",
  RENEWED: "outline",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  APPLIED: Clock,
  UNDER_REVIEW: Clock,
  APPROVED: CheckCircle,
  ACTIVE: Shield,
  EXPIRED: XCircle,
  RENEWED: CheckCircle,
};

type PermitStatus = "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE" | "EXPIRED" | "RENEWED";

const VALID_TRANSITIONS: Record<PermitStatus, PermitStatus[]> = {
  APPLIED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["APPROVED", "APPLIED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["EXPIRED", "RENEWED"],
  EXPIRED: ["RENEWED"],
  RENEWED: ["ACTIVE", "EXPIRED"],
};

interface PermitFormData {
  permitType: string;
  customType: string;
  permitNumber: string;
  issuingAuthority: string;
  appliedDate: string;
  issuedDate: string;
  expiryDate: string;
  notes: string;
  linkedInspectionIds: string;
  linkedDocumentIds: string;
}

const emptyForm: PermitFormData = {
  permitType: "",
  customType: "",
  permitNumber: "",
  issuingAuthority: "",
  appliedDate: "",
  issuedDate: "",
  expiryDate: "",
  notes: "",
  linkedInspectionIds: "",
  linkedDocumentIds: "",
};

export default function PermitsTab({ projectId, userRole }: PermitsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedPermit, setSelectedPermit] = useState<ProjectPermit | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [formData, setFormData] = useState<PermitFormData>({ ...emptyForm });

  const canManage = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT";
  const canDelete = userRole === "ADMIN" || userRole === "MANAGER";

  const { data: permits = [], isLoading } = useQuery<ProjectPermit[]>({
    queryKey: ["/api/projects", projectId, "permits"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/permits`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch permits");
      return response.json();
    },
    enabled: !!projectId,
  });

  const createPermit = useMutation({
    mutationFn: async (data: PermitFormData) => {
      return apiRequest("POST", `/api/projects/${projectId}/permits`, {
        permitType: data.permitType,
        customType: data.permitType === "CUSTOM" ? data.customType : null,
        permitNumber: data.permitNumber || null,
        issuingAuthority: data.issuingAuthority || null,
        appliedDate: data.appliedDate || null,
        issuedDate: data.issuedDate || null,
        expiryDate: data.expiryDate || null,
        notes: data.notes || null,
        linkedInspectionIds: data.linkedInspectionIds || null,
        linkedDocumentIds: data.linkedDocumentIds || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "permits"] });
      setShowCreateDialog(false);
      setFormData({ ...emptyForm });
      toast({ title: "Success", description: "Permit created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create permit", variant: "destructive" });
    },
  });

  const updatePermit = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PermitFormData }) => {
      return apiRequest("PATCH", `/api/permits/${id}`, {
        permitType: data.permitType,
        customType: data.customType || null,
        permitNumber: data.permitNumber || null,
        issuingAuthority: data.issuingAuthority || null,
        appliedDate: data.appliedDate || null,
        issuedDate: data.issuedDate || null,
        expiryDate: data.expiryDate || null,
        notes: data.notes || null,
        linkedInspectionIds: data.linkedInspectionIds || null,
        linkedDocumentIds: data.linkedDocumentIds || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "permits"] });
      setShowEditDialog(false);
      setSelectedPermit(null);
      setFormData({ ...emptyForm });
      toast({ title: "Success", description: "Permit updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update permit", variant: "destructive" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PermitStatus }) => {
      return apiRequest("POST", `/api/permits/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "permits"] });
      toast({ title: "Success", description: "Status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
    },
  });

  const deletePermit = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/permits/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "permits"] });
      setShowDetailDialog(false);
      setSelectedPermit(null);
      toast({ title: "Success", description: "Permit deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete permit", variant: "destructive" });
    },
  });

  const handleEdit = (permit: ProjectPermit) => {
    setSelectedPermit(permit);
    setFormData({
      permitType: permit.permitType,
      customType: permit.customType || "",
      permitNumber: permit.permitNumber || "",
      issuingAuthority: permit.issuingAuthority || "",
      appliedDate: permit.appliedDate || "",
      issuedDate: permit.issuedDate || "",
      expiryDate: permit.expiryDate || "",
      notes: permit.notes || "",
      linkedInspectionIds: permit.linkedInspectionIds || "",
      linkedDocumentIds: permit.linkedDocumentIds || "",
    });
    setShowEditDialog(true);
  };

  const filteredPermits = permits.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (typeFilter !== "all" && p.permitType !== typeFilter) return false;
    return true;
  });

  const isDateExpired = (p: ProjectPermit) => {
    if (!p.expiryDate) return false;
    return differenceInDays(parseISO(p.expiryDate), new Date()) < 0;
  };
  const expiredCount = permits.filter((p) => p.status === "EXPIRED" || (p.status !== "RENEWED" && isDateExpired(p))).length;
  const expiringCount = permits.filter((p) => {
    if (!p.expiryDate || p.status === "EXPIRED" || p.status === "RENEWED") return false;
    const days = differenceInDays(parseISO(p.expiryDate), new Date());
    return days >= 0 && days <= 30;
  }).length;
  const activeCount = permits.filter((p) => {
    if (p.status === "EXPIRED" || p.status === "RENEWED") return false;
    if (isDateExpired(p)) return false;
    return ["APPLIED", "UNDER_REVIEW", "APPROVED", "ACTIVE"].includes(p.status);
  }).length;

  const getExpiryWarning = (permit: ProjectPermit) => {
    if (!permit.expiryDate || permit.status === "EXPIRED" || permit.status === "RENEWED") return null;
    const days = differenceInDays(parseISO(permit.expiryDate), new Date());
    if (days < 0) return { level: "expired", text: "Expired", days };
    if (days <= 7) return { level: "critical", text: `Expires in ${days} day${days !== 1 ? "s" : ""}`, days };
    if (days <= 30) return { level: "warning", text: `Expires in ${days} days`, days };
    return null;
  };

  const getPermitTypeLabel = (type: string, customType?: string | null) => {
    if (type === "CUSTOM" && customType) return customType;
    return PERMIT_TYPE_OPTIONS.find((t) => t.value === type)?.label || type;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading permits...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="text-permits-title">
              <FileCheck className="h-5 w-5" />
              Permits & Licenses
            </CardTitle>
            <CardDescription>
              Track building permits, safety permits, and regulatory requirements
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-permit">
              <Plus className="h-4 w-4 mr-2" />
              New Permit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-green-600" data-testid="text-active-count">{activeCount}</div>
                <div className="text-sm text-muted-foreground">Active</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-yellow-600" data-testid="text-expiring-count">{expiringCount}</div>
                <div className="text-sm text-muted-foreground">Expiring Soon</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <div className="text-2xl font-bold text-red-600" data-testid="text-expired-count">{expiredCount}</div>
                <div className="text-sm text-muted-foreground">Expired</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-4 mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-permit-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-permit-type-filter">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {PERMIT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filteredPermits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-permits">
              No permits found. {canManage && "Click 'New Permit' to create one."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPermits.map((permit) => {
                const StatusIcon = STATUS_ICONS[permit.status] || Clock;
                const expiryWarning = getExpiryWarning(permit);

                return (
                  <Card
                    key={permit.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => {
                      setSelectedPermit(permit);
                      setShowDetailDialog(true);
                    }}
                    data-testid={`card-permit-${permit.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <FileCheck className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium" data-testid={`text-permit-type-${permit.id}`}>
                              {getPermitTypeLabel(permit.permitType, permit.customType)}
                            </span>
                            <Badge variant={STATUS_COLORS[permit.status]} data-testid={`badge-permit-status-${permit.id}`}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {STATUS_OPTIONS.find((s) => s.value === permit.status)?.label || permit.status}
                            </Badge>
                            {expiryWarning && (
                              <Badge
                                variant="destructive"
                                className={expiryWarning.level === "warning" ? "bg-yellow-600" : ""}
                                data-testid={`badge-expiry-warning-${permit.id}`}
                              >
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {expiryWarning.text}
                              </Badge>
                            )}
                          </div>
                          {permit.permitNumber && (
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <Hash className="h-3 w-3" />
                              {permit.permitNumber}
                            </div>
                          )}
                          {permit.issuingAuthority && (
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <Building className="h-3 w-3" />
                              {permit.issuingAuthority}
                            </div>
                          )}
                          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
                            {permit.appliedDate && (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                Applied: {format(parseISO(permit.appliedDate), "MMM d, yyyy")}
                              </span>
                            )}
                            {permit.expiryDate && (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                Expires: {format(parseISO(permit.expiryDate), "MMM d, yyyy")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(permit)}
                              data-testid={`button-edit-permit-${permit.id}`}
                            >
                              <Edit2 className="h-4 w-4" />
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
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Permit</DialogTitle>
            <DialogDescription>Add a new permit or license to this project</DialogDescription>
          </DialogHeader>
          <PermitForm
            formData={formData}
            setFormData={setFormData}
            onSubmit={() => createPermit.mutate(formData)}
            isPending={createPermit.isPending}
            submitLabel="Create Permit"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={(open) => { setShowEditDialog(open); if (!open) setSelectedPermit(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Permit</DialogTitle>
            <DialogDescription>Update permit details</DialogDescription>
          </DialogHeader>
          {selectedPermit && (
            <PermitForm
              formData={formData}
              setFormData={setFormData}
              onSubmit={() => updatePermit.mutate({ id: selectedPermit.id, data: formData })}
              isPending={updatePermit.isPending}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={(open) => { setShowDetailDialog(open); if (!open) setSelectedPermit(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permit Details</DialogTitle>
            <DialogDescription>View and manage permit status</DialogDescription>
          </DialogHeader>
          {selectedPermit && (
            <PermitDetailView
              permit={selectedPermit}
              canManage={canManage}
              canDelete={canDelete}
              onStatusChange={(status: PermitStatus) => {
                updateStatus.mutate(
                  { id: selectedPermit.id, status },
                  {
                    onSuccess: () => {
                      setSelectedPermit({ ...selectedPermit, status });
                    },
                  }
                );
              }}
              onEdit={() => {
                setShowDetailDialog(false);
                handleEdit(selectedPermit);
              }}
              onDelete={() => deletePermit.mutate(selectedPermit.id)}
              statusUpdating={updateStatus.isPending}
              deleting={deletePermit.isPending}
              getPermitTypeLabel={getPermitTypeLabel}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PermitForm({
  formData,
  setFormData,
  onSubmit,
  isPending,
  submitLabel,
}: {
  formData: PermitFormData;
  setFormData: (d: PermitFormData) => void;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Permit Type *</Label>
        <Select
          value={formData.permitType}
          onValueChange={(v) => setFormData({ ...formData, permitType: v })}
        >
          <SelectTrigger data-testid="select-permit-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {PERMIT_TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {formData.permitType === "CUSTOM" && (
        <div className="space-y-2">
          <Label>Custom Type Name *</Label>
          <Input
            value={formData.customType}
            onChange={(e) => setFormData({ ...formData, customType: e.target.value })}
            placeholder="e.g., Noise Permit"
            data-testid="input-custom-type"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Permit Number</Label>
        <Input
          value={formData.permitNumber}
          onChange={(e) => setFormData({ ...formData, permitNumber: e.target.value })}
          placeholder="e.g., BP-2026-001234"
          data-testid="input-permit-number"
        />
      </div>

      <div className="space-y-2">
        <Label>Issuing Authority</Label>
        <Input
          value={formData.issuingAuthority}
          onChange={(e) => setFormData({ ...formData, issuingAuthority: e.target.value })}
          placeholder="e.g., City of Los Angeles"
          data-testid="input-issuing-authority"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Applied Date</Label>
          <Input
            type="date"
            value={formData.appliedDate}
            onChange={(e) => setFormData({ ...formData, appliedDate: e.target.value })}
            data-testid="input-applied-date"
          />
        </div>
        <div className="space-y-2">
          <Label>Issued Date</Label>
          <Input
            type="date"
            value={formData.issuedDate}
            onChange={(e) => setFormData({ ...formData, issuedDate: e.target.value })}
            data-testid="input-issued-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Expiry Date</Label>
        <Input
          type="date"
          value={formData.expiryDate}
          onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
          data-testid="input-expiry-date"
        />
      </div>

      <div className="space-y-2">
        <Label>Linked Inspection IDs</Label>
        <Input
          value={formData.linkedInspectionIds}
          onChange={(e) => setFormData({ ...formData, linkedInspectionIds: e.target.value })}
          placeholder="Comma-separated inspection IDs"
          data-testid="input-linked-inspections"
        />
      </div>

      <div className="space-y-2">
        <Label>Linked Document IDs</Label>
        <Input
          value={formData.linkedDocumentIds}
          onChange={(e) => setFormData({ ...formData, linkedDocumentIds: e.target.value })}
          placeholder="Comma-separated document IDs"
          data-testid="input-linked-documents"
        />
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes..."
          rows={3}
          data-testid="textarea-permit-notes"
        />
      </div>

      <DialogFooter>
        <Button
          onClick={onSubmit}
          disabled={isPending || !formData.permitType || (formData.permitType === "CUSTOM" && !formData.customType)}
          data-testid="button-submit-permit"
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

function PermitDetailView({
  permit,
  canManage,
  canDelete,
  onStatusChange,
  onEdit,
  onDelete,
  statusUpdating,
  deleting,
  getPermitTypeLabel,
}: {
  permit: ProjectPermit;
  canManage: boolean;
  canDelete: boolean;
  onStatusChange: (status: PermitStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  statusUpdating: boolean;
  deleting: boolean;
  getPermitTypeLabel: (type: string, customType?: string | null) => string;
}) {
  const transitions = VALID_TRANSITIONS[permit.status as PermitStatus] || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-muted-foreground text-xs">Type</Label>
          <p className="font-medium" data-testid="text-detail-permit-type">
            {getPermitTypeLabel(permit.permitType, permit.customType)}
          </p>
        </div>
        <div>
          <Label className="text-muted-foreground text-xs">Status</Label>
          <div>
            <Badge variant={STATUS_COLORS[permit.status]} data-testid="badge-detail-status">
              {STATUS_OPTIONS.find((s) => s.value === permit.status)?.label || permit.status}
            </Badge>
          </div>
        </div>
        {permit.permitNumber && (
          <div>
            <Label className="text-muted-foreground text-xs">Permit Number</Label>
            <p data-testid="text-detail-permit-number">{permit.permitNumber}</p>
          </div>
        )}
        {permit.issuingAuthority && (
          <div>
            <Label className="text-muted-foreground text-xs">Issuing Authority</Label>
            <p data-testid="text-detail-issuing-authority">{permit.issuingAuthority}</p>
          </div>
        )}
        {permit.appliedDate && (
          <div>
            <Label className="text-muted-foreground text-xs">Applied Date</Label>
            <p>{format(parseISO(permit.appliedDate), "MMM d, yyyy")}</p>
          </div>
        )}
        {permit.issuedDate && (
          <div>
            <Label className="text-muted-foreground text-xs">Issued Date</Label>
            <p>{format(parseISO(permit.issuedDate), "MMM d, yyyy")}</p>
          </div>
        )}
        {permit.expiryDate && (
          <div>
            <Label className="text-muted-foreground text-xs">Expiry Date</Label>
            <p>{format(parseISO(permit.expiryDate), "MMM d, yyyy")}</p>
          </div>
        )}
      </div>

      {permit.notes && (
        <div>
          <Label className="text-muted-foreground text-xs">Notes</Label>
          <p className="text-sm whitespace-pre-wrap">{permit.notes}</p>
        </div>
      )}

      {permit.linkedInspectionIds && (
        <div>
          <Label className="text-muted-foreground text-xs">Linked Inspections</Label>
          <p className="text-sm">{permit.linkedInspectionIds}</p>
        </div>
      )}

      {permit.linkedDocumentIds && (
        <div>
          <Label className="text-muted-foreground text-xs">Linked Documents</Label>
          <p className="text-sm">{permit.linkedDocumentIds}</p>
        </div>
      )}

      {canManage && transitions.length > 0 && (
        <div>
          <Label className="text-muted-foreground text-xs mb-2 block">Advance Status</Label>
          <div className="flex flex-wrap gap-2">
            {transitions.map((nextStatus) => (
              <Button
                key={nextStatus}
                variant="outline"
                size="sm"
                onClick={() => onStatusChange(nextStatus)}
                disabled={statusUpdating}
                data-testid={`button-status-${nextStatus.toLowerCase()}`}
              >
                {statusUpdating && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                <ArrowRight className="h-3 w-3 mr-1" />
                {STATUS_OPTIONS.find((s) => s.value === nextStatus)?.label || nextStatus}
              </Button>
            ))}
          </div>
        </div>
      )}

      <DialogFooter className="flex justify-between gap-2">
        {canManage && (
          <Button variant="outline" onClick={onEdit} data-testid="button-edit-from-detail">
            <Edit2 className="h-4 w-4 mr-2" />
            Edit
          </Button>
        )}
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="button-delete-permit">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Permit</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this permit? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} disabled={deleting}>
                  {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </DialogFooter>
    </div>
  );
}

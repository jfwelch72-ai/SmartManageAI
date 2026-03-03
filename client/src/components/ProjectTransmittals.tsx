import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Send,
  Plus,
  Eye,
  Edit,
  Trash2,
  CheckCircle2,
  Clock,
  FileText,
  Users,
  Archive,
  UserPlus
} from "lucide-react";
import { format } from "date-fns";
import DocumentAttachments from "@/components/DocumentAttachments";

interface Subcontractor {
  id: string;
  companyName: string;
  name?: string;
}

interface TransmittalRecipient {
  id: string;
  transmittalId: string;
  subcontractorId: string;
  subcontractorName: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

interface Transmittal {
  id: string;
  projectId: string;
  transmittalNumber: string;
  subject: string;
  description: string | null;
  documentType: string | null;
  revisionNumber: string | null;
  status: string;
  attachmentsJson: string | null;
  notes: string | null;
  dateSent: string | null;
  sentByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  project: {
    code: string;
    name: string;
  };
  recipients?: TransmittalRecipient[];
  recipientCount?: number;
}

interface ProjectTransmittalsProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const DOCUMENT_TYPES = [
  "Plans",
  "Drawings",
  "Specifications",
  "Addendum",
  "Shop Drawings",
  "As-Builts",
  "Other"
];

export default function ProjectTransmittals({ projectId, projectCode, userRole }: ProjectTransmittalsProps) {
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAddRecipientsDialog, setShowAddRecipientsDialog] = useState(false);
  const [selectedTransmittal, setSelectedTransmittal] = useState<Transmittal | null>(null);

  const [createForm, setCreateForm] = useState({
    subject: "",
    description: "",
    documentType: "",
    revisionNumber: "",
    notes: "",
    recipientSubcontractorIds: [] as string[]
  });

  const [editForm, setEditForm] = useState({
    subject: "",
    description: "",
    documentType: "",
    revisionNumber: "",
    notes: ""
  });

  const [addRecipientIds, setAddRecipientIds] = useState<string[]>([]);

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (filterStatus !== "all") params.set("status", filterStatus);
    return `?${params.toString()}`;
  };

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"],
  });

  const queryString = buildQueryString();
  const { data: transmittals = [], isLoading: loadingTransmittals } = useQuery<Transmittal[]>({
    queryKey: ["/api/transmittals", queryString],
  });

  const { data: detailTransmittal } = useQuery<Transmittal>({
    queryKey: ["/api/transmittals", selectedTransmittal?.id],
    enabled: !!selectedTransmittal?.id && showDetailDialog
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const body: Record<string, unknown> = {
        projectId,
        subject: data.subject,
      };
      if (data.description) body.description = data.description;
      if (data.documentType) body.documentType = data.documentType;
      if (data.revisionNumber) body.revisionNumber = data.revisionNumber;
      if (data.notes) body.notes = data.notes;
      if (data.recipientSubcontractorIds.length > 0) body.recipientSubcontractorIds = data.recipientSubcontractorIds;
      return await apiRequest("POST", "/api/transmittals", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      toast({ title: "Transmittal created successfully" });
      setShowCreateDialog(false);
      resetCreateForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof editForm }) => {
      return await apiRequest("PATCH", `/api/transmittals/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      if (selectedTransmittal) queryClient.invalidateQueries({ queryKey: ["/api/transmittals", selectedTransmittal.id] });
      toast({ title: "Transmittal updated" });
      setShowEditDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to update transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const sendMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/transmittals/${id}/send`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      if (selectedTransmittal) queryClient.invalidateQueries({ queryKey: ["/api/transmittals", selectedTransmittal.id] });
      toast({ title: "Transmittal sent to recipients" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to send transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const supersedeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/transmittals/${id}/supersede`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      if (selectedTransmittal) queryClient.invalidateQueries({ queryKey: ["/api/transmittals", selectedTransmittal.id] });
      toast({ title: "Transmittal marked as superseded" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to supersede transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/transmittals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      toast({ title: "Transmittal deleted" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const addRecipientsMutation = useMutation({
    mutationFn: async ({ id, subcontractorIds }: { id: string; subcontractorIds: string[] }) => {
      return await apiRequest("POST", `/api/transmittals/${id}/recipients`, { subcontractorIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
      if (selectedTransmittal) queryClient.invalidateQueries({ queryKey: ["/api/transmittals", selectedTransmittal.id] });
      toast({ title: "Recipients added" });
      setShowAddRecipientsDialog(false);
      setAddRecipientIds([]);
    },
    onError: (error: any) => {
      toast({ title: "Failed to add recipients", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const resetCreateForm = () => {
    setCreateForm({
      subject: "",
      description: "",
      documentType: "",
      revisionNumber: "",
      notes: "",
      recipientSubcontractorIds: []
    });
  };

  const openDetailDialog = (tx: Transmittal) => {
    setSelectedTransmittal(tx);
    setShowDetailDialog(true);
  };

  const openEditDialog = (tx: Transmittal) => {
    setEditForm({
      subject: tx.subject,
      description: tx.description || "",
      documentType: tx.documentType || "",
      revisionNumber: tx.revisionNumber || "",
      notes: tx.notes || ""
    });
    setSelectedTransmittal(tx);
    setShowEditDialog(true);
  };

  const openAddRecipientsDialog = () => {
    setAddRecipientIds([]);
    setShowAddRecipientsDialog(true);
  };

  const toggleRecipient = (subId: string, checked: boolean) => {
    setCreateForm(prev => ({
      ...prev,
      recipientSubcontractorIds: checked
        ? [...prev.recipientSubcontractorIds, subId]
        : prev.recipientSubcontractorIds.filter(id => id !== subId)
    }));
  };

  const toggleAddRecipient = (subId: string, checked: boolean) => {
    setAddRecipientIds(prev =>
      checked ? [...prev, subId] : prev.filter(id => id !== subId)
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
      case "SENT":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><Send className="h-3 w-3 mr-1" />Sent</Badge>;
      case "ACKNOWLEDGED":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Acknowledged</Badge>;
      case "SUPERSEDED":
        return <Badge variant="outline" className="text-muted-foreground"><Archive className="h-3 w-3 mr-1" />Superseded</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const detail = detailTransmittal || selectedTransmittal;

  const draftCount = transmittals.filter(t => t.status === "DRAFT").length;
  const sentCount = transmittals.filter(t => t.status === "SENT").length;
  const acknowledgedCount = transmittals.filter(t => t.status === "ACKNOWLEDGED").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold" data-testid="proj-tx-section-title">Document Transmittals</h3>
          <p className="text-sm text-muted-foreground">Distribute updated plans, drawings, and specifications to subcontractors</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="proj-tx-button-create">
          <Plus className="h-4 w-4 mr-2" />
          Create Transmittal
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-tx-total-count">{transmittals.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-tx-draft-count">{draftCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Send className="h-4 w-4" />
              Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-tx-sent-count">{sentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Acknowledged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-tx-acknowledged-count">{acknowledgedCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger data-testid="proj-tx-select-filter-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingTransmittals ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : transmittals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Send className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-1" data-testid="proj-tx-empty-state">No transmittals found</h3>
            <p className="text-muted-foreground">Create a transmittal to distribute documents to subcontractors</p>
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="hidden md:block">
          <Card>
            <Table data-testid="proj-tx-table">
              <TableHeader>
                <TableRow>
                  <TableHead>TX #</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date Sent</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transmittals.map(tx => (
                  <TableRow key={tx.id} data-testid={`proj-tx-row-${tx.id}`}>
                    <TableCell className="font-medium" data-testid={`proj-tx-number-${tx.id}`}>{tx.transmittalNumber}</TableCell>
                    <TableCell data-testid={`proj-tx-subject-${tx.id}`}>{tx.subject}</TableCell>
                    <TableCell data-testid={`proj-tx-doctype-${tx.id}`}>{tx.documentType || "-"}</TableCell>
                    <TableCell data-testid={`proj-tx-revision-${tx.id}`}>{tx.revisionNumber || "-"}</TableCell>
                    <TableCell data-testid={`proj-tx-status-${tx.id}`}>{getStatusBadge(tx.status)}</TableCell>
                    <TableCell data-testid={`proj-tx-date-${tx.id}`}>{tx.dateSent ? format(new Date(tx.dateSent), "MMM d, yyyy") : "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`proj-tx-recipients-${tx.id}`}>
                        <Users className="h-3 w-3 mr-1" />
                        {tx.recipientCount ?? tx.recipients?.length ?? 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDetailDialog(tx)}
                          data-testid={`proj-tx-button-view-${tx.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        {tx.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(tx)}
                            data-testid={`proj-tx-button-edit-${tx.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="md:hidden space-y-3">
          {transmittals.map(tx => (
            <div
              key={tx.id}
              className="border rounded-md p-4 space-y-3"
              onClick={() => openDetailDialog(tx)}
              data-testid={`proj-tx-row-mobile-${tx.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" data-testid={`proj-tx-number-mobile-${tx.id}`}>{tx.transmittalNumber}</span>
                <span className="shrink-0" data-testid={`proj-tx-status-mobile-${tx.id}`}>{getStatusBadge(tx.status)}</span>
              </div>
              <p className="text-sm" data-testid={`proj-tx-subject-mobile-${tx.id}`}>{tx.subject}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Document Type</span>
                  <p data-testid={`proj-tx-doctype-mobile-${tx.id}`}>{tx.documentType || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Revision</span>
                  <p data-testid={`proj-tx-revision-mobile-${tx.id}`}>{tx.revisionNumber || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date Sent</span>
                  <p data-testid={`proj-tx-date-mobile-${tx.id}`}>{tx.dateSent ? format(new Date(tx.dateSent), "MMM d, yyyy") : "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Recipients</span>
                  <div>
                    <Badge variant="outline" data-testid={`proj-tx-recipients-mobile-${tx.id}`}>
                      <Users className="h-3 w-3 mr-1" />
                      {tx.recipientCount ?? tx.recipients?.length ?? 0}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={(e) => { e.stopPropagation(); openDetailDialog(tx); }}
                  data-testid={`proj-tx-button-view-mobile-${tx.id}`}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
                {tx.status === "DRAFT" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={(e) => { e.stopPropagation(); openEditDialog(tx); }}
                    data-testid={`proj-tx-button-edit-mobile-${tx.id}`}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Transmittal</DialogTitle>
            <DialogDescription>
              Create a new document transmittal for distribution
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                placeholder="e.g., Revised Floor Plans - Building A"
                data-testid="proj-tx-input-create-subject"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Additional details about this transmittal..."
                rows={3}
                data-testid="proj-tx-input-create-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select
                value={createForm.documentType}
                onValueChange={(value) => setCreateForm({ ...createForm, documentType: value })}
              >
                <SelectTrigger data-testid="proj-tx-select-create-doctype">
                  <SelectValue placeholder="Select document type..." />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map(dt => (
                    <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Revision Number</Label>
              <Input
                value={createForm.revisionNumber}
                onChange={(e) => setCreateForm({ ...createForm, revisionNumber: e.target.value })}
                placeholder="e.g., Rev 2, A1, etc."
                data-testid="proj-tx-input-create-revision"
              />
            </div>

            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2" data-testid="proj-tx-list-create-recipients">
                {subcontractors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subcontractors available</p>
                ) : (
                  subcontractors.map(sub => (
                    <div key={sub.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`proj-tx-create-recipient-${sub.id}`}
                        checked={createForm.recipientSubcontractorIds.includes(sub.id)}
                        onCheckedChange={(checked) => toggleRecipient(sub.id, !!checked)}
                        data-testid={`proj-tx-checkbox-recipient-${sub.id}`}
                      />
                      <label htmlFor={`proj-tx-create-recipient-${sub.id}`} className="text-sm cursor-pointer">
                        {sub.companyName || sub.name}
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder="Additional notes..."
                rows={2}
                data-testid="proj-tx-input-create-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="proj-tx-button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.subject || createMutation.isPending}
              data-testid="proj-tx-button-submit-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transmittal Details</DialogTitle>
            <DialogDescription>
              {detail?.transmittalNumber} — {detail?.subject}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Project</Label>
                  <p className="font-medium" data-testid="proj-tx-detail-project">{detail.project?.code} - {detail.project?.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Status</Label>
                  <div data-testid="proj-tx-detail-status">{getStatusBadge(detail.status)}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Document Type</Label>
                  <p data-testid="proj-tx-detail-doctype">{detail.documentType || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Revision</Label>
                  <p data-testid="proj-tx-detail-revision">{detail.revisionNumber || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Sent By</Label>
                  <p data-testid="proj-tx-detail-sentby">{detail.sentByName || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Date Sent</Label>
                  <p data-testid="proj-tx-detail-datesent">{detail.dateSent ? format(new Date(detail.dateSent), "MMM d, yyyy") : "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Created</Label>
                  <p data-testid="proj-tx-detail-created">{format(new Date(detail.createdAt), "MMM d, yyyy")}</p>
                </div>
              </div>

              {detail.description && (
                <div>
                  <Label className="text-muted-foreground text-xs">Description</Label>
                  <p className="text-sm" data-testid="proj-tx-detail-description">{detail.description}</p>
                </div>
              )}

              {detail.notes && (
                <div>
                  <Label className="text-muted-foreground text-xs">Notes</Label>
                  <p className="text-sm" data-testid="proj-tx-detail-notes">{detail.notes}</p>
                </div>
              )}

              {detail.recipients && detail.recipients.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-muted-foreground text-xs">Recipients</Label>
                    {detail.status === "SENT" && (
                      <Button size="sm" variant="outline" onClick={openAddRecipientsDialog} data-testid="proj-tx-button-add-recipients">
                        <UserPlus className="h-4 w-4 mr-1" />
                        Add Recipients
                      </Button>
                    )}
                  </div>
                  <Table data-testid="proj-tx-detail-recipients-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subcontractor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Acknowledged At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.recipients.map(r => (
                        <TableRow key={r.id} data-testid={`proj-tx-recipient-row-${r.id}`}>
                          <TableCell data-testid={`proj-tx-recipient-name-${r.id}`}>{r.subcontractorName}</TableCell>
                          <TableCell data-testid={`proj-tx-recipient-status-${r.id}`}>
                            {r.acknowledged ? (
                              <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Acknowledged
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-muted-foreground">
                                <Clock className="h-3 w-3 mr-1" />
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell data-testid={`proj-tx-recipient-date-${r.id}`}>
                            {r.acknowledgedAt ? format(new Date(r.acknowledgedAt), "MMM d, yyyy h:mm a") : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {detail.recipients && detail.recipients.length === 0 && detail.status === "SENT" && (
                <div className="text-center py-4">
                  <Button size="sm" variant="outline" onClick={openAddRecipientsDialog} data-testid="proj-tx-button-add-recipients-empty">
                    <UserPlus className="h-4 w-4 mr-1" />
                    Add Recipients
                  </Button>
                </div>
              )}

              <DocumentAttachments
                entityType="transmittals"
                entityId={detail.id}
                canUpload={["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole)}
                canDelete={["ADMIN", "MANAGER"].includes(userRole)}
                compact
              />

              <DialogFooter className="gap-2 flex-wrap">
                {detail.status === "DRAFT" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDetailDialog(false);
                        openEditDialog(detail);
                      }}
                      data-testid="proj-tx-button-edit-detail"
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      onClick={() => sendMutation.mutate(detail.id)}
                      disabled={sendMutation.isPending}
                      data-testid="proj-tx-button-send"
                    >
                      <Send className="h-4 w-4 mr-1" />
                      {sendMutation.isPending ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="proj-tx-button-delete"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {deleteMutation.isPending ? "Deleting..." : "Delete"}
                    </Button>
                  </>
                )}
                {(detail.status === "SENT" || detail.status === "ACKNOWLEDGED") && (
                  <Button
                    variant="outline"
                    onClick={() => supersedeMutation.mutate(detail.id)}
                    disabled={supersedeMutation.isPending}
                    data-testid="proj-tx-button-supersede"
                  >
                    <Archive className="h-4 w-4 mr-1" />
                    {supersedeMutation.isPending ? "Superseding..." : "Supersede"}
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Transmittal</DialogTitle>
            <DialogDescription>
              Update transmittal details (DRAFT only)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={editForm.subject}
                onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                data-testid="proj-tx-input-edit-subject"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                data-testid="proj-tx-input-edit-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select
                value={editForm.documentType}
                onValueChange={(value) => setEditForm({ ...editForm, documentType: value })}
              >
                <SelectTrigger data-testid="proj-tx-select-edit-doctype">
                  <SelectValue placeholder="Select document type..." />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map(dt => (
                    <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Revision Number</Label>
              <Input
                value={editForm.revisionNumber}
                onChange={(e) => setEditForm({ ...editForm, revisionNumber: e.target.value })}
                data-testid="proj-tx-input-edit-revision"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={2}
                data-testid="proj-tx-input-edit-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="proj-tx-button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={() => selectedTransmittal && updateMutation.mutate({ id: selectedTransmittal.id, data: editForm })}
              disabled={!editForm.subject || updateMutation.isPending}
              data-testid="proj-tx-button-submit-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRecipientsDialog} onOpenChange={setShowAddRecipientsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Recipients</DialogTitle>
            <DialogDescription>
              Select additional subcontractors to receive this transmittal
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2" data-testid="proj-tx-list-add-recipients">
              {subcontractors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subcontractors available</p>
              ) : (
                subcontractors
                  .filter(sub => {
                    const existingIds = detail?.recipients?.map(r => r.subcontractorId) || [];
                    return !existingIds.includes(sub.id);
                  })
                  .map(sub => (
                    <div key={sub.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`proj-tx-add-recipient-${sub.id}`}
                        checked={addRecipientIds.includes(sub.id)}
                        onCheckedChange={(checked) => toggleAddRecipient(sub.id, !!checked)}
                        data-testid={`proj-tx-checkbox-add-recipient-${sub.id}`}
                      />
                      <label htmlFor={`proj-tx-add-recipient-${sub.id}`} className="text-sm cursor-pointer">
                        {sub.companyName || sub.name}
                      </label>
                    </div>
                  ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRecipientsDialog(false)} data-testid="proj-tx-button-cancel-add-recipients">
              Cancel
            </Button>
            <Button
              onClick={() => selectedTransmittal && addRecipientsMutation.mutate({ id: selectedTransmittal.id, subcontractorIds: addRecipientIds })}
              disabled={addRecipientIds.length === 0 || addRecipientsMutation.isPending}
              data-testid="proj-tx-button-submit-add-recipients"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              {addRecipientsMutation.isPending ? "Adding..." : `Add ${addRecipientIds.length} Recipient${addRecipientIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
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

interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
}

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

const DOCUMENT_TYPES = [
  "Plans",
  "Drawings",
  "Specifications",
  "Addendum",
  "Shop Drawings",
  "As-Builts",
  "Other"
];

export default function TransmittalsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAddRecipientsDialog, setShowAddRecipientsDialog] = useState(false);
  const [selectedTransmittal, setSelectedTransmittal] = useState<Transmittal | null>(null);

  const [createForm, setCreateForm] = useState({
    projectId: "",
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
    if (filterProject !== "all") params.set("projectId", filterProject);
    if (filterStatus !== "all") params.set("status", filterStatus);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/subcontracts/projects"],
    enabled: !!user
  });

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"],
    enabled: !!user
  });

  const queryString = buildQueryString();
  const { data: transmittals = [], isLoading: loadingTransmittals } = useQuery<Transmittal[]>({
    queryKey: ["/api/transmittals" + queryString],
    enabled: !!user
  });

  const { data: detailTransmittal } = useQuery<Transmittal>({
    queryKey: ["/api/transmittals", selectedTransmittal?.id],
    enabled: !!selectedTransmittal?.id && showDetailDialog
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const body: Record<string, unknown> = {
        projectId: data.projectId,
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals" + queryString] });
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
      projectId: "",
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

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground" data-testid="text-login-required">Please log in to access Document Transmittals</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Send className="h-8 w-8 text-primary" />
            Document Transmittals
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Distribute updated plans, drawings, and specifications to subcontractors
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-transmittal">
          <Plus className="h-4 w-4 mr-2" />
          Create Transmittal
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-count">{transmittals.length}</div>
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
            <div className="text-2xl font-bold" data-testid="text-draft-count">{draftCount}</div>
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
            <div className="text-2xl font-bold" data-testid="text-sent-count">{sentCount}</div>
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
            <div className="text-2xl font-bold" data-testid="text-acknowledged-count">{acknowledgedCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-64">
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger data-testid="select-filter-project">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger data-testid="select-filter-status">
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
            <h3 className="text-lg font-medium mb-1" data-testid="text-empty-state">No transmittals found</h3>
            <p className="text-muted-foreground">Create a transmittal to distribute documents to subcontractors</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table data-testid="table-transmittals">
            <TableHeader>
              <TableRow>
                <TableHead>TX #</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Project</TableHead>
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
                <TableRow key={tx.id} data-testid={`row-transmittal-${tx.id}`}>
                  <TableCell className="font-medium" data-testid={`text-tx-number-${tx.id}`}>{tx.transmittalNumber}</TableCell>
                  <TableCell data-testid={`text-tx-subject-${tx.id}`}>{tx.subject}</TableCell>
                  <TableCell data-testid={`text-tx-project-${tx.id}`}>{tx.project?.code} - {tx.project?.name}</TableCell>
                  <TableCell data-testid={`text-tx-doctype-${tx.id}`}>{tx.documentType || "-"}</TableCell>
                  <TableCell data-testid={`text-tx-revision-${tx.id}`}>{tx.revisionNumber || "-"}</TableCell>
                  <TableCell data-testid={`status-tx-${tx.id}`}>{getStatusBadge(tx.status)}</TableCell>
                  <TableCell data-testid={`text-tx-date-${tx.id}`}>{tx.dateSent ? format(new Date(tx.dateSent), "MMM d, yyyy") : "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" data-testid={`badge-recipients-${tx.id}`}>
                      <Users className="h-3 w-3 mr-1" />
                      {tx.recipientCount ?? tx.recipients?.length ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDetailDialog(tx)}
                      data-testid={`button-view-transmittal-${tx.id}`}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
              <Label>Project *</Label>
              <Select
                value={createForm.projectId}
                onValueChange={(value) => setCreateForm({ ...createForm, projectId: value })}
              >
                <SelectTrigger data-testid="select-create-project">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                placeholder="e.g., Revised Floor Plans - Building A"
                data-testid="input-create-subject"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Additional details about this transmittal..."
                rows={3}
                data-testid="input-create-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select
                value={createForm.documentType}
                onValueChange={(value) => setCreateForm({ ...createForm, documentType: value })}
              >
                <SelectTrigger data-testid="select-create-doctype">
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
                data-testid="input-create-revision"
              />
            </div>

            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2" data-testid="list-create-recipients">
                {subcontractors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subcontractors available</p>
                ) : (
                  subcontractors.map(sub => (
                    <div key={sub.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`create-recipient-${sub.id}`}
                        checked={createForm.recipientSubcontractorIds.includes(sub.id)}
                        onCheckedChange={(checked) => toggleRecipient(sub.id, !!checked)}
                        data-testid={`checkbox-recipient-${sub.id}`}
                      />
                      <label htmlFor={`create-recipient-${sub.id}`} className="text-sm cursor-pointer">
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
                data-testid="input-create-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.projectId || !createForm.subject || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Transmittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span data-testid="text-detail-tx-number">{detail?.transmittalNumber}</span>
              {detail && getStatusBadge(detail.status)}
            </DialogTitle>
            <DialogDescription data-testid="text-detail-subject">
              {detail?.subject}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <p className="font-medium" data-testid="text-detail-project">{detail.project?.code} - {detail.project?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Document Type</p>
                  <p className="font-medium" data-testid="text-detail-doctype">{detail.documentType || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Revision Number</p>
                  <p className="font-medium" data-testid="text-detail-revision">{detail.revisionNumber || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sent By</p>
                  <p className="font-medium" data-testid="text-detail-sentby">{detail.sentByName || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date Sent</p>
                  <p className="font-medium" data-testid="text-detail-sentdate">{detail.dateSent ? format(new Date(detail.dateSent), "MMM d, yyyy h:mm a") : "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium" data-testid="text-detail-created">{format(new Date(detail.createdAt), "MMM d, yyyy")}</p>
                </div>
              </div>

              {detail.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm" data-testid="text-detail-description">{detail.description}</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h4 className="font-medium flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    Recipients
                  </h4>
                  {detail.status === "SENT" && (
                    <Button size="sm" variant="outline" onClick={openAddRecipientsDialog} data-testid="button-add-recipients">
                      <UserPlus className="h-4 w-4 mr-1" />
                      Add Recipients
                    </Button>
                  )}
                </div>
                {detail.recipients && detail.recipients.length > 0 ? (
                  <Table data-testid="table-recipients">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subcontractor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Acknowledged Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.recipients.map(r => (
                        <TableRow key={r.id} data-testid={`row-recipient-${r.id}`}>
                          <TableCell data-testid={`text-recipient-name-${r.id}`}>{r.subcontractorName}</TableCell>
                          <TableCell data-testid={`status-recipient-${r.id}`}>
                            {r.acknowledged ? (
                              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                <CheckCircle2 className="h-4 w-4" />
                                Acknowledged
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                Pending
                              </span>
                            )}
                          </TableCell>
                          <TableCell data-testid={`text-recipient-date-${r.id}`}>
                            {r.acknowledgedAt ? format(new Date(r.acknowledgedAt), "MMM d, yyyy h:mm a") : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-recipients">No recipients assigned</p>
                )}
              </div>

              {detail.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm" data-testid="text-detail-notes">{detail.notes}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 flex-wrap">
                {detail.status === "DRAFT" && (
                  <>
                    <Button
                      onClick={() => sendMutation.mutate(detail.id)}
                      disabled={sendMutation.isPending}
                      data-testid="button-send-transmittal"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sendMutation.isPending ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDetailDialog(false);
                        openEditDialog(detail);
                      }}
                      data-testid="button-edit-transmittal"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-delete-transmittal"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {deleteMutation.isPending ? "Deleting..." : "Delete"}
                    </Button>
                  </>
                )}
                {detail.status === "SENT" && (
                  <Button
                    variant="outline"
                    onClick={() => supersedeMutation.mutate(detail.id)}
                    disabled={supersedeMutation.isPending}
                    data-testid="button-supersede-transmittal"
                  >
                    <Archive className="h-4 w-4 mr-2" />
                    {supersedeMutation.isPending ? "Processing..." : "Mark as Superseded"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Transmittal</DialogTitle>
            <DialogDescription>
              Update transmittal details (Draft only)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={editForm.subject}
                onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                data-testid="input-edit-subject"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                data-testid="input-edit-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select
                value={editForm.documentType}
                onValueChange={(value) => setEditForm({ ...editForm, documentType: value })}
              >
                <SelectTrigger data-testid="select-edit-doctype">
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
                data-testid="input-edit-revision"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={2}
                data-testid="input-edit-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={() => selectedTransmittal && updateMutation.mutate({ id: selectedTransmittal.id, data: editForm })}
              disabled={!editForm.subject || updateMutation.isPending}
              data-testid="button-submit-edit"
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

          <div className="py-4">
            <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2" data-testid="list-add-recipients">
              {subcontractors
                .filter(sub => !detail?.recipients?.some(r => r.subcontractorId === sub.id))
                .map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`add-recipient-${sub.id}`}
                      checked={addRecipientIds.includes(sub.id)}
                      onCheckedChange={(checked) => toggleAddRecipient(sub.id, !!checked)}
                      data-testid={`checkbox-add-recipient-${sub.id}`}
                    />
                    <label htmlFor={`add-recipient-${sub.id}`} className="text-sm cursor-pointer">
                      {sub.companyName || sub.name}
                    </label>
                  </div>
                ))}
              {subcontractors.filter(sub => !detail?.recipients?.some(r => r.subcontractorId === sub.id)).length === 0 && (
                <p className="text-sm text-muted-foreground">All subcontractors have been added</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRecipientsDialog(false)} data-testid="button-cancel-add-recipients">
              Cancel
            </Button>
            <Button
              onClick={() => selectedTransmittal && addRecipientsMutation.mutate({ id: selectedTransmittal.id, subcontractorIds: addRecipientIds })}
              disabled={addRecipientIds.length === 0 || addRecipientsMutation.isPending}
              data-testid="button-submit-add-recipients"
            >
              {addRecipientsMutation.isPending ? "Adding..." : "Add Recipients"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

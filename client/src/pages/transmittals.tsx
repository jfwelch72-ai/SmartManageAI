import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Send,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import {
  useTransmittalMutations,
  type Transmittal,
  type Subcontractor,
  type EditTransmittalForm,
} from "@/hooks/useTransmittalMutations";
import {
  getTransmittalStatusBadge,
  TransmittalDetailDialog,
  TransmittalEditDialog,
  TransmittalCreateDialog,
} from "@/components/document-control/TransmittalDetailDialog";

interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
}

export default function TransmittalsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedTransmittal, setSelectedTransmittal] = useState<Transmittal | null>(null);

  const [editForm, setEditForm] = useState<EditTransmittalForm>({
    subject: "",
    description: "",
    documentType: "",
    revisionNumber: "",
    notes: ""
  });

  const mutations = useTransmittalMutations({
    selectedTransmittalId: selectedTransmittal?.id,
    onCreateSuccess: () => setShowCreateDialog(false),
    onUpdateSuccess: () => setShowEditDialog(false),
    onSendSuccess: () => setShowDetailDialog(false),
    onSupersedeSuccess: () => setShowDetailDialog(false),
    onDeleteSuccess: () => setShowDetailDialog(false),
  });

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
      ) : isMobile ? (
        <div className="space-y-3" data-testid="list-transmittals-mobile">
          {transmittals.map(tx => (
            <Card key={tx.id} data-testid={`card-transmittal-${tx.id}`} className="hover-elevate" onClick={() => openDetailDialog(tx)}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium" data-testid={`text-tx-number-${tx.id}`}>{tx.transmittalNumber}</span>
                  <span data-testid={`status-tx-${tx.id}`}>{getTransmittalStatusBadge(tx.status)}</span>
                </div>
                <p className="text-sm font-medium" data-testid={`text-tx-subject-${tx.id}`}>{tx.subject}</p>
                <div className="flex items-center justify-between gap-2 flex-wrap text-sm text-muted-foreground">
                  <span data-testid={`text-tx-project-${tx.id}`}>{tx.project?.code} - {tx.project?.name}</span>
                  <span data-testid={`text-tx-doctype-${tx.id}`}>{tx.documentType || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground" data-testid={`text-tx-date-${tx.id}`}>
                    {tx.dateSent ? format(new Date(tx.dateSent), "MMM d, yyyy") : "Not sent"}
                  </span>
                  <Badge variant="outline" data-testid={`badge-recipients-${tx.id}`}>
                    <Users className="h-3 w-3 mr-1" />
                    {tx.recipientCount ?? tx.recipients?.length ?? 0}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
                  <TableCell data-testid={`status-tx-${tx.id}`}>{getTransmittalStatusBadge(tx.status)}</TableCell>
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

      <TransmittalCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        subcontractors={subcontractors}
        projects={projects}
        onSubmit={(form) => mutations.createMutation.mutate({ ...form, projectId: form.projectId })}
        isPending={mutations.createMutation.isPending}
      />

      <TransmittalDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        transmittal={detail}
        subcontractors={subcontractors}
        onSend={(id) => mutations.sendMutation.mutate(id)}
        onSupersede={(id) => mutations.supersedeMutation.mutate(id)}
        onDelete={(id) => mutations.deleteMutation.mutate(id)}
        onEdit={openEditDialog}
        onAddRecipients={(id, subs) => mutations.addRecipientsMutation.mutate({ id, subcontractorIds: subs })}
        sendPending={mutations.sendMutation.isPending}
        supersedePending={mutations.supersedeMutation.isPending}
        deletePending={mutations.deleteMutation.isPending}
        addRecipientsPending={mutations.addRecipientsMutation.isPending}
      />

      <TransmittalEditDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editForm={editForm}
        setEditForm={setEditForm}
        onSubmit={() => selectedTransmittal && mutations.updateMutation.mutate({ id: selectedTransmittal.id, data: editForm })}
        isPending={mutations.updateMutation.isPending}
      />
    </div>
  );
}

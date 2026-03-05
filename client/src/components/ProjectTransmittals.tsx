import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Edit,
  CheckCircle2,
  Clock,
  FileText,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import DocumentAttachments from "@/components/DocumentAttachments";
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

interface ProjectTransmittalsProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

export default function ProjectTransmittals({ projectId, projectCode, userRole }: ProjectTransmittalsProps) {
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
                      <TableCell data-testid={`proj-tx-status-${tx.id}`}>{getTransmittalStatusBadge(tx.status)}</TableCell>
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
                  <span className="shrink-0" data-testid={`proj-tx-status-mobile-${tx.id}`}>{getTransmittalStatusBadge(tx.status)}</span>
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

      <TransmittalCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        subcontractors={subcontractors}
        fixedProjectId={projectId}
        onSubmit={(form) => mutations.createMutation.mutate({ ...form, projectId })}
        isPending={mutations.createMutation.isPending}
        testIdPrefix="proj-tx-"
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
        testIdPrefix="proj-tx-"
      />

      <TransmittalEditDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        editForm={editForm}
        setEditForm={setEditForm}
        onSubmit={() => selectedTransmittal && mutations.updateMutation.mutate({ id: selectedTransmittal.id, data: editForm })}
        isPending={mutations.updateMutation.isPending}
        testIdPrefix="proj-tx-"
      />
    </div>
  );
}

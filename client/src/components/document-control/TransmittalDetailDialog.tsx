import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Send,
  Eye,
  Edit,
  Trash2,
  CheckCircle2,
  Clock,
  Users,
  Archive,
  UserPlus
} from "lucide-react";
import { format } from "date-fns";
import type {
  Transmittal,
  Subcontractor,
  EditTransmittalForm,
} from "@/hooks/useTransmittalMutations";
import { DOCUMENT_TYPES } from "@/hooks/useTransmittalMutations";
import { RecipientListField } from "@/components/email/RecipientListField";

export function getTransmittalStatusBadge(status: string) {
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
}

interface TransmittalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transmittal: Transmittal | null;
  subcontractors: Subcontractor[];
  onSend: (id: string) => void;
  onSupersede: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (tx: Transmittal) => void;
  onAddRecipients: (id: string, subcontractorIds: string[]) => void;
  sendPending?: boolean;
  supersedePending?: boolean;
  deletePending?: boolean;
  addRecipientsPending?: boolean;
  testIdPrefix?: string;
}

export function TransmittalDetailDialog({
  open,
  onOpenChange,
  transmittal,
  subcontractors,
  onSend,
  onSupersede,
  onDelete,
  onEdit,
  onAddRecipients,
  sendPending = false,
  supersedePending = false,
  deletePending = false,
  addRecipientsPending = false,
  testIdPrefix = "",
}: TransmittalDetailDialogProps) {
  const [showAddRecipientsDialog, setShowAddRecipientsDialog] = useState(false);
  const [addRecipientIds, setAddRecipientIds] = useState<string[]>([]);

  const p = testIdPrefix;

  const openAddRecipientsDialog = () => {
    setAddRecipientIds([]);
    setShowAddRecipientsDialog(true);
  };

  const toggleAddRecipient = (subId: string, checked: boolean) => {
    setAddRecipientIds(prev =>
      checked ? [...prev, subId] : prev.filter(id => id !== subId)
    );
  };

  const handleAddRecipients = () => {
    if (transmittal) {
      onAddRecipients(transmittal.id, addRecipientIds);
      setShowAddRecipientsDialog(false);
      setAddRecipientIds([]);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span data-testid={`${p}text-detail-tx-number`}>{transmittal?.transmittalNumber}</span>
              {transmittal && getTransmittalStatusBadge(transmittal.status)}
            </DialogTitle>
            <DialogDescription data-testid={`${p}text-detail-subject`}>
              {transmittal?.subject}
            </DialogDescription>
          </DialogHeader>

          {transmittal && (
            <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <p className="font-medium" data-testid={`${p}text-detail-project`}>{transmittal.project?.code} - {transmittal.project?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Document Type</p>
                  <p className="font-medium" data-testid={`${p}text-detail-doctype`}>{transmittal.documentType || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Revision Number</p>
                  <p className="font-medium" data-testid={`${p}text-detail-revision`}>{transmittal.revisionNumber || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sent By</p>
                  <p className="font-medium" data-testid={`${p}text-detail-sentby`}>{transmittal.sentByName || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date Sent</p>
                  <p className="font-medium" data-testid={`${p}text-detail-sentdate`}>{transmittal.dateSent ? format(new Date(transmittal.dateSent), "MMM d, yyyy h:mm a") : "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium" data-testid={`${p}text-detail-created`}>{format(new Date(transmittal.createdAt), "MMM d, yyyy")}</p>
                </div>
              </div>

              {transmittal.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm" data-testid={`${p}text-detail-description`}>{transmittal.description}</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h4 className="font-medium flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    Recipients
                  </h4>
                  {(transmittal.status === "SENT" || transmittal.status === "ACKNOWLEDGED") && (
                    <Button size="sm" variant="outline" onClick={openAddRecipientsDialog} data-testid={`${p}button-add-recipients`}>
                      <UserPlus className="h-4 w-4 mr-1" />
                      Add Recipients
                    </Button>
                  )}
                </div>
                {transmittal.recipients && transmittal.recipients.length > 0 ? (
                  <Table data-testid={`${p}table-recipients`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subcontractor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Acknowledged Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transmittal.recipients.map(r => (
                        <TableRow key={r.id} data-testid={`${p}row-recipient-${r.id}`}>
                          <TableCell data-testid={`${p}text-recipient-name-${r.id}`}>{r.subcontractorName}</TableCell>
                          <TableCell data-testid={`${p}status-recipient-${r.id}`}>
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
                          <TableCell data-testid={`${p}text-recipient-date-${r.id}`}>
                            {r.acknowledgedAt ? format(new Date(r.acknowledgedAt), "MMM d, yyyy h:mm a") : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid={`${p}text-no-recipients`}>No recipients assigned</p>
                )}
              </div>

              {transmittal.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm" data-testid={`${p}text-detail-notes`}>{transmittal.notes}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 flex-wrap">
                {transmittal.status === "DRAFT" && (
                  <>
                    <Button
                      onClick={() => onSend(transmittal.id)}
                      disabled={sendPending}
                      data-testid={`${p}button-send-transmittal`}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sendPending ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        onEdit(transmittal);
                      }}
                      data-testid={`${p}button-edit-transmittal`}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => onDelete(transmittal.id)}
                      disabled={deletePending}
                      data-testid={`${p}button-delete-transmittal`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {deletePending ? "Deleting..." : "Delete"}
                    </Button>
                  </>
                )}
                {(transmittal.status === "SENT" || transmittal.status === "ACKNOWLEDGED") && (
                  <Button
                    variant="outline"
                    onClick={() => onSupersede(transmittal.id)}
                    disabled={supersedePending}
                    data-testid={`${p}button-supersede-transmittal`}
                  >
                    <Archive className="h-4 w-4 mr-2" />
                    {supersedePending ? "Processing..." : "Mark as Superseded"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRecipientsDialog} onOpenChange={setShowAddRecipientsDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Recipients</DialogTitle>
            <DialogDescription>
              Select additional subcontractors to receive this transmittal
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2" data-testid={`${p}list-add-recipients`}>
              {subcontractors
                .filter(sub => !transmittal?.recipients?.some(r => r.subcontractorId === sub.id))
                .map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${p}add-recipient-${sub.id}`}
                      checked={addRecipientIds.includes(sub.id)}
                      onCheckedChange={(checked) => toggleAddRecipient(sub.id, !!checked)}
                      data-testid={`${p}checkbox-add-recipient-${sub.id}`}
                    />
                    <label htmlFor={`${p}add-recipient-${sub.id}`} className="text-sm cursor-pointer">
                      {sub.companyName || sub.name}
                    </label>
                  </div>
                ))}
              {subcontractors.filter(sub => !transmittal?.recipients?.some(r => r.subcontractorId === sub.id)).length === 0 && (
                <p className="text-sm text-muted-foreground">All subcontractors have been added</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRecipientsDialog(false)} data-testid={`${p}button-cancel-add-recipients`}>
              Cancel
            </Button>
            <Button
              onClick={handleAddRecipients}
              disabled={addRecipientIds.length === 0 || addRecipientsPending}
              data-testid={`${p}button-submit-add-recipients`}
            >
              {addRecipientsPending ? "Adding..." : "Add Recipients"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TransmittalEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editForm: EditTransmittalForm;
  setEditForm: (form: EditTransmittalForm) => void;
  onSubmit: () => void;
  isPending: boolean;
  testIdPrefix?: string;
}

export function TransmittalEditDialog({
  open,
  onOpenChange,
  editForm,
  setEditForm,
  onSubmit,
  isPending,
  testIdPrefix = "",
}: TransmittalEditDialogProps) {
  const p = testIdPrefix;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
              data-testid={`${p}input-edit-subject`}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={3}
              data-testid={`${p}input-edit-description`}
            />
          </div>

          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select
              value={editForm.documentType}
              onValueChange={(value) => setEditForm({ ...editForm, documentType: value })}
            >
              <SelectTrigger data-testid={`${p}select-edit-doctype`}>
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
              data-testid={`${p}input-edit-revision`}
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              rows={2}
              data-testid={`${p}input-edit-notes`}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid={`${p}button-cancel-edit`}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!editForm.subject || isPending}
            data-testid={`${p}button-submit-edit`}
          >
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TransmittalCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subcontractors: Subcontractor[];
  projects?: Array<{ id: string; code: string; name: string }>;
  fixedProjectId?: string;
  onSubmit: (form: any) => void;
  isPending: boolean;
  testIdPrefix?: string;
}

export function TransmittalCreateDialog({
  open,
  onOpenChange,
  subcontractors,
  projects,
  fixedProjectId,
  onSubmit,
  isPending,
  testIdPrefix = "",
}: TransmittalCreateDialogProps) {
  const p = testIdPrefix;
  const [form, setForm] = useState({
    projectId: fixedProjectId || "",
    subject: "",
    description: "",
    documentType: "",
    revisionNumber: "",
    notes: "",
    recipientSubcontractorIds: [] as string[],
    recipientEmails: [] as string[],
  });

  const resetForm = () => {
    setForm({
      projectId: fixedProjectId || "",
      subject: "",
      description: "",
      documentType: "",
      revisionNumber: "",
      notes: "",
      recipientSubcontractorIds: [],
      recipientEmails: [],
    });
  };

  const toggleRecipient = (subId: string, checked: boolean) => {
    setForm(prev => ({
      ...prev,
      recipientSubcontractorIds: checked
        ? [...prev.recipientSubcontractorIds, subId]
        : prev.recipientSubcontractorIds.filter(id => id !== subId)
    }));
  };

  const handleSubmit = () => {
    onSubmit(form);
    resetForm();
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) resetForm();
    onOpenChange(val);
  };

  const isValid = form.subject && (fixedProjectId || form.projectId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Transmittal</DialogTitle>
          <DialogDescription>
            Create a new document transmittal for distribution
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
          {!fixedProjectId && projects && (
            <div className="space-y-2">
              <Label>Project *</Label>
              <Select
                value={form.projectId}
                onValueChange={(value) => setForm({ ...form, projectId: value })}
              >
                <SelectTrigger data-testid={`${p}select-create-project`}>
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(proj => (
                    <SelectItem key={proj.id} value={proj.id}>{proj.code} - {proj.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Subject *</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="e.g., Revised Floor Plans - Building A"
              data-testid={`${p}input-create-subject`}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Additional details about this transmittal..."
              rows={3}
              data-testid={`${p}input-create-description`}
            />
          </div>

          <div className="space-y-2">
            <Label>Document Type</Label>
            <Select
              value={form.documentType}
              onValueChange={(value) => setForm({ ...form, documentType: value })}
            >
              <SelectTrigger data-testid={`${p}select-create-doctype`}>
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
              value={form.revisionNumber}
              onChange={(e) => setForm({ ...form, revisionNumber: e.target.value })}
              placeholder="e.g., Rev 2, A1, etc."
              data-testid={`${p}input-create-revision`}
            />
          </div>

          <div className="space-y-2">
            <Label>Recipients</Label>
            <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2" data-testid={`${p}list-create-recipients`}>
              {subcontractors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subcontractors available</p>
              ) : (
                subcontractors.map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${p}create-recipient-${sub.id}`}
                      checked={form.recipientSubcontractorIds.includes(sub.id)}
                      onCheckedChange={(checked) => toggleRecipient(sub.id, !!checked)}
                      data-testid={`${p}checkbox-recipient-${sub.id}`}
                    />
                    <label htmlFor={`${p}create-recipient-${sub.id}`} className="text-sm cursor-pointer">
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
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Additional notes..."
              rows={2}
              data-testid={`${p}input-create-notes`}
            />
          </div>

          {(fixedProjectId || form.projectId) && (
            <RecipientListField
              projectId={fixedProjectId || form.projectId}
              emails={form.recipientEmails}
              onChange={(emails) => setForm({ ...form, recipientEmails: emails })}
              label="Additional notify emails (optional)"
              helpText="Load a saved distribution list or add additional emails to notify when this transmittal is sent."
              testIdPrefix={`${p}tx-create-recipients`}
              allowOrgScope
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid={`${p}button-cancel-create`}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            data-testid={`${p}button-submit-create`}
          >
            {isPending ? "Creating..." : "Create Transmittal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

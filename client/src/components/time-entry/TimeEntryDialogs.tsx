import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";

interface EditDialogProps {
  editEntry: any;
  setEditEntry: (e: any) => void;
  editDate: string;
  setEditDate: (v: string) => void;
  editRegular: string;
  setEditRegular: (v: string) => void;
  editOvertime: string;
  setEditOvertime: (v: string) => void;
  editCostCode: string;
  setEditCostCode: (v: string) => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  handleUpdate: () => void;
  updatePending: boolean;
}

export function EditTimeEntryDialog({
  editEntry,
  setEditEntry,
  editDate,
  setEditDate,
  editRegular,
  setEditRegular,
  editOvertime,
  setEditOvertime,
  editCostCode,
  setEditCostCode,
  editNotes,
  setEditNotes,
  handleUpdate,
  updatePending,
}: EditDialogProps) {
  return (
    <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Time Entry</DialogTitle>
          <DialogDescription>Update the time entry details below.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-date">Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              data-testid="input-edit-date"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-regular">Regular Hours</Label>
              <Input
                id="edit-regular"
                type="number"
                step="0.25"
                min="0"
                max="24"
                value={editRegular}
                onChange={(e) => setEditRegular(e.target.value)}
                data-testid="input-edit-regular"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-overtime">Overtime Hours</Label>
              <Input
                id="edit-overtime"
                type="number"
                step="0.25"
                min="0"
                max="24"
                value={editOvertime}
                onChange={(e) => setEditOvertime(e.target.value)}
                data-testid="input-edit-overtime"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-cost-code">Cost Code</Label>
            <CostCodeCombobox
              id="edit-cost-code"
              value={editCostCode}
              onChange={setEditCostCode}
              data-testid="input-edit-cost-code"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              data-testid="textarea-edit-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="button-edit-cancel">
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={updatePending} data-testid="button-edit-save">
            {updatePending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteTimeEntryDialog({
  deleteEntryId,
  setDeleteEntryId,
  handleDelete,
  deletePending,
}: {
  deleteEntryId: string | null;
  setDeleteEntryId: (id: string | null) => void;
  handleDelete: () => void;
  deletePending: boolean;
}) {
  return (
    <Dialog open={!!deleteEntryId} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Time Entry</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this time entry? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteEntryId(null)} data-testid="button-delete-cancel">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deletePending}
            data-testid="button-delete-confirm"
          >
            {deletePending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectTimeEntryDialog({
  rejectEntryId,
  setRejectEntryId,
  rejectReason,
  setRejectReason,
  handleReject,
  rejectPending,
}: {
  rejectEntryId: string | null;
  setRejectEntryId: (id: string | null) => void;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  handleReject: () => void;
  rejectPending: boolean;
}) {
  return (
    <Dialog open={!!rejectEntryId} onOpenChange={(open) => !open && setRejectEntryId(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Time Entry</DialogTitle>
          <DialogDescription>
            Please provide a reason for rejecting this time entry.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            placeholder="Enter rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            data-testid="textarea-reject-reason"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setRejectEntryId(null);
              setRejectReason("");
            }}
            data-testid="button-reject-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={rejectPending || !rejectReason.trim()}
            data-testid="button-reject-confirm"
          >
            {rejectPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { FileText, Calendar, User, CheckCircle, XCircle, Clock, Edit } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChangeOrderFiles } from "./ChangeOrderFiles";
import { ChangeOrderFileUploader } from "./ChangeOrderFileUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

interface ChangeOrder {
  id: string;
  changeOrderNumber: string;
  description: string;
  amount: string;
  status: string;
  requestedById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChangeOrderDialogProps {
  changeOrder: ChangeOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  userRole: string;
}

export function ChangeOrderDialog({
  changeOrder,
  open,
  onOpenChange,
  projectCode,
  userRole,
}: ChangeOrderDialogProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedNumber, setEditedNumber] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [editedAmount, setEditedAmount] = useState("");

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);
  const canEdit = changeOrder?.status === "DRAFT";

  useEffect(() => {
    if (changeOrder) {
      setEditedNumber(changeOrder.changeOrderNumber);
      setEditedDescription(changeOrder.description);
      setEditedAmount(changeOrder.amount);
      setIsEditing(false);
    }
  }, [changeOrder]);

  const updateMutation = useMutation({
    mutationFn: async (data: { changeOrderNumber: string; description: string; amount: string }) => {
      return apiRequest("PATCH", `/api/change-orders/${changeOrder?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order updated successfully" });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update change order", variant: "destructive" });
    },
  });

  const requestApprovalMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/request-approval`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order sent for approval" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to request approval", variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/submit`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order submitted to client" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order approved" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const reason = prompt("Please provide a reason for rejection:");
      if (!reason) throw new Error("Rejection reason required");
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order rejected" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      if (error.message !== "Rejection reason required") {
        toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
      }
    },
  });

  const returnToDraftMutation = useMutation({
    mutationFn: async () => {
      const reason = prompt("Reason for returning to draft (optional):");
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/return-to-draft`, {
        reason: reason || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order returned to draft" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!editedNumber || !editedDescription || !editedAmount) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      changeOrderNumber: editedNumber,
      description: editedDescription,
      amount: editedAmount,
    });
  };

  if (!changeOrder) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "APPROVED":
        return "default";
      case "REJECTED":
        return "destructive";
      case "PENDING_APPROVAL":
        return "destructive";
      case "SUBMITTED":
        return "secondary";
      default:
        return "secondary";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-view-change-order">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Change Order Details
            </DialogTitle>
            <Badge variant={getStatusColor(changeOrder.status)}>
              {changeOrder.status.replace("_", " ")}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="view-co-number">Change Order Number</Label>
              {isEditing ? (
                <Input
                  id="view-co-number"
                  value={editedNumber}
                  onChange={(e) => setEditedNumber(e.target.value)}
                  data-testid="input-edit-co-number"
                />
              ) : (
                <div className="mt-1">
                  <Badge variant="outline" className="font-mono text-base px-3 py-1">
                    {changeOrder.changeOrderNumber}
                  </Badge>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="view-co-description">Description</Label>
              {isEditing ? (
                <Textarea
                  id="view-co-description"
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  rows={4}
                  data-testid="input-edit-co-description"
                />
              ) : (
                <p className="mt-1 text-sm">{changeOrder.description}</p>
              )}
            </div>

            <div>
              <Label htmlFor="view-co-amount">Amount</Label>
              {isEditing ? (
                <Input
                  id="view-co-amount"
                  type="number"
                  step="0.01"
                  value={editedAmount}
                  onChange={(e) => setEditedAmount(e.target.value)}
                  data-testid="input-edit-co-amount"
                />
              ) : (
                <p className="mt-1 text-2xl font-bold font-mono">
                  ${parseFloat(changeOrder.amount).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <Separator />

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>Created: {format(new Date(changeOrder.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
            {changeOrder.approvedAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4" />
                <span>Approved: {format(new Date(changeOrder.approvedAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            )}
          </div>

          {changeOrder.rejectionReason && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm font-medium text-destructive mb-1">Rejection Reason:</p>
              <p className="text-sm text-destructive/90">{changeOrder.rejectionReason}</p>
            </div>
          )}

          <Separator />

          {/* File Attachments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Attachments</h3>
              {canEdit && <ChangeOrderFileUploader changeOrderId={changeOrder.id} variant="outline" />}
            </div>
            <ChangeOrderFiles changeOrderId={changeOrder.id} alwaysExpanded />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="button-save-changes"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  data-testid="button-edit-change-order"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}

              {changeOrder.status === "DRAFT" && (
                <Button
                  onClick={() => requestApprovalMutation.mutate()}
                  disabled={requestApprovalMutation.isPending}
                  data-testid="button-request-approval-dialog"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  {requestApprovalMutation.isPending ? "Requesting..." : "Request Approval"}
                </Button>
              )}

              {canManage && changeOrder.status === "PENDING_APPROVAL" && (
                <>
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    data-testid="button-submit-dialog"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {submitMutation.isPending ? "Submitting..." : "Submit to Client"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => returnToDraftMutation.mutate()}
                    disabled={returnToDraftMutation.isPending}
                    data-testid="button-return-draft-dialog"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {returnToDraftMutation.isPending ? "Returning..." : "Return to Draft"}
                  </Button>
                </>
              )}

              {canManage && changeOrder.status === "SUBMITTED" && (
                <>
                  <Button
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                    data-testid="button-approve-dialog"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {approveMutation.isPending ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectMutation.isPending}
                    data-testid="button-reject-dialog"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    {rejectMutation.isPending ? "Rejecting..." : "Reject"}
                  </Button>
                </>
              )}

              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-dialog">
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

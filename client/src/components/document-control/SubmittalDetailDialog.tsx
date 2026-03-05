import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileCheck,
  Eye,
  CheckCircle2,
  XCircle,
  Send,
  RotateCcw,
  Trash2,
  Edit,
  Link as LinkIcon,
  MessageSquare,
  FileText
} from "lucide-react";
import { format } from "date-fns";
import type { Submittal, RFI, SubmittalCreateForm } from "@/hooks/useSubmittalMutations";

export function getStatusBadge(status: string, prefix = "") {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary" data-testid={`${prefix}badge-status-draft`}>Draft</Badge>;
    case "SUBMITTED":
      return <Badge variant="default" data-testid={`${prefix}badge-status-submitted`}>Submitted</Badge>;
    case "UNDER_REVIEW":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`${prefix}badge-status-under-review`}>Under Review</Badge>;
    case "APPROVED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`${prefix}badge-status-approved`}>Approved</Badge>;
    case "APPROVED_AS_NOTED":
      return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400" data-testid={`${prefix}badge-status-approved-as-noted`}>Approved As Noted</Badge>;
    case "REJECTED":
      return <Badge variant="destructive" data-testid={`${prefix}badge-status-rejected`}>Rejected</Badge>;
    case "REVISE_AND_RESUBMIT":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid={`${prefix}badge-status-revise`}>Revise & Resubmit</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function getPhaseBadge(phase: string) {
  switch (phase) {
    case "ESTIMATE":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Estimate</Badge>;
    case "AWARDED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Awarded</Badge>;
    case "CONSTRUCTION":
      return <Badge variant="default">Construction</Badge>;
    default:
      return <Badge variant="outline">{phase}</Badge>;
  }
}

export function getTypeBadge(type: string) {
  switch (type) {
    case "CONTRACTOR":
      return <Badge variant="default">Contractor</Badge>;
    case "SUBCONTRACTOR":
      return <Badge variant="outline">Subcontractor</Badge>;
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

interface SubmittalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submittal: Submittal | null;
  selectedDetail?: Submittal | null;
  testIdPrefix?: string;
  mutations: {
    submitMutation: { mutate: (id: string) => void; isPending: boolean };
    startReviewMutation: { mutate: (id: string) => void; isPending: boolean };
    resubmitMutation: { mutate: (id: string) => void; isPending: boolean };
    deleteMutation: { mutate: (id: string) => void; isPending: boolean };
    addCommentMutation: { mutate: (args: { id: string; comment: string }) => void; isPending: boolean };
    reviewMutation: { mutate: (args: { id: string; action: string; comments: string }) => void; isPending: boolean };
    linkRfiMutation: { mutate: (args: { id: string; rfiId: string }) => void; isPending: boolean };
  };
  onEdit?: (submittal: Submittal) => void;
  attachmentsSlot?: React.ReactNode;
}

export function SubmittalDetailDialog({
  open,
  onOpenChange,
  submittal,
  selectedDetail,
  testIdPrefix = "",
  mutations,
  onEdit,
  attachmentsSlot
}: SubmittalDetailDialogProps) {
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showLinkRfiDialog, setShowLinkRfiDialog] = useState(false);
  const [reviewAction, setReviewAction] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [newComment, setNewComment] = useState("");
  const [selectedRfiId, setSelectedRfiId] = useState("");

  const { data: rfis = [] } = useQuery<RFI[]>({
    queryKey: ["/api/rfi", submittal?.projectId ? `?projectId=${submittal.projectId}` : ""],
    enabled: !!submittal?.projectId && showLinkRfiDialog
  });

  const detail = selectedDetail || submittal;

  const openReviewDialog = (action: string) => {
    setReviewAction(action);
    setReviewComments("");
    setShowReviewDialog(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid={`${testIdPrefix}text-detail-title`}>
              <FileCheck className="h-5 w-5" />
              {detail?.submittalNumber}
              {detail && getStatusBadge(detail.status, testIdPrefix)}
              {detail && getTypeBadge(detail.submittalType)}
              {detail && getPhaseBadge(detail.phase)}
            </DialogTitle>
            <DialogDescription>{detail?.subject}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Subject</Label>
                  <p className="font-medium" data-testid={`${testIdPrefix}text-detail-subject`}>{detail.subject}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Revision</Label>
                  <p className="font-medium" data-testid={`${testIdPrefix}text-detail-revision`}>Rev {detail.revision}</p>
                </div>
              </div>

              {detail.description && (
                <div>
                  <Label className="text-muted-foreground text-xs">Description</Label>
                  <p data-testid={`${testIdPrefix}text-detail-description`}>{detail.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {detail.specSection && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Spec Section</Label>
                    <p data-testid={`${testIdPrefix}text-detail-spec-section`}>{detail.specSection}</p>
                  </div>
                )}
                {detail.category && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Category</Label>
                    <p data-testid={`${testIdPrefix}text-detail-category`}>{detail.category}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Project</Label>
                  <p data-testid={`${testIdPrefix}text-detail-project`}>{detail.project?.code} - {detail.project?.name}</p>
                </div>
                {detail.subcontractor && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Subcontractor</Label>
                    <p data-testid={`${testIdPrefix}text-detail-subcontractor`}>{detail.subcontractor.companyName || detail.subcontractor.name}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {detail.submittedByName && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Submitted By</Label>
                    <p data-testid={`${testIdPrefix}text-detail-submitted-by`}>{detail.submittedByName}</p>
                  </div>
                )}
                {detail.dateSubmitted && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Date Submitted</Label>
                    <p data-testid={`${testIdPrefix}text-detail-date-submitted`}>{format(new Date(detail.dateSubmitted), "MMM d, yyyy")}</p>
                  </div>
                )}
              </div>

              {detail.reviewerName && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Reviewer</Label>
                    <p data-testid={`${testIdPrefix}text-detail-reviewer`}>{detail.reviewerName}</p>
                  </div>
                  {detail.reviewDate && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Review Date</Label>
                      <p data-testid={`${testIdPrefix}text-detail-review-date`}>{format(new Date(detail.reviewDate), "MMM d, yyyy")}</p>
                    </div>
                  )}
                </div>
              )}

              {detail.reviewComments && (
                <div>
                  <Label className="text-muted-foreground text-xs">Review Comments</Label>
                  <p className="bg-muted p-3 rounded-md text-sm" data-testid={`${testIdPrefix}text-detail-review-comments`}>{detail.reviewComments}</p>
                </div>
              )}

              {detail.stampAction && (
                <div>
                  <Label className="text-muted-foreground text-xs">Stamp</Label>
                  <p data-testid={`${testIdPrefix}text-detail-stamp`}>{detail.stampAction}</p>
                </div>
              )}

              {detail.linkedRfiId && (
                <div>
                  <Label className="text-muted-foreground text-xs">Linked RFI</Label>
                  <p data-testid={`${testIdPrefix}text-detail-linked-rfi`}>{detail.linkedRfiId}</p>
                </div>
              )}

              {detail.dateRequired && (
                <div>
                  <Label className="text-muted-foreground text-xs">Date Required</Label>
                  <p data-testid={`${testIdPrefix}text-detail-date-required`}>{format(new Date(detail.dateRequired), "MMM d, yyyy")}</p>
                </div>
              )}

              {detail.revision > 1 && detail.previousRevisionId && (
                <div>
                  <Label className="text-muted-foreground text-xs">Previous Revision</Label>
                  <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}text-detail-previous-revision`}>
                    Revision {detail.revision - 1} (ID: {detail.previousRevisionId})
                  </p>
                </div>
              )}

              {attachmentsSlot}

              <div className="flex items-center gap-2 flex-wrap border-t pt-4">
                {detail.status === "DRAFT" && (
                  <>
                    <Button
                      onClick={() => mutations.submitMutation.mutate(detail.id)}
                      disabled={mutations.submitMutation.isPending}
                      data-testid={`${testIdPrefix}button-action-submit`}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Submit
                    </Button>
                    {onEdit && (
                      <Button variant="outline" data-testid={`${testIdPrefix}button-action-edit`} onClick={() => onEdit(detail)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => mutations.deleteMutation.mutate(detail.id)}
                      disabled={mutations.deleteMutation.isPending}
                      data-testid={`${testIdPrefix}button-action-delete`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </>
                )}
                {detail.status === "SUBMITTED" && (
                  <Button
                    onClick={() => mutations.startReviewMutation.mutate(detail.id)}
                    disabled={mutations.startReviewMutation.isPending}
                    data-testid={`${testIdPrefix}button-action-start-review`}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Start Review
                  </Button>
                )}
                {detail.status === "UNDER_REVIEW" && (
                  <>
                    <Button
                      variant="default"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => openReviewDialog("approve")}
                      data-testid={`${testIdPrefix}button-action-approve`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="border-green-500 text-green-700 dark:text-green-400"
                      onClick={() => openReviewDialog("approve-as-noted")}
                      data-testid={`${testIdPrefix}button-action-approve-as-noted`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Approve As Noted
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => openReviewDialog("reject")}
                      data-testid={`${testIdPrefix}button-action-reject`}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      className="border-orange-500 text-orange-700 dark:text-orange-400"
                      onClick={() => openReviewDialog("revise")}
                      data-testid={`${testIdPrefix}button-action-revise`}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Revise & Resubmit
                    </Button>
                  </>
                )}
                {(detail.status === "REJECTED" || detail.status === "REVISE_AND_RESUBMIT") && (
                  <Button
                    onClick={() => mutations.resubmitMutation.mutate(detail.id)}
                    disabled={mutations.resubmitMutation.isPending}
                    data-testid={`${testIdPrefix}button-action-resubmit`}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Resubmit
                  </Button>
                )}
                {(detail.status === "APPROVED" || detail.status === "APPROVED_AS_NOTED") && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedRfiId("");
                      setShowLinkRfiDialog(true);
                    }}
                    data-testid={`${testIdPrefix}button-action-link-rfi`}
                  >
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Link to RFI
                  </Button>
                )}
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Activity Log
                </h3>
                {detail.activity && detail.activity.length > 0 ? (
                  <div className="space-y-3" data-testid={`${testIdPrefix}activity-log`}>
                    {detail.activity.map((act) => (
                      <div key={act.id} className="flex items-start gap-3 text-sm" data-testid={`${testIdPrefix}activity-item-${act.id}`}>
                        <div className="p-1 bg-muted rounded-md mt-0.5">
                          <FileText className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{act.userName || "System"}</span>
                            <span className="text-muted-foreground text-xs">{format(new Date(act.createdAt), "MMM d, yyyy h:mm a")}</span>
                          </div>
                          <p className="text-muted-foreground">{act.action}{act.comment ? `: ${act.comment}` : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}text-no-activity`}>No activity yet</p>
                )}
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium mb-2">Add Comment</h3>
                <div className="flex gap-2">
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    rows={2}
                    className="flex-1"
                    data-testid={`${testIdPrefix}input-add-comment`}
                  />
                  <Button
                    onClick={() => {
                      if (newComment.trim() && detail.id) {
                        mutations.addCommentMutation.mutate({ id: detail.id, comment: newComment.trim() });
                        setNewComment("");
                      }
                    }}
                    disabled={!newComment.trim() || mutations.addCommentMutation.isPending}
                    data-testid={`${testIdPrefix}button-add-comment`}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" && "Approve Submittal"}
              {reviewAction === "approve-as-noted" && "Approve As Noted"}
              {reviewAction === "reject" && "Reject Submittal"}
              {reviewAction === "revise" && "Revise & Resubmit"}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve" ? "Optionally add review comments." : "Please provide review comments."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Review Comments {reviewAction !== "approve" ? "*" : ""}</Label>
              <Textarea
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Enter review comments..."
                rows={4}
                data-testid={`${testIdPrefix}input-review-comments`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)} data-testid={`${testIdPrefix}button-cancel-review`}>Cancel</Button>
            <Button
              onClick={() => {
                if (submittal) {
                  mutations.reviewMutation.mutate({
                    id: submittal.id,
                    action: reviewAction,
                    comments: reviewComments
                  });
                  setShowReviewDialog(false);
                  setReviewComments("");
                }
              }}
              disabled={
                (reviewAction !== "approve" && !reviewComments.trim()) ||
                mutations.reviewMutation.isPending
              }
              data-testid={`${testIdPrefix}button-confirm-review`}
            >
              {mutations.reviewMutation.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkRfiDialog} onOpenChange={setShowLinkRfiDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to RFI</DialogTitle>
            <DialogDescription>Select an RFI to link to this submittal</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>RFI</Label>
              <Select value={selectedRfiId} onValueChange={setSelectedRfiId}>
                <SelectTrigger data-testid={`${testIdPrefix}select-link-rfi`}>
                  <SelectValue placeholder="Select an RFI..." />
                </SelectTrigger>
                <SelectContent>
                  {rfis.map(rfi => (
                    <SelectItem key={rfi.id} value={rfi.id}>{rfi.rfiNumber} - {rfi.subject}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkRfiDialog(false)} data-testid={`${testIdPrefix}button-cancel-link-rfi`}>Cancel</Button>
            <Button
              onClick={() => {
                if (submittal && selectedRfiId) {
                  mutations.linkRfiMutation.mutate({ id: submittal.id, rfiId: selectedRfiId });
                  setShowLinkRfiDialog(false);
                  setSelectedRfiId("");
                }
              }}
              disabled={!selectedRfiId || mutations.linkRfiMutation.isPending}
              data-testid={`${testIdPrefix}button-confirm-link-rfi`}
            >
              {mutations.linkRfiMutation.isPending ? "Linking..." : "Link RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

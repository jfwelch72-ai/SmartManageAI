import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import DocumentAttachments from "@/components/DocumentAttachments";
import {
  Send,
  Play,
  MessageSquare,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Trash2,
  Edit,
  RotateCcw,
  Link2,
  FileCheck,
  Forward,
} from "lucide-react";
import { format } from "date-fns";
import type { RFI, ActivityEntry, ChangeOrder, RFIEditForm } from "@/hooks/useRfiMutations";
import { getStatusBadge, getPriorityBadge, DEFAULT_EDIT_FORM } from "@/hooks/useRfiMutations";

const RFI_CATEGORIES = [
  { value: "DESIGN_CLARIFICATION", label: "Design Clarification" },
  { value: "FIELD_CONDITION", label: "Field Condition" },
  { value: "SUBSTITUTION_REQUEST", label: "Substitution Request" },
  { value: "SPECIFICATION_INTERPRETATION", label: "Specification Interpretation" },
  { value: "SCHEDULE", label: "Schedule" },
  { value: "ADMINISTRATIVE", label: "Administrative" },
  { value: "OTHER", label: "Other" },
];

function getCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return RFI_CATEGORIES.find((c) => c.value === value)?.label || value;
}

interface TMTicket {
  id: string;
  ticketNumber: string;
  workDate: string;
  status: string;
  description: string | null;
}

interface Submittal {
  id: string;
  submittalNumber: string;
  subject: string;
  status: string;
}

interface RfiDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rfi: RFI | null;
  onRfiUpdate: (rfi: RFI) => void;
  mutations: {
    submitMutation: { mutate: (id: string) => void; isPending: boolean };
    reviewMutation: { mutate: (id: string) => void; isPending: boolean };
    forwardMutation: { mutate: (args: { id: string; forwardedToId: string }) => void; isPending: boolean };
    answerMutation: { mutate: (args: { id: string; answer: string }) => void; isPending: boolean };
    closeMutation: { mutate: (id: string) => void; isPending: boolean };
    reopenMutation: { mutate: (id: string) => void; isPending: boolean };
    deleteMutation: { mutate: (id: string) => void; isPending: boolean };
    updateMutation: { mutate: (args: { id: string; data: Record<string, unknown> }) => void; isPending: boolean };
    linkCOMutation: { mutate: (args: { id: string; changeOrderId: string }) => void; isPending: boolean };
    linkTMMutation: { mutate: (args: { id: string; tmTicketId: string }) => void; isPending: boolean };
    linkSubmittalMutation: { mutate: (args: { id: string; submittalId: string }) => void; isPending: boolean };
    addCommentMutation: { mutate: (args: { id: string; comment: string }) => void; isPending: boolean };
  };
  testIdPrefix?: string;
  attachmentsSlot?: React.ReactNode;
}

export default function RfiDetailDialog({
  open,
  onOpenChange,
  rfi,
  onRfiUpdate,
  mutations,
  testIdPrefix = "",
  attachmentsSlot,
}: RfiDetailDialogProps) {
  const [showAnswerInput, setShowAnswerInput] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [commentText, setCommentText] = useState("");
  const [showLinkCODialog, setShowLinkCODialog] = useState(false);
  const [selectedCOId, setSelectedCOId] = useState("");
  const [showLinkTMDialog, setShowLinkTMDialog] = useState(false);
  const [selectedTMId, setSelectedTMId] = useState("");
  const [showLinkSubmittalDialog, setShowLinkSubmittalDialog] = useState(false);
  const [selectedSubmittalId, setSelectedSubmittalId] = useState("");
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [forwardToUserId, setForwardToUserId] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<RFIEditForm>({ ...DEFAULT_EDIT_FORM });

  const p = testIdPrefix;

  const { data: selectedRFIDetail } = useQuery<RFI>({
    queryKey: ["/api/rfi", rfi?.id],
    enabled: !!rfi?.id && open,
  });

  const { data: activityLog = [] } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/rfi", rfi?.id, "activity"],
    enabled: !!rfi?.id && open,
  });

  const { data: changeOrders = [] } = useQuery<ChangeOrder[]>({
    queryKey: ["/api/change-orders" + (rfi?.projectId ? `?projectId=${rfi.projectId}` : "")],
    enabled: !!rfi?.projectId && showLinkCODialog,
  });

  const { data: tmTickets = [] } = useQuery<TMTicket[]>({
    queryKey: ["/api/projects", rfi?.projectId, "tm-tickets"],
    enabled: !!rfi?.projectId && showLinkTMDialog,
  });

  const { data: submittals = [] } = useQuery<Submittal[]>({
    queryKey: ["/api/submittals", { projectId: rfi?.projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/submittals?projectId=${rfi?.projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch submittals");
      return res.json();
    },
    enabled: !!rfi?.projectId && showLinkSubmittalDialog,
  });

  const { data: orgUsers = [] } = useQuery<{ id: string; firstName: string; lastName: string; role: string }[]>({
    queryKey: ["/api/messaging/users"],
    enabled: showForwardDialog,
  });

  useEffect(() => {
    if (selectedRFIDetail && open) {
      onRfiUpdate(selectedRFIDetail);
    }
  }, [selectedRFIDetail, open]);

  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setShowAnswerInput(false);
      setAnswerText("");
      setCommentText("");
      setShowForwardDialog(false);
      setForwardToUserId("");
    }
  }, [open]);

  const startEdit = () => {
    if (!rfi) return;
    setEditForm({
      subject: rfi.subject,
      question: rfi.question,
      priority: rfi.priority,
      category: rfi.category || "",
      drawingReference: rfi.drawingReference || "",
      specReference: rfi.specReference || "",
      dateRequired: rfi.dateRequired || "",
      impactDescription: rfi.impactDescription || "",
      costImpact: rfi.costImpact || false,
      scheduleImpact: rfi.scheduleImpact || false,
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    if (!rfi) return;
    mutations.updateMutation.mutate({ id: rfi.id, data: editForm });
    setEditMode(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setEditMode(false); setShowAnswerInput(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid={`${p}dialog-rfi-detail`}>
          {rfi && (
            <div className="space-y-6">
              <DialogHeader>
                <div className="flex items-center gap-3 flex-wrap">
                  {getStatusBadge(rfi.status)}
                  {getPriorityBadge(rfi.priority)}
                  <span className="text-sm text-muted-foreground" data-testid={`${p}text-detail-rfi-number`}>
                    {rfi.rfiNumber}
                  </span>
                </div>
                <DialogTitle data-testid={`${p}text-detail-subject`}>
                  {editMode ? (
                    <Input
                      value={editForm.subject}
                      onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                      data-testid={`${p}input-edit-subject`}
                    />
                  ) : (
                    rfi.subject
                  )}
                </DialogTitle>
              </DialogHeader>

              {editMode ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Question</Label>
                    <Textarea
                      value={editForm.question}
                      onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                      rows={4}
                      data-testid={`${p}input-edit-question`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                        <SelectTrigger data-testid={`${p}select-edit-priority`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LOW">Low</SelectItem>
                          <SelectItem value="MEDIUM">Medium</SelectItem>
                          <SelectItem value="HIGH">High</SelectItem>
                          <SelectItem value="URGENT">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={editForm.category || "none"} onValueChange={(v) => setEditForm({ ...editForm, category: v === "none" ? "" : v })}>
                        <SelectTrigger data-testid={`${p}select-edit-category`}>
                          <SelectValue placeholder="Select category (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {RFI_CATEGORIES.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Drawing Reference</Label>
                      <Input
                        value={editForm.drawingReference}
                        onChange={(e) => setEditForm({ ...editForm, drawingReference: e.target.value })}
                        data-testid={`${p}input-edit-drawing-ref`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Spec Reference</Label>
                      <Input
                        value={editForm.specReference}
                        onChange={(e) => setEditForm({ ...editForm, specReference: e.target.value })}
                        data-testid={`${p}input-edit-spec-ref`}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Date Required</Label>
                    <Input
                      type="date"
                      value={editForm.dateRequired}
                      onChange={(e) => setEditForm({ ...editForm, dateRequired: e.target.value })}
                      data-testid={`${p}input-edit-date-required`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Impact Description</Label>
                    <Textarea
                      value={editForm.impactDescription}
                      onChange={(e) => setEditForm({ ...editForm, impactDescription: e.target.value })}
                      rows={2}
                      data-testid={`${p}input-edit-impact`}
                    />
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={editForm.costImpact}
                        onCheckedChange={(c) => setEditForm({ ...editForm, costImpact: !!c })}
                        data-testid={`${p}checkbox-edit-cost-impact`}
                      />
                      <Label>Cost Impact</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={editForm.scheduleImpact}
                        onCheckedChange={(c) => setEditForm({ ...editForm, scheduleImpact: !!c })}
                        data-testid={`${p}checkbox-edit-schedule-impact`}
                      />
                      <Label>Schedule Impact</Label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button onClick={saveEdit} disabled={mutations.updateMutation.isPending} data-testid={`${p}button-save-edit`}>
                      {mutations.updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditMode(false)} data-testid={`${p}button-cancel-edit`}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-muted-foreground text-xs">Question</Label>
                      <p className="mt-1 whitespace-pre-wrap" data-testid={`${p}text-detail-question`}>{rfi.question}</p>
                    </div>

                    {rfi.category && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Category</Label>
                        <p className="mt-1" data-testid={`${p}text-detail-category`}>{getCategoryLabel(rfi.category)}</p>
                      </div>
                    )}

                    {(rfi.drawingReference || rfi.specReference) && (
                      <div className="flex gap-4 flex-wrap">
                        {rfi.drawingReference && (
                          <div>
                            <Label className="text-muted-foreground text-xs">Drawing Reference</Label>
                            <p className="mt-1" data-testid={`${p}text-detail-drawing-ref`}>{rfi.drawingReference}</p>
                          </div>
                        )}
                        {rfi.specReference && (
                          <div>
                            <Label className="text-muted-foreground text-xs">Spec Reference</Label>
                            <p className="mt-1" data-testid={`${p}text-detail-spec-ref`}>{rfi.specReference}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {rfi.subcontractor && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Subcontractor</Label>
                        <p className="mt-1" data-testid={`${p}text-detail-subcontractor`}>{rfi.subcontractor.companyName}</p>
                      </div>
                    )}

                    {rfi.dateRequired && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Date Required</Label>
                        <p className="mt-1" data-testid={`${p}text-detail-date-required`}>
                          {format(new Date(rfi.dateRequired), "MMM d, yyyy")}
                        </p>
                      </div>
                    )}

                    {(rfi.costImpact || rfi.scheduleImpact) && (
                      <div className="flex gap-3 flex-wrap">
                        {rfi.costImpact && (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid={`${p}badge-cost-impact`}>
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Cost Impact
                          </Badge>
                        )}
                        {rfi.scheduleImpact && (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid={`${p}badge-schedule-impact`}>
                            <Clock className="h-3 w-3 mr-1" />
                            Schedule Impact
                          </Badge>
                        )}
                      </div>
                    )}

                    {rfi.impactDescription && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Impact Description</Label>
                        <p className="mt-1 whitespace-pre-wrap" data-testid={`${p}text-detail-impact`}>{rfi.impactDescription}</p>
                      </div>
                    )}

                    {rfi.answer && (
                      <Card data-testid={`${p}card-answer`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            Answer
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="whitespace-pre-wrap" data-testid={`${p}text-detail-answer`}>{rfi.answer}</p>
                          {rfi.answeredByName && (
                            <p className="text-sm text-muted-foreground" data-testid={`${p}text-detail-answered-by`}>
                              Answered by {rfi.answeredByName}
                              {rfi.dateAnswered && ` on ${format(new Date(rfi.dateAnswered), "MMM d, yyyy")}`}
                            </p>
                          )}
                          <DocumentAttachments
                            entityType="rfi-answer"
                            entityId={rfi.id}
                            canUpload={rfi.status === "UNDER_REVIEW" || rfi.status === "ANSWERED"}
                            canDelete={true}
                            compact
                          />
                        </CardContent>
                      </Card>
                    )}

                    {rfi.status === "CLOSED" && rfi.closedByName && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`${p}text-detail-closed-by`}>
                        <XCircle className="h-4 w-4 shrink-0" />
                        <span>
                          Closed by {rfi.closedByName}
                          {rfi.closedAt && ` on ${format(new Date(rfi.closedAt), "MMM d, yyyy")}`}
                        </span>
                      </div>
                    )}

                    {rfi.status === "FORWARDED" && rfi.forwardedAt && (
                      <Card data-testid={`${p}card-forwarded`} className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2 text-blue-700 dark:text-blue-300">
                            <Forward className="h-4 w-4" />
                            Forwarded to Design Team
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-blue-800 dark:text-blue-200" data-testid={`${p}text-forwarded-date`}>
                            Forwarded on {format(new Date(rfi.forwardedAt), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Awaiting response from the design team.
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    {rfi.linkedChangeOrderId && (
                      <div data-testid={`${p}linked-co`}>
                        <Label className="text-muted-foreground text-xs">Linked Change Order</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm" data-testid={`${p}text-linked-co-id`}>{rfi.linkedChangeOrderId}</span>
                        </div>
                      </div>
                    )}

                    {rfi.linkedTmTicketId && (
                      <div data-testid={`${p}linked-tm`}>
                        <Label className="text-muted-foreground text-xs">Linked T&amp;M Ticket</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm" data-testid={`${p}text-linked-tm-id`}>{rfi.linkedTmTicketId}</span>
                        </div>
                      </div>
                    )}

                    {rfi.linkedSubmittalId && (
                      <div data-testid={`${p}linked-submittal`}>
                        <Label className="text-muted-foreground text-xs">Linked Submittal</Label>
                        <div className="mt-1 flex items-center gap-2 p-2 rounded-md border bg-card">
                          <FileCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium" data-testid={`${p}text-linked-submittal-number`}>
                              {rfi.linkedSubmittalNumber || rfi.linkedSubmittalId}
                            </p>
                            {rfi.linkedSubmittalSubject && (
                              <p className="text-xs text-muted-foreground truncate" data-testid={`${p}text-linked-submittal-subject`}>
                                {rfi.linkedSubmittalSubject}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {attachmentsSlot}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {rfi.status === "DRAFT" && (
                      <>
                        <Button
                          onClick={() => mutations.submitMutation.mutate(rfi.id)}
                          disabled={mutations.submitMutation.isPending}
                          data-testid={`${p}button-submit-rfi`}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Submit
                        </Button>
                        <Button variant="outline" onClick={startEdit} data-testid={`${p}button-edit-rfi`}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => mutations.deleteMutation.mutate(rfi.id)}
                          disabled={mutations.deleteMutation.isPending}
                          data-testid={`${p}button-delete-rfi`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </>
                    )}
                    {rfi.status === "SUBMITTED" && (
                      <Button
                        onClick={() => mutations.reviewMutation.mutate(rfi.id)}
                        disabled={mutations.reviewMutation.isPending}
                        data-testid={`${p}button-start-review`}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Start Review
                      </Button>
                    )}
                    {rfi.status === "UNDER_REVIEW" && (
                      <>
                        {showAnswerInput ? (
                          <div className="w-full space-y-3">
                            <Textarea
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                              placeholder="Enter the answer to this RFI..."
                              rows={4}
                              data-testid={`${p}input-answer`}
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                onClick={() => {
                                  mutations.answerMutation.mutate({ id: rfi.id, answer: answerText });
                                  setShowAnswerInput(false);
                                  setAnswerText("");
                                }}
                                disabled={!answerText.trim() || mutations.answerMutation.isPending}
                                data-testid={`${p}button-submit-answer`}
                              >
                                {mutations.answerMutation.isPending ? "Submitting..." : "Submit Answer"}
                              </Button>
                              <Button variant="outline" onClick={() => setShowAnswerInput(false)} data-testid={`${p}button-cancel-answer`}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <Button onClick={() => setShowAnswerInput(true)} data-testid={`${p}button-answer-rfi`}>
                              <MessageSquare className="h-4 w-4 mr-2" />
                              Answer
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setShowForwardDialog(true)}
                              disabled={mutations.forwardMutation.isPending}
                              data-testid={`${p}button-forward-rfi`}
                            >
                              <Forward className="h-4 w-4 mr-2" />
                              Forward to Design Team
                            </Button>
                          </>
                        )}
                      </>
                    )}
                    {rfi.status === "FORWARDED" && (
                      <>
                        {showAnswerInput ? (
                          <div className="w-full space-y-3">
                            <Textarea
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                              placeholder="Enter the answer to this RFI..."
                              rows={4}
                              data-testid={`${p}input-answer-forwarded`}
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                onClick={() => {
                                  mutations.answerMutation.mutate({ id: rfi.id, answer: answerText });
                                  setShowAnswerInput(false);
                                  setAnswerText("");
                                }}
                                disabled={!answerText.trim() || mutations.answerMutation.isPending}
                                data-testid={`${p}button-submit-answer-forwarded`}
                              >
                                {mutations.answerMutation.isPending ? "Submitting..." : "Submit Answer"}
                              </Button>
                              <Button variant="outline" onClick={() => setShowAnswerInput(false)} data-testid={`${p}button-cancel-answer-forwarded`}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button onClick={() => setShowAnswerInput(true)} data-testid={`${p}button-answer-forwarded-rfi`}>
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Answer
                          </Button>
                        )}
                      </>
                    )}
                    {rfi.status === "ANSWERED" && (
                      <>
                        <Button
                          onClick={() => mutations.closeMutation.mutate(rfi.id)}
                          disabled={mutations.closeMutation.isPending}
                          data-testid={`${p}button-close-rfi`}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Close
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowLinkCODialog(true)}
                          data-testid={`${p}button-link-co`}
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          Link Change Order
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowLinkTMDialog(true)}
                          data-testid={`${p}button-link-tm`}
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          Link T&amp;M
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowLinkSubmittalDialog(true)}
                          data-testid={`${p}button-link-submittal`}
                        >
                          <FileCheck className="h-4 w-4 mr-2" />
                          Link Submittal
                        </Button>
                      </>
                    )}
                    {rfi.status === "CLOSED" && (
                      <Button
                        variant="outline"
                        onClick={() => mutations.reopenMutation.mutate(rfi.id)}
                        disabled={mutations.reopenMutation.isPending}
                        data-testid={`${p}button-reopen-rfi`}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reopen
                      </Button>
                    )}
                  </div>

                  <div className="border-t pt-4 space-y-4">
                    <h3 className="font-medium flex items-center gap-2" data-testid={`${p}text-activity-header`}>
                      <MessageSquare className="h-4 w-4" />
                      Activity Log
                    </h3>
                    {activityLog.length === 0 ? (
                      <p className="text-sm text-muted-foreground" data-testid={`${p}text-no-activity`}>No activity yet</p>
                    ) : (
                      <div className="space-y-3">
                        {activityLog.map((entry) => (
                          <div key={entry.id} className="flex gap-3" data-testid={`${p}activity-entry-${entry.id}`}>
                            <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium" data-testid={`${p}text-activity-user-${entry.id}`}>
                                  {entry.userName}
                                </span>
                                <span className="text-xs text-muted-foreground" data-testid={`${p}text-activity-date-${entry.id}`}>
                                  {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                                </span>
                              </div>
                              <p className="text-sm" data-testid={`${p}text-activity-action-${entry.id}`}>
                                {entry.comment || entry.action}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a comment..."
                        rows={2}
                        className="flex-1"
                        data-testid={`${p}input-comment`}
                      />
                      <Button
                        onClick={() => {
                          mutations.addCommentMutation.mutate({ id: rfi.id, comment: commentText });
                          setCommentText("");
                        }}
                        disabled={!commentText.trim() || mutations.addCommentMutation.isPending}
                        data-testid={`${p}button-add-comment`}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showForwardDialog} onOpenChange={(o) => { setShowForwardDialog(o); if (!o) setForwardToUserId(""); }}>
        <DialogContent data-testid={`${p}dialog-forward-rfi`}>
          <DialogHeader>
            <DialogTitle>Forward to Design Team</DialogTitle>
            <DialogDescription>Select a team member to forward this RFI to for an official response.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={forwardToUserId} onValueChange={setForwardToUserId}>
              <SelectTrigger data-testid={`${p}select-forward-user`}>
                <SelectValue placeholder="Select a user..." />
              </SelectTrigger>
              <SelectContent>
                {orgUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForwardDialog(false); setForwardToUserId(""); }} data-testid={`${p}button-cancel-forward`}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (rfi && forwardToUserId) {
                  mutations.forwardMutation.mutate({ id: rfi.id, forwardedToId: forwardToUserId });
                  setShowForwardDialog(false);
                  setForwardToUserId("");
                }
              }}
              disabled={!forwardToUserId || mutations.forwardMutation.isPending}
              data-testid={`${p}button-confirm-forward`}
            >
              {mutations.forwardMutation.isPending ? "Forwarding..." : "Forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkCODialog} onOpenChange={setShowLinkCODialog}>
        <DialogContent data-testid={`${p}dialog-link-co`}>
          <DialogHeader>
            <DialogTitle>Link Change Order</DialogTitle>
            <DialogDescription>Select a change order to link to this RFI</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedCOId} onValueChange={setSelectedCOId}>
              <SelectTrigger data-testid={`${p}select-link-co`}>
                <SelectValue placeholder="Select a change order..." />
              </SelectTrigger>
              <SelectContent>
                {changeOrders.map((co) => (
                  <SelectItem key={co.id} value={co.id}>
                    {co.changeOrderNumber} - {co.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkCODialog(false)} data-testid={`${p}button-cancel-link-co`}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (rfi) {
                  mutations.linkCOMutation.mutate({ id: rfi.id, changeOrderId: selectedCOId });
                  setShowLinkCODialog(false);
                  setSelectedCOId("");
                }
              }}
              disabled={!selectedCOId || mutations.linkCOMutation.isPending}
              data-testid={`${p}button-confirm-link-co`}
            >
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkTMDialog} onOpenChange={(o) => { setShowLinkTMDialog(o); if (!o) setSelectedTMId(""); }}>
        <DialogContent data-testid={`${p}dialog-link-tm`}>
          <DialogHeader>
            <DialogTitle>Link T&amp;M Ticket</DialogTitle>
            <DialogDescription>Select a T&amp;M ticket to link to this RFI</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {tmTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No T&amp;M tickets found for this project.</p>
            ) : (
              <Select value={selectedTMId} onValueChange={setSelectedTMId}>
                <SelectTrigger data-testid={`${p}select-link-tm`}>
                  <SelectValue placeholder="Select a T&amp;M ticket..." />
                </SelectTrigger>
                <SelectContent>
                  {tmTickets.map((tm) => (
                    <SelectItem key={tm.id} value={tm.id}>
                      {tm.ticketNumber}
                      {tm.workDate ? ` — ${format(new Date(tm.workDate), "MMM d, yyyy")}` : ""}
                      {tm.description ? ` — ${tm.description.slice(0, 40)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowLinkTMDialog(false); setSelectedTMId(""); }}
              data-testid={`${p}button-cancel-link-tm`}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (rfi && selectedTMId) {
                  mutations.linkTMMutation.mutate({ id: rfi.id, tmTicketId: selectedTMId });
                  setShowLinkTMDialog(false);
                  setSelectedTMId("");
                }
              }}
              disabled={!selectedTMId || mutations.linkTMMutation.isPending}
              data-testid={`${p}button-confirm-link-tm`}
            >
              {mutations.linkTMMutation.isPending ? "Linking..." : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkSubmittalDialog} onOpenChange={(o) => { setShowLinkSubmittalDialog(o); if (!o) setSelectedSubmittalId(""); }}>
        <DialogContent data-testid={`${p}dialog-link-submittal`}>
          <DialogHeader>
            <DialogTitle>Link Submittal</DialogTitle>
            <DialogDescription>Select a submittal to link to this RFI</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {submittals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submittals found for this project.</p>
            ) : (
              <Select value={selectedSubmittalId} onValueChange={setSelectedSubmittalId}>
                <SelectTrigger data-testid={`${p}select-link-submittal`}>
                  <SelectValue placeholder="Select a submittal..." />
                </SelectTrigger>
                <SelectContent>
                  {submittals.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.submittalNumber} — {s.subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowLinkSubmittalDialog(false); setSelectedSubmittalId(""); }}
              data-testid={`${p}button-cancel-link-submittal`}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (rfi && selectedSubmittalId) {
                  mutations.linkSubmittalMutation.mutate({ id: rfi.id, submittalId: selectedSubmittalId });
                  setShowLinkSubmittalDialog(false);
                  setSelectedSubmittalId("");
                }
              }}
              disabled={!selectedSubmittalId || mutations.linkSubmittalMutation.isPending}
              data-testid={`${p}button-confirm-link-submittal`}
            >
              {mutations.linkSubmittalMutation.isPending ? "Linking..." : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

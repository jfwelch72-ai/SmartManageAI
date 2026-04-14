import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { FilePenLine, CheckCircle, RotateCcw, Clock, Send, MessageSquare, DollarSign, AlertTriangle, Paperclip, Download } from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface CostBreakdown {
  labor: number;
  material: number;
  equipment: number;
  subcontractor: number;
  total: number;
}

interface COAttachment {
  id: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  storageKey: string;
}

interface ChangeOrderItem {
  id: string;
  changeOrderNumber: string;
  description: string;
  amount: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string | null;
  clientResponseDueDate: string | null;
  costBreakdown: CostBreakdown | null;
  attachments?: COAttachment[];
}

interface COComment {
  id: string;
  authorName: string;
  authorType: string;
  message: string;
  createdAt: string;
}

interface PortalChangeOrdersTabProps {
  changeOrders: ChangeOrderItem[] | undefined;
  projectId?: string;
  email?: string;
  onRefresh?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING_APPROVAL: { label: "Pending Approval", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  SUBMITTED:        { label: "Awaiting Response", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  APPROVED:         { label: "Approved",          className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  REJECTED:         { label: "Rejected",          className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

function fmtCurrency(amount: string | number): string {
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (isNaN(num)) return String(amount);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function fmtDate(dateStr: string | null, includeTime = false): string {
  if (!dateStr) return "—";
  try { return format(new Date(dateStr), includeTime ? "MMM d, yyyy h:mm a" : "MMM d, yyyy"); } catch { return "—"; }
}

function ResponseDueCountdown({ dueDate }: { dueDate: string }) {
  const due = new Date(dueDate);
  const overdue = isPast(due);
  const distance = formatDistanceToNow(due, { addSuffix: true });

  return (
    <div className={`flex items-center gap-1.5 text-sm ${overdue ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
      {overdue ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      <span>{overdue ? `Overdue ${distance}` : `Due ${distance}`}</span>
    </div>
  );
}

export function PortalChangeOrdersTab({ changeOrders, projectId, email, onRefresh }: PortalChangeOrdersTabProps) {
  const [selectedCO, setSelectedCO] = useState<ChangeOrderItem | null>(null);
  const [comments, setComments] = useState<COComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const { toast } = useToast();

  const clientHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-email": email || "",
    "x-client-project-id": projectId || "",
  };

  const fetchComments = async (coId: string) => {
    if (!projectId || !email) return;
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/ai-features/client-portal/public/change-orders/${coId}/comments`, {
        headers: clientHeaders,
      });
      if (res.ok) {
        setComments(await res.json());
      }
    } catch {
    } finally {
      setLoadingComments(false);
    }
  };

  useEffect(() => {
    if (selectedCO) {
      fetchComments(selectedCO.id);
      setShowRevisionInput(false);
      setRevisionReason("");
      setNewComment("");
    }
  }, [selectedCO?.id]);

  const handlePostComment = async () => {
    if (!selectedCO || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch(`/api/ai-features/client-portal/public/change-orders/${selectedCO.id}/comments`, {
        method: "POST",
        headers: clientHeaders,
        body: JSON.stringify({ message: newComment.trim() }),
      });
      if (res.ok) {
        const comment = await res.json();
        setComments(prev => [...prev, comment]);
        setNewComment("");
      }
    } catch {
      toast({ title: "Error", description: "Failed to post comment", variant: "destructive" });
    } finally {
      setPostingComment(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!selectedCO) return;
    setActionPending(true);
    try {
      const res = await fetch(`/api/ai-features/client-portal/public/change-orders/${selectedCO.id}/acknowledge`, {
        method: "POST",
        headers: clientHeaders,
      });
      if (res.ok) {
        toast({ title: "Change Order Acknowledged", description: `CO ${selectedCO.changeOrderNumber} has been approved.` });
        setSelectedCO({ ...selectedCO, status: "APPROVED", approvedAt: new Date().toISOString() });
        fetchComments(selectedCO.id);
        onRefresh?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to acknowledge", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to acknowledge change order", variant: "destructive" });
    } finally {
      setActionPending(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!selectedCO || !revisionReason.trim()) return;
    setActionPending(true);
    try {
      const res = await fetch(`/api/ai-features/client-portal/public/change-orders/${selectedCO.id}/request-revision`, {
        method: "POST",
        headers: clientHeaders,
        body: JSON.stringify({ reason: revisionReason.trim() }),
      });
      if (res.ok) {
        toast({ title: "Revision Requested", description: `Revision request sent for CO ${selectedCO.changeOrderNumber}.` });
        setSelectedCO(null);
        onRefresh?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to request revision", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to request revision", variant: "destructive" });
    } finally {
      setActionPending(false);
    }
  };

  const approvedTotal = (changeOrders || [])
    .filter(co => co.status === "APPROVED")
    .reduce((sum, co) => sum + (parseFloat(co.amount) || 0), 0);

  const pendingTotal = (changeOrders || [])
    .filter(co => co.status === "SUBMITTED" || co.status === "PENDING_APPROVAL")
    .reduce((sum, co) => sum + (parseFloat(co.amount) || 0), 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Change Orders</CardTitle>
          <CardDescription>Review and respond to change orders for this project</CardDescription>
        </CardHeader>
        <CardContent>
          {changeOrders && changeOrders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border p-3" data-testid="portal-co-summary-total">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total COs</p>
                <p className="text-lg font-bold">{changeOrders.length}</p>
              </div>
              <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 p-3" data-testid="portal-co-summary-approved">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Approved</p>
                <p className="text-lg font-bold text-green-700 dark:text-green-400">{fmtCurrency(approvedTotal)}</p>
              </div>
              {pendingTotal > 0 && (
                <div className="rounded-lg border bg-blue-50 dark:bg-blue-900/20 p-3" data-testid="portal-co-summary-pending">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{fmtCurrency(pendingTotal)}</p>
                </div>
              )}
            </div>
          )}

          {changeOrders && changeOrders.length > 0 ? (
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CO #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Response Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changeOrders.map((co) => {
                    const statusCfg = STATUS_CONFIG[co.status] || { label: co.status, className: "bg-gray-100 text-gray-700" };
                    return (
                      <TableRow
                        key={co.id}
                        data-testid={`row-co-${co.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedCO(co)}
                      >
                        <TableCell className="font-medium whitespace-nowrap">{co.changeOrderNumber}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="truncate text-sm">{co.description}</p>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {fmtCurrency(co.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusCfg.className} variant="outline">
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDate(co.submittedAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {co.clientResponseDueDate ? fmtDate(co.clientResponseDueDate) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="text-center py-8">
              <FilePenLine className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No change orders available yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedCO} onOpenChange={(open) => { if (!open) setSelectedCO(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-portal-co-detail">
          {selectedCO && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>Change Order {selectedCO.changeOrderNumber}</span>
                  <Badge className={STATUS_CONFIG[selectedCO.status]?.className || "bg-gray-100 text-gray-700"} variant="outline">
                    {STATUS_CONFIG[selectedCO.status]?.label || selectedCO.status}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {selectedCO.status === "SUBMITTED" && selectedCO.clientResponseDueDate && (
                  <div className="rounded-lg border p-3 bg-muted/30">
                    <ResponseDueCountdown dueDate={selectedCO.clientResponseDueDate} />
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-co-description">{selectedCO.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Total Amount</h4>
                    <p className="text-lg font-bold" data-testid="text-co-amount">{fmtCurrency(selectedCO.amount)}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Submitted</h4>
                    <p className="text-sm">{fmtDate(selectedCO.submittedAt)}</p>
                  </div>
                </div>

                {selectedCO.costBreakdown && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Cost Breakdown</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm" data-testid="co-cost-breakdown">
                      {selectedCO.costBreakdown.labor > 0 && (
                        <div className="flex justify-between px-3 py-1.5 rounded bg-muted/30">
                          <span>Labor</span>
                          <span className="font-medium">{fmtCurrency(selectedCO.costBreakdown.labor)}</span>
                        </div>
                      )}
                      {selectedCO.costBreakdown.material > 0 && (
                        <div className="flex justify-between px-3 py-1.5 rounded bg-muted/30">
                          <span>Material</span>
                          <span className="font-medium">{fmtCurrency(selectedCO.costBreakdown.material)}</span>
                        </div>
                      )}
                      {selectedCO.costBreakdown.equipment > 0 && (
                        <div className="flex justify-between px-3 py-1.5 rounded bg-muted/30">
                          <span>Equipment</span>
                          <span className="font-medium">{fmtCurrency(selectedCO.costBreakdown.equipment)}</span>
                        </div>
                      )}
                      {selectedCO.costBreakdown.subcontractor > 0 && (
                        <div className="flex justify-between px-3 py-1.5 rounded bg-muted/30">
                          <span>Subcontractor</span>
                          <span className="font-medium">{fmtCurrency(selectedCO.costBreakdown.subcontractor)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {selectedCO.attachments && selectedCO.attachments.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Paperclip className="w-4 h-4 text-muted-foreground" />
                      <h4 className="text-sm font-medium">Attachments</h4>
                    </div>
                    <div className="space-y-1.5" data-testid="co-attachments-list">
                      {selectedCO.attachments.map((att) => (
                        <button
                          key={att.id}
                          onClick={async () => {
                            try {
                              const resp = await fetch(
                                `/api/ai-features/client-portal/public/change-orders/${selectedCO.id}/attachments/${att.id}/download`,
                                { headers: clientHeaders }
                              );
                              if (!resp.ok) throw new Error("Download failed");
                              const blob = await resp.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = att.fileName;
                              a.click();
                              URL.revokeObjectURL(url);
                            } catch {
                              toast({ title: "Download failed", description: "Could not download attachment", variant: "destructive" });
                            }
                          }}
                          className="flex items-center gap-2 px-3 py-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors text-sm w-full text-left"
                          data-testid={`attachment-${att.id}`}
                        >
                          <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{att.fileName}</span>
                          {att.fileSize && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {att.fileSize > 1048576
                                ? `${(att.fileSize / 1048576).toFixed(1)} MB`
                                : `${Math.round(att.fileSize / 1024)} KB`}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium">Comments</h4>
                  </div>

                  {loadingComments ? (
                    <p className="text-sm text-muted-foreground py-2">Loading comments...</p>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No comments yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto mb-3" data-testid="co-comments-list">
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-lg p-2.5 text-sm ${
                            c.authorType === "CLIENT"
                              ? "bg-blue-50 dark:bg-blue-900/20 ml-4"
                              : "bg-muted/50 mr-4"
                          }`}
                          data-testid={`comment-${c.id}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-xs">{c.authorName}</span>
                            <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt, true)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{c.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {projectId && email && (
                    <div className="flex gap-2">
                      <Textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="min-h-[60px]"
                        data-testid="input-co-comment"
                      />
                      <Button
                        size="sm"
                        onClick={handlePostComment}
                        disabled={postingComment || !newComment.trim()}
                        className="self-end"
                        data-testid="button-post-comment"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {selectedCO.status === "SUBMITTED" && projectId && email && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Your Response</h4>

                      {!showRevisionInput ? (
                        <div className="flex gap-2">
                          <Button
                            onClick={handleAcknowledge}
                            disabled={actionPending}
                            className="flex-1"
                            data-testid="button-acknowledge-co"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {actionPending ? "Processing..." : "Acknowledge & Approve"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setShowRevisionInput(true)}
                            disabled={actionPending}
                            className="flex-1"
                            data-testid="button-request-revision-toggle"
                          >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Request Revision
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Textarea
                            value={revisionReason}
                            onChange={(e) => setRevisionReason(e.target.value)}
                            placeholder="Describe what changes are needed..."
                            className="min-h-[80px]"
                            data-testid="input-revision-reason"
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={handleRequestRevision}
                              disabled={actionPending || !revisionReason.trim()}
                              variant="destructive"
                              className="flex-1"
                              data-testid="button-submit-revision"
                            >
                              {actionPending ? "Submitting..." : "Submit Revision Request"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => { setShowRevisionInput(false); setRevisionReason(""); }}
                              data-testid="button-cancel-revision"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

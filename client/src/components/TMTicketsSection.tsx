import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useTMTickets, useSubmitTMTicket, useApproveTMTicket, useRejectTMTicket, useDeleteTMTicket, type TMTicket } from "@/hooks/use-data";
import { Plus, ChevronDown, ChevronRight, FileText, CheckCircle, XCircle, Send, Lock } from "lucide-react";
import { format } from "date-fns";
import TMTicketDialog from "@/components/tm/TMTicketDialog";
import TMTicketDetail from "@/components/tm/TMTicketDetail";

function TMStatusBadge({ status }: { status: TMTicket["status"] }) {
  const variants: Record<TMTicket["status"], { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    DRAFT: { variant: "secondary", label: "Draft" },
    SUBMITTED: { variant: "outline", label: "Pending Review" },
    APPROVED: { variant: "default", label: "Approved" },
    REJECTED: { variant: "destructive", label: "Rejected" },
  };
  const { variant, label } = variants[status];
  return <Badge variant={variant} data-testid={`badge-status-${status.toLowerCase()}`}>{label}</Badge>;
}

const formatCurrency = (value: string | number) => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
};

interface TMTicketsSectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

export default function TMTicketsSection({ projectId, projectCode, userRole }: TMTicketsSectionProps) {
  const { toast } = useToast();
  const { data: tickets = [], isLoading } = useTMTickets(projectId);
  const submitMutation = useSubmitTMTicket();
  const approveMutation = useApproveTMTicket();
  const rejectMutation = useRejectTMTicket();
  const deleteMutation = useDeleteTMTicket();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [ticketToReject, setTicketToReject] = useState<string | null>(null);

  const canCreate = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole);
  const canApprove = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole);

  const toggleTicketExpanded = (id: string) => {
    const newSet = new Set(expandedTickets);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedTickets(newSet);
  };

  const handleSubmit = async (ticketId: string) => {
    try {
      await submitMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket submitted for approval" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit ticket", variant: "destructive" });
    }
  };

  const handleApprove = async (ticketId: string) => {
    try {
      await approveMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve ticket", variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!ticketToReject || !rejectionReason.trim()) {
      toast({ title: "Error", description: "Rejection reason is required", variant: "destructive" });
      return;
    }
    try {
      await rejectMutation.mutateAsync({ ticketId: ticketToReject, projectId, reason: rejectionReason });
      toast({ title: "Success", description: "T&M ticket rejected" });
      setShowRejectDialog(false);
      setRejectionReason("");
      setTicketToReject(null);
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject ticket", variant: "destructive" });
    }
  };

  const handleDelete = async (ticketId: string) => {
    try {
      await deleteMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete ticket", variant: "destructive" });
    }
  };

  const handleViewPDF = (ticketId: string) => {
    window.open(`/api/tm-tickets/${ticketId}/pdf`, "_blank");
  };

  const openRejectDialog = (ticketId: string) => {
    setTicketToReject(ticketId);
    setShowRejectDialog(true);
  };

  const sortedTickets = [...tickets].sort((a, b) => {
    const statusOrder = { SUBMITTED: 0, DRAFT: 1, APPROVED: 2, REJECTED: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pendingCount = tickets.filter(t => t.status === "SUBMITTED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">T&M Work Tickets</h3>
          {pendingCount > 0 && (
            <Badge variant="secondary" data-testid="badge-pending-count">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => setShowCreateDialog(true)} data-testid="button-new-tm-ticket">
            <Plus className="w-4 h-4 mr-2" />
            New T&M Ticket
          </Button>
        )}
      </div>

      <TMTicketDialog
        projectId={projectId}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      {isLoading ? (
        <div className="text-center py-4 text-muted-foreground">Loading T&M tickets...</div>
      ) : sortedTickets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No T&M work tickets yet</p>
          {canCreate && <p className="text-sm">Click "New T&M Ticket" to create one</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedTickets.map((ticket) => (
            <Collapsible
              key={ticket.id}
              open={expandedTickets.has(ticket.id)}
              onOpenChange={() => toggleTicketExpanded(ticket.id)}
            >
              <Card data-testid={`tm-ticket-card-${ticket.id}`}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate">
                    <div className="flex items-center gap-4">
                      {expandedTickets.has(ticket.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid={`text-ticket-number-${ticket.id}`}>{ticket.ticketNumber}</span>
                          <TMStatusBadge status={ticket.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(ticket.workDate), "MMM d, yyyy")} - {ticket.scopeDescription.substring(0, 50)}
                          {ticket.scopeDescription.length > 50 && "..."}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-medium" data-testid={`text-ticket-total-${ticket.id}`}>{formatCurrency(ticket.grandTotal)}</p>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>L: {formatCurrency(ticket.totalLaborCost)}</span>
                        <span>E: {formatCurrency(ticket.totalEquipmentCost)}</span>
                        <span>M: {formatCurrency(ticket.totalMaterialCost)}</span>
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>

                <div className="flex items-center gap-2 px-4 pb-3">
                  {(ticket.billingStatus === "INVOICED" || ticket.billingStatus === "BILLED") && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300" data-testid={`badge-locked-${ticket.id}`}>
                      <Lock className="w-3 h-3 mr-1" />
                      Locked — {ticket.billingStatus === "BILLED" ? "Billed" : "Invoiced"}
                    </Badge>
                  )}
                  {ticket.billingStatus !== "INVOICED" && ticket.billingStatus !== "BILLED" && ticket.status === "DRAFT" && canCreate && (
                    <Button variant="default" size="sm" onClick={(e) => { e.stopPropagation(); handleSubmit(ticket.id); }} disabled={submitMutation.isPending} data-testid={`button-quick-submit-${ticket.id}`}>
                      <Send className="w-4 h-4 mr-2" /> Submit for Approval
                    </Button>
                  )}
                  {ticket.billingStatus !== "INVOICED" && ticket.billingStatus !== "BILLED" && ticket.status === "SUBMITTED" && canApprove && (
                    <>
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(ticket.id); }} disabled={approveMutation.isPending} data-testid={`button-quick-approve-${ticket.id}`}>
                        <CheckCircle className="w-4 h-4 mr-2" /> Approve
                      </Button>
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openRejectDialog(ticket.id); }} data-testid={`button-quick-reject-${ticket.id}`}>
                        <XCircle className="w-4 h-4 mr-2" /> Reject
                      </Button>
                    </>
                  )}
                </div>

                <CollapsibleContent>
                  <TMTicketDetail
                    ticket={ticket}
                    canCreate={canCreate}
                    canApprove={canApprove}
                    onSubmit={handleSubmit}
                    onApprove={handleApprove}
                    onReject={openRejectDialog}
                    onDelete={handleDelete}
                    onViewPDF={handleViewPDF}
                    submitPending={submitMutation.isPending}
                    approvePending={approveMutation.isPending}
                  />
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent data-testid="dialog-reject-tm-ticket">
          <DialogHeader>
            <DialogTitle>Reject T&M Ticket</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="rejection-reason">Rejection Reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this ticket is being rejected..."
              data-testid="input-rejection-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectMutation.isPending || !rejectionReason.trim()} data-testid="button-confirm-reject">
              Reject Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Send, Check, X, Loader2, CloudRain } from "lucide-react";
import type { Project } from "@shared/schema";
import type { ClaimWithRelations } from "./types";
import { getStatusBadge, getClaimTypeBadge, formatCurrency } from "./DelayClaimTable";

export function CreateClaimDialog({
  open,
  onOpenChange,
  projects,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  onSubmit: (data: { projectId: string; title: string; description: string; claimType: "TIME_EXTENSION" | "COST_IMPACT" | "BOTH"; daysRequested: string; costRequested: string }) => void;
  isPending: boolean;
}) {
  const [newClaim, setNewClaim] = useState({
    projectId: "",
    title: "",
    description: "",
    claimType: "TIME_EXTENSION" as "TIME_EXTENSION" | "COST_IMPACT" | "BOTH",
    daysRequested: "",
    costRequested: "",
  });

  const handleSubmit = () => {
    onSubmit(newClaim);
    setNewClaim({ projectId: "", title: "", description: "", claimType: "TIME_EXTENSION", daysRequested: "", costRequested: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Delay Claim</DialogTitle>
          <DialogDescription>Submit a claim for time extension or cost impact due to project delays</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={newClaim.projectId} onValueChange={(v) => setNewClaim({ ...newClaim, projectId: v })}>
              <SelectTrigger data-testid="select-new-claim-project"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Claim Title</Label>
            <Input placeholder="Brief description of the claim" value={newClaim.title} onChange={(e) => setNewClaim({ ...newClaim, title: e.target.value })} data-testid="input-new-claim-title" />
          </div>
          <div className="space-y-2">
            <Label>Claim Type</Label>
            <Select value={newClaim.claimType} onValueChange={(v: "TIME_EXTENSION" | "COST_IMPACT" | "BOTH") => setNewClaim({ ...newClaim, claimType: v })}>
              <SelectTrigger data-testid="select-new-claim-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TIME_EXTENSION">Time Extension Only</SelectItem>
                <SelectItem value="COST_IMPACT">Cost Impact Only</SelectItem>
                <SelectItem value="BOTH">Time Extension + Cost Impact</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(newClaim.claimType === "TIME_EXTENSION" || newClaim.claimType === "BOTH") && (
            <div className="space-y-2">
              <Label>Days Requested</Label>
              <Input type="number" placeholder="Number of days" value={newClaim.daysRequested} onChange={(e) => setNewClaim({ ...newClaim, daysRequested: e.target.value })} data-testid="input-new-claim-days" />
            </div>
          )}
          {(newClaim.claimType === "COST_IMPACT" || newClaim.claimType === "BOTH") && (
            <div className="space-y-2">
              <Label>Cost Requested ($)</Label>
              <Input type="number" placeholder="Amount in dollars" value={newClaim.costRequested} onChange={(e) => setNewClaim({ ...newClaim, costRequested: e.target.value })} data-testid="input-new-claim-cost" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea placeholder="Detailed description of the delay and its impact..." value={newClaim.description} onChange={(e) => setNewClaim({ ...newClaim, description: e.target.value })} rows={4} data-testid="input-new-claim-description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!newClaim.projectId || !newClaim.title || isPending} data-testid="button-submit-new-claim">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClaimDetailDialog({
  claim,
  open,
  onOpenChange,
  canManage,
  onSubmit,
  onReview,
  onApprove,
  onReject,
  submitPending,
  reviewPending,
  approvePending,
}: {
  claim: ClaimWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onSubmit: (id: string) => void;
  onReview: (id: string, notes: string) => void;
  onApprove: (id: string, days?: number, cost?: string) => void;
  onReject: (id: string) => void;
  submitPending: boolean;
  reviewPending: boolean;
  approvePending: boolean;
}) {
  if (!claim) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{claim.claimNumber}</span>
            {getStatusBadge(claim.status)}
          </DialogTitle>
          <DialogDescription>{claim.project?.code} - {claim.project?.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">{claim.title}</h3>
            <p className="text-muted-foreground text-sm">{claim.description || "No description provided"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-muted-foreground">Claim Type</Label><div className="mt-1">{getClaimTypeBadge(claim.claimType)}</div></div>
            <div><Label className="text-muted-foreground">Created By</Label><div className="mt-1 text-sm">{claim.createdBy ? `${claim.createdBy.firstName} ${claim.createdBy.lastName}` : "-"}</div></div>
          </div>
          {(claim.claimType === "TIME_EXTENSION" || claim.claimType === "BOTH") && (
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground">Days Requested</Label><div className="text-lg font-semibold">{claim.daysRequested || "-"}</div></div>
              <div><Label className="text-muted-foreground">Days Approved</Label><div className="text-lg font-semibold text-green-600">{claim.daysApproved || "-"}</div></div>
            </div>
          )}
          {(claim.claimType === "COST_IMPACT" || claim.claimType === "BOTH") && (
            <div className="grid grid-cols-2 gap-4">
              <div><Label className="text-muted-foreground">Cost Requested</Label><div className="text-lg font-semibold">{formatCurrency(claim.costRequested)}</div></div>
              <div><Label className="text-muted-foreground">Cost Approved</Label><div className="text-lg font-semibold text-green-600">{formatCurrency(claim.costApproved)}</div></div>
            </div>
          )}
          {claim.weatherEvidenceSummary && (
            <div><Label className="text-muted-foreground flex items-center gap-1"><CloudRain className="w-4 h-4" />Weather Evidence</Label><p className="mt-1 text-sm bg-muted p-3 rounded-md">{claim.weatherEvidenceSummary}</p></div>
          )}
          {claim.reviewNotes && (
            <div><Label className="text-muted-foreground">Review Notes</Label><p className="mt-1 text-sm bg-muted p-3 rounded-md">{claim.reviewNotes}</p></div>
          )}
          {claim.rejectionReason && (
            <div><Label className="text-muted-foreground text-destructive">Rejection Reason</Label><p className="mt-1 text-sm bg-destructive/10 text-destructive p-3 rounded-md">{claim.rejectionReason}</p></div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {claim.status === "DRAFT" && canManage && (
            <Button onClick={() => onSubmit(claim.id)} disabled={submitPending} data-testid="button-submit-claim">
              {submitPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Send className="w-4 h-4 mr-2" />Submit for Review
            </Button>
          )}
          {claim.status === "SUBMITTED" && canManage && (
            <Button onClick={() => { const notes = prompt("Enter review notes (optional):"); onReview(claim.id, notes || ""); }} disabled={reviewPending} data-testid="button-start-review">
              {reviewPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Eye className="w-4 h-4 mr-2" />Start Review
            </Button>
          )}
          {claim.status === "UNDER_REVIEW" && canManage && (
            <>
              <Button variant="outline" onClick={() => onReject(claim.id)} data-testid="button-reject-claim"><X className="w-4 h-4 mr-2" />Reject</Button>
              <Button onClick={() => onApprove(claim.id, claim.daysRequested || undefined, claim.costRequested || undefined)} disabled={approvePending} data-testid="button-approve-claim">
                {approvePending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Check className="w-4 h-4 mr-2" />Approve
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Claim</DialogTitle>
          <DialogDescription>Please provide a reason for rejecting this delay claim.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Rejection Reason</Label>
            <Textarea placeholder="Enter the reason for rejection..." value={reason} onChange={(e) => setReason(e.target.value)} rows={4} data-testid="input-rejection-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { onConfirm(reason); setReason(""); }} disabled={!reason || isPending} data-testid="button-confirm-reject">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Reject Claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

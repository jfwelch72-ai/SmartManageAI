import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Inbox, Eye, Clock, CheckCircle, XCircle, Send, FileText, Calendar as CalendarIcon, DollarSign, Building2, MessageSquare, ArrowLeft, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Button as UIButton } from "@/components/ui/button";

interface BidInvitation {
  id: string;
  bidRequestId: string;
  status: "PENDING" | "VIEWED" | "DECLINED" | "RESPONDED" | "WITHDRAWN";
  personalMessage?: string;
  viewedAt?: string;
  respondedAt?: string;
  createdAt: string;
  request: {
    id: string;
    title: string;
    description?: string;
    scopeOfWork: string;
    requiredTrades: string[];
    bidDueDate: string;
    projectStartDate?: string;
    projectAddress?: string;
    projectCity?: string;
    projectState?: string;
    budgetRangeMin?: number;
    budgetRangeMax?: number;
    requiresBonding: boolean;
    requiresInsurance: boolean;
    specialRequirements?: string;
    status: string;
  };
  gcOrganization: {
    id: string;
    name: string;
    logoUrl?: string;
  };
  myResponse?: {
    id: string;
    totalBidAmount: number;
    status: string;
    submittedAt?: string;
  };
  clarifications?: Array<{
    id: string;
    question: string;
    answer?: string;
    questionAskedAt: string;
    answeredAt?: string;
    isPublicToAllInvitees: boolean;
  }>;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: JSX.Element }> = {
    PENDING: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200", icon: <Clock className="w-3 h-3" /> },
    VIEWED: { color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <Eye className="w-3 h-3" /> },
    DECLINED: { color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <XCircle className="w-3 h-3" /> },
    RESPONDED: { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <CheckCircle className="w-3 h-3" /> },
    WITHDRAWN: { color: "bg-muted text-muted-foreground", icon: <XCircle className="w-3 h-3" /> },
  };
  const v = variants[status] || variants.PENDING;
  return (
    <Badge className={`${v.color} gap-1`}>
      {v.icon}
      {status}
    </Badge>
  );
}

function InvitationCard({ invitation, onRefresh }: { invitation: BidInvitation; onRefresh: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  
  const daysUntilDue = Math.ceil((new Date(invitation.request.bidDueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysUntilDue < 0;
  const isDueSoon = daysUntilDue <= 3 && daysUntilDue >= 0;
  
  const declineMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/bid-network/inbox/${invitation.id}/decline`, { reason: declineReason });
    },
    onSuccess: () => {
      toast({ title: "Invitation declined" });
      setDeclineOpen(false);
      onRefresh();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to decline invitation", variant: "destructive" });
    },
  });

  return (
    <Card className="hover-elevate" data-testid={`card-invitation-${invitation.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground truncate">{invitation.gcOrganization.name}</span>
            </div>
            <CardTitle className="text-lg truncate">{invitation.request.title}</CardTitle>
          </div>
          <StatusBadge status={invitation.status} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {invitation.request.description || invitation.request.scopeOfWork}
        </p>
        
        <div className="flex flex-wrap gap-1 mb-3">
          {invitation.request.requiredTrades.slice(0, 3).map(trade => (
            <Badge key={trade} variant="secondary" className="text-xs">
              {trade.replace(/_/g, " ")}
            </Badge>
          ))}
          {invitation.request.requiredTrades.length > 3 && (
            <Badge variant="secondary" className="text-xs">+{invitation.request.requiredTrades.length - 3}</Badge>
          )}
        </div>
        
        <div className="flex items-center justify-between text-sm mb-3">
          <div className={`flex items-center gap-1 ${isOverdue ? "text-destructive" : isDueSoon ? "text-amber-600" : "text-muted-foreground"}`}>
            <CalendarIcon className="w-3 h-3" />
            <span>
              {isOverdue ? "Overdue" : isDueSoon ? `Due in ${daysUntilDue} days` : `Due: ${format(new Date(invitation.request.bidDueDate), "MMM d, yyyy")}`}
            </span>
          </div>
          
          {invitation.request.budgetRangeMin && invitation.request.budgetRangeMax && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              <span>${(invitation.request.budgetRangeMin / 1000).toFixed(0)}K - ${(invitation.request.budgetRangeMax / 1000).toFixed(0)}K</span>
            </div>
          )}
        </div>
        
        {invitation.myResponse && (
          <div className="bg-muted/50 rounded-md p-2 mb-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your Response:</span>
              <Badge variant={invitation.myResponse.status === "SUBMITTED" ? "default" : "secondary"}>
                ${invitation.myResponse.totalBidAmount.toLocaleString()} - {invitation.myResponse.status}
              </Badge>
            </div>
          </div>
        )}
        
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={() => navigate(`/bid-inbox/${invitation.id}`)}
            data-testid={`button-view-${invitation.id}`}
          >
            <Eye className="w-3 h-3 mr-1" />
            View Details
          </Button>
          
          {invitation.status !== "DECLINED" && invitation.status !== "RESPONDED" && (
            <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid={`button-decline-${invitation.id}`}>
                  <XCircle className="w-3 h-3 mr-1" />
                  Decline
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Decline Invitation</DialogTitle>
                  <DialogDescription>
                    Let the GC know why you're declining this bid request.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reason">Reason (optional)</Label>
                    <Textarea
                      id="reason"
                      placeholder="e.g., Not enough capacity, outside service area..."
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      data-testid="input-decline-reason"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    onClick={() => declineMutation.mutate()}
                    disabled={declineMutation.isPending}
                    data-testid="button-confirm-decline"
                  >
                    {declineMutation.isPending ? "Declining..." : "Decline Invitation"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SubmitResponseDialog({ invitation, onSuccess }: { invitation: BidInvitation; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    totalBidAmount: invitation.myResponse?.totalBidAmount?.toString() || "",
    laborCost: "",
    materialCost: "",
    equipmentCost: "",
    proposalNotes: "",
    scopeInclusions: "",
    scopeExclusions: "",
    assumptions: "",
    proposedStartDate: "",
    proposedDuration: "",
    quoteValidUntil: "",
  });
  
  const submitMutation = useMutation({
    mutationFn: async (isDraft: boolean) => {
      const payload = {
        invitationId: invitation.id,
        totalBidAmount: parseFloat(formData.totalBidAmount),
        laborCost: formData.laborCost ? parseFloat(formData.laborCost) : null,
        materialCost: formData.materialCost ? parseFloat(formData.materialCost) : null,
        equipmentCost: formData.equipmentCost ? parseFloat(formData.equipmentCost) : null,
        proposalNotes: formData.proposalNotes || null,
        scopeInclusions: formData.scopeInclusions || null,
        scopeExclusions: formData.scopeExclusions || null,
        assumptions: formData.assumptions || null,
        proposedStartDate: formData.proposedStartDate || null,
        proposedDuration: formData.proposedDuration ? parseInt(formData.proposedDuration) : null,
        quoteValidUntil: formData.quoteValidUntil || null,
        status: isDraft ? "DRAFT" : "SUBMITTED",
      };
      const res = await apiRequest("POST", "/api/bid-network/responses", payload);
      return res.json();
    },
    onSuccess: (_, isDraft) => {
      toast({
        title: isDraft ? "Draft saved" : "Response submitted",
        description: isDraft ? "Your draft has been saved." : "Your bid response has been submitted to the GC."
      });
      setOpen(false);
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit response", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-submit-response">
          <Send className="w-4 h-4 mr-2" />
          {invitation.myResponse ? "Update Response" : "Submit Response"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit Bid Response</DialogTitle>
          <DialogDescription>
            Provide your quote and proposal details for "{invitation.request.title}"
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="totalBid">Total Bid Amount ($) *</Label>
            <Input
              id="totalBid"
              type="number"
              placeholder="0.00"
              value={formData.totalBidAmount}
              onChange={(e) => setFormData({ ...formData, totalBidAmount: e.target.value })}
              data-testid="input-total-bid"
            />
          </div>
          
          <Separator />
          
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="labor">Labor Cost ($)</Label>
              <Input
                id="labor"
                type="number"
                placeholder="0.00"
                value={formData.laborCost}
                onChange={(e) => setFormData({ ...formData, laborCost: e.target.value })}
                data-testid="input-labor-cost"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="material">Material Cost ($)</Label>
              <Input
                id="material"
                type="number"
                placeholder="0.00"
                value={formData.materialCost}
                onChange={(e) => setFormData({ ...formData, materialCost: e.target.value })}
                data-testid="input-material-cost"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="equipment">Equipment Cost ($)</Label>
              <Input
                id="equipment"
                type="number"
                placeholder="0.00"
                value={formData.equipmentCost}
                onChange={(e) => setFormData({ ...formData, equipmentCost: e.target.value })}
                data-testid="input-equipment-cost"
              />
            </div>
          </div>
          
          <Separator />
          
          <div className="grid gap-2">
            <Label htmlFor="notes">Proposal Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional details about your proposal..."
              value={formData.proposalNotes}
              onChange={(e) => setFormData({ ...formData, proposalNotes: e.target.value })}
              data-testid="input-proposal-notes"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inclusions">Scope Inclusions</Label>
              <Textarea
                id="inclusions"
                placeholder="What's included in your bid..."
                value={formData.scopeInclusions}
                onChange={(e) => setFormData({ ...formData, scopeInclusions: e.target.value })}
                data-testid="input-inclusions"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exclusions">Scope Exclusions</Label>
              <Textarea
                id="exclusions"
                placeholder="What's NOT included..."
                value={formData.scopeExclusions}
                onChange={(e) => setFormData({ ...formData, scopeExclusions: e.target.value })}
                data-testid="input-exclusions"
              />
            </div>
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="assumptions">Assumptions</Label>
            <Textarea
              id="assumptions"
              placeholder="Key assumptions your bid is based on..."
              value={formData.assumptions}
              onChange={(e) => setFormData({ ...formData, assumptions: e.target.value })}
              data-testid="input-assumptions"
            />
          </div>
          
          <Separator />
          
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startDate">Proposed Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.proposedStartDate && "text-muted-foreground"
                    )}
                    data-testid="input-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.proposedStartDate ? format(parseISO(formData.proposedStartDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={formData.proposedStartDate ? parseISO(formData.proposedStartDate) : undefined}
                    onSelect={(date) => setFormData({ ...formData, proposedStartDate: date ? format(date, "yyyy-MM-dd") : "" })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (days)</Label>
              <Input
                id="duration"
                type="number"
                placeholder="0"
                value={formData.proposedDuration}
                onChange={(e) => setFormData({ ...formData, proposedDuration: e.target.value })}
                data-testid="input-duration"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="validUntil">Quote Valid Until</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.quoteValidUntil && "text-muted-foreground"
                    )}
                    data-testid="input-valid-until"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.quoteValidUntil ? format(parseISO(formData.quoteValidUntil), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={formData.quoteValidUntil ? parseISO(formData.quoteValidUntil) : undefined}
                    onSelect={(date) => setFormData({ ...formData, quoteValidUntil: date ? format(date, "yyyy-MM-dd") : "" })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="secondary"
            onClick={() => submitMutation.mutate(true)}
            disabled={!formData.totalBidAmount || submitMutation.isPending}
            data-testid="button-save-draft-response"
          >
            Save Draft
          </Button>
          <Button
            onClick={() => submitMutation.mutate(false)}
            disabled={!formData.totalBidAmount || submitMutation.isPending}
            data-testid="button-submit-final"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Response"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvitationDetailView({ invitationId }: { invitationId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [askQuestion, setAskQuestion] = useState(false);
  const [question, setQuestion] = useState("");
  
  const { data: invitation, isLoading, refetch } = useQuery<BidInvitation>({
    queryKey: ["/api/bid-network/inbox", invitationId],
  });
  
  const askMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bid-network/clarifications", {
        bidRequestId: invitation?.bidRequestId,
        question,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Question submitted", description: "The GC will be notified." });
      setAskQuestion(false);
      setQuestion("");
      refetch();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit question", variant: "destructive" });
    },
  });
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card className="animate-pulse">
          <CardHeader>
            <div className="h-8 bg-muted rounded w-1/2" />
          </CardHeader>
          <CardContent>
            <div className="h-40 bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!invitation) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h3 className="text-lg font-medium mb-2">Invitation not found</h3>
            <Button onClick={() => navigate("/bid-inbox")} data-testid="button-back-to-inbox">
              Back to Inbox
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const daysUntilDue = Math.ceil((new Date(invitation.request.bidDueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysUntilDue < 0;
  const canRespond = !isOverdue && invitation.status !== "DECLINED" && invitation.request.status === "OPEN";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/bid-inbox")} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="text-invitation-title">{invitation.request.title}</h1>
          <p className="text-muted-foreground">From {invitation.gcOrganization.name}</p>
        </div>
        <StatusBadge status={invitation.status} />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Scope of Work</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap" data-testid="text-scope">{invitation.request.scopeOfWork}</p>
              
              {invitation.request.description && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="font-medium mb-2">Additional Description</h4>
                  <p className="text-muted-foreground">{invitation.request.description}</p>
                </div>
              )}
              
              {invitation.request.specialRequirements && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="font-medium mb-2">Special Requirements</h4>
                  <p className="text-muted-foreground">{invitation.request.specialRequirements}</p>
                </div>
              )}
            </CardContent>
          </Card>
          
          {invitation.personalMessage && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Personal Message
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground italic">"{invitation.personalMessage}"</p>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Clarifications</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setAskQuestion(true)} data-testid="button-ask-question">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Ask Question
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {askQuestion && (
                <div className="mb-4 p-4 border rounded-lg">
                  <Label htmlFor="question">Your Question</Label>
                  <Textarea
                    id="question"
                    placeholder="Ask the GC a question about this bid request..."
                    className="mt-2"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    data-testid="input-question"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button variant="outline" size="sm" onClick={() => setAskQuestion(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      onClick={() => askMutation.mutate()}
                      disabled={!question.trim() || askMutation.isPending}
                      data-testid="button-send-question"
                    >
                      {askMutation.isPending ? "Sending..." : "Send Question"}
                    </Button>
                  </div>
                </div>
              )}
              
              {invitation.clarifications && invitation.clarifications.length > 0 ? (
                <div className="space-y-4">
                  {invitation.clarifications.map(c => (
                    <div key={c.id} className="border-l-2 border-primary pl-4">
                      <p className="font-medium">{c.question}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Asked {format(new Date(c.questionAskedAt), "MMM d, yyyy")}
                      </p>
                      {c.answer ? (
                        <div className="mt-2 bg-muted/50 rounded p-2">
                          <p className="text-sm">{c.answer}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Answered {c.answeredAt && format(new Date(c.answeredAt), "MMM d, yyyy")}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 italic">Awaiting response...</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">No clarifications yet</p>
              )}
            </CardContent>
          </Card>
        </div>
        
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Required Trades</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {invitation.request.requiredTrades.map(trade => (
                    <Badge key={trade} variant="secondary" className="text-xs">
                      {trade.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <Separator />
              
              <div>
                <Label className="text-muted-foreground">Bid Due Date</Label>
                <p className={`font-medium ${isOverdue ? "text-destructive" : ""}`}>
                  {format(new Date(invitation.request.bidDueDate), "MMMM d, yyyy 'at' h:mm a")}
                </p>
                {isOverdue && <p className="text-xs text-destructive">This bid request has expired</p>}
              </div>
              
              {invitation.request.projectStartDate && (
                <div>
                  <Label className="text-muted-foreground">Project Start</Label>
                  <p className="font-medium">{format(new Date(invitation.request.projectStartDate), "MMMM d, yyyy")}</p>
                </div>
              )}
              
              {(invitation.request.projectAddress || invitation.request.projectCity) && (
                <div>
                  <Label className="text-muted-foreground">Location</Label>
                  <p className="font-medium">
                    {[invitation.request.projectAddress, invitation.request.projectCity, invitation.request.projectState]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              )}
              
              <Separator />
              
              {invitation.request.budgetRangeMin && invitation.request.budgetRangeMax && (
                <div>
                  <Label className="text-muted-foreground">Budget Range</Label>
                  <p className="font-medium text-lg">
                    ${invitation.request.budgetRangeMin.toLocaleString()} - ${invitation.request.budgetRangeMax.toLocaleString()}
                  </p>
                </div>
              )}
              
              <div className="flex gap-2">
                {invitation.request.requiresBonding && (
                  <Badge variant="outline">Bonding Required</Badge>
                )}
                {invitation.request.requiresInsurance && (
                  <Badge variant="outline">Insurance Required</Badge>
                )}
              </div>
            </CardContent>
          </Card>
          
          {invitation.myResponse && (
            <Card>
              <CardHeader>
                <CardTitle>Your Response</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Bid:</span>
                    <span className="font-bold text-lg">${invitation.myResponse.totalBidAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge>{invitation.myResponse.status}</Badge>
                  </div>
                  {invitation.myResponse.submittedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Submitted:</span>
                      <span>{format(new Date(invitation.myResponse.submittedAt), "MMM d, yyyy")}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          
          <div className="space-y-2">
            {canRespond && (
              <SubmitResponseDialog invitation={invitation} onSuccess={() => refetch()} />
            )}
            
            {isOverdue && (
              <p className="text-center text-sm text-muted-foreground">
                This bid request has expired and is no longer accepting responses.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BidInboxPage() {
  const params = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  if (params.id) {
    return <InvitationDetailView invitationId={params.id} />;
  }
  
  const inboxUrl = statusFilter !== "all"
    ? `/api/bid-network/inbox?status=${statusFilter}`
    : "/api/bid-network/inbox";
  
  const { data: invitations = [], isLoading, refetch } = useQuery<BidInvitation[]>({
    queryKey: [inboxUrl],
  });
  
  const pendingCount = invitations.filter(i => i.status === "PENDING" || i.status === "VIEWED").length;
  const respondedCount = invitations.filter(i => i.status === "RESPONDED").length;
  const declinedCount = invitations.filter(i => i.status === "DECLINED").length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Bid Inbox</h1>
          <p className="text-muted-foreground">View and respond to bid invitations from GCs</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("PENDING")} data-testid="card-stat-pending">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("RESPONDED")} data-testid="card-stat-responded">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{respondedCount}</p>
                <p className="text-sm text-muted-foreground">Responded</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover-elevate" onClick={() => setStatusFilter("DECLINED")} data-testid="card-stat-declined">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{declinedCount}</p>
                <p className="text-sm text-muted-foreground">Declined</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        {isMobile ? (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-bid-inbox-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({invitations.length})</SelectItem>
              <SelectItem value="PENDING">Pending ({pendingCount})</SelectItem>
              <SelectItem value="RESPONDED">Responded ({respondedCount})</SelectItem>
              <SelectItem value="DECLINED">Declined ({declinedCount})</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">All ({invitations.length})</TabsTrigger>
            <TabsTrigger value="PENDING" data-testid="tab-pending">Pending ({pendingCount})</TabsTrigger>
            <TabsTrigger value="RESPONDED" data-testid="tab-responded">Responded ({respondedCount})</TabsTrigger>
            <TabsTrigger value="DECLINED" data-testid="tab-declined">Declined ({declinedCount})</TabsTrigger>
          </TabsList>
        )}
      </Tabs>
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : invitations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No bid invitations</h3>
            <p className="text-muted-foreground text-center">
              When General Contractors invite you to bid on projects, they'll appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {invitations.map(invitation => (
            <InvitationCard key={invitation.id} invitation={invitation} onRefresh={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}

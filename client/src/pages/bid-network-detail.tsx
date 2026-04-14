import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  Send,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  FileText,
  Calendar,
  DollarSign,
  Building2,
  MessageSquare,
  AlertCircle,
  Star,
  Trophy,
} from "lucide-react";
import { format } from "date-fns";

interface MatchingSub {
  id: string;
  name: string;
  tradeType: string;
  tradeSpecialties: string[];
  logoUrl?: string;
  companyDescription?: string;
  serviceAreas: string[];
  certifications: string[];
}

interface Invitation {
  id: string;
  invitedOrganizationId: string;
  externalCompanyName?: string;
  externalContactEmail?: string;
  status: string;
  viewedAt?: string;
  respondedAt?: string;
  createdAt: string;
  organization?: {
    id: string;
    name: string;
    logoUrl?: string;
  };
}

interface Response {
  id: string;
  totalBidAmount: number;
  laborCost?: number;
  materialCost?: number;
  equipmentCost?: number;
  proposalNotes?: string;
  scopeInclusions?: string;
  scopeExclusions?: string;
  assumptions?: string;
  proposedStartDate?: string;
  proposedDuration?: number;
  quoteValidUntil?: string;
  status: string;
  submittedAt?: string;
  gcInternalRating?: number;
  gcInternalNotes?: string;
  organization: {
    id: string;
    name: string;
    logoUrl?: string;
  };
}

interface BidRequest {
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
  showBudgetToSubs: boolean;
  requiresBonding: boolean;
  requiresInsurance: boolean;
  specialRequirements?: string;
  status: string;
  internalNotes?: string;
  viewCount: number;
  inviteCount: number;
  responseCount: number;
  createdAt: string;
  invitations: Invitation[];
  responses: Response[];
}

interface Clarification {
  id: string;
  question: string;
  answer?: string;
  questionAskedAt: string;
  answeredAt?: string;
  isPublicToAllInvitees: boolean;
  askedByOrganizationId?: string;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    OPEN: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    CLOSED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    AWARDED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    PENDING:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    VIEWED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    DECLINED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    RESPONDED:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    SUBMITTED:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    UNDER_REVIEW:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    SHORTLISTED:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
    NOT_SELECTED: "bg-muted text-muted-foreground",
  };
  return <Badge className={variants[status] || variants.DRAFT}>{status}</Badge>;
}

function SendInvitationsDialog({
  requestId,
  requiredTrades,
  onSuccess,
}: {
  requestId: string;
  requiredTrades: string[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const [personalMessage, setPersonalMessage] = useState("");

  const matchSubsUrl = `/api/bid-network/match-subs?trades=${requiredTrades.join(",")}`;
  const { data: matchingSubs = [], isLoading } = useQuery<MatchingSub[]>({
    queryKey: [matchSubsUrl],
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const invitees = selectedSubs.map((id) => ({ organizationId: id }));
      const res = await apiRequest(
        "POST",
        "/api/bid-network/invitations/send",
        {
          bidRequestId: requestId,
          invitees,
          personalMessage: personalMessage || undefined,
        },
      );
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Invitations sent",
        description: `${data.created?.length || 0} invitations sent successfully.`,
      });
      setOpen(false);
      setSelectedSubs([]);
      setPersonalMessage("");
      onSuccess();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send invitations",
        variant: "destructive",
      });
    },
  });

  const toggleSub = (id: string) => {
    setSelectedSubs((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-send-invitations">
          <Send className="w-4 h-4 mr-2" />
          Send Invitations
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite Subcontractors</DialogTitle>
          <DialogDescription>
            Select subcontractors matching your required trades to invite to
            this bid request.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Personal Message (optional)</Label>
            <Textarea
              placeholder="Add a personal message to include with the invitation..."
              value={personalMessage}
              onChange={(e) => setPersonalMessage(e.target.value)}
              data-testid="input-personal-message"
            />
          </div>

          <Separator />

          <Label>Matching Subcontractors</Label>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : matchingSubs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No matching subcontractors found</p>
              <p className="text-sm">
                No platform members match your required trades or have enabled
                receiving invites.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {matchingSubs.map((sub) => (
                <div
                  key={sub.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedSubs.includes(sub.id)
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => toggleSub(sub.id)}
                  data-testid={`sub-option-${sub.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {sub.logoUrl ? (
                        <img
                          src={sub.logoUrl}
                          alt={sub.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <Building2 className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{sub.name}</p>
                      <div className="flex gap-1 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {sub.tradeType.replace(/_/g, " ")}
                        </Badge>
                        {sub.certifications?.slice(0, 2).map((cert) => (
                          <Badge
                            key={cert}
                            variant="outline"
                            className="text-xs"
                          >
                            {cert}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {selectedSubs.includes(sub.id) && (
                      <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={selectedSubs.length === 0 || sendMutation.isPending}
            data-testid="button-confirm-send"
          >
            {sendMutation.isPending
              ? "Sending..."
              : `Send to ${selectedSubs.length} Subcontractors`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResponseDetailDialog({ response }: { response: Response }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(response.gcInternalRating || 0);
  const [notes, setNotes] = useState(response.gcInternalNotes || "");

  const updateMutation = useMutation({
    mutationFn: async (data: {
      status?: string;
      gcInternalRating?: number;
      gcInternalNotes?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/bid-network/responses/${response.id}/review`,
        data,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Response updated" });
      queryClient.invalidateQueries({
        queryKey: ["/api/bid-network/requests"],
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update response",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`button-view-response-${response.id}`}
        >
          <Eye className="w-3 h-3 mr-1" />
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {response.organization.name}
          </DialogTitle>
          <DialogDescription>
            Bid response details and internal notes
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-3xl font-bold">
                    ${response.totalBidAmount.toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total Bid Amount
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <StatusBadge status={response.status} />
                  <p className="text-sm text-muted-foreground mt-1">
                    {response.submittedAt &&
                      `Submitted ${format(new Date(response.submittedAt), "MMM d")}`}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {(response.laborCost ||
            response.materialCost ||
            response.equipmentCost) && (
            <div className="grid grid-cols-3 gap-4">
              {response.laborCost && (
                <div className="text-center p-2 bg-muted/50 rounded">
                  <p className="font-medium">
                    ${response.laborCost.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Labor</p>
                </div>
              )}
              {response.materialCost && (
                <div className="text-center p-2 bg-muted/50 rounded">
                  <p className="font-medium">
                    ${response.materialCost.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Material</p>
                </div>
              )}
              {response.equipmentCost && (
                <div className="text-center p-2 bg-muted/50 rounded">
                  <p className="font-medium">
                    ${response.equipmentCost.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Equipment</p>
                </div>
              )}
            </div>
          )}

          <Separator />

          {response.proposalNotes && (
            <div>
              <Label className="text-muted-foreground">Proposal Notes</Label>
              <p className="mt-1">{response.proposalNotes}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {response.scopeInclusions && (
              <div>
                <Label className="text-muted-foreground">Inclusions</Label>
                <p className="mt-1 text-sm">{response.scopeInclusions}</p>
              </div>
            )}
            {response.scopeExclusions && (
              <div>
                <Label className="text-muted-foreground">Exclusions</Label>
                <p className="mt-1 text-sm">{response.scopeExclusions}</p>
              </div>
            )}
          </div>

          {response.assumptions && (
            <div>
              <Label className="text-muted-foreground">Assumptions</Label>
              <p className="mt-1 text-sm">{response.assumptions}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-sm">
            {response.proposedStartDate && (
              <div>
                <Label className="text-muted-foreground">Start Date</Label>
                <p>
                  {format(new Date(response.proposedStartDate), "MMM d, yyyy")}
                </p>
              </div>
            )}
            {response.proposedDuration && (
              <div>
                <Label className="text-muted-foreground">Duration</Label>
                <p>{response.proposedDuration} days</p>
              </div>
            )}
            {response.quoteValidUntil && (
              <div>
                <Label className="text-muted-foreground">Valid Until</Label>
                <p>
                  {format(new Date(response.quoteValidUntil), "MMM d, yyyy")}
                </p>
              </div>
            )}
          </div>

          <Separator />

          <div>
            <Label>Internal Rating</Label>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <Button
                  key={star}
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setRating(star);
                    updateMutation.mutate({ gcInternalRating: star });
                  }}
                  data-testid={`star-${star}`}
                >
                  <Star
                    className={`w-5 h-5 ${star <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                  />
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label>Internal Notes</Label>
            <Textarea
              placeholder="Add private notes about this response..."
              className="mt-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== response.gcInternalNotes) {
                  updateMutation.mutate({ gcInternalNotes: notes });
                }
              }}
              data-testid="input-internal-notes"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {response.status === "SUBMITTED" && (
            <>
              <Button
                variant="outline"
                onClick={() => updateMutation.mutate({ status: "SHORTLISTED" })}
                disabled={updateMutation.isPending}
                data-testid="button-shortlist"
              >
                <Star className="w-4 h-4 mr-2" />
                Shortlist
              </Button>
              <Button
                onClick={() => updateMutation.mutate({ status: "AWARDED" })}
                disabled={updateMutation.isPending}
                data-testid="button-award"
              >
                <Trophy className="w-4 h-4 mr-2" />
                Award
              </Button>
            </>
          )}
          {response.status === "SHORTLISTED" && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  updateMutation.mutate({ status: "NOT_SELECTED" })
                }
                disabled={updateMutation.isPending}
                data-testid="button-not-select"
              >
                Not Selected
              </Button>
              <Button
                onClick={() => updateMutation.mutate({ status: "AWARDED" })}
                disabled={updateMutation.isPending}
                data-testid="button-award"
              >
                <Trophy className="w-4 h-4 mr-2" />
                Award
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BidNetworkDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const {
    data: request,
    isLoading,
    refetch,
  } = useQuery<BidRequest>({
    queryKey: ["/api/bid-network/requests", params.id],
    enabled: !!params.id,
  });

  const { data: clarifications = [] } = useQuery<Clarification[]>({
    queryKey: ["/api/bid-network/clarifications", params.id],
    enabled: !!params.id,
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PATCH",
        `/api/bid-network/requests/${params.id}`,
        { status: "OPEN" },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid request published" });
      refetch();
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PATCH",
        `/api/bid-network/requests/${params.id}`,
        { status: "CLOSED" },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid request closed" });
      refetch();
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({
      clarificationId,
      answer,
      isPublic,
    }: {
      clarificationId: string;
      answer: string;
      isPublic: boolean;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/bid-network/clarifications/${clarificationId}/answer`,
        { answer, isPublicToAllInvitees: isPublic },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Answer submitted" });
      queryClient.invalidateQueries({
        queryKey: ["/api/bid-network/clarifications"],
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container max-w-full p-6">
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

  if (!request) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-12 h-12 text-destructive mb-4" />
            <h3 className="text-lg font-medium mb-2">Bid request not found</h3>
            <Button
              onClick={() => navigate("/bid-network")}
              data-testid="button-back-to-list"
            >
              Back to Bid Network
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/bid-network")}
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="text-request-title">
            {request.title}
          </h1>
          <p className="text-muted-foreground">
            Created {format(new Date(request.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{request.viewCount}</p>
                <p className="text-sm text-muted-foreground">Views</p>
              </div>
              <Eye className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{request.inviteCount}</p>
                <p className="text-sm text-muted-foreground">Invited</p>
              </div>
              <Users className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{request.responseCount}</p>
                <p className="text-sm text-muted-foreground">Responses</p>
              </div>
              <FileText className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {format(new Date(request.bidDueDate), "MMM d")}
                </p>
                <p className="text-sm text-muted-foreground">Due Date</p>
              </div>
              <Calendar className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        {request.status === "DRAFT" && (
          <Button
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            data-testid="button-publish"
          >
            <Send className="w-4 h-4 mr-2" />
            Publish
          </Button>
        )}
        {request.status === "OPEN" && (
          <>
            <SendInvitationsDialog
              requestId={request.id}
              requiredTrades={request.requiredTrades}
              onSuccess={() => refetch()}
            />
            <Button
              variant="outline"
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              data-testid="button-close"
            >
              Close Bidding
            </Button>
          </>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="invitations" data-testid="tab-invitations">
            Invitations ({request.invitations.length})
          </TabsTrigger>
          <TabsTrigger value="responses" data-testid="tab-responses">
            Responses ({request.responses.length})
          </TabsTrigger>
          <TabsTrigger value="clarifications" data-testid="tab-clarifications">
            Q&A ({clarifications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Scope of Work</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{request.scopeOfWork}</p>
                  {request.description && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="font-medium mb-2">Description</h4>
                      <p className="text-muted-foreground">
                        {request.description}
                      </p>
                    </div>
                  )}
                  {request.specialRequirements && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="font-medium mb-2">Special Requirements</h4>
                      <p className="text-muted-foreground">
                        {request.specialRequirements}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {request.internalNotes && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Internal Notes
                    </CardTitle>
                    <CardDescription>
                      Only visible to your organization
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      {request.internalNotes}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-muted-foreground">
                      Required Trades
                    </Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {request.requiredTrades.map((trade) => (
                        <Badge key={trade} variant="secondary">
                          {trade.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-muted-foreground">Due Date</Label>
                    <p className="font-medium">
                      {format(
                        new Date(request.bidDueDate),
                        "MMMM d, yyyy 'at' h:mm a",
                      )}
                    </p>
                  </div>

                  {request.projectStartDate && (
                    <div>
                      <Label className="text-muted-foreground">
                        Project Start
                      </Label>
                      <p className="font-medium">
                        {format(
                          new Date(request.projectStartDate),
                          "MMMM d, yyyy",
                        )}
                      </p>
                    </div>
                  )}

                  {(request.projectAddress || request.projectCity) && (
                    <div>
                      <Label className="text-muted-foreground">Location</Label>
                      <p className="font-medium">
                        {[
                          request.projectAddress,
                          request.projectCity,
                          request.projectState,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                  )}

                  {request.budgetRangeMin && request.budgetRangeMax && (
                    <>
                      <Separator />
                      <div>
                        <Label className="text-muted-foreground">
                          Budget Range
                        </Label>
                        <p className="font-medium text-lg">
                          ${request.budgetRangeMin.toLocaleString()} - $
                          {request.budgetRangeMax.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {request.showBudgetToSubs
                            ? "Visible to subs"
                            : "Hidden from subs"}
                        </p>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="flex gap-2 flex-wrap">
                    {request.requiresBonding && (
                      <Badge variant="outline">Bonding Required</Badge>
                    )}
                    {request.requiresInsurance && (
                      <Badge variant="outline">Insurance Required</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Invitations Sent</CardTitle>
                {request.status === "OPEN" && (
                  <SendInvitationsDialog
                    requestId={request.id}
                    requiredTrades={request.requiredTrades}
                    onSuccess={() => refetch()}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {request.invitations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No invitations sent yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subcontractor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Viewed</TableHead>
                      <TableHead>Responded</TableHead>
                      <TableHead>Invited</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {request.invitations.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            {inv.organization?.name ||
                              inv.externalCompanyName ||
                              inv.externalContactEmail ||
                              "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inv.status} />
                        </TableCell>
                        <TableCell>
                          {inv.viewedAt
                            ? format(new Date(inv.viewedAt), "MMM d")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {inv.respondedAt
                            ? format(new Date(inv.respondedAt), "MMM d")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {format(new Date(inv.createdAt), "MMM d")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="responses">
          <Card>
            <CardHeader>
              <CardTitle>Bid Responses</CardTitle>
            </CardHeader>
            <CardContent>
              {request.responses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No responses received yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subcontractor</TableHead>
                      <TableHead className="text-right">Bid Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {request.responses
                      .sort((a, b) => a.totalBidAmount - b.totalBidAmount)
                      .map((resp, idx) => (
                        <TableRow key={resp.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {idx === 0 && (
                                <Trophy className="w-4 h-4 text-amber-500" />
                              )}
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              {resp.organization.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            ${resp.totalBidAmount.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={resp.status} />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`w-3 h-3 ${star <= (resp.gcInternalRating || 0) ? "fill-amber-400 text-amber-400" : "text-muted"}`}
                                />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {resp.submittedAt
                              ? format(new Date(resp.submittedAt), "MMM d")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <ResponseDetailDialog response={resp} />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clarifications">
          <Card>
            <CardHeader>
              <CardTitle>Questions & Answers</CardTitle>
            </CardHeader>
            <CardContent>
              {clarifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No questions received yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {clarifications.map((c) => (
                    <div key={c.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{c.question}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Asked{" "}
                            {format(new Date(c.questionAskedAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        {c.isPublicToAllInvitees && (
                          <Badge variant="outline">Public</Badge>
                        )}
                      </div>

                      {c.answer ? (
                        <div className="mt-3 bg-muted/50 rounded p-3">
                          <p className="text-sm">{c.answer}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Answered{" "}
                            {c.answeredAt &&
                              format(new Date(c.answeredAt), "MMM d, yyyy")}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          <Textarea
                            placeholder="Type your answer..."
                            id={`answer-${c.id}`}
                            data-testid={`input-answer-${c.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const textarea = document.getElementById(
                                  `answer-${c.id}`,
                                ) as HTMLTextAreaElement;
                                answerMutation.mutate({
                                  clarificationId: c.id,
                                  answer: textarea.value,
                                  isPublic: false,
                                });
                              }}
                              data-testid={`button-answer-private-${c.id}`}
                            >
                              Answer Privately
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                const textarea = document.getElementById(
                                  `answer-${c.id}`,
                                ) as HTMLTextAreaElement;
                                answerMutation.mutate({
                                  clarificationId: c.id,
                                  answer: textarea.value,
                                  isPublic: true,
                                });
                              }}
                              data-testid={`button-answer-public-${c.id}`}
                            >
                              Answer to All
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

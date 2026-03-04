import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  FileText, AlertCircle, Clock, Search, Check, X, 
  Plus, Calendar, CheckCircle2, XCircle, Loader2,
  Eye, Send, DollarSign, CloudRain
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DelayClaim, Project } from "@shared/schema";

interface ClaimWithRelations extends DelayClaim {
  project?: {
    id: string;
    name: string;
    code: string;
  };
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  submittedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  reviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  approvedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export default function DelayClaimsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [selectedClaim, setSelectedClaim] = useState<ClaimWithRelations | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  // Create form state
  const [newClaim, setNewClaim] = useState({
    projectId: "",
    title: "",
    description: "",
    claimType: "TIME_EXTENSION" as "TIME_EXTENSION" | "COST_IMPACT" | "BOTH",
    daysRequested: "",
    costRequested: "",
  });

  const { data: claims = [], isLoading } = useQuery<ClaimWithRelations[]>({
    queryKey: ["/api/delay-claims"],
    enabled: !!user,
  });

  const { data: projects = [] } = useQuery<{ data: Project[]; pagination: any }, Error, Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
    select: (response) => response.data || [],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newClaim) => {
      return apiRequest("POST", "/api/delay-claims", {
        ...data,
        daysRequested: data.daysRequested ? parseInt(data.daysRequested) : undefined,
        costRequested: data.costRequested || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Delay claim created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] });
      setIsCreateOpen(false);
      setNewClaim({
        projectId: "",
        title: "",
        description: "",
        claimType: "TIME_EXTENSION",
        daysRequested: "",
        costRequested: "",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create claim", description: error.message, variant: "destructive" });
    }
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/delay-claims/${id}/submit`, {});
    },
    onSuccess: () => {
      toast({ title: "Claim submitted for review" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] });
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit claim", description: error.message, variant: "destructive" });
    }
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      return apiRequest("POST", `/api/delay-claims/${id}/review`, { reviewNotes: notes });
    },
    onSuccess: () => {
      toast({ title: "Claim marked as under review" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] });
      setIsDetailOpen(false);
      setReviewNotes("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to review claim", description: error.message, variant: "destructive" });
    }
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, daysApproved, costApproved }: { id: string; daysApproved?: number; costApproved?: string }) => {
      return apiRequest("POST", `/api/delay-claims/${id}/approve`, { daysApproved, costApproved });
    },
    onSuccess: () => {
      toast({ title: "Claim approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] });
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve claim", description: error.message, variant: "destructive" });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return apiRequest("POST", `/api/delay-claims/${id}/reject`, { rejectionReason: reason });
    },
    onSuccess: () => {
      toast({ title: "Claim rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] });
      setIsRejectOpen(false);
      setIsDetailOpen(false);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject claim", description: error.message, variant: "destructive" });
    }
  });

  const filteredClaims = useMemo(() => {
    return claims.filter(claim => {
      const matchesSearch =
        claim.claimNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        claim.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        claim.project?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        claim.project?.code?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === "ALL" || claim.status === statusFilter;
      const matchesProject = projectFilter === "ALL" || claim.projectId === projectFilter;

      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [claims, searchTerm, statusFilter, projectFilter]);

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(typeof amount === "string" ? parseFloat(amount) : amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline">Draft</Badge>;
      case "SUBMITTED":
        return <Badge variant="outline" className="text-blue-600 border-blue-600 dark:text-blue-500 dark:border-blue-500">Submitted</Badge>;
      case "UNDER_REVIEW":
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">Under Review</Badge>;
      case "APPROVED":
        return <Badge className="bg-green-500 hover:bg-green-600">Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      case "WITHDRAWN":
        return <Badge variant="secondary">Withdrawn</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getClaimTypeBadge = (type: string) => {
    switch (type) {
      case "TIME_EXTENSION":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Time</Badge>;
      case "COST_IMPACT":
        return <Badge variant="secondary"><DollarSign className="w-3 h-3 mr-1" />Cost</Badge>;
      case "BOTH":
        return <Badge variant="secondary">Time + Cost</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const canManageClaims = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Delay Claims</h1>
          <p className="text-muted-foreground">Manage time extension and cost impact claims</p>
        </div>
        {canManageClaims && (
          <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-claim">
            <Plus className="w-4 h-4 mr-2" />
            New Claim
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-draft-count">
              {claims.filter(c => c.status === "DRAFT").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Submitted</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-submitted-count">
              {claims.filter(c => c.status === "SUBMITTED").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Under Review</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-review-count">
              {claims.filter(c => c.status === "UNDER_REVIEW").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-approved-count">
              {claims.filter(c => c.status === "APPROVED").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-rejected-count">
              {claims.filter(c => c.status === "REJECTED").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filter Claims</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by claim number, title, or project..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-claims"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-project-filter">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Projects</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.code} - {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Claims Table / Mobile Cards */}
      {isMobile ? (
        <div className="space-y-3">
          {filteredClaims.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No delay claims found
              </CardContent>
            </Card>
          ) : (
            filteredClaims.map((claim) => (
              <Card
                key={claim.id}
                className="hover-elevate cursor-pointer"
                data-testid={`card-claim-${claim.id}`}
                onClick={() => {
                  setSelectedClaim(claim);
                  setIsDetailOpen(true);
                }}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium" data-testid={`text-claim-number-${claim.id}`}>
                      {claim.claimNumber}
                    </span>
                    {getStatusBadge(claim.status)}
                  </div>
                  <div className="text-sm font-medium">{claim.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {claim.project?.code || "-"} {claim.project?.name ? `- ${claim.project.name}` : ""}
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    {getClaimTypeBadge(claim.claimType)}
                    {claim.daysRequested ? (
                      <span className="text-xs text-muted-foreground">{claim.daysRequested} days</span>
                    ) : null}
                    {claim.costRequested ? (
                      <span className="text-xs text-muted-foreground">{formatCurrency(claim.costRequested)}</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {claim.createdAt ? format(new Date(claim.createdAt), "MM/dd/yyyy") : "-"}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim #</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClaims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        No delay claims found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClaims.map((claim) => (
                      <TableRow key={claim.id} data-testid={`row-claim-${claim.id}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-claim-number-${claim.id}`}>
                          {claim.claimNumber}
                        </TableCell>
                        <TableCell>
                          {claim.project?.code || "-"}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {claim.title}
                        </TableCell>
                        <TableCell>
                          {getClaimTypeBadge(claim.claimType)}
                        </TableCell>
                        <TableCell>
                          {claim.daysRequested ? `${claim.daysRequested} days` : "-"}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(claim.costRequested)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(claim.status)}
                        </TableCell>
                        <TableCell>
                          {claim.createdAt ? format(new Date(claim.createdAt), "MM/dd/yyyy") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedClaim(claim);
                              setIsDetailOpen(true);
                            }}
                            data-testid={`button-view-claim-${claim.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Claim Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Delay Claim</DialogTitle>
            <DialogDescription>
              Submit a claim for time extension or cost impact due to project delays
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={newClaim.projectId} onValueChange={(v) => setNewClaim({ ...newClaim, projectId: v })}>
                <SelectTrigger data-testid="select-new-claim-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Claim Title</Label>
              <Input
                placeholder="Brief description of the claim"
                value={newClaim.title}
                onChange={(e) => setNewClaim({ ...newClaim, title: e.target.value })}
                data-testid="input-new-claim-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Claim Type</Label>
              <Select value={newClaim.claimType} onValueChange={(v: "TIME_EXTENSION" | "COST_IMPACT" | "BOTH") => setNewClaim({ ...newClaim, claimType: v })}>
                <SelectTrigger data-testid="select-new-claim-type">
                  <SelectValue />
                </SelectTrigger>
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
                <Input
                  type="number"
                  placeholder="Number of days"
                  value={newClaim.daysRequested}
                  onChange={(e) => setNewClaim({ ...newClaim, daysRequested: e.target.value })}
                  data-testid="input-new-claim-days"
                />
              </div>
            )}
            {(newClaim.claimType === "COST_IMPACT" || newClaim.claimType === "BOTH") && (
              <div className="space-y-2">
                <Label>Cost Requested ($)</Label>
                <Input
                  type="number"
                  placeholder="Amount in dollars"
                  value={newClaim.costRequested}
                  onChange={(e) => setNewClaim({ ...newClaim, costRequested: e.target.value })}
                  data-testid="input-new-claim-cost"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Detailed description of the delay and its impact..."
                value={newClaim.description}
                onChange={(e) => setNewClaim({ ...newClaim, description: e.target.value })}
                rows={4}
                data-testid="input-new-claim-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newClaim)}
              disabled={!newClaim.projectId || !newClaim.title || createMutation.isPending}
              data-testid="button-submit-new-claim"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claim Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{selectedClaim?.claimNumber}</span>
              {selectedClaim && getStatusBadge(selectedClaim.status)}
            </DialogTitle>
            <DialogDescription>
              {selectedClaim?.project?.code} - {selectedClaim?.project?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedClaim && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">{selectedClaim.title}</h3>
                <p className="text-muted-foreground text-sm">{selectedClaim.description || "No description provided"}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Claim Type</Label>
                  <div className="mt-1">{getClaimTypeBadge(selectedClaim.claimType)}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created By</Label>
                  <div className="mt-1 text-sm">
                    {selectedClaim.createdBy ? `${selectedClaim.createdBy.firstName} ${selectedClaim.createdBy.lastName}` : "-"}
                  </div>
                </div>
              </div>

              {(selectedClaim.claimType === "TIME_EXTENSION" || selectedClaim.claimType === "BOTH") && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Days Requested</Label>
                    <div className="text-lg font-semibold">{selectedClaim.daysRequested || "-"}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Days Approved</Label>
                    <div className="text-lg font-semibold text-green-600">{selectedClaim.daysApproved || "-"}</div>
                  </div>
                </div>
              )}

              {(selectedClaim.claimType === "COST_IMPACT" || selectedClaim.claimType === "BOTH") && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Cost Requested</Label>
                    <div className="text-lg font-semibold">{formatCurrency(selectedClaim.costRequested)}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Cost Approved</Label>
                    <div className="text-lg font-semibold text-green-600">{formatCurrency(selectedClaim.costApproved)}</div>
                  </div>
                </div>
              )}

              {selectedClaim.weatherEvidenceSummary && (
                <div>
                  <Label className="text-muted-foreground flex items-center gap-1">
                    <CloudRain className="w-4 h-4" />
                    Weather Evidence
                  </Label>
                  <p className="mt-1 text-sm bg-muted p-3 rounded-md">{selectedClaim.weatherEvidenceSummary}</p>
                </div>
              )}

              {selectedClaim.reviewNotes && (
                <div>
                  <Label className="text-muted-foreground">Review Notes</Label>
                  <p className="mt-1 text-sm bg-muted p-3 rounded-md">{selectedClaim.reviewNotes}</p>
                </div>
              )}

              {selectedClaim.rejectionReason && (
                <div>
                  <Label className="text-muted-foreground text-destructive">Rejection Reason</Label>
                  <p className="mt-1 text-sm bg-destructive/10 text-destructive p-3 rounded-md">{selectedClaim.rejectionReason}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {selectedClaim?.status === "DRAFT" && canManageClaims && (
              <Button
                onClick={() => submitMutation.mutate(selectedClaim.id)}
                disabled={submitMutation.isPending}
                data-testid="button-submit-claim"
              >
                {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Send className="w-4 h-4 mr-2" />
                Submit for Review
              </Button>
            )}
            {selectedClaim?.status === "SUBMITTED" && canManageClaims && (
              <Button
                onClick={() => {
                  const notes = prompt("Enter review notes (optional):");
                  reviewMutation.mutate({ id: selectedClaim.id, notes: notes || "" });
                }}
                disabled={reviewMutation.isPending}
                data-testid="button-start-review"
              >
                {reviewMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Eye className="w-4 h-4 mr-2" />
                Start Review
              </Button>
            )}
            {selectedClaim?.status === "UNDER_REVIEW" && canManageClaims && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsRejectOpen(true)}
                  data-testid="button-reject-claim"
                >
                  <X className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={() => {
                    approveMutation.mutate({
                      id: selectedClaim.id,
                      daysApproved: selectedClaim.daysRequested || undefined,
                      costApproved: selectedClaim.costRequested || undefined,
                    });
                  }}
                  disabled={approveMutation.isPending}
                  data-testid="button-approve-claim"
                >
                  {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Check className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Claim</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this delay claim.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                placeholder="Enter the reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                data-testid="input-rejection-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedClaim && rejectMutation.mutate({ id: selectedClaim.id, reason: rejectionReason })}
              disabled={!rejectionReason || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reject Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, Search, Send, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import type { ClaimWithRelations } from "@/components/delay-claims/types";
import { DelayClaimMobileList, DelayClaimDesktopTable } from "@/components/delay-claims/DelayClaimTable";
import { CreateClaimDialog, ClaimDetailDialog, RejectDialog } from "@/components/delay-claims/DelayClaimDialogs";

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

  const { data: claims = [], isLoading } = useQuery<ClaimWithRelations[]>({ queryKey: ["/api/delay-claims"], enabled: !!user });
  const { data: projects = [] } = useQuery<{ data: Project[]; pagination: any }, Error, Project[]>({
    queryKey: ["/api/projects"], enabled: !!user, select: (response) => response.data || [],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { projectId: string; title: string; description: string; claimType: string; daysRequested: string; costRequested: string }) => {
      return apiRequest("POST", "/api/delay-claims", { ...data, daysRequested: data.daysRequested ? parseInt(data.daysRequested) : undefined, costRequested: data.costRequested || undefined });
    },
    onSuccess: () => { toast({ title: "Delay claim created successfully" }); queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] }); setIsCreateOpen(false); },
    onError: (error: Error) => { toast({ title: "Failed to create claim", description: error.message, variant: "destructive" }); }
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/delay-claims/${id}/submit`, {}),
    onSuccess: () => { toast({ title: "Claim submitted for review" }); queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] }); setIsDetailOpen(false); },
    onError: (error: Error) => { toast({ title: "Failed to submit claim", description: error.message, variant: "destructive" }); }
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => apiRequest("POST", `/api/delay-claims/${id}/review`, { reviewNotes: notes }),
    onSuccess: () => { toast({ title: "Claim marked as under review" }); queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] }); setIsDetailOpen(false); },
    onError: (error: Error) => { toast({ title: "Failed to review claim", description: error.message, variant: "destructive" }); }
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, daysApproved, costApproved }: { id: string; daysApproved?: number; costApproved?: string }) => apiRequest("POST", `/api/delay-claims/${id}/approve`, { daysApproved, costApproved }),
    onSuccess: () => { toast({ title: "Claim approved" }); queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] }); setIsDetailOpen(false); },
    onError: (error: Error) => { toast({ title: "Failed to approve claim", description: error.message, variant: "destructive" }); }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiRequest("POST", `/api/delay-claims/${id}/reject`, { rejectionReason: reason }),
    onSuccess: () => { toast({ title: "Claim rejected" }); queryClient.invalidateQueries({ queryKey: ["/api/delay-claims"] }); setIsRejectOpen(false); setIsDetailOpen(false); },
    onError: (error: Error) => { toast({ title: "Failed to reject claim", description: error.message, variant: "destructive" }); }
  });

  const filteredClaims = useMemo(() => claims.filter(claim => {
    const matchesSearch = claim.claimNumber?.toLowerCase().includes(searchTerm.toLowerCase()) || claim.title?.toLowerCase().includes(searchTerm.toLowerCase()) || claim.project?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || claim.project?.code?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && (statusFilter === "ALL" || claim.status === statusFilter) && (projectFilter === "ALL" || claim.projectId === projectFilter);
  }), [claims, searchTerm, statusFilter, projectFilter]);

  const canManageClaims = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT";
  const onSelectClaim = (c: ClaimWithRelations) => { setSelectedClaim(c); setIsDetailOpen(true); };

  if (isLoading) return <div className="p-6 flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Delay Claims</h1>
          <p className="text-muted-foreground">Manage time extension and cost impact claims</p>
        </div>
        {canManageClaims && <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-claim"><Plus className="w-4 h-4 mr-2" />New Claim</Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm font-medium">Draft</CardTitle><FileText className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-draft-count">{claims.filter(c => c.status === "DRAFT").length}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm font-medium">Submitted</CardTitle><Send className="h-4 w-4 text-blue-500" /></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-submitted-count">{claims.filter(c => c.status === "SUBMITTED").length}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm font-medium">Under Review</CardTitle><Clock className="h-4 w-4 text-yellow-500" /></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-review-count">{claims.filter(c => c.status === "UNDER_REVIEW").length}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm font-medium">Approved</CardTitle><CheckCircle2 className="h-4 w-4 text-green-500" /></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-approved-count">{claims.filter(c => c.status === "APPROVED").length}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm font-medium">Rejected</CardTitle><XCircle className="h-4 w-4 text-destructive" /></CardHeader><CardContent><div className="text-2xl font-bold" data-testid="text-rejected-count">{claims.filter(c => c.status === "REJECTED").length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Filter Claims</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by claim number, title, or project..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" data-testid="input-search-claims" />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
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
              <SelectTrigger className="w-[200px]" data-testid="select-project-filter"><SelectValue placeholder="Project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isMobile ? <DelayClaimMobileList claims={filteredClaims} onSelect={onSelectClaim} /> : <DelayClaimDesktopTable claims={filteredClaims} onSelect={onSelectClaim} />}

      <CreateClaimDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} projects={projects} onSubmit={(d) => createMutation.mutate(d)} isPending={createMutation.isPending} />
      <ClaimDetailDialog
        claim={selectedClaim} open={isDetailOpen} onOpenChange={setIsDetailOpen} canManage={!!canManageClaims}
        onSubmit={(id) => submitMutation.mutate(id)}
        onReview={(id, notes) => reviewMutation.mutate({ id, notes })}
        onApprove={(id, days, cost) => approveMutation.mutate({ id, daysApproved: days, costApproved: cost })}
        onReject={() => setIsRejectOpen(true)}
        submitPending={submitMutation.isPending} reviewPending={reviewMutation.isPending} approvePending={approveMutation.isPending}
      />
      <RejectDialog open={isRejectOpen} onOpenChange={setIsRejectOpen} onConfirm={(reason) => selectedClaim && rejectMutation.mutate({ id: selectedClaim.id, reason })} isPending={rejectMutation.isPending} />
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileCheck,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Send,
  RotateCcw,
  Trash2,
  Edit,
  Link as LinkIcon,
  MessageSquare,
  FileText
} from "lucide-react";
import { format } from "date-fns";
import DocumentAttachments from "@/components/DocumentAttachments";

interface ProjectSubmittalsProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
  name?: string;
}

interface SubmittalActivity {
  id: string;
  submittalId: string;
  action: string;
  comment: string | null;
  createdAt: string;
  userName: string | null;
}

interface Submittal {
  id: string;
  projectId: string;
  submittalNumber: string;
  subject: string;
  description: string | null;
  submittalType: string;
  phase: string;
  specSection: string | null;
  category: string | null;
  status: string;
  revision: number;
  previousRevisionId: string | null;
  subcontractorId: string | null;
  contractId: string | null;
  dateRequired: string | null;
  dateSubmitted: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewDate: string | null;
  reviewComments: string | null;
  stampAction: string | null;
  linkedRfiId: string | null;
  attachmentsJson: string | null;
  createdAt: string;
  updatedAt: string | null;
  project: { code: string; name: string };
  subcontractor?: { id: string; companyName: string; name?: string } | null;
  activity?: SubmittalActivity[];
}

interface SubmittalStats {
  total: number;
  pendingReview: number;
  approved: number;
  needsAction: number;
}

interface RFI {
  id: string;
  rfiNumber: string;
  subject: string;
}

export default function ProjectSubmittals({ projectId, projectCode, userRole }: ProjectSubmittalsProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showLinkRfiDialog, setShowLinkRfiDialog] = useState(false);
  const [selectedSubmittal, setSelectedSubmittal] = useState<Submittal | null>(null);
  const [reviewAction, setReviewAction] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [newComment, setNewComment] = useState("");
  const [selectedRfiId, setSelectedRfiId] = useState("");

  const [createForm, setCreateForm] = useState({
    subject: "",
    description: "",
    submittalType: "CONTRACTOR",
    phase: "CONSTRUCTION",
    specSection: "",
    category: "",
    subcontractorId: "",
    dateRequired: ""
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterPhase !== "all") params.set("phase", filterPhase);
    if (activeTab === "contractor") params.set("submittalType", "CONTRACTOR");
    if (activeTab === "subcontractor") params.set("submittalType", "SUBCONTRACTOR");
    return `?${params.toString()}`;
  };

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"]
  });

  const { data: stats } = useQuery<SubmittalStats>({
    queryKey: ["/api/submittals/stats", `?projectId=${projectId}`]
  });

  const { data: submittals = [], isLoading: loadingSubmittals } = useQuery<Submittal[]>({
    queryKey: ["/api/submittals", buildQueryString()]
  });

  const { data: selectedDetail } = useQuery<Submittal>({
    queryKey: ["/api/submittals", selectedSubmittal?.id],
    enabled: !!selectedSubmittal?.id && showDetailDialog
  });

  const { data: rfis = [] } = useQuery<RFI[]>({
    queryKey: ["/api/rfi", `?projectId=${projectId}`],
    enabled: showLinkRfiDialog
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const body: Record<string, unknown> = {
        projectId,
        subject: data.subject,
        submittalType: data.submittalType,
        phase: data.phase
      };
      if (data.description) body.description = data.description;
      if (data.specSection) body.specSection = data.specSection;
      if (data.category) body.category = data.category;
      if (data.subcontractorId) body.subcontractorId = data.subcontractorId;
      if (data.dateRequired) body.dateRequired = data.dateRequired;
      return await apiRequest("POST", "/api/submittals", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Submittal created successfully" });
      setShowCreateDialog(false);
      resetCreateForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create submittal", description: error.message, variant: "destructive" });
    }
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/submit`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Submittal submitted for review" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    }
  });

  const startReviewMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/review`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Review started" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to start review", description: error.message, variant: "destructive" });
    }
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action, comments }: { id: string; action: string; comments: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/${action}`, { reviewComments: comments || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Review completed" });
      setShowReviewDialog(false);
      setShowDetailDialog(false);
      setReviewComments("");
    },
    onError: (error: any) => {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
    }
  });

  const resubmitMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/resubmit`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Revision created" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to resubmit", description: error.message, variant: "destructive" });
    }
  });

  const linkRfiMutation = useMutation({
    mutationFn: async ({ id, rfiId }: { id: string; rfiId: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/link-rfi`, { rfiId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "RFI linked successfully" });
      setShowLinkRfiDialog(false);
      setSelectedRfiId("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to link RFI", description: error.message, variant: "destructive" });
    }
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/activity`, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Comment added" });
      setNewComment("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/submittals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
      toast({ title: "Submittal deleted" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    }
  });

  const resetCreateForm = () => {
    setCreateForm({
      subject: "",
      description: "",
      submittalType: "CONTRACTOR",
      phase: "CONSTRUCTION",
      specSection: "",
      category: "",
      subcontractorId: "",
      dateRequired: ""
    });
  };

  const openDetailDialog = (submittal: Submittal) => {
    setSelectedSubmittal(submittal);
    setShowDetailDialog(true);
  };

  const openReviewDialog = (action: string) => {
    setReviewAction(action);
    setReviewComments("");
    setShowReviewDialog(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary" data-testid="proj-sub-badge-status-draft">Draft</Badge>;
      case "SUBMITTED":
        return <Badge variant="default" data-testid="proj-sub-badge-status-submitted">Submitted</Badge>;
      case "UNDER_REVIEW":
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid="proj-sub-badge-status-under-review">Under Review</Badge>;
      case "APPROVED":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="proj-sub-badge-status-approved">Approved</Badge>;
      case "APPROVED_AS_NOTED":
        return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400" data-testid="proj-sub-badge-status-approved-as-noted">Approved As Noted</Badge>;
      case "REJECTED":
        return <Badge variant="destructive" data-testid="proj-sub-badge-status-rejected">Rejected</Badge>;
      case "REVISE_AND_RESUBMIT":
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" data-testid="proj-sub-badge-status-revise">Revise & Resubmit</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPhaseBadge = (phase: string) => {
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
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "CONTRACTOR":
        return <Badge variant="default">Contractor</Badge>;
      case "SUBCONTRACTOR":
        return <Badge variant="outline">Subcontractor</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const detail = selectedDetail || selectedSubmittal;

  return (
    <div className="space-y-6" data-testid="proj-sub-container">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" data-testid="proj-sub-text-section-title">Submittals</h2>
          <p className="text-sm text-muted-foreground">Manage submittals for this project</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="proj-sub-button-create-submittal">
          <Plus className="h-4 w-4 mr-2" />
          Create Submittal
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-sub-stat-total">{stats?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-sub-stat-pending-review">{stats?.pendingReview ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-sub-stat-approved">{stats?.approved ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Needs Action
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="proj-sub-stat-needs-action">{stats?.needsAction ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="proj-sub-tabs-submittal-type">
          <TabsTrigger value="all" data-testid="proj-sub-tab-all">All</TabsTrigger>
          <TabsTrigger value="contractor" data-testid="proj-sub-tab-contractor">Contractor</TabsTrigger>
          <TabsTrigger value="subcontractor" data-testid="proj-sub-tab-subcontractor">Subcontractor</TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="w-48">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="proj-sub-select-filter-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="APPROVED_AS_NOTED">Approved As Noted</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="REVISE_AND_RESUBMIT">Revise & Resubmit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select value={filterPhase} onValueChange={setFilterPhase}>
              <SelectTrigger data-testid="proj-sub-select-filter-phase">
                <SelectValue placeholder="All Phases" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Phases</SelectItem>
                <SelectItem value="ESTIMATE">Estimate</SelectItem>
                <SelectItem value="AWARDED">Awarded</SelectItem>
                <SelectItem value="CONSTRUCTION">Construction</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {["all", "contractor", "subcontractor"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {loadingSubmittals ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : submittals.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground" data-testid="proj-sub-text-empty-state">
                  No submittals found
                </CardContent>
              </Card>
            ) : (
              <>
              <div className="hidden md:block">
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SUB #</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Phase</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Rev #</TableHead>
                          <TableHead>Submitted By</TableHead>
                          <TableHead>Date Submitted</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {submittals.map(s => (
                          <TableRow key={s.id} data-testid={`proj-sub-row-submittal-${s.id}`}>
                            <TableCell className="font-medium" data-testid={`proj-sub-text-submittal-number-${s.id}`}>{s.submittalNumber}</TableCell>
                            <TableCell data-testid={`proj-sub-text-submittal-subject-${s.id}`}>{s.subject}</TableCell>
                            <TableCell>{getTypeBadge(s.submittalType)}</TableCell>
                            <TableCell>{getPhaseBadge(s.phase)}</TableCell>
                            <TableCell>{getStatusBadge(s.status)}</TableCell>
                            <TableCell data-testid={`proj-sub-text-revision-${s.id}`}>{s.revision}</TableCell>
                            <TableCell className="text-muted-foreground">{s.submittedByName || "-"}</TableCell>
                            <TableCell className="text-muted-foreground">{s.dateSubmitted ? format(new Date(s.dateSubmitted), "MMM d, yyyy") : "-"}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openDetailDialog(s)}
                                data-testid={`proj-sub-button-view-submittal-${s.id}`}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <div className="md:hidden space-y-3">
                {submittals.map(s => (
                  <div
                    key={s.id}
                    className="border rounded-md p-3 space-y-2 cursor-pointer"
                    onClick={() => openDetailDialog(s)}
                    data-testid={`proj-sub-row-submittal-mobile-${s.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm" data-testid={`proj-sub-text-submittal-number-mobile-${s.id}`}>{s.submittalNumber}</span>
                      <span className="shrink-0">{getStatusBadge(s.status)}</span>
                    </div>
                    <p className="text-sm truncate" data-testid={`proj-sub-text-submittal-subject-mobile-${s.id}`}>{s.subject}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Type</span>
                        <div>{getTypeBadge(s.submittalType)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Phase</span>
                        <div>{getPhaseBadge(s.phase)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Revision</span>
                        <div data-testid={`proj-sub-text-revision-mobile-${s.id}`}>{s.revision}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Submitted By</span>
                        <div>{s.submittedByName || "-"}</div>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground text-xs">Date Submitted</span>
                        <div>{s.dateSubmitted ? format(new Date(s.dateSubmitted), "MMM d, yyyy") : "-"}</div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={(e) => { e.stopPropagation(); openDetailDialog(s); }}
                      data-testid={`proj-sub-button-view-submittal-mobile-${s.id}`}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </div>
                ))}
              </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Submittal</DialogTitle>
            <DialogDescription>Create a new submittal for review and approval</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                placeholder="Enter submittal subject..."
                data-testid="proj-sub-input-create-subject"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Optional description..."
                rows={3}
                data-testid="proj-sub-input-create-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Submittal Type</Label>
                <Select value={createForm.submittalType} onValueChange={(v) => setCreateForm({ ...createForm, submittalType: v })}>
                  <SelectTrigger data-testid="proj-sub-select-create-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                    <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phase</Label>
                <Select value={createForm.phase} onValueChange={(v) => setCreateForm({ ...createForm, phase: v })}>
                  <SelectTrigger data-testid="proj-sub-select-create-phase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ESTIMATE">Estimate</SelectItem>
                    <SelectItem value="AWARDED">Awarded</SelectItem>
                    <SelectItem value="CONSTRUCTION">Construction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Spec Section</Label>
                <Input
                  value={createForm.specSection}
                  onChange={(e) => setCreateForm({ ...createForm, specSection: e.target.value })}
                  placeholder="e.g., 03 30 00"
                  data-testid="proj-sub-input-create-spec-section"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input
                  value={createForm.category}
                  onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                  placeholder="e.g., Materials, Shop Drawings"
                  data-testid="proj-sub-input-create-category"
                />
              </div>
            </div>
            {createForm.submittalType === "SUBCONTRACTOR" && (
              <div className="space-y-2">
                <Label>Subcontractor</Label>
                <Select value={createForm.subcontractorId} onValueChange={(v) => setCreateForm({ ...createForm, subcontractorId: v })}>
                  <SelectTrigger data-testid="proj-sub-select-create-subcontractor">
                    <SelectValue placeholder="Select a subcontractor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {subcontractors.map(sub => (
                      <SelectItem key={sub.id} value={sub.id}>{sub.companyName || sub.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Date Required</Label>
              <Input
                type="date"
                value={createForm.dateRequired}
                onChange={(e) => setCreateForm({ ...createForm, dateRequired: e.target.value })}
                data-testid="proj-sub-input-create-date-required"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="proj-sub-button-cancel-create">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.subject || createMutation.isPending}
              data-testid="proj-sub-button-submit-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Submittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid="proj-sub-text-detail-title">
              <FileCheck className="h-5 w-5" />
              {detail?.submittalNumber}
              {detail && getStatusBadge(detail.status)}
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
                  <p className="font-medium" data-testid="proj-sub-text-detail-subject">{detail.subject}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Revision</Label>
                  <p className="font-medium" data-testid="proj-sub-text-detail-revision">Rev {detail.revision}</p>
                </div>
              </div>

              {detail.description && (
                <div>
                  <Label className="text-muted-foreground text-xs">Description</Label>
                  <p data-testid="proj-sub-text-detail-description">{detail.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {detail.specSection && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Spec Section</Label>
                    <p data-testid="proj-sub-text-detail-spec-section">{detail.specSection}</p>
                  </div>
                )}
                {detail.category && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Category</Label>
                    <p data-testid="proj-sub-text-detail-category">{detail.category}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Project</Label>
                  <p data-testid="proj-sub-text-detail-project">{detail.project?.code} - {detail.project?.name}</p>
                </div>
                {detail.subcontractor && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Subcontractor</Label>
                    <p data-testid="proj-sub-text-detail-subcontractor">{detail.subcontractor.companyName || detail.subcontractor.name}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {detail.submittedByName && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Submitted By</Label>
                    <p data-testid="proj-sub-text-detail-submitted-by">{detail.submittedByName}</p>
                  </div>
                )}
                {detail.dateSubmitted && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Date Submitted</Label>
                    <p data-testid="proj-sub-text-detail-date-submitted">{format(new Date(detail.dateSubmitted), "MMM d, yyyy")}</p>
                  </div>
                )}
              </div>

              {detail.reviewerName && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Reviewer</Label>
                    <p data-testid="proj-sub-text-detail-reviewer">{detail.reviewerName}</p>
                  </div>
                  {detail.reviewDate && (
                    <div>
                      <Label className="text-muted-foreground text-xs">Review Date</Label>
                      <p data-testid="proj-sub-text-detail-review-date">{format(new Date(detail.reviewDate), "MMM d, yyyy")}</p>
                    </div>
                  )}
                </div>
              )}

              {detail.reviewComments && (
                <div>
                  <Label className="text-muted-foreground text-xs">Review Comments</Label>
                  <p className="bg-muted p-3 rounded-md text-sm" data-testid="proj-sub-text-detail-review-comments">{detail.reviewComments}</p>
                </div>
              )}

              {detail.stampAction && (
                <div>
                  <Label className="text-muted-foreground text-xs">Stamp</Label>
                  <p data-testid="proj-sub-text-detail-stamp">{detail.stampAction}</p>
                </div>
              )}

              {detail.linkedRfiId && (
                <div>
                  <Label className="text-muted-foreground text-xs">Linked RFI</Label>
                  <p data-testid="proj-sub-text-detail-linked-rfi">{detail.linkedRfiId}</p>
                </div>
              )}

              {detail.dateRequired && (
                <div>
                  <Label className="text-muted-foreground text-xs">Date Required</Label>
                  <p data-testid="proj-sub-text-detail-date-required">{format(new Date(detail.dateRequired), "MMM d, yyyy")}</p>
                </div>
              )}

              {detail.revision > 1 && detail.previousRevisionId && (
                <div>
                  <Label className="text-muted-foreground text-xs">Previous Revision</Label>
                  <p className="text-sm text-muted-foreground" data-testid="proj-sub-text-detail-previous-revision">
                    Revision {detail.revision - 1} (ID: {detail.previousRevisionId})
                  </p>
                </div>
              )}

              <DocumentAttachments
                entityType="submittals"
                entityId={detail.id}
                canUpload={["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole)}
                canDelete={["ADMIN", "MANAGER"].includes(userRole)}
                compact
              />

              <div className="flex items-center gap-2 flex-wrap border-t pt-4">
                {detail.status === "DRAFT" && (
                  <>
                    <Button
                      onClick={() => submitMutation.mutate(detail.id)}
                      disabled={submitMutation.isPending}
                      data-testid="proj-sub-button-action-submit"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Submit
                    </Button>
                    <Button variant="outline" data-testid="proj-sub-button-action-edit" onClick={() => {
                      setCreateForm({
                        subject: detail.subject,
                        description: detail.description || "",
                        submittalType: detail.submittalType,
                        phase: detail.phase,
                        specSection: detail.specSection || "",
                        category: detail.category || "",
                        subcontractorId: detail.subcontractorId || "",
                        dateRequired: detail.dateRequired || ""
                      });
                      setShowDetailDialog(false);
                      setShowCreateDialog(true);
                    }}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(detail.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="proj-sub-button-action-delete"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </>
                )}
                {detail.status === "SUBMITTED" && (
                  <Button
                    onClick={() => startReviewMutation.mutate(detail.id)}
                    disabled={startReviewMutation.isPending}
                    data-testid="proj-sub-button-action-start-review"
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
                      data-testid="proj-sub-button-action-approve"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="border-green-500 text-green-700 dark:text-green-400"
                      onClick={() => openReviewDialog("approve-as-noted")}
                      data-testid="proj-sub-button-action-approve-as-noted"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Approve As Noted
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => openReviewDialog("reject")}
                      data-testid="proj-sub-button-action-reject"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      className="border-orange-500 text-orange-700 dark:text-orange-400"
                      onClick={() => openReviewDialog("revise")}
                      data-testid="proj-sub-button-action-revise"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Revise & Resubmit
                    </Button>
                  </>
                )}
                {(detail.status === "REJECTED" || detail.status === "REVISE_AND_RESUBMIT") && (
                  <Button
                    onClick={() => resubmitMutation.mutate(detail.id)}
                    disabled={resubmitMutation.isPending}
                    data-testid="proj-sub-button-action-resubmit"
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
                    data-testid="proj-sub-button-action-link-rfi"
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
                  <div className="space-y-3" data-testid="proj-sub-activity-log">
                    {detail.activity.map((act) => (
                      <div key={act.id} className="flex items-start gap-3 text-sm" data-testid={`proj-sub-activity-item-${act.id}`}>
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
                  <p className="text-sm text-muted-foreground" data-testid="proj-sub-text-no-activity">No activity yet</p>
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
                    data-testid="proj-sub-input-add-comment"
                  />
                  <Button
                    onClick={() => {
                      if (newComment.trim() && detail.id) {
                        addCommentMutation.mutate({ id: detail.id, comment: newComment.trim() });
                      }
                    }}
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    data-testid="proj-sub-button-add-comment"
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
                data-testid="proj-sub-input-review-comments"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)} data-testid="proj-sub-button-cancel-review">Cancel</Button>
            <Button
              onClick={() => {
                if (selectedSubmittal) {
                  reviewMutation.mutate({
                    id: selectedSubmittal.id,
                    action: reviewAction,
                    comments: reviewComments
                  });
                }
              }}
              disabled={
                (reviewAction !== "approve" && !reviewComments.trim()) ||
                reviewMutation.isPending
              }
              data-testid="proj-sub-button-confirm-review"
            >
              {reviewMutation.isPending ? "Processing..." : "Confirm"}
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
                <SelectTrigger data-testid="proj-sub-select-link-rfi">
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
            <Button variant="outline" onClick={() => setShowLinkRfiDialog(false)} data-testid="proj-sub-button-cancel-link-rfi">Cancel</Button>
            <Button
              onClick={() => {
                if (selectedSubmittal && selectedRfiId) {
                  linkRfiMutation.mutate({ id: selectedSubmittal.id, rfiId: selectedRfiId });
                }
              }}
              disabled={!selectedRfiId || linkRfiMutation.isPending}
              data-testid="proj-sub-button-confirm-link-rfi"
            >
              {linkRfiMutation.isPending ? "Linking..." : "Link RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

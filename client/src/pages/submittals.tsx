import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileCheck,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { useSubmittalMutations } from "@/hooks/useSubmittalMutations";
import type { Submittal, SubmittalStats, SubmittalCreateForm, Project, Subcontractor } from "@/hooks/useSubmittalMutations";
import { SUBMITTAL_CATEGORIES, SUBMITTAL_CATEGORY_LABELS } from "@/hooks/useSubmittalMutations";
import { SubmittalDetailDialog, getStatusBadge, getPhaseBadge, getTypeBadge } from "@/components/document-control/SubmittalDetailDialog";

export default function SubmittalsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [activeCategoryTab, setActiveCategoryTab] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedSubmittal, setSelectedSubmittal] = useState<Submittal | null>(null);

  const [createForm, setCreateForm] = useState<SubmittalCreateForm>({
    projectId: "",
    subject: "",
    description: "",
    submittalType: "CONTRACTOR",
    phase: "CONSTRUCTION",
    specSection: "",
    submittalCategory: "",
    subcontractorId: "",
    dateRequired: ""
  });

  const mutations = useSubmittalMutations({
    onCreateSuccess: () => { setShowCreateDialog(false); resetCreateForm(); },
    onSubmitSuccess: () => setShowDetailDialog(false),
    onStartReviewSuccess: () => setShowDetailDialog(false),
    onReviewSuccess: () => setShowDetailDialog(false),
    onResubmitSuccess: () => setShowDetailDialog(false),
    onDeleteSuccess: () => setShowDetailDialog(false),
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filterProject !== "all") params.set("projectId", filterProject);
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterPhase !== "all") params.set("phase", filterPhase);
    if (activeCategoryTab !== "all") params.set("category", activeCategoryTab);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/subcontracts/projects"],
    enabled: !!user
  });

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"],
    enabled: !!user
  });

  const { data: stats } = useQuery<SubmittalStats>({
    queryKey: ["/api/submittals/stats"],
    enabled: !!user
  });

  const { data: submittals = [], isLoading: loadingSubmittals } = useQuery<Submittal[]>({
    queryKey: ["/api/submittals", buildQueryString()],
    enabled: !!user
  });

  const { data: selectedDetail } = useQuery<Submittal>({
    queryKey: ["/api/submittals", selectedSubmittal?.id],
    enabled: !!selectedSubmittal?.id && showDetailDialog
  });

  const resetCreateForm = () => {
    setCreateForm({
      projectId: "",
      subject: "",
      description: "",
      submittalType: "CONTRACTOR",
      phase: "CONSTRUCTION",
      specSection: "",
      submittalCategory: "",
      subcontractorId: "",
      dateRequired: ""
    });
  };

  const openDetailDialog = (submittal: Submittal) => {
    setSelectedSubmittal(submittal);
    setShowDetailDialog(true);
  };

  const handleEdit = (detail: Submittal) => {
    setCreateForm({
      projectId: detail.projectId,
      subject: detail.subject,
      description: detail.description || "",
      submittalType: detail.submittalType,
      phase: detail.phase,
      specSection: detail.specSection || "",
      submittalCategory: detail.submittalCategory || "",
      subcontractorId: detail.subcontractorId || "",
      dateRequired: detail.dateRequired || ""
    });
    setShowDetailDialog(false);
    setShowCreateDialog(true);
  };

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground" data-testid="text-login-required">Please log in to access Submittals</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <FileCheck className="h-8 w-8 text-primary" />
            Submittals
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Manage contractor and subcontractor submittals for projects
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-submittal">
          <Plus className="h-4 w-4 mr-2" />
          Create Submittal
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">{stats?.total ?? 0}</div>
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
            <div className="text-2xl font-bold" data-testid="stat-pending-review">{stats?.pendingReview ?? 0}</div>
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
            <div className="text-2xl font-bold" data-testid="stat-approved">{stats?.approved ?? 0}</div>
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
            <div className="text-2xl font-bold" data-testid="stat-needs-action">{stats?.needsAction ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeCategoryTab} onValueChange={setActiveCategoryTab}>
        <TabsList className="flex-wrap h-auto" data-testid="tabs-submittal-category">
          <TabsTrigger value="all" data-testid="tab-all-types">All Types</TabsTrigger>
          <TabsTrigger value="SHOP_DRAWING" data-testid="tab-shop-drawings">Shop Drawings</TabsTrigger>
          <TabsTrigger value="PRODUCT_DATA" data-testid="tab-product-data">Product Data</TabsTrigger>
          <TabsTrigger value="MATERIAL_APPROVAL" data-testid="tab-material-approvals">Material Approvals</TabsTrigger>
          <TabsTrigger value="ENGINEERING_APPROVAL" data-testid="tab-engineering-approvals">Engineering Approvals</TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="w-48">
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger data-testid="select-filter-project">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status">
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
              <SelectTrigger data-testid="select-filter-phase">
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

        {["all", "SHOP_DRAWING", "PRODUCT_DATA", "MATERIAL_APPROVAL", "ENGINEERING_APPROVAL"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {loadingSubmittals ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : submittals.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-empty-state">
                  No submittals found
                </CardContent>
              </Card>
            ) : isMobile ? (
              <div className="space-y-3">
                {submittals.map(s => (
                  <Card key={s.id} data-testid={`card-submittal-${s.id}`} className="hover-elevate" onClick={() => openDetailDialog(s)}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-submittal-number-${s.id}`}>{s.submittalNumber}</span>
                        {getStatusBadge(s.status)}
                      </div>
                      <p className="text-sm" data-testid={`text-submittal-subject-${s.id}`}>{s.subject}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getTypeBadge(s.submittalType)}
                        {getPhaseBadge(s.phase)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {s.project?.code} - {s.project?.name}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Rev {s.revision}</span>
                        <span>{s.dateSubmitted ? format(new Date(s.dateSubmitted), "MMM d, yyyy") : "Not submitted"}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SUB #</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Phase</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Rev #</TableHead>
                        <TableHead>Submitted By</TableHead>
                        <TableHead>Date Submitted</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {submittals.map(s => (
                        <TableRow key={s.id} data-testid={`row-submittal-${s.id}`}>
                          <TableCell className="font-medium" data-testid={`text-submittal-number-${s.id}`}>{s.submittalNumber}</TableCell>
                          <TableCell data-testid={`text-submittal-subject-${s.id}`}>{s.subject}</TableCell>
                          <TableCell>{getTypeBadge(s.submittalType)}</TableCell>
                          <TableCell>{getPhaseBadge(s.phase)}</TableCell>
                          <TableCell className="text-muted-foreground">{s.project?.code} - {s.project?.name}</TableCell>
                          <TableCell>{getStatusBadge(s.status)}</TableCell>
                          <TableCell data-testid={`text-revision-${s.id}`}>{s.revision}</TableCell>
                          <TableCell className="text-muted-foreground">{s.submittedByName || "-"}</TableCell>
                          <TableCell className="text-muted-foreground">{s.dateSubmitted ? format(new Date(s.dateSubmitted), "MMM d, yyyy") : "-"}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDetailDialog(s)}
                              data-testid={`button-view-submittal-${s.id}`}
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
              <Label>Project *</Label>
              <Select value={createForm.projectId} onValueChange={(v) => setCreateForm({ ...createForm, projectId: v })}>
                <SelectTrigger data-testid="select-create-project">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                placeholder="Enter submittal subject..."
                data-testid="input-create-subject"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Optional description..."
                rows={3}
                data-testid="input-create-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Submittal Type</Label>
                <Select value={createForm.submittalType} onValueChange={(v) => setCreateForm({ ...createForm, submittalType: v })}>
                  <SelectTrigger data-testid="select-create-type">
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
                  <SelectTrigger data-testid="select-create-phase">
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
                  data-testid="input-create-spec-section"
                />
              </div>
              <div className="space-y-2">
                <Label>Document Category</Label>
                <Select value={createForm.submittalCategory} onValueChange={(v) => setCreateForm({ ...createForm, submittalCategory: v })}>
                  <SelectTrigger data-testid="select-create-category">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBMITTAL_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{SUBMITTAL_CATEGORY_LABELS[cat]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createForm.submittalType === "SUBCONTRACTOR" && (
              <div className="space-y-2">
                <Label>Subcontractor</Label>
                <Select value={createForm.subcontractorId} onValueChange={(v) => setCreateForm({ ...createForm, subcontractorId: v })}>
                  <SelectTrigger data-testid="select-create-subcontractor">
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
                data-testid="input-create-date-required"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => mutations.createMutation.mutate(createForm)}
              disabled={!createForm.projectId || !createForm.subject || mutations.createMutation.isPending}
              data-testid="button-submit-create"
            >
              {mutations.createMutation.isPending ? "Creating..." : "Create Submittal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubmittalDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        submittal={selectedSubmittal}
        selectedDetail={selectedDetail}
        mutations={mutations}
        onEdit={handleEdit}
        userRole={user?.role ?? ""}
        currentUserId={user?.id ?? ""}
      />
    </div>
  );
}

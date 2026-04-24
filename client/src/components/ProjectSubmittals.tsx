import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
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
  Send,
  Download,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { format } from "date-fns";
import { useSubmittalMutations } from "@/hooks/useSubmittalMutations";
import type { Submittal, SubmittalStats, SubmittalCreateForm, Subcontractor } from "@/hooks/useSubmittalMutations";
import { SUBMITTAL_CATEGORIES, SUBMITTAL_CATEGORY_LABELS } from "@/hooks/useSubmittalMutations";
import { SubmittalDetailDialog, getStatusBadge, getPhaseBadge, getTypeBadge } from "@/components/document-control/SubmittalDetailDialog";
import { useAuth } from "@/hooks/use-auth";

interface ProjectSubmittalsProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

export default function ProjectSubmittals({ projectId, projectCode, userRole }: ProjectSubmittalsProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedSubmittal, setSelectedSubmittal] = useState<Submittal | null>(null);

  const [createForm, setCreateForm] = useState<Omit<SubmittalCreateForm, 'projectId'>>({
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

  const resetCreateForm = () => {
    setCreateForm({
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

  useEffect(() => {
    if (submittals.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkId = params.get("submittalId");
    if (deepLinkId) {
      const found = submittals.find((s) => s.id === deepLinkId);
      if (found) {
        setSelectedSubmittal(found);
        setShowDetailDialog(true);
      }
    }
  }, [submittals]);

  const { getRowProps: getSubmittalRowProps } = useTableKeyboardNav({
    rowCount: submittals.length,
    onActivate: (idx) => {
      const s = submittals[idx];
      if (s) openDetailDialog(s);
    },
  });
  useRegisterShortcuts(
    "project-submittals",
    TABLE_NAV_SHORTCUTS.filter((sc) => sc.keys !== "/"),
  );

  const handleEdit = (detail: Submittal) => {
    setCreateForm({
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

  const detail = selectedDetail || selectedSubmittal;

  return (
    <div className="space-y-6" data-testid="proj-sub-container">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" data-testid="proj-sub-text-section-title">Submittals</h2>
          <p className="text-sm text-muted-foreground">Manage submittals for this project</p>
        </div>
        <div className="flex items-center gap-2">
          {["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole) && (
            <Button
              variant="outline"
              asChild
              data-testid="proj-sub-button-download-log"
            >
              <a href={`/api/projects/${projectId}/submittals/log.pdf`} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" />
                Download log (PDF)
              </a>
            </Button>
          )}
          <Button onClick={() => setShowCreateDialog(true)} data-testid="proj-sub-button-create-submittal">
            <Plus className="h-4 w-4 mr-2" />
            Create Submittal
          </Button>
        </div>
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
              <EmptyState
                icon={Send}
                title="No submittals yet"
                description="Create a submittal to track material approvals and document submissions."
                testId="empty-state-submittals"
              />
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
                        {submittals.map((s, idx) => (
                          <TableRow
                            key={s.id}
                            className="cursor-pointer data-[focused=true]:bg-muted data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-inset"
                            onClick={() => openDetailDialog(s)}
                            data-testid={`proj-sub-row-submittal-${s.id}`}
                            {...getSubmittalRowProps(idx)}
                          >
                            <TableCell className="font-medium" data-testid={`proj-sub-text-submittal-number-${s.id}`}>{s.submittalNumber}</TableCell>
                            <TableCell data-testid={`proj-sub-text-submittal-subject-${s.id}`}>{s.subject}</TableCell>
                            <TableCell>{getTypeBadge(s.submittalType)}</TableCell>
                            <TableCell>{getPhaseBadge(s.phase)}</TableCell>
                            <TableCell>{getStatusBadge(s.status, "proj-sub-")}</TableCell>
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
                {submittals.map((s, idx) => (
                  <div
                    key={s.id}
                    className="border rounded-md p-3 space-y-2 cursor-pointer data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-offset-2 data-[focused=true]:ring-offset-background"
                    onClick={() => openDetailDialog(s)}
                    data-testid={`proj-sub-row-submittal-mobile-${s.id}`}
                    {...getSubmittalRowProps(idx)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm" data-testid={`proj-sub-text-submittal-number-mobile-${s.id}`}>{s.submittalNumber}</span>
                      <span className="shrink-0">{getStatusBadge(s.status, "proj-sub-")}</span>
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
        <DialogContent className="sm:max-w-lg">
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
                <Label>Document Category</Label>
                <Select value={createForm.submittalCategory} onValueChange={(v) => setCreateForm({ ...createForm, submittalCategory: v })}>
                  <SelectTrigger data-testid="proj-sub-select-create-category">
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
              onClick={() => mutations.createMutation.mutate({ ...createForm, projectId })}
              disabled={!createForm.subject || mutations.createMutation.isPending}
              data-testid="proj-sub-button-submit-create"
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
        testIdPrefix="proj-sub-"
        mutations={mutations}
        onEdit={handleEdit}
        userRole={userRole}
        currentUserId={user?.id ?? ""}
      />
    </div>
  );
}

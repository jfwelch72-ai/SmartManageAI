import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  HelpCircle,
  Plus,
  Eye,
  Send,
  Play,
  MessageSquare,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Trash2,
  Edit,
  RotateCcw,
  Link2,
  Search
} from "lucide-react";
import { format } from "date-fns";
import DocumentAttachments from "@/components/DocumentAttachments";

interface ProjectRFIsProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
}

interface RFIStats {
  total: number;
  open: number;
  answered: number;
  closed: number;
}

interface RFI {
  id: string;
  rfiNumber: string;
  projectId: string;
  subject: string;
  question: string;
  answer: string | null;
  priority: string;
  status: string;
  subcontractorId: string | null;
  contractId: string | null;
  drawingReference: string | null;
  specReference: string | null;
  impactDescription: string | null;
  costImpact: boolean;
  scheduleImpact: boolean;
  dateRequired: string | null;
  assignedToId: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  answeredById: string | null;
  answeredByName: string | null;
  linkedChangeOrderId: string | null;
  linkedTmTicketId: string | null;
  createdAt: string;
  updatedAt: string | null;
  dateSubmitted: string | null;
  dateAnswered: string | null;
  closedAt: string | null;
  project?: { code: string; name: string };
  subcontractor?: { companyName: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
}

interface ActivityEntry {
  id: string;
  action: string;
  comment: string | null;
  userName: string;
  createdAt: string;
}

interface ChangeOrder {
  id: string;
  coNumber: string;
  title: string;
  status: string;
}

export default function ProjectRFIs({ projectId, projectCode, userRole }: ProjectRFIsProps) {
  const { toast } = useToast();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedRFI, setSelectedRFI] = useState<RFI | null>(null);
  const [showAnswerInput, setShowAnswerInput] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [commentText, setCommentText] = useState("");
  const [showLinkCODialog, setShowLinkCODialog] = useState(false);
  const [selectedCOId, setSelectedCOId] = useState("");

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const [createForm, setCreateForm] = useState({
    subject: "",
    question: "",
    priority: "MEDIUM",
    subcontractorId: "",
    drawingReference: "",
    specReference: "",
    dateRequired: "",
    impactDescription: "",
    costImpact: false,
    scheduleImpact: false,
  });

  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    subject: "",
    question: "",
    priority: "MEDIUM",
    drawingReference: "",
    specReference: "",
    dateRequired: "",
    impactDescription: "",
    costImpact: false,
    scheduleImpact: false,
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (filterStatus !== "all") params.set("status", filterStatus);
    return `?${params.toString()}`;
  };

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"],
  });

  const { data: stats, isLoading: loadingStats } = useQuery<RFIStats>({
    queryKey: ["/api/rfi/stats", { projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/rfi/stats?projectId=${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const rfiQueryKey = ["/api/rfi", { projectId, status: filterStatus }];

  const { data: rfis = [], isLoading: loadingRFIs } = useQuery<RFI[]>({
    queryKey: rfiQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/rfi${buildQueryString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch RFIs");
      return res.json();
    },
  });

  const { data: selectedRFIDetail } = useQuery<RFI>({
    queryKey: ["/api/rfi", selectedRFI?.id],
    enabled: !!selectedRFI?.id && showDetailDialog,
  });

  const { data: activityLog = [] } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/rfi", selectedRFI?.id, "activity"],
    enabled: !!selectedRFI?.id && showDetailDialog,
  });

  const { data: changeOrders = [] } = useQuery<ChangeOrder[]>({
    queryKey: ["/api/change-orders", { projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/change-orders?projectId=${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch change orders");
      return res.json();
    },
    enabled: showLinkCODialog,
  });

  useEffect(() => {
    if (selectedRFIDetail && showDetailDialog) {
      setSelectedRFI(selectedRFIDetail);
    }
  }, [selectedRFIDetail, showDetailDialog]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const body: Record<string, unknown> = {
        projectId,
        subject: data.subject,
        question: data.question,
        priority: data.priority,
        costImpact: data.costImpact,
        scheduleImpact: data.scheduleImpact,
      };
      if (data.subcontractorId) body.subcontractorId = data.subcontractorId;
      if (data.drawingReference) body.drawingReference = data.drawingReference;
      if (data.specReference) body.specReference = data.specReference;
      if (data.dateRequired) body.dateRequired = data.dateRequired;
      if (data.impactDescription) body.impactDescription = data.impactDescription;
      return await apiRequest("POST", "/api/rfi", body);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI created successfully" });
      setShowCreateDialog(false);
      resetCreateForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create RFI", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return await apiRequest("PATCH", `/api/rfi/${id}`, data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI updated" });
      setEditMode(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to update RFI", description: error.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/submit`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI submitted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to submit RFI", description: error.message, variant: "destructive" });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/review`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI moved to review" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to start review", description: error.message, variant: "destructive" });
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/answer`, { answer }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI answered" });
      setShowAnswerInput(false);
      setAnswerText("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to answer RFI", description: error.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/close`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI closed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to close RFI", description: error.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/reopen`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI reopened" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to reopen RFI", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("DELETE", `/api/rfi/${id}`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI deleted" });
      setShowDetailDialog(false);
      setSelectedRFI(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete RFI", description: error.message, variant: "destructive" });
    },
  });

  const linkCOMutation = useMutation({
    mutationFn: async ({ id, changeOrderId }: { id: string; changeOrderId: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/link-co`, { changeOrderId }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Change order linked" });
      setShowLinkCODialog(false);
      setSelectedCOId("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to link change order", description: error.message, variant: "destructive" });
    },
  });

  const linkTMMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/link-tm`, {}),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "T&M ticket linked" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to link T&M ticket", description: error.message, variant: "destructive" });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/activity`, { comment }),
    onSuccess: () => {
      if (selectedRFI) queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRFI.id, "activity"] });
      toast({ title: "Comment added" });
      setCommentText("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rfi"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rfi/stats"] });
    if (selectedRFI) {
      queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRFI.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRFI.id, "activity"] });
    }
  };

  const resetCreateForm = () => {
    setCreateForm({
      subject: "",
      question: "",
      priority: "MEDIUM",
      subcontractorId: "",
      drawingReference: "",
      specReference: "",
      dateRequired: "",
      impactDescription: "",
      costImpact: false,
      scheduleImpact: false,
    });
  };

  const openDetail = (rfi: RFI) => {
    setSelectedRFI(rfi);
    setShowDetailDialog(true);
    setShowAnswerInput(false);
    setAnswerText("");
    setEditMode(false);
    setCommentText("");
  };

  const startEdit = () => {
    if (!selectedRFI) return;
    setEditForm({
      subject: selectedRFI.subject,
      question: selectedRFI.question,
      priority: selectedRFI.priority,
      drawingReference: selectedRFI.drawingReference || "",
      specReference: selectedRFI.specReference || "",
      dateRequired: selectedRFI.dateRequired || "",
      impactDescription: selectedRFI.impactDescription || "",
      costImpact: selectedRFI.costImpact || false,
      scheduleImpact: selectedRFI.scheduleImpact || false,
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    if (!selectedRFI) return;
    updateMutation.mutate({ id: selectedRFI.id, data: editForm });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
      case "SUBMITTED":
        return <Badge variant="default"><Send className="h-3 w-3 mr-1" />Submitted</Badge>;
      case "UNDER_REVIEW":
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"><Search className="h-3 w-3 mr-1" />Under Review</Badge>;
      case "ANSWERED":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Answered</Badge>;
      case "CLOSED":
        return <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><XCircle className="h-3 w-3 mr-1" />Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "LOW":
        return <Badge variant="secondary">Low</Badge>;
      case "MEDIUM":
        return <Badge variant="default">Medium</Badge>;
      case "HIGH":
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">High</Badge>;
      case "URGENT":
        return <Badge variant="destructive">Urgent</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
  };

  const filteredRFIs = rfis.filter((rfi) => {
    if (filterPriority !== "all" && rfi.priority !== filterPriority) return false;
    return true;
  });

  return (
    <div className="space-y-6" data-testid="proj-section-rfis">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">RFIs</h3>
          <Badge variant="secondary" data-testid="proj-badge-rfi-count">{stats?.total ?? 0} total</Badge>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="proj-button-create-rfi">
          <Plus className="h-4 w-4 mr-2" />
          Create RFI
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loadingStats ? (
          [1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card data-testid="proj-card-stat-total">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  Total RFIs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="proj-text-stat-total">{stats?.total ?? 0}</div>
              </CardContent>
            </Card>
            <Card data-testid="proj-card-stat-open">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Open
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="proj-text-stat-open">{stats?.open ?? 0}</div>
              </CardContent>
            </Card>
            <Card data-testid="proj-card-stat-answered">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Answered
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="proj-text-stat-answered">{stats?.answered ?? 0}</div>
              </CardContent>
            </Card>
            <Card data-testid="proj-card-stat-closed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Closed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="proj-text-stat-closed">{stats?.closed ?? 0}</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger data-testid="proj-select-filter-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger data-testid="proj-select-filter-priority">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingRFIs ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : filteredRFIs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="proj-text-empty-state">
            No RFIs found for this project. Create your first RFI to get started.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:block">
              <Table data-testid="proj-table-rfis">
                <TableHeader>
                  <TableRow>
                    <TableHead>RFI #</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Date Submitted</TableHead>
                    <TableHead>Date Required</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRFIs.map((rfi) => (
                    <TableRow
                      key={rfi.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(rfi)}
                      data-testid={`proj-row-rfi-${rfi.id}`}
                    >
                      <TableCell className="font-medium" data-testid={`proj-text-rfi-number-${rfi.id}`}>
                        {rfi.rfiNumber}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" data-testid={`proj-text-rfi-subject-${rfi.id}`}>
                        {rfi.subject}
                      </TableCell>
                      <TableCell data-testid={`proj-badge-rfi-priority-${rfi.id}`}>
                        {getPriorityBadge(rfi.priority)}
                      </TableCell>
                      <TableCell data-testid={`proj-badge-rfi-status-${rfi.id}`}>
                        {getStatusBadge(rfi.status)}
                      </TableCell>
                      <TableCell data-testid={`proj-text-rfi-submitter-${rfi.id}`}>
                        {rfi.submittedByName || "—"}
                      </TableCell>
                      <TableCell data-testid={`proj-text-rfi-submitted-date-${rfi.id}`}>
                        {rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell data-testid={`proj-text-rfi-required-date-${rfi.id}`}>
                        {rfi.dateRequired ? format(new Date(rfi.dateRequired), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(rfi);
                          }}
                          data-testid={`proj-button-view-rfi-${rfi.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden space-y-3 p-3">
              {filteredRFIs.map((rfi) => (
                <div
                  key={rfi.id}
                  className="border rounded-md p-3 space-y-2 cursor-pointer"
                  onClick={() => openDetail(rfi)}
                  data-testid={`proj-row-rfi-mobile-${rfi.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm" data-testid={`proj-text-rfi-number-mobile-${rfi.id}`}>
                      {rfi.rfiNumber}
                    </span>
                    <span className="shrink-0" data-testid={`proj-badge-rfi-status-mobile-${rfi.id}`}>
                      {getStatusBadge(rfi.status)}
                    </span>
                  </div>
                  <div className="text-sm truncate" data-testid={`proj-text-rfi-subject-mobile-${rfi.id}`}>
                    {rfi.subject}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div data-testid={`proj-badge-rfi-priority-mobile-${rfi.id}`}>
                      <span className="block mb-1">Priority</span>
                      {getPriorityBadge(rfi.priority)}
                    </div>
                    <div data-testid={`proj-text-rfi-submitter-mobile-${rfi.id}`}>
                      <span className="block mb-1">Submitted By</span>
                      <span className="text-foreground text-sm">{rfi.submittedByName || "—"}</span>
                    </div>
                    <div data-testid={`proj-text-rfi-submitted-date-mobile-${rfi.id}`}>
                      <span className="block mb-1">Date Submitted</span>
                      <span className="text-foreground text-sm">
                        {rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}
                      </span>
                    </div>
                    <div data-testid={`proj-text-rfi-required-date-mobile-${rfi.id}`}>
                      <span className="block mb-1">Date Required</span>
                      <span className="text-foreground text-sm">
                        {rfi.dateRequired ? format(new Date(rfi.dateRequired), "MMM d, yyyy") : "—"}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetail(rfi);
                    }}
                    data-testid={`proj-button-view-rfi-mobile-${rfi.id}`}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg" data-testid="proj-dialog-create-rfi">
          <DialogHeader>
            <DialogTitle>Create RFI</DialogTitle>
            <DialogDescription>
              Submit a new Request for Information for {projectCode}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                placeholder="Brief description of the issue"
                data-testid="proj-input-create-subject"
              />
            </div>
            <div className="space-y-2">
              <Label>Question *</Label>
              <Textarea
                value={createForm.question}
                onChange={(e) => setCreateForm({ ...createForm, question: e.target.value })}
                placeholder="Detailed question requiring clarification..."
                rows={4}
                data-testid="proj-input-create-question"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={createForm.priority}
                onValueChange={(v) => setCreateForm({ ...createForm, priority: v })}
              >
                <SelectTrigger data-testid="proj-select-create-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subcontractor</Label>
              <Select
                value={createForm.subcontractorId || "none"}
                onValueChange={(v) => setCreateForm({ ...createForm, subcontractorId: v === "none" ? "" : v })}
              >
                <SelectTrigger data-testid="proj-select-create-subcontractor">
                  <SelectValue placeholder="Select subcontractor (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {subcontractors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.companyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Drawing Reference</Label>
                <Input
                  value={createForm.drawingReference}
                  onChange={(e) => setCreateForm({ ...createForm, drawingReference: e.target.value })}
                  placeholder="e.g., Sheet A-201"
                  data-testid="proj-input-create-drawing-ref"
                />
              </div>
              <div className="space-y-2">
                <Label>Spec Reference</Label>
                <Input
                  value={createForm.specReference}
                  onChange={(e) => setCreateForm({ ...createForm, specReference: e.target.value })}
                  placeholder="e.g., Section 03300"
                  data-testid="proj-input-create-spec-ref"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date Required</Label>
              <Input
                type="date"
                value={createForm.dateRequired}
                onChange={(e) => setCreateForm({ ...createForm, dateRequired: e.target.value })}
                data-testid="proj-input-create-date-required"
              />
            </div>
            <div className="space-y-2">
              <Label>Impact Description</Label>
              <Textarea
                value={createForm.impactDescription}
                onChange={(e) => setCreateForm({ ...createForm, impactDescription: e.target.value })}
                placeholder="Describe the impact if not resolved..."
                rows={2}
                data-testid="proj-input-create-impact"
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="proj-costImpact"
                  checked={createForm.costImpact}
                  onCheckedChange={(c) => setCreateForm({ ...createForm, costImpact: !!c })}
                  data-testid="proj-checkbox-create-cost-impact"
                />
                <Label htmlFor="proj-costImpact" className="cursor-pointer">Cost Impact</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="proj-scheduleImpact"
                  checked={createForm.scheduleImpact}
                  onCheckedChange={(c) => setCreateForm({ ...createForm, scheduleImpact: !!c })}
                  data-testid="proj-checkbox-create-schedule-impact"
                />
                <Label htmlFor="proj-scheduleImpact" className="cursor-pointer">Schedule Impact</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="proj-button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.subject || !createForm.question || createMutation.isPending}
              data-testid="proj-button-submit-create"
            >
              {createMutation.isPending ? "Creating..." : "Create RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={(open) => { setShowDetailDialog(open); if (!open) { setEditMode(false); setShowAnswerInput(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="proj-dialog-rfi-detail">
          {selectedRFI && (
            <div className="space-y-6">
              <DialogHeader>
                <div className="flex items-center gap-3 flex-wrap">
                  {getStatusBadge(selectedRFI.status)}
                  {getPriorityBadge(selectedRFI.priority)}
                  <span className="text-sm text-muted-foreground" data-testid="proj-text-detail-rfi-number">
                    {selectedRFI.rfiNumber}
                  </span>
                </div>
                <DialogTitle data-testid="proj-text-detail-subject">
                  {editMode ? (
                    <Input
                      value={editForm.subject}
                      onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                      data-testid="proj-input-edit-subject"
                    />
                  ) : (
                    selectedRFI.subject
                  )}
                </DialogTitle>
              </DialogHeader>

              {editMode ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Question</Label>
                    <Textarea
                      value={editForm.question}
                      onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
                      rows={4}
                      data-testid="proj-input-edit-question"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                      <SelectTrigger data-testid="proj-select-edit-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="URGENT">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Drawing Reference</Label>
                      <Input
                        value={editForm.drawingReference}
                        onChange={(e) => setEditForm({ ...editForm, drawingReference: e.target.value })}
                        data-testid="proj-input-edit-drawing-ref"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Spec Reference</Label>
                      <Input
                        value={editForm.specReference}
                        onChange={(e) => setEditForm({ ...editForm, specReference: e.target.value })}
                        data-testid="proj-input-edit-spec-ref"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Date Required</Label>
                    <Input
                      type="date"
                      value={editForm.dateRequired}
                      onChange={(e) => setEditForm({ ...editForm, dateRequired: e.target.value })}
                      data-testid="proj-input-edit-date-required"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Impact Description</Label>
                    <Textarea
                      value={editForm.impactDescription}
                      onChange={(e) => setEditForm({ ...editForm, impactDescription: e.target.value })}
                      rows={2}
                      data-testid="proj-input-edit-impact"
                    />
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={editForm.costImpact}
                        onCheckedChange={(c) => setEditForm({ ...editForm, costImpact: !!c })}
                        data-testid="proj-checkbox-edit-cost-impact"
                      />
                      <Label>Cost Impact</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={editForm.scheduleImpact}
                        onCheckedChange={(c) => setEditForm({ ...editForm, scheduleImpact: !!c })}
                        data-testid="proj-checkbox-edit-schedule-impact"
                      />
                      <Label>Schedule Impact</Label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button onClick={saveEdit} disabled={updateMutation.isPending} data-testid="proj-button-save-edit">
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditMode(false)} data-testid="proj-button-cancel-edit">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-muted-foreground text-xs">Question</Label>
                      <p className="mt-1 whitespace-pre-wrap" data-testid="proj-text-detail-question">{selectedRFI.question}</p>
                    </div>

                    {(selectedRFI.drawingReference || selectedRFI.specReference) && (
                      <div className="flex gap-4 flex-wrap">
                        {selectedRFI.drawingReference && (
                          <div>
                            <Label className="text-muted-foreground text-xs">Drawing Reference</Label>
                            <p className="mt-1" data-testid="proj-text-detail-drawing-ref">{selectedRFI.drawingReference}</p>
                          </div>
                        )}
                        {selectedRFI.specReference && (
                          <div>
                            <Label className="text-muted-foreground text-xs">Spec Reference</Label>
                            <p className="mt-1" data-testid="proj-text-detail-spec-ref">{selectedRFI.specReference}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedRFI.subcontractor && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Subcontractor</Label>
                        <p className="mt-1" data-testid="proj-text-detail-subcontractor">{selectedRFI.subcontractor.companyName}</p>
                      </div>
                    )}

                    {selectedRFI.dateRequired && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Date Required</Label>
                        <p className="mt-1" data-testid="proj-text-detail-date-required">
                          {format(new Date(selectedRFI.dateRequired), "MMM d, yyyy")}
                        </p>
                      </div>
                    )}

                    {(selectedRFI.costImpact || selectedRFI.scheduleImpact) && (
                      <div className="flex gap-3 flex-wrap">
                        {selectedRFI.costImpact && (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="proj-badge-cost-impact">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Cost Impact
                          </Badge>
                        )}
                        {selectedRFI.scheduleImpact && (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="proj-badge-schedule-impact">
                            <Clock className="h-3 w-3 mr-1" />
                            Schedule Impact
                          </Badge>
                        )}
                      </div>
                    )}

                    {selectedRFI.impactDescription && (
                      <div>
                        <Label className="text-muted-foreground text-xs">Impact Description</Label>
                        <p className="mt-1 whitespace-pre-wrap" data-testid="proj-text-detail-impact">{selectedRFI.impactDescription}</p>
                      </div>
                    )}

                    {selectedRFI.answer && (
                      <Card data-testid="proj-card-answer">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            Answer
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="whitespace-pre-wrap" data-testid="proj-text-detail-answer">{selectedRFI.answer}</p>
                          {selectedRFI.answeredByName && (
                            <p className="text-sm text-muted-foreground mt-2" data-testid="proj-text-detail-answered-by">
                              Answered by {selectedRFI.answeredByName}
                              {selectedRFI.dateAnswered && ` on ${format(new Date(selectedRFI.dateAnswered), "MMM d, yyyy")}`}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {selectedRFI.linkedChangeOrderId && (
                      <div data-testid="proj-linked-co">
                        <Label className="text-muted-foreground text-xs">Linked Change Order</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm" data-testid="proj-text-linked-co-id">{selectedRFI.linkedChangeOrderId}</span>
                        </div>
                      </div>
                    )}

                    {selectedRFI.linkedTmTicketId && (
                      <div data-testid="proj-linked-tm">
                        <Label className="text-muted-foreground text-xs">Linked T&M Ticket</Label>
                        <div className="mt-1 flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm" data-testid="proj-text-linked-tm-id">{selectedRFI.linkedTmTicketId}</span>
                        </div>
                      </div>
                    )}

                    <DocumentAttachments
                      entityType="rfi"
                      entityId={selectedRFI.id}
                      canUpload={["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole)}
                      canDelete={["ADMIN", "MANAGER"].includes(userRole)}
                      compact
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedRFI.status === "DRAFT" && (
                      <>
                        <Button
                          onClick={() => submitMutation.mutate(selectedRFI.id)}
                          disabled={submitMutation.isPending}
                          data-testid="proj-button-submit-rfi"
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Submit
                        </Button>
                        <Button variant="outline" onClick={startEdit} data-testid="proj-button-edit-rfi">
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(selectedRFI.id)}
                          disabled={deleteMutation.isPending}
                          data-testid="proj-button-delete-rfi"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </>
                    )}
                    {selectedRFI.status === "SUBMITTED" && (
                      <Button
                        onClick={() => reviewMutation.mutate(selectedRFI.id)}
                        disabled={reviewMutation.isPending}
                        data-testid="proj-button-start-review"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Start Review
                      </Button>
                    )}
                    {selectedRFI.status === "UNDER_REVIEW" && (
                      <>
                        {showAnswerInput ? (
                          <div className="w-full space-y-3">
                            <Textarea
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                              placeholder="Enter the answer to this RFI..."
                              rows={4}
                              data-testid="proj-input-answer"
                            />
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                onClick={() => answerMutation.mutate({ id: selectedRFI.id, answer: answerText })}
                                disabled={!answerText.trim() || answerMutation.isPending}
                                data-testid="proj-button-submit-answer"
                              >
                                {answerMutation.isPending ? "Submitting..." : "Submit Answer"}
                              </Button>
                              <Button variant="outline" onClick={() => setShowAnswerInput(false)} data-testid="proj-button-cancel-answer">
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button onClick={() => setShowAnswerInput(true)} data-testid="proj-button-answer-rfi">
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Answer
                          </Button>
                        )}
                      </>
                    )}
                    {selectedRFI.status === "ANSWERED" && (
                      <>
                        <Button
                          onClick={() => closeMutation.mutate(selectedRFI.id)}
                          disabled={closeMutation.isPending}
                          data-testid="proj-button-close-rfi"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Close
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowLinkCODialog(true)}
                          data-testid="proj-button-link-co"
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          Link Change Order
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => linkTMMutation.mutate(selectedRFI.id)}
                          disabled={linkTMMutation.isPending}
                          data-testid="proj-button-link-tm"
                        >
                          <Link2 className="h-4 w-4 mr-2" />
                          Link T&M
                        </Button>
                      </>
                    )}
                    {selectedRFI.status === "CLOSED" && (
                      <Button
                        variant="outline"
                        onClick={() => reopenMutation.mutate(selectedRFI.id)}
                        disabled={reopenMutation.isPending}
                        data-testid="proj-button-reopen-rfi"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reopen
                      </Button>
                    )}
                  </div>

                  <div className="border-t pt-4 space-y-4">
                    <h3 className="font-medium flex items-center gap-2" data-testid="proj-text-activity-header">
                      <MessageSquare className="h-4 w-4" />
                      Activity Log
                    </h3>
                    {activityLog.length === 0 ? (
                      <p className="text-sm text-muted-foreground" data-testid="proj-text-no-activity">No activity yet</p>
                    ) : (
                      <div className="space-y-3">
                        {activityLog.map((entry) => (
                          <div key={entry.id} className="flex gap-3" data-testid={`proj-activity-entry-${entry.id}`}>
                            <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium" data-testid={`proj-text-activity-user-${entry.id}`}>
                                  {entry.userName}
                                </span>
                                <span className="text-xs text-muted-foreground" data-testid={`proj-text-activity-date-${entry.id}`}>
                                  {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                                </span>
                              </div>
                              <p className="text-sm" data-testid={`proj-text-activity-action-${entry.id}`}>
                                {entry.comment || entry.action}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a comment..."
                        rows={2}
                        className="flex-1"
                        data-testid="proj-input-comment"
                      />
                      <Button
                        onClick={() => addCommentMutation.mutate({ id: selectedRFI.id, comment: commentText })}
                        disabled={!commentText.trim() || addCommentMutation.isPending}
                        data-testid="proj-button-add-comment"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkCODialog} onOpenChange={setShowLinkCODialog}>
        <DialogContent data-testid="proj-dialog-link-co">
          <DialogHeader>
            <DialogTitle>Link Change Order</DialogTitle>
            <DialogDescription>Select a change order to link to this RFI</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedCOId} onValueChange={setSelectedCOId}>
              <SelectTrigger data-testid="proj-select-link-co">
                <SelectValue placeholder="Select a change order..." />
              </SelectTrigger>
              <SelectContent>
                {changeOrders.map((co) => (
                  <SelectItem key={co.id} value={co.id}>
                    {co.coNumber} - {co.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkCODialog(false)} data-testid="proj-button-cancel-link-co">
              Cancel
            </Button>
            <Button
              onClick={() => selectedRFI && linkCOMutation.mutate({ id: selectedRFI.id, changeOrderId: selectedCOId })}
              disabled={!selectedCOId || linkCOMutation.isPending}
              data-testid="proj-button-confirm-link-co"
            >
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

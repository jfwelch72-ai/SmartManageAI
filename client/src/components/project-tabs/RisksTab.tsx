import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  AlertTriangle,
  Shield,
  Trash2,
  Edit,
  Bot,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  DollarSign,
  Calendar,
} from "lucide-react";

interface ProjectRisk {
  id: string;
  projectId: string;
  organizationId: string;
  title: string;
  description: string | null;
  category: string;
  probability: number;
  impact: number;
  riskScore: number;
  status: string;
  mitigationPlan: string | null;
  ownerUserId: string | null;
  ownerName?: string | null;
  costImpactDollars: string | null;
  scheduleImpactDays: number | null;
  linkedCostCode: string | null;
  linkedMilestone: string | null;
  linkedChangeOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RiskSummary {
  totalRisks: number;
  openRisks: number;
  highRisks: number;
  criticalRisks: number;
  occurredRisks: number;
  resolvedRisks: number;
  acceptedRisks: number;
  totalCostExposure: number;
  totalScheduleExposure: number;
  categoryBreakdown: Record<string, number>;
}

interface RiskMatrixCell {
  count: number;
  risks: { id: string; title: string; category: string }[];
}

interface RiskFormData {
  title: string;
  description: string | null;
  category: string;
  probability: number;
  impact: number;
  status: string;
  mitigationPlan: string | null;
  ownerUserId: string | null;
  costImpactDollars: string | null;
  scheduleImpactDays: number | null;
  linkedCostCode: string | null;
  linkedMilestone: string | null;
  autoCreateChangeOrder?: boolean;
}

interface AiSuggestedRisk {
  title: string;
  description: string;
  category: string;
  probability: number;
  impact: number;
  mitigationPlan: string;
  costImpactDollars: number | null;
  scheduleImpactDays: number | null;
}

const CATEGORIES = [
  "FINANCIAL", "SCHEDULE", "SAFETY", "ENVIRONMENTAL", "REGULATORY",
  "SUBCONTRACTOR", "SUPPLY_CHAIN", "WEATHER", "DESIGN", "OTHER",
];

const STATUSES = ["IDENTIFIED", "ASSESSED", "MITIGATING", "RESOLVED", "ACCEPTED", "OCCURRED"];

const STATUS_COLORS: Record<string, string> = {
  IDENTIFIED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ASSESSED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  MITIGATING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  RESOLVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  ACCEPTED: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  OCCURRED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function getCellColor(prob: number, impact: number): string {
  const score = prob * impact;
  if (score >= 20) return "bg-red-600 dark:bg-red-700";
  if (score >= 15) return "bg-orange-500 dark:bg-orange-600";
  if (score >= 10) return "bg-yellow-500 dark:bg-yellow-600";
  if (score >= 5) return "bg-green-400 dark:bg-green-600";
  return "bg-green-300 dark:bg-green-700";
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

interface RisksTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

export default function RisksTab({ projectId, projectCode, userRole }: RisksTabProps) {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingRisk, setEditingRisk] = useState<ProjectRisk | null>(null);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [view, setView] = useState<"register" | "matrix">("register");

  const queryParams = new URLSearchParams();
  if (filterStatus !== "all") queryParams.set("status", filterStatus);
  if (filterCategory !== "all") queryParams.set("category", filterCategory);
  if (filterSeverity !== "all") queryParams.set("severity", filterSeverity);

  const { data: risks = [], isLoading } = useQuery<ProjectRisk[]>({
    queryKey: ["/api/projects", projectId, "risks", filterStatus, filterCategory, filterSeverity],
    queryFn: () =>
      apiRequest("GET", `/api/projects/${projectId}/risks?${queryParams.toString()}`)
        .then((r) => r.json()),
  });

  const { data: summary } = useQuery<RiskSummary>({
    queryKey: ["/api/projects", projectId, "risks", "summary"],
    queryFn: () =>
      apiRequest("GET", `/api/projects/${projectId}/risks/summary`).then((r) => r.json()),
  });

  const { data: matrix } = useQuery<Record<string, RiskMatrixCell>>({
    queryKey: ["/api/projects", projectId, "risks", "matrix"],
    queryFn: () =>
      apiRequest("GET", `/api/projects/${projectId}/risks/matrix`).then((r) => r.json()),
    enabled: view === "matrix",
  });

  const { data: users = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskFormData) =>
      apiRequest("POST", `/api/projects/${projectId}/risks`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "risks"] });
      setShowForm(false);
      toast({ title: "Risk created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RiskFormData }) =>
      apiRequest("PATCH", `/api/projects/${projectId}/risks/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "risks"] });
      setEditingRisk(null);
      setShowForm(false);
      toast({ title: "Risk updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/projects/${projectId}/risks/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "risks"] });
      toast({ title: "Risk deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const aiSuggestMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${projectId}/risks/ai-suggest`).then((r) => r.json()),
    onSuccess: () => setShowAiSuggestions(true),
    onError: (err: Error) => {
      toast({ title: "AI Error", description: err.message, variant: "destructive" });
    },
  });

  const handleAddSuggestion = (suggestion: AiSuggestedRisk) => {
    createMutation.mutate({
      title: suggestion.title,
      description: suggestion.description,
      category: suggestion.category,
      probability: suggestion.probability,
      impact: suggestion.impact,
      mitigationPlan: suggestion.mitigationPlan,
      costImpactDollars: suggestion.costImpactDollars ? String(suggestion.costImpactDollars) : null,
      scheduleImpactDays: suggestion.scheduleImpactDays,
    });
  };

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card data-testid="card-risk-open">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground font-medium">Open Risks</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-risk-open-count">{summary.openRisks}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-risk-high">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground font-medium">High Priority</span>
              </div>
              <p className="text-2xl font-bold text-red-600" data-testid="text-risk-high-count">{summary.highRisks}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-risk-occurred">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="text-xs text-muted-foreground font-medium">Occurred</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-risk-occurred-count">{summary.occurredRisks}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-risk-resolved">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground font-medium">Resolved</span>
              </div>
              <p className="text-2xl font-bold text-green-600" data-testid="text-risk-resolved-count">{summary.resolvedRisks}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-risk-cost-exposure">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground font-medium">Cost Exposure</span>
              </div>
              <p className="text-lg font-bold" data-testid="text-risk-cost-exposure">
                ${summary.totalCostExposure.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-risk-schedule-exposure">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground font-medium">Max Delay</span>
              </div>
              <p className="text-lg font-bold" data-testid="text-risk-schedule-exposure">
                {summary.totalScheduleExposure} days
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Risk Register</CardTitle>
              <CardDescription>Identify, assess, and track project risks</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex border rounded-md overflow-hidden">
                <button
                  className={`px-3 py-1.5 text-xs font-medium ${view === "register" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => setView("register")}
                  data-testid="button-view-register"
                >
                  Register
                </button>
                <button
                  className={`px-3 py-1.5 text-xs font-medium ${view === "matrix" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => setView("matrix")}
                  data-testid="button-view-matrix"
                >
                  Heat Map
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { aiSuggestMutation.mutate(); }}
                disabled={aiSuggestMutation.isPending}
                data-testid="button-ai-suggest-risks"
              >
                {aiSuggestMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4 mr-1" />
                )}
                AI Suggest
              </Button>
              <Button
                size="sm"
                onClick={() => { setEditingRisk(null); setShowForm(true); }}
                data-testid="button-add-risk"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Risk
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {view === "register" && (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{formatCategory(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[170px]" data-testid="select-filter-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{formatCategory(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger className="w-[150px]" data-testid="select-filter-severity">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="low">Low (1-4)</SelectItem>
                    <SelectItem value="medium">Medium (5-9)</SelectItem>
                    <SelectItem value="high">High (10-19)</SelectItem>
                    <SelectItem value="critical">Critical (20-25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : risks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground" data-testid="text-no-risks">
                  <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No risks found</p>
                  <p className="text-sm mt-1">Add risks manually or use AI suggestions to get started.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-center">P</TableHead>
                        <TableHead className="text-center">I</TableHead>
                        <TableHead className="text-center">Score</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Cost Impact</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {risks.map((risk) => (
                        <TableRow key={risk.id} data-testid={`row-risk-${risk.id}`}>
                          <TableCell className="font-medium max-w-[200px] truncate" data-testid={`text-risk-title-${risk.id}`}>
                            {risk.title}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs" data-testid={`badge-risk-category-${risk.id}`}>
                              {formatCategory(risk.category)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">{risk.probability}</TableCell>
                          <TableCell className="text-center">{risk.impact}</TableCell>
                          <TableCell className="text-center">
                            <span
                              className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold text-white ${getCellColor(risk.probability, risk.impact)}`}
                              data-testid={`text-risk-score-${risk.id}`}
                            >
                              {risk.riskScore}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[risk.status] || ""}`} data-testid={`badge-risk-status-${risk.id}`}>
                              {formatCategory(risk.status)}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {risk.ownerName || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {risk.costImpactDollars ? `$${Number(risk.costImpactDollars).toLocaleString()}` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setEditingRisk(risk); setShowForm(true); }}
                                data-testid={`button-edit-risk-${risk.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { if (confirm("Delete this risk?")) deleteMutation.mutate(risk.id); }}
                                data-testid={`button-delete-risk-${risk.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {view === "matrix" && matrix && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">5×5 Risk Matrix — Probability vs Impact (open risks only)</p>
              <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                  <div className="flex items-end mb-1">
                    <div className="w-20" />
                    <div className="flex-1 grid grid-cols-5 gap-1 text-center text-xs font-medium text-muted-foreground">
                      <span>1 - Negligible</span>
                      <span>2 - Minor</span>
                      <span>3 - Moderate</span>
                      <span>4 - Major</span>
                      <span>5 - Catastrophic</span>
                    </div>
                  </div>
                  <div className="text-center text-xs font-medium text-muted-foreground mb-2">Impact →</div>
                  {[5, 4, 3, 2, 1].map((prob) => (
                    <div key={prob} className="flex items-stretch gap-1 mb-1">
                      <div className="w-20 flex items-center justify-end pr-2 text-xs font-medium text-muted-foreground">
                        P={prob}
                      </div>
                      <div className="flex-1 grid grid-cols-5 gap-1">
                        {[1, 2, 3, 4, 5].map((impact) => {
                          const cell = matrix[`${prob}-${impact}`];
                          const count = cell?.count || 0;
                          return (
                            <TooltipProvider key={`${prob}-${impact}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={`${getCellColor(prob, impact)} rounded-md flex items-center justify-center min-h-[48px] cursor-default transition-transform hover:scale-105`}
                                    data-testid={`matrix-cell-${prob}-${impact}`}
                                  >
                                    <span className="text-white font-bold text-sm">
                                      {count > 0 ? count : ""}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                {count > 0 && (
                                  <TooltipContent className="max-w-xs">
                                    <p className="font-medium mb-1">Score: {prob * impact} ({count} risk{count > 1 ? "s" : ""})</p>
                                    <ul className="text-xs space-y-0.5">
                                      {cell?.risks.map((r) => (
                                        <li key={r.id}>• {r.title} ({formatCategory(r.category)})</li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span className="font-medium">Legend:</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-300 dark:bg-green-700" /> Low (1-4)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 dark:bg-green-600" /> Medium (5-9)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500 dark:bg-yellow-600" /> High (10-14)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 dark:bg-orange-600" /> Very High (15-19)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600 dark:bg-red-700" /> Critical (20-25)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <RiskFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        risk={editingRisk}
        users={users}
        onSubmit={(data) => {
          if (editingRisk) {
            updateMutation.mutate({ id: editingRisk.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      {showAiSuggestions && aiSuggestMutation.data && (
        <AiSuggestionsDialog
          open={showAiSuggestions}
          onOpenChange={setShowAiSuggestions}
          suggestions={aiSuggestMutation.data as AiSuggestedRisk[]}
          onAdd={handleAddSuggestion}
          addPending={createMutation.isPending}
        />
      )}
    </div>
  );
}

function RiskFormDialog({
  open,
  onOpenChange,
  risk,
  users,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  risk: ProjectRisk | null;
  users: Array<{ id: string; firstName: string; lastName: string }>;
  onSubmit: (data: RiskFormData) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [probability, setProbability] = useState("3");
  const [impact, setImpact] = useState("3");
  const [status, setStatus] = useState("IDENTIFIED");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [costImpactDollars, setCostImpactDollars] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [linkedCostCode, setLinkedCostCode] = useState("");
  const [linkedMilestone, setLinkedMilestone] = useState("");
  const [autoCreateCO, setAutoCreateCO] = useState(false);

  const resetForm = () => {
    if (risk) {
      setTitle(risk.title);
      setDescription(risk.description || "");
      setCategory(risk.category);
      setProbability(String(risk.probability));
      setImpact(String(risk.impact));
      setStatus(risk.status);
      setMitigationPlan(risk.mitigationPlan || "");
      setOwnerUserId(risk.ownerUserId || "");
      setCostImpactDollars(risk.costImpactDollars ? String(Number(risk.costImpactDollars)) : "");
      setScheduleImpactDays(risk.scheduleImpactDays ? String(risk.scheduleImpactDays) : "");
      setLinkedCostCode(risk.linkedCostCode || "");
      setLinkedMilestone(risk.linkedMilestone || "");
    } else {
      setTitle("");
      setDescription("");
      setCategory("OTHER");
      setProbability("3");
      setImpact("3");
      setStatus("IDENTIFIED");
      setMitigationPlan("");
      setOwnerUserId("");
      setCostImpactDollars("");
      setScheduleImpactDays("");
      setLinkedCostCode("");
      setLinkedMilestone("");
    }
    setAutoCreateCO(false);
  };

  const prevOpenRef = useRef(false);
  const prevRiskIdRef = useRef<string | null>(null);

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    const riskChanged = risk?.id !== prevRiskIdRef.current;
    if (justOpened || (open && riskChanged)) {
      resetForm();
    }
    prevOpenRef.current = open;
    prevRiskIdRef.current = risk?.id ?? null;
  }, [open, risk?.id]);

  const handleOpen = (v: boolean) => {
    onOpenChange(v);
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    const formData: RiskFormData = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      probability: Number(probability),
      impact: Number(impact),
      status,
      mitigationPlan: mitigationPlan.trim() || null,
      ownerUserId: ownerUserId === "none" ? null : (ownerUserId || null),
      costImpactDollars: costImpactDollars ? costImpactDollars : null,
      scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : null,
      linkedCostCode: linkedCostCode.trim() || null,
      linkedMilestone: linkedMilestone.trim() || null,
      autoCreateChangeOrder: status === "OCCURRED" && autoCreateCO ? true : undefined,
    };
    onSubmit(formData);
  };

  const score = Number(probability) * Number(impact);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title-risk-form">{risk ? "Edit Risk" : "Add New Risk"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Risk title" data-testid="input-risk-title" />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the risk..." rows={2} data-testid="input-risk-description" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-risk-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{formatCategory(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-risk-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{formatCategory(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Probability (1-5)</Label>
              <Select value={probability} onValueChange={setProbability}>
                <SelectTrigger data-testid="select-risk-probability"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} - {["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"][v - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Impact (1-5)</Label>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger data-testid="select-risk-impact"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <SelectItem key={v} value={String(v)}>{v} - {["Negligible", "Minor", "Moderate", "Major", "Catastrophic"][v - 1]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Risk Score</Label>
              <div className="flex items-center gap-2 h-9 mt-1">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold text-white ${getCellColor(Number(probability), Number(impact))}`}>
                  {score}
                </span>
              </div>
            </div>
          </div>

          <div>
            <Label>Mitigation Plan</Label>
            <Textarea value={mitigationPlan} onChange={(e) => setMitigationPlan(e.target.value)} placeholder="How will this risk be mitigated?" rows={2} data-testid="input-risk-mitigation" />
          </div>

          <div>
            <Label>Owner</Label>
            <Select value={ownerUserId} onValueChange={setOwnerUserId}>
              <SelectTrigger data-testid="select-risk-owner"><SelectValue placeholder="Select owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Owner</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cost Impact ($)</Label>
              <Input type="number" value={costImpactDollars} onChange={(e) => setCostImpactDollars(e.target.value)} placeholder="0.00" data-testid="input-risk-cost-impact" />
            </div>
            <div>
              <Label>Schedule Impact (days)</Label>
              <Input type="number" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} placeholder="0" data-testid="input-risk-schedule-impact" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Linked Cost Code</Label>
              <Input value={linkedCostCode} onChange={(e) => setLinkedCostCode(e.target.value)} placeholder="e.g., 03-100" data-testid="input-risk-cost-code" />
            </div>
            <div>
              <Label>Linked Milestone</Label>
              <Input value={linkedMilestone} onChange={(e) => setLinkedMilestone(e.target.value)} placeholder="e.g., Foundation Complete" data-testid="input-risk-milestone" />
            </div>
          </div>

          {status === "OCCURRED" && risk && risk.status !== "OCCURRED" && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200">
              <input type="checkbox" checked={autoCreateCO} onChange={(e) => setAutoCreateCO(e.target.checked)} id="autoCreateCO" data-testid="checkbox-auto-create-co" />
              <label htmlFor="autoCreateCO" className="text-sm text-amber-800 dark:text-amber-300 cursor-pointer">
                Auto-create a change order draft for this occurred risk
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-risk">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !title.trim()} data-testid="button-save-risk">
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {risk ? "Update" : "Create"} Risk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiSuggestionsDialog({
  open,
  onOpenChange,
  suggestions,
  onAdd,
  addPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestions: AiSuggestedRisk[];
  onAdd: (s: AiSuggestedRisk) => void;
  addPending: boolean;
}) {
  const [addedIndexes, setAddedIndexes] = useState<Set<number>>(new Set());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI-Suggested Risks
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {suggestions.map((s, idx) => (
            <div
              key={idx}
              className={`p-4 border rounded-lg space-y-2 ${addedIndexes.has(idx) ? "opacity-50" : ""}`}
              data-testid={`card-ai-suggestion-${idx}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={addPending || addedIndexes.has(idx)}
                  onClick={() => { onAdd(s); setAddedIndexes(prev => new Set(prev).add(idx)); }}
                  data-testid={`button-add-suggestion-${idx}`}
                >
                  {addedIndexes.has(idx) ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Plus className="h-4 w-4" />}
                  {addedIndexes.has(idx) ? "Added" : "Add"}
                </Button>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <Badge variant="outline">{formatCategory(s.category)}</Badge>
                <span>P: {s.probability} / I: {s.impact} / Score: {s.probability * s.impact}</span>
                {s.costImpactDollars && <span className="text-amber-600">Cost: ${s.costImpactDollars.toLocaleString()}</span>}
                {s.scheduleImpactDays && <span className="text-blue-600">Delay: {s.scheduleImpactDays}d</span>}
              </div>
              {s.mitigationPlan && (
                <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
                  <strong>Mitigation:</strong> {s.mitigationPlan}
                </p>
              )}
            </div>
          ))}
          {suggestions.length === 0 && (
            <p className="text-center text-muted-foreground py-4">No suggestions generated.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-ai-suggestions">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

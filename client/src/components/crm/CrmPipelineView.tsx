import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  TrendingUp,
  Trophy,
  Target,
  Plus,
  Search,
  ChevronRight,
  Phone,
  Mail,
  Users,
  FileText,
  Calendar,
  MapPin,
  ArrowRight,
  LayoutList,
  Kanban,
  AlertCircle,
  X,
  Clock,
} from "lucide-react";
import { format } from "date-fns";

type PipelineStage = "LEAD" | "QUALIFIED" | "ESTIMATING" | "BID_SUBMITTED" | "NEGOTIATION" | "WON" | "LOST";
type ActivityType = "CALL" | "EMAIL" | "MEETING" | "NOTE" | "FOLLOW_UP" | "SITE_VISIT";

interface Opportunity {
  id: string;
  name: string;
  stage: PipelineStage;
  dealValue: string | null;
  probability: number | null;
  crmOrganisationId: string | null;
  contactId: string | null;
  assignedToId: string | null;
  projectType: string | null;
  projectLocation: string | null;
  expectedCloseDate: string | null;
  source: string | null;
  notes: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  crmOrgName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  assignedFirstName: string | null;
  assignedLastName: string | null;
}

interface Activity {
  id: string;
  activityType: ActivityType;
  description: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdByFirstName: string | null;
  createdByLastName: string | null;
}

interface PipelineStats {
  totalValue: number;
  weightedValue: number;
  wonValue: number;
  winRate: number;
  openDeals: number;
  totalDeals: number;
  stageCounts: Record<string, number>;
  stageValues: Record<string, number>;
}

interface CrmOrg {
  id: string;
  name: string;
}

const STAGES: { key: PipelineStage; label: string; color: string; bgColor: string; probability: number }[] = [
  { key: "LEAD", label: "Lead", color: "text-slate-600", bgColor: "bg-slate-100 dark:bg-slate-800", probability: 10 },
  { key: "QUALIFIED", label: "Qualified", color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900", probability: 25 },
  { key: "ESTIMATING", label: "Estimating", color: "text-violet-600", bgColor: "bg-violet-100 dark:bg-violet-900", probability: 40 },
  { key: "BID_SUBMITTED", label: "Bid Submitted", color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-900", probability: 60 },
  { key: "NEGOTIATION", label: "Negotiation", color: "text-yellow-600", bgColor: "bg-yellow-100 dark:bg-yellow-900", probability: 75 },
  { key: "WON", label: "Won", color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900", probability: 100 },
  { key: "LOST", label: "Lost", color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900", probability: 0 },
];

const ACTIVITY_ICONS: Record<ActivityType, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: FileText,
  FOLLOW_UP: ArrowRight,
  SITE_VISIT: MapPin,
};

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  NOTE: "Note",
  FOLLOW_UP: "Follow-up",
  SITE_VISIT: "Site Visit",
};

function formatCurrency(value: number | string | null | undefined): string {
  if (!value) return "$0";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

function getStageInfo(stage: PipelineStage) {
  return STAGES.find(s => s.key === stage) ?? STAGES[0];
}

const DEFAULT_FORM = {
  name: "",
  stage: "LEAD" as PipelineStage,
  dealValue: "",
  probability: "10",
  crmOrganisationId: "",
  contactId: "",
  assignedToId: "",
  projectType: "",
  projectLocation: "",
  expectedCloseDate: "",
  source: "",
  notes: "",
  lostReason: "",
};

export default function CrmPipelineView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ activityType: "NOTE" as ActivityType, description: "", scheduledAt: "" });
  const [addActivityOpen, setAddActivityOpen] = useState(false);
  const [editStageOpp, setEditStageOpp] = useState<Opportunity | null>(null);
  const [editForm, setEditForm] = useState({ ...DEFAULT_FORM });
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = ["ADMIN", "MANAGER", "ESTIMATOR", "SALES"].includes(user?.role ?? "");
  const canDelete = ["ADMIN", "MANAGER"].includes(user?.role ?? "");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stageFilter !== "all") params.set("stage", stageFilter);
  const queryString = params.toString();

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ["/api/crm/opportunities", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/crm/opportunities${queryString ? `?${queryString}` : ""}`);
      if (!res.ok) throw new Error("Failed to load opportunities");
      return res.json();
    },
  });

  const { data: stats } = useQuery<PipelineStats>({
    queryKey: ["/api/crm/pipeline/stats"],
    queryFn: async () => {
      const res = await fetch("/api/crm/pipeline/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });

  const { data: activities = [], isLoading: activitiesLoading } = useQuery<Activity[]>({
    queryKey: ["/api/crm/opportunities", selectedOpp?.id, "activities"],
    queryFn: async () => {
      if (!selectedOpp) return [];
      const res = await fetch(`/api/crm/opportunities/${selectedOpp.id}/activities`);
      if (!res.ok) throw new Error("Failed to load activities");
      return res.json();
    },
    enabled: !!selectedOpp,
  });

  const { data: crmOrgs = [] } = useQuery<CrmOrg[]>({
    queryKey: ["/api/crm/organisations"],
    queryFn: async () => {
      const res = await fetch("/api/crm/organisations");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline/stats"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) =>
      apiRequest("POST", "/api/crm/opportunities", {
        ...data,
        dealValue: data.dealValue ? data.dealValue : null,
        probability: data.probability ? parseInt(data.probability) : 10,
        crmOrganisationId: data.crmOrganisationId || null,
        contactId: data.contactId || null,
        assignedToId: data.assignedToId || null,
        expectedCloseDate: data.expectedCloseDate || null,
        lostReason: data.lostReason || null,
      }),
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
      setForm({ ...DEFAULT_FORM });
      toast({ title: "Opportunity created" });
    },
    onError: () => toast({ title: "Failed to create opportunity", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof DEFAULT_FORM> }) =>
      apiRequest("PATCH", `/api/crm/opportunities/${id}`, {
        ...data,
        dealValue: data.dealValue !== undefined ? (data.dealValue || null) : undefined,
        probability: data.probability !== undefined ? (data.probability ? parseInt(data.probability) : 10) : undefined,
        crmOrganisationId: data.crmOrganisationId !== undefined ? (data.crmOrganisationId || null) : undefined,
        expectedCloseDate: data.expectedCloseDate !== undefined ? (data.expectedCloseDate || null) : undefined,
        lostReason: data.lostReason !== undefined ? (data.lostReason || null) : undefined,
      }),
    onSuccess: (_, vars) => {
      invalidateAll();
      if (selectedOpp?.id === vars.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", vars.id, "activities"] });
      }
      toast({ title: "Opportunity updated" });
      setEditOpen(false);
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/opportunities/${id}`),
    onSuccess: () => {
      invalidateAll();
      setDetailOpen(false);
      setSelectedOpp(null);
      toast({ title: "Opportunity deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const addActivityMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof activityForm }) =>
      apiRequest("POST", `/api/crm/opportunities/${id}/activities`, {
        ...data,
        scheduledAt: data.scheduledAt || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", selectedOpp?.id, "activities"] });
      setActivityForm({ activityType: "NOTE", description: "", scheduledAt: "" });
      setAddActivityOpen(false);
      toast({ title: "Activity logged" });
    },
    onError: () => toast({ title: "Failed to log activity", variant: "destructive" }),
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: PipelineStage }) =>
      apiRequest("PATCH", `/api/crm/opportunities/${id}`, { stage }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Stage updated" });
    },
    onError: () => toast({ title: "Failed to update stage", variant: "destructive" }),
  });

  const openDetail = (opp: Opportunity) => {
    setSelectedOpp(opp);
    setDetailOpen(true);
  };

  const openEdit = (opp: Opportunity) => {
    setEditForm({
      name: opp.name,
      stage: opp.stage,
      dealValue: opp.dealValue ?? "",
      probability: String(opp.probability ?? 10),
      crmOrganisationId: opp.crmOrganisationId ?? "",
      contactId: opp.contactId ?? "",
      assignedToId: opp.assignedToId ?? "",
      projectType: opp.projectType ?? "",
      projectLocation: opp.projectLocation ?? "",
      expectedCloseDate: opp.expectedCloseDate ?? "",
      source: opp.source ?? "",
      notes: opp.notes ?? "",
      lostReason: opp.lostReason ?? "",
    });
    setEditOpen(true);
  };

  const oppsByStage = (stage: PipelineStage) =>
    opportunities.filter(o => o.stage === stage);

  const stageTotal = (stage: PipelineStage) =>
    oppsByStage(stage).reduce((sum, o) => sum + (parseFloat(o.dealValue ?? "0") || 0), 0);

  return (
    <div className="flex flex-col gap-6" data-testid="crm-pipeline-view">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="stat-total-pipeline">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900">
                <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats ? formatCurrency(stats.totalValue) : <Skeleton className="h-6 w-16" />}</p>
                <p className="text-xs text-muted-foreground">Total Pipeline</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-weighted-value">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-violet-100 dark:bg-violet-900">
                <TrendingUp className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats ? formatCurrency(stats.weightedValue) : <Skeleton className="h-6 w-16" />}</p>
                <p className="text-xs text-muted-foreground">Weighted Value</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-win-rate">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                <Trophy className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats ? `${stats.winRate}%` : <Skeleton className="h-6 w-12" />}</p>
                <p className="text-xs text-muted-foreground">Win Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-open-deals">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                <Target className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats ? stats.openDeals : <Skeleton className="h-6 w-8" />}</p>
                <p className="text-xs text-muted-foreground">Open Deals</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search opportunities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-pipeline-search"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-stage-filter">
              <SelectValue placeholder="All Stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {STAGES.map(s => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "kanban" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("kanban")}
            data-testid="button-view-kanban"
          >
            <Kanban className="w-4 h-4 mr-1.5" />
            Board
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("list")}
            data-testid="button-view-list"
          >
            <LayoutList className="w-4 h-4 mr-1.5" />
            List
          </Button>
          {canEdit && (
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-opportunity">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Opportunity
            </Button>
          )}
        </div>
      </div>

      {/* Kanban Board */}
      {viewMode === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map(stage => {
            const stageOpps = oppsByStage(stage.key);
            const total = stageTotal(stage.key);
            return (
              <div
                key={stage.key}
                className="flex-shrink-0 w-[220px] flex flex-col gap-2"
                data-testid={`kanban-col-${stage.key}`}
              >
                <div className={`rounded-lg px-3 py-2 ${stage.bgColor}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${stage.color}`}>{stage.label}</span>
                    <Badge variant="secondary" className="text-xs">{stageOpps.length}</Badge>
                  </div>
                  {total > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(total)}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 min-h-[80px]">
                  {isLoading
                    ? [1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
                    : stageOpps.map(opp => (
                      <Card
                        key={opp.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => openDetail(opp)}
                        data-testid={`card-opp-${opp.id}`}
                      >
                        <CardContent className="p-3 flex flex-col gap-1.5">
                          <p className="text-sm font-medium leading-tight line-clamp-2">{opp.name}</p>
                          {opp.crmOrgName && (
                            <p className="text-xs text-muted-foreground truncate">{opp.crmOrgName}</p>
                          )}
                          {opp.dealValue && (
                            <p className="text-sm font-semibold text-primary">{formatCurrency(opp.dealValue)}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="text-xs">
                              {opp.probability ?? 10}%
                            </Badge>
                            {opp.expectedCloseDate && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(opp.expectedCloseDate), "MMM d")}
                              </span>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {STAGES.filter(s => s.key !== opp.stage).slice(0, 2).map(s => (
                                <button
                                  key={s.key}
                                  className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                                  onClick={e => {
                                    e.stopPropagation();
                                    stageMutation.mutate({ id: opp.id, stage: s.key });
                                  }}
                                  data-testid={`button-move-${opp.id}-${s.key}`}
                                >
                                  → {s.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : opportunities.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No opportunities found</p>
                {canEdit && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add your first opportunity
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <div className="col-span-4">Opportunity</div>
                  <div className="col-span-2">Stage</div>
                  <div className="col-span-2">Value</div>
                  <div className="col-span-2">Prob.</div>
                  <div className="col-span-2">Close Date</div>
                </div>
                {opportunities.map(opp => {
                  const si = getStageInfo(opp.stage);
                  return (
                    <div
                      key={opp.id}
                      className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-muted/30 cursor-pointer items-center"
                      onClick={() => openDetail(opp)}
                      data-testid={`row-opp-${opp.id}`}
                    >
                      <div className="col-span-4">
                        <p className="font-medium text-sm truncate">{opp.name}</p>
                        {opp.crmOrgName && <p className="text-xs text-muted-foreground truncate">{opp.crmOrgName}</p>}
                      </div>
                      <div className="col-span-2">
                        <Badge className={`${si.bgColor} ${si.color} border-0 text-xs`}>{si.label}</Badge>
                      </div>
                      <div className="col-span-2 text-sm font-medium">{formatCurrency(opp.dealValue)}</div>
                      <div className="col-span-2 text-sm">{opp.probability ?? 10}%</div>
                      <div className="col-span-2 text-xs text-muted-foreground">
                        {opp.expectedCloseDate ? format(new Date(opp.expectedCloseDate), "MMM d, yyyy") : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Opportunity Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-add-opportunity">
          <DialogHeader>
            <DialogTitle>Add Opportunity</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Opportunity Name *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Downtown Office Renovation"
                data-testid="input-opp-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stage</Label>
                <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v as PipelineStage, probability: String(STAGES.find(s => s.key === v)?.probability ?? 10) }))}>
                  <SelectTrigger data-testid="select-opp-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.probability}
                  onChange={e => setForm(f => ({ ...f, probability: e.target.value }))}
                  data-testid="input-opp-probability"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Deal Value ($)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.dealValue}
                  onChange={e => setForm(f => ({ ...f, dealValue: e.target.value }))}
                  placeholder="0.00"
                  data-testid="input-opp-value"
                />
              </div>
              <div>
                <Label>Expected Close Date</Label>
                <Input
                  type="date"
                  value={form.expectedCloseDate}
                  onChange={e => setForm(f => ({ ...f, expectedCloseDate: e.target.value }))}
                  data-testid="input-opp-close-date"
                />
              </div>
            </div>
            <div>
              <Label>Linked Organization</Label>
              <Select value={form.crmOrganisationId || "__none__"} onValueChange={v => setForm(f => ({ ...f, crmOrganisationId: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-opp-org">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {crmOrgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Project Type</Label>
                <Input
                  value={form.projectType}
                  onChange={e => setForm(f => ({ ...f, projectType: e.target.value }))}
                  placeholder="e.g. Commercial, Residential"
                  data-testid="input-opp-project-type"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={form.projectLocation}
                  onChange={e => setForm(f => ({ ...f, projectLocation: e.target.value }))}
                  placeholder="City, State"
                  data-testid="input-opp-location"
                />
              </div>
            </div>
            <div>
              <Label>Source</Label>
              <Input
                value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                placeholder="e.g. Referral, Website, LinkedIn"
                data-testid="input-opp-source"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-opp-notes"
              />
            </div>
            {(form.stage === "LOST") && (
              <div>
                <Label>Lost Reason</Label>
                <Input
                  value={form.lostReason}
                  onChange={e => setForm(f => ({ ...f, lostReason: e.target.value }))}
                  placeholder="Why was this lost?"
                  data-testid="input-opp-lost-reason"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-submit-add"
            >
              {createMutation.isPending ? "Creating..." : "Create Opportunity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Opportunity Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-opportunity">
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Opportunity Name *</Label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-edit-opp-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stage</Label>
                <Select value={editForm.stage} onValueChange={v => setEditForm(f => ({ ...f, stage: v as PipelineStage }))}>
                  <SelectTrigger data-testid="select-edit-opp-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={editForm.probability}
                  onChange={e => setEditForm(f => ({ ...f, probability: e.target.value }))}
                  data-testid="input-edit-opp-probability"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Deal Value ($)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.dealValue}
                  onChange={e => setEditForm(f => ({ ...f, dealValue: e.target.value }))}
                  data-testid="input-edit-opp-value"
                />
              </div>
              <div>
                <Label>Expected Close Date</Label>
                <Input
                  type="date"
                  value={editForm.expectedCloseDate}
                  onChange={e => setEditForm(f => ({ ...f, expectedCloseDate: e.target.value }))}
                  data-testid="input-edit-opp-close-date"
                />
              </div>
            </div>
            <div>
              <Label>Linked Organization</Label>
              <Select value={editForm.crmOrganisationId || "__none__"} onValueChange={v => setEditForm(f => ({ ...f, crmOrganisationId: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-opp-org">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {crmOrgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Project Type</Label>
                <Input
                  value={editForm.projectType}
                  onChange={e => setEditForm(f => ({ ...f, projectType: e.target.value }))}
                  data-testid="input-edit-opp-project-type"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={editForm.projectLocation}
                  onChange={e => setEditForm(f => ({ ...f, projectLocation: e.target.value }))}
                  data-testid="input-edit-opp-location"
                />
              </div>
            </div>
            <div>
              <Label>Source</Label>
              <Input
                value={editForm.source}
                onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                data-testid="input-edit-opp-source"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-edit-opp-notes"
              />
            </div>
            {editForm.stage === "LOST" && (
              <div>
                <Label>Lost Reason</Label>
                <Input
                  value={editForm.lostReason}
                  onChange={e => setEditForm(f => ({ ...f, lostReason: e.target.value }))}
                  data-testid="input-edit-opp-lost-reason"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit">Cancel</Button>
            <Button
              onClick={() => selectedOpp && updateMutation.mutate({ id: selectedOpp.id, data: editForm })}
              disabled={!editForm.name.trim() || updateMutation.isPending}
              data-testid="button-submit-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-opp-detail">
          <SheetHeader>
            <SheetTitle className="pr-8 leading-tight">{selectedOpp?.name ?? "Opportunity"}</SheetTitle>
          </SheetHeader>
          {selectedOpp && (
            <div className="mt-4 flex flex-col gap-5">
              {/* Stage badge + quick move */}
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const si = getStageInfo(selectedOpp.stage);
                  return <Badge className={`${si.bgColor} ${si.color} border-0`}>{si.label}</Badge>;
                })()}
                {canEdit && STAGES.filter(s => s.key !== selectedOpp.stage).map(s => (
                  <button
                    key={s.key}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
                    onClick={() => {
                      stageMutation.mutate({ id: selectedOpp.id, stage: s.key });
                      setSelectedOpp(prev => prev ? { ...prev, stage: s.key } : null);
                    }}
                    data-testid={`button-detail-move-${s.key}`}
                  >
                    <ChevronRight className="w-3 h-3" /> {s.label}
                  </button>
                ))}
              </div>

              {/* Key fields */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Deal Value</p>
                  <p className="font-semibold text-primary">{formatCurrency(selectedOpp.dealValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Probability</p>
                  <p className="font-semibold">{selectedOpp.probability ?? 10}%</p>
                </div>
                {selectedOpp.crmOrgName && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Organization</p>
                    <p>{selectedOpp.crmOrgName}</p>
                  </div>
                )}
                {selectedOpp.projectType && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Project Type</p>
                    <p>{selectedOpp.projectType}</p>
                  </div>
                )}
                {selectedOpp.projectLocation && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Location</p>
                    <p className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedOpp.projectLocation}</p>
                  </div>
                )}
                {selectedOpp.expectedCloseDate && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Expected Close</p>
                    <p className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(selectedOpp.expectedCloseDate), "MMM d, yyyy")}</p>
                  </div>
                )}
                {selectedOpp.source && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Source</p>
                    <p>{selectedOpp.source}</p>
                  </div>
                )}
                {selectedOpp.assignedFirstName && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Assigned To</p>
                    <p>{selectedOpp.assignedFirstName} {selectedOpp.assignedLastName}</p>
                  </div>
                )}
              </div>

              {selectedOpp.notes && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{selectedOpp.notes}</p>
                </div>
              )}

              {selectedOpp.lostReason && (
                <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3">
                  <p className="text-xs font-medium text-red-700 dark:text-red-300 uppercase tracking-wide mb-1">Lost Reason</p>
                  <p className="text-sm text-red-800 dark:text-red-200">{selectedOpp.lostReason}</p>
                </div>
              )}

              {/* Actions */}
              {canEdit && (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { openEdit(selectedOpp); }}
                    data-testid="button-edit-opp"
                  >
                    Edit Details
                  </Button>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => deleteMutation.mutate(selectedOpp.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-delete-opp"
                    >
                      Delete
                    </Button>
                  )}
                </div>
              )}

              {/* Activity Log */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-sm">Activity Log</p>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setAddActivityOpen(true)} data-testid="button-add-activity">
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Log Activity
                    </Button>
                  )}
                </div>
                {activitiesLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : activities.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No activities yet</p>
                    {canEdit && <p className="text-xs">Log a call, email, or meeting to start tracking</p>}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {activities.map(act => {
                      const Icon = ACTIVITY_ICONS[act.activityType] ?? FileText;
                      return (
                        <div
                          key={act.id}
                          className="flex gap-3 p-3 rounded-md bg-muted/40 text-sm"
                          data-testid={`activity-${act.id}`}
                        >
                          <div className="mt-0.5 shrink-0">
                            <div className="p-1.5 rounded-full bg-background border">
                              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-medium">{ACTIVITY_LABELS[act.activityType]}</span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(act.createdAt), "MMM d, h:mm a")}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-xs leading-snug whitespace-pre-wrap">{act.description}</p>
                            {act.createdByFirstName && (
                              <p className="text-xs text-muted-foreground mt-1">by {act.createdByFirstName} {act.createdByLastName}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Activity Dialog */}
      <Dialog open={addActivityOpen} onOpenChange={setAddActivityOpen}>
        <DialogContent data-testid="dialog-add-activity">
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Activity Type</Label>
              <Select value={activityForm.activityType} onValueChange={v => setActivityForm(f => ({ ...f, activityType: v as ActivityType }))}>
                <SelectTrigger data-testid="select-activity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea
                value={activityForm.description}
                onChange={e => setActivityForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="What happened or was discussed?"
                data-testid="textarea-activity-description"
              />
            </div>
            <div>
              <Label>Scheduled Date (optional)</Label>
              <Input
                type="datetime-local"
                value={activityForm.scheduledAt}
                onChange={e => setActivityForm(f => ({ ...f, scheduledAt: e.target.value }))}
                data-testid="input-activity-scheduled"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddActivityOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedOpp && addActivityMutation.mutate({ id: selectedOpp.id, data: activityForm })}
              disabled={!activityForm.description.trim() || addActivityMutation.isPending}
              data-testid="button-submit-activity"
            >
              {addActivityMutation.isPending ? "Logging..." : "Log Activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

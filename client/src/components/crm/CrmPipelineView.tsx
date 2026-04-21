import { useState, Fragment, useEffect, useRef } from "react";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useGlobalSearchFocus } from "@/hooks/use-global-search-focus";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Folder,
  AlertCircle,
  GitBranch,
  Brain,
  RefreshCw,
  User,
} from "lucide-react";
import { CrmActivityTimeline } from "./CrmActivityTimeline";
import { EnrollSequenceDialog } from "./EnrollSequenceDialog";
import { CrmCustomFieldsForm, type CustomFieldsValue } from "./CrmCustomFieldsForm";
import { useLocation } from "wouter";
import { differenceInDays } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";

type PipelineStage = "LEAD" | "QUALIFIED" | "ESTIMATING" | "BID_SUBMITTED" | "NEGOTIATION" | "WON" | "LOST";
type ActivityType = "CALL" | "EMAIL" | "MEETING" | "NOTE" | "FOLLOW_UP" | "SITE_VISIT";

interface Opportunity {
  id: string;
  name: string;
  stage: PipelineStage;
  dealValue: string | null;
  probability: number | null;
  aiWinProbability: number | null;
  aiWinProbabilityRationale: string | null;
  crmOrganisationId: string | null;
  contactId: string | null;
  assignedToId: string | null;
  projectType: string | null;
  projectLocation: string | null;
  expectedCloseDate: string | null;
  source: string | null;
  notes: string | null;
  lostReason: string | null;
  lostCategory: string | null;
  leadScore: number | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  crmOrgName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  assignedFirstName: string | null;
  assignedLastName: string | null;
  customFields?: Record<string, unknown>;
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

interface CrmOrg { id: string; name: string; }
interface CrmContact { id: string; firstName: string; lastName: string; orgName?: string | null; }
interface OrgUser { id: string; firstName: string; lastName: string; role: string; }

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

function staleness(updatedAt: string): { dot: string; tooltip: string } {
  const days = differenceInDays(new Date(), new Date(updatedAt));
  if (days <= 3) return { dot: "bg-green-500", tooltip: `Active — updated ${days}d ago` };
  if (days <= 14) return { dot: "bg-yellow-500", tooltip: `${days}d since last update` };
  return { dot: "bg-red-500", tooltip: `Stale — ${days}d since last update` };
}

function getStageInfo(stage: PipelineStage) {
  return STAGES.find(s => s.key === stage) ?? STAGES[0];
}

function isStageChange(activity: Activity): boolean {
  return activity.description.startsWith("[Stage Change]") || activity.description.startsWith("[Converted]");
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

type SortField = "name" | "stage" | "dealValue" | "probability" | "expectedCloseDate" | "updatedAt";
type SortDir = "asc" | "desc";

function sortOpportunities(opps: Opportunity[], field: SortField, dir: SortDir): Opportunity[] {
  return [...opps].sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    switch (field) {
      case "name": av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case "stage": av = STAGES.findIndex(s => s.key === a.stage); bv = STAGES.findIndex(s => s.key === b.stage); break;
      case "dealValue": av = parseFloat(a.dealValue ?? "0") || 0; bv = parseFloat(b.dealValue ?? "0") || 0; break;
      case "probability": av = a.probability ?? 0; bv = b.probability ?? 0; break;
      case "expectedCloseDate": av = a.expectedCloseDate ?? ""; bv = b.expectedCloseDate ?? ""; break;
      case "updatedAt": av = a.updatedAt; bv = b.updatedAt; break;
    }
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

function SortableHeader({ label, field, currentField, currentDir, onSort }: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = currentField === field;
  return (
    <button
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground"
      onClick={() => onSort(field)}
      data-testid={`sort-col-${field}`}
    >
      {label}
      {active ? (currentDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

const DEFAULT_CONVERT_FORM = { name: "", clientName: "", startDate: "", targetEndDate: "", location: "" };

export default function CrmPipelineView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const handler = () => setAddOpen(true);
    window.addEventListener("crm:open-create-deal", handler);
    return () => window.removeEventListener("crm:open-create-deal", handler);
  }, []);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [formCustomFields, setFormCustomFields] = useState<CustomFieldsValue>({});
  const [editFormCustomFields, setEditFormCustomFields] = useState<CustomFieldsValue>({});
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ activityType: "NOTE" as ActivityType, description: "", scheduledAt: "" });
  const [addActivityOpen, setAddActivityOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ ...DEFAULT_FORM });
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState({ ...DEFAULT_CONVERT_FORM });
  const [createBidOpen, setCreateBidOpen] = useState(false);
  const [createBidForm, setCreateBidForm] = useState({ name: "", description: "" });
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostForm, setLostForm] = useState({ lostCategory: "PRICE", lostReason: "" });
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Task #736: selected rows for bulk "Reassign owner" action on the list view.
  const [selectedOppIds, setSelectedOppIds] = useState<Set<string>>(new Set());

  const canEdit = ["ADMIN", "MANAGER", "ESTIMATOR"].includes(user?.role ?? "");
  const [, navigate] = useLocation();
  const canDelete = ["ADMIN", "MANAGER"].includes(user?.role ?? "");
  const canManageProjects = ["ADMIN", "MANAGER"].includes(user?.role ?? "");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stageFilter !== "all") params.set("stage", stageFilter);
  if (assignedFilter !== "all") params.set("assignedToId", assignedFilter);
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

  const { data: crmContacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    queryFn: async () => {
      const res = await fetch("/api/crm/contacts");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: orgUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/crm/pipeline/users"],
    queryFn: async () => {
      const res = await fetch("/api/crm/pipeline/users");
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
        dealValue: data.dealValue || null,
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
      setFormCustomFields({});
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
        contactId: data.contactId !== undefined ? (data.contactId || null) : undefined,
        assignedToId: data.assignedToId !== undefined ? (data.assignedToId || null) : undefined,
        expectedCloseDate: data.expectedCloseDate !== undefined ? (data.expectedCloseDate || null) : undefined,
        lostReason: data.lostReason !== undefined ? (data.lostReason || null) : undefined,
      }),
    onSuccess: (_, vars) => {
      invalidateAll();
      if (selectedOpp?.id === vars.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", vars.id, "activities"] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", vars.id] });
        setSelectedOpp(prev => prev ? { ...prev, ...vars.data, stage: (vars.data.stage as PipelineStage) ?? prev.stage } : null);
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
    onSuccess: (_, vars) => {
      invalidateAll();
      if (selectedOpp?.id === vars.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", vars.id, "activities"] });
        setSelectedOpp(prev => prev ? { ...prev, stage: vars.stage } : null);
      }
      toast({ title: "Stage updated" });
    },
    onError: () => toast({ title: "Failed to update stage", variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof DEFAULT_CONVERT_FORM }) =>
      apiRequest("POST", `/api/crm/opportunities/${id}/convert-to-project`, {
        name: data.name || undefined,
        clientName: data.clientName || undefined,
        location: data.location || undefined,
        startDate: data.startDate || undefined,
        targetEndDate: data.targetEndDate || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", selectedOpp?.id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setConvertOpen(false);
      setConvertForm({ ...DEFAULT_CONVERT_FORM });
      toast({ title: "Project created from opportunity" });
    },
    onError: () => toast({ title: "Failed to convert to project", variant: "destructive" }),
  });

  const createBidMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof createBidForm }) =>
      apiRequest("POST", `/api/crm/opportunities/${id}/create-bid`, {
        name: data.name || undefined,
        description: data.description || undefined,
      }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", selectedOpp?.id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      setCreateBidOpen(false);
      setCreateBidForm({ name: "", description: "" });
      toast({ title: "Bid created from opportunity" });
    },
    onError: () => toast({ title: "Failed to create bid", variant: "destructive" }),
  });

  const rescoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/crm/opportunities/${id}/rescore`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Win probability re-scored" });
    },
    onError: () => toast({ title: "Failed to re-score", variant: "destructive" }),
  });

  // Task #736: bulk "Reassign owner" — one POST replaces up to 500 PATCH
  // calls and triggers a single summary notification to the new owner.
  const bulkReassignOwnerMutation = useMutation({
    mutationFn: async ({ opportunityIds, assignedToId }: { opportunityIds: string[]; assignedToId: string | null }) => {
      const res = await apiRequest("POST", "/api/crm/opportunities/bulk-reassign", { opportunityIds, assignedToId });
      return res.json() as Promise<{ updated: number; assignedToId: string | null }>;
    },
    onSuccess: (data, vars) => {
      invalidateAll();
      setSelectedOppIds(new Set());
      const ownerLabel = vars.assignedToId
        ? (() => {
            const u = orgUsers.find((u) => u.id === vars.assignedToId);
            return u ? `${u.firstName} ${u.lastName}`.trim() || "selected owner" : "selected owner";
          })()
        : "Unassigned";
      const n = data?.updated ?? 0;
      toast({ title: `Reassigned ${n} opportunit${n === 1 ? "y" : "ies"} to ${ownerLabel}` });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "";
      toast({ title: "Failed to reassign owner", description: message, variant: "destructive" });
    },
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
    setEditFormCustomFields((opp.customFields as CustomFieldsValue) ?? {});
    setEditOpen(true);
  };

  const openConvert = (opp: Opportunity) => {
    setConvertForm({
      name: opp.name,
      clientName: opp.crmOrgName ?? "",
      startDate: "",
      targetEndDate: "",
      location: opp.projectLocation ?? "",
    });
    setConvertOpen(true);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const oppsByStage = (stage: PipelineStage) => opportunities.filter(o => o.stage === stage);
  const stageTotal = (stage: PipelineStage) => oppsByStage(stage).reduce((sum, o) => sum + (parseFloat(o.dealValue ?? "0") || 0), 0);
  const sortedOpps = sortOpportunities(opportunities, sortField, sortDir);

  const listModeActive = viewMode === "list";
  const { getRowProps: getOppRowProps } = useTableKeyboardNav({
    rowCount: listModeActive ? sortedOpps.length : 0,
    onActivate: (idx) => {
      const opp = sortedOpps[idx];
      if (opp) openDetail(opp);
    },
    enabled: listModeActive,
  });
  useGlobalSearchFocus(searchInputRef, true);
  useRegisterShortcuts("crm-pipeline-list", TABLE_NAV_SHORTCUTS, listModeActive);

  const OppFormFields = ({ formData, onUpdate, isEdit = false, customFields, setCustomFields }: {
    formData: typeof DEFAULT_FORM;
    onUpdate: (patch: Partial<typeof DEFAULT_FORM>) => void;
    isEdit?: boolean;
    customFields: CustomFieldsValue;
    setCustomFields: (v: CustomFieldsValue) => void;
  }) => (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <Label>Opportunity Name *</Label>
        <Input
          value={formData.name}
          onChange={e => onUpdate({ name: e.target.value })}
          placeholder="e.g. Downtown Office Renovation"
          data-testid={`input-${isEdit ? "edit-" : ""}opp-name`}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Stage</Label>
          <Select
            value={formData.stage}
            onValueChange={v => onUpdate({ stage: v as PipelineStage, probability: String(STAGES.find(s => s.key === v)?.probability ?? 10) })}
          >
            <SelectTrigger data-testid={`select-${isEdit ? "edit-" : ""}opp-stage`}>
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
            value={formData.probability}
            onChange={e => onUpdate({ probability: e.target.value })}
            data-testid={`input-${isEdit ? "edit-" : ""}opp-probability`}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Deal Value ($)</Label>
          <Input
            type="number"
            min={0}
            value={formData.dealValue}
            onChange={e => onUpdate({ dealValue: e.target.value })}
            placeholder="0.00"
            data-testid={`input-${isEdit ? "edit-" : ""}opp-value`}
          />
        </div>
        <div>
          <Label>Expected Close Date</Label>
          <Input
            type="date"
            value={formData.expectedCloseDate}
            onChange={e => onUpdate({ expectedCloseDate: e.target.value })}
            data-testid={`input-${isEdit ? "edit-" : ""}opp-close-date`}
          />
        </div>
      </div>
      <div>
        <Label>Linked Organization</Label>
        <Select
          value={formData.crmOrganisationId || "__none__"}
          onValueChange={v => onUpdate({ crmOrganisationId: v === "__none__" ? "" : v })}
        >
          <SelectTrigger data-testid={`select-${isEdit ? "edit-" : ""}opp-org`}>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {crmOrgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Linked Contact</Label>
        <Select
          value={formData.contactId || "__none__"}
          onValueChange={v => onUpdate({ contactId: v === "__none__" ? "" : v })}
        >
          <SelectTrigger data-testid={`select-${isEdit ? "edit-" : ""}opp-contact`}>
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {crmContacts.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.firstName} {c.lastName}{c.orgName ? ` — ${c.orgName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Assigned To</Label>
        <Select
          value={formData.assignedToId || "__none__"}
          onValueChange={v => onUpdate({ assignedToId: v === "__none__" ? "" : v })}
        >
          <SelectTrigger data-testid={`select-${isEdit ? "edit-" : ""}opp-assigned`}>
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Unassigned</SelectItem>
            {orgUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Project Type</Label>
          <Input
            value={formData.projectType}
            onChange={e => onUpdate({ projectType: e.target.value })}
            placeholder="e.g. Commercial, Residential"
            data-testid={`input-${isEdit ? "edit-" : ""}opp-project-type`}
          />
        </div>
        <div>
          <Label>Location</Label>
          <Input
            value={formData.projectLocation}
            onChange={e => onUpdate({ projectLocation: e.target.value })}
            placeholder="City, State"
            data-testid={`input-${isEdit ? "edit-" : ""}opp-location`}
          />
        </div>
      </div>
      <div>
        <Label>Source</Label>
        <Input
          value={formData.source}
          onChange={e => onUpdate({ source: e.target.value })}
          placeholder="e.g. Referral, Website, LinkedIn"
          data-testid={`input-${isEdit ? "edit-" : ""}opp-source`}
        />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={e => onUpdate({ notes: e.target.value })}
          rows={3}
          data-testid={`textarea-${isEdit ? "edit-" : ""}opp-notes`}
        />
      </div>
      {formData.stage === "LOST" && (
        <div>
          <Label>Lost Reason</Label>
          <Input
            value={formData.lostReason}
            onChange={e => onUpdate({ lostReason: e.target.value })}
            placeholder="Why was this lost?"
            data-testid={`input-${isEdit ? "edit-" : ""}opp-lost-reason`}
          />
        </div>
      )}
      <CrmCustomFieldsForm
        entityType="OPPORTUNITY"
        values={customFields}
        onChange={setCustomFields}
        prefix={isEdit ? "edit-" : ""}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="crm-pipeline-view">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <Card data-testid="stat-total-pipeline">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-md bg-blue-100 dark:bg-blue-900">
                <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-base sm:text-xl font-bold truncate">{stats ? formatCurrency(stats.totalValue) : <Skeleton className="h-6 w-16" />}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">Total Pipeline</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-weighted-value">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-md bg-violet-100 dark:bg-violet-900">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="min-w-0">
                <p className="text-base sm:text-xl font-bold truncate">{stats ? formatCurrency(stats.weightedValue) : <Skeleton className="h-6 w-16" />}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">Weighted Value</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-win-rate">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-md bg-green-100 dark:bg-green-900">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="min-w-0">
                <p className="text-base sm:text-xl font-bold truncate">{stats ? `${stats.winRate}%` : <Skeleton className="h-6 w-12" />}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">Win Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-open-deals">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                <Target className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-base sm:text-xl font-bold truncate">{stats ? stats.openDeals : <Skeleton className="h-6 w-8" />}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">Open Deals</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px] sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search opportunities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-pipeline-search"
            />
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="flex-1 min-w-[120px] sm:flex-none sm:w-[150px] min-h-[44px] sm:min-h-0" data-testid="select-stage-filter">
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="flex-1 min-w-[120px] sm:flex-none sm:w-[160px] min-h-[44px] sm:min-h-0" data-testid="select-assigned-filter">
                <SelectValue placeholder="All Assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {orgUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={viewMode === "kanban" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("kanban")}
            className="min-h-[44px] sm:min-h-0"
            data-testid="button-view-kanban"
          >
            <Kanban className="w-4 h-4 mr-1.5" />
            Board
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="min-h-[44px] sm:min-h-0"
            data-testid="button-view-list"
          >
            <LayoutList className="w-4 h-4 mr-1.5" />
            List
          </Button>
          {canEdit && (
            <Button onClick={() => setAddOpen(true)} className="min-h-[44px] sm:min-h-0 ml-auto" data-testid="button-add-opportunity">
              <Plus className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Add Opportunity</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
        </div>
      </div>

      {/* Kanban Board */}
      {viewMode === "kanban" && (
        <div className="flex flex-col sm:flex-row gap-3 sm:overflow-x-auto pb-4">
          {STAGES.map(stage => {
            const stageOpps = oppsByStage(stage.key);
            const total = stageTotal(stage.key);
            return (
              <div
                key={stage.key}
                className="w-full sm:flex-shrink-0 sm:w-[220px] flex flex-col gap-2"
                data-testid={`kanban-col-${stage.key}`}
              >
                <div className={`rounded-lg px-3 py-2 ${stage.bgColor}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${stage.color}`}>{stage.label}</span>
                    <Badge variant="secondary" className="text-xs">{stageOpps.length}</Badge>
                  </div>
                  {total > 0 && <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(total)}</p>}
                </div>
                <div className="flex flex-col gap-2 min-h-[80px]">
                  {isLoading
                    ? [1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
                    : stageOpps.map(opp => {
                      const stale = staleness(opp.updatedAt);
                      const initials = `${opp.assignedFirstName?.[0] ?? ""}${opp.assignedLastName?.[0] ?? ""}`.toUpperCase();
                      const closeIn = opp.expectedCloseDate ? differenceInDays(new Date(opp.expectedCloseDate), new Date()) : null;
                      return (
                      <Card
                        key={opp.id}
                        className="cursor-pointer hover-elevate active-elevate-2 group relative overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={() => navigate(`/crm/deals/${opp.id}`)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/crm/deals/${opp.id}`); } }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open deal ${opp.name}`}
                        data-testid={`card-opp-${opp.id}`}
                      >
                        {/* Stale indicator stripe on left edge */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${stale.dot}`} title={stale.tooltip} />
                        <CardContent className="p-3 pl-3.5 flex flex-col gap-1.5">
                          {/* Top row: name + staleness dot */}
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">{opp.name}</p>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${stale.dot}`} data-testid={`stale-dot-${opp.id}`} />
                                </TooltipTrigger>
                                <TooltipContent side="top"><p className="text-xs">{stale.tooltip}</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>

                          {opp.crmOrgName && (
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <Users className="w-3 h-3" />{opp.crmOrgName}
                            </p>
                          )}

                          {opp.dealValue && (
                            <p className="text-base font-semibold text-primary leading-tight" data-testid={`text-value-${opp.id}`}>
                              {formatCurrency(opp.dealValue)}
                            </p>
                          )}

                          {/* Badges row */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {opp.aiWinProbability != null ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] h-5 gap-0.5 px-1.5 ${
                                        opp.aiWinProbability >= 60
                                          ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                                          : opp.aiWinProbability >= 30
                                            ? "border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400"
                                            : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                                      }`}
                                      data-testid={`badge-ai-prob-${opp.id}`}
                                    >
                                      <Brain className="w-2.5 h-2.5" />{opp.aiWinProbability}%
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[220px]">
                                    <p className="text-xs">{opp.aiWinProbabilityRationale || "AI-scored win probability"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5">{opp.probability ?? 10}%</Badge>
                            )}
                            {opp.leadScore != null && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] h-5 gap-0.5 px-1.5 ${
                                  opp.leadScore >= 70 ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400" :
                                  opp.leadScore >= 40 ? "border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400" :
                                  "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400"
                                }`}
                                data-testid={`badge-score-${opp.id}`}
                              >
                                <Target className="w-2.5 h-2.5" />{opp.leadScore}
                              </Badge>
                            )}
                          </div>

                          {/* Bottom row: avatar + close date */}
                          <div className="flex items-center justify-between mt-1 gap-2">
                            {(opp.assignedFirstName || opp.assignedLastName) ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0" data-testid={`avatar-assigned-${opp.id}`}>
                                      <span className="text-[10px] font-semibold text-primary uppercase leading-none">{initials || "?"}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p className="text-xs">{opp.assignedFirstName} {opp.assignedLastName}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <div className="w-6 h-6 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center shrink-0">
                                <User className="w-3 h-3 text-muted-foreground" />
                              </div>
                            )}
                            {opp.expectedCloseDate && (
                              <span className={`text-[10px] flex items-center gap-1 ${
                                closeIn != null && closeIn < 0 ? "text-red-600 dark:text-red-400 font-medium" :
                                closeIn != null && closeIn < 7 ? "text-orange-600 dark:text-orange-400" :
                                "text-muted-foreground"
                              }`}>
                                <Calendar className="w-2.5 h-2.5" />
                                {format(new Date(opp.expectedCloseDate), "MMM d")}
                                {closeIn != null && closeIn < 0 && " (late)"}
                              </span>
                            )}
                          </div>

                          {canEdit && (
                            <div className="flex gap-1 mt-1 flex-wrap opacity-0 group-hover:opacity-100 transition-opacity">
                              {STAGES.filter(s => s.key !== opp.stage).slice(0, 2).map(s => (
                                <button
                                  key={s.key}
                                  className="text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                                  onClick={e => { e.stopPropagation(); stageMutation.mutate({ id: opp.id, stage: s.key }); }}
                                  data-testid={`button-move-${opp.id}-${s.key}`}
                                >
                                  → {s.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <Card>
          {/* Task #736: bulk actions surface above the list when rows selected */}
          {canEdit && selectedOppIds.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3"
              data-testid="bulk-opportunity-actions"
            >
              <Badge variant="default" className="text-xs">{selectedOppIds.size} selected</Badge>
              <Select
                value=""
                onValueChange={(value) => {
                  if (!value) return;
                  const ids = Array.from(selectedOppIds);
                  const assignedToId = value === "__unassigned__" ? null : value;
                  bulkReassignOwnerMutation.mutate({ opportunityIds: ids, assignedToId });
                }}
                disabled={bulkReassignOwnerMutation.isPending}
              >
                <SelectTrigger
                  className="h-8 w-[220px]"
                  data-testid="select-bulk-reassign-opp-owner"
                >
                  <SelectValue placeholder={bulkReassignOwnerMutation.isPending ? "Reassigning..." : "Reassign owner..."} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__" data-testid="option-reassign-opp-unassigned">Unassigned</SelectItem>
                  {user?.id && orgUsers.some((u) => u.id === user.id) && (
                    <SelectItem value={user.id} data-testid="option-reassign-opp-mine">
                      Me ({(() => {
                        const me = orgUsers.find((u) => u.id === user.id);
                        return me ? `${me.firstName} ${me.lastName}`.trim() : "current user";
                      })()})
                    </SelectItem>
                  )}
                  {orgUsers
                    .filter((u) => u.id !== user?.id)
                    .map((u) => (
                      <SelectItem
                        key={u.id}
                        value={u.id}
                        data-testid={`option-reassign-opp-${u.id}`}
                      >
                        {`${u.firstName} ${u.lastName}`.trim() || u.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedOppIds(new Set())}
                data-testid="button-clear-opp-selection"
              >
                Clear
              </Button>
            </div>
          )}
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
                <div className={`hidden sm:grid ${canEdit ? "grid-cols-[32px_repeat(12,minmax(0,1fr))]" : "grid-cols-12"} gap-2 px-4 py-2 items-center`}>
                  {canEdit && (() => {
                    const visibleSelected = sortedOpps.filter((o) => selectedOppIds.has(o.id)).length;
                    const allSelected = sortedOpps.length > 0 && visibleSelected === sortedOpps.length;
                    const someSelected = visibleSelected > 0 && !allSelected;
                    const checkedValue: boolean | "indeterminate" = allSelected
                      ? true
                      : someSelected
                        ? "indeterminate"
                        : false;
                    return (
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={checkedValue}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedOppIds(new Set(sortedOpps.map((o) => o.id)));
                            } else {
                              setSelectedOppIds(new Set());
                            }
                          }}
                          aria-label="Select all opportunities"
                          data-testid="checkbox-select-all-opportunities"
                        />
                      </div>
                    );
                  })()}
                  <div className="col-span-4">
                    <SortableHeader label="Opportunity" field="name" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                  </div>
                  <div className="col-span-2">
                    <SortableHeader label="Stage" field="stage" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                  </div>
                  <div className="col-span-2">
                    <SortableHeader label="Value" field="dealValue" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                  </div>
                  <div className="col-span-2">
                    <SortableHeader label="Prob." field="probability" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                  </div>
                  <div className="col-span-2">
                    <SortableHeader label="Close Date" field="expectedCloseDate" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                  </div>
                </div>
                {sortedOpps.map((opp, oppIdx) => {
                  const si = getStageInfo(opp.stage);
                  return (
                    <div
                      key={opp.id}
                      className={`hidden sm:grid ${canEdit ? "grid-cols-[32px_repeat(12,minmax(0,1fr))]" : "grid-cols-12"} gap-2 px-4 py-3 hover:bg-muted/30 cursor-pointer items-center data-[focused=true]:bg-muted/60 data-[focused=true]:shadow-[inset_2px_0_0_0_hsl(var(--primary))]`}
                      onClick={() => openDetail(opp)}
                      data-testid={`row-opp-${opp.id}`}
                      {...getOppRowProps(oppIdx)}
                    >
                      {canEdit && (
                        <div
                          className="flex items-center justify-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedOppIds.has(opp.id)}
                            onCheckedChange={(checked) => {
                              setSelectedOppIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(opp.id);
                                else next.delete(opp.id);
                                return next;
                              });
                            }}
                            aria-label={`Select ${opp.name}`}
                            data-testid={`checkbox-select-opp-${opp.id}`}
                          />
                        </div>
                      )}
                      <div className="col-span-4">
                        <p className="font-medium text-sm truncate">{opp.name}</p>
                        {opp.crmOrgName && <p className="text-xs text-muted-foreground truncate">{opp.crmOrgName}</p>}
                      </div>
                      <div className="col-span-2">
                        <Badge className={`${si.bgColor} ${si.color} border-0 text-xs`}>{si.label}</Badge>
                      </div>
                      <div className="col-span-2 text-sm font-medium">{formatCurrency(opp.dealValue)}</div>
                      <div className="col-span-2 text-sm">
                        {opp.aiWinProbability != null ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 cursor-default">
                                  <Brain className="w-3 h-3 text-primary" />
                                  {opp.aiWinProbability}%
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[220px]">
                                <p className="text-xs">{opp.aiWinProbabilityRationale || "AI-scored"}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span>{opp.probability ?? 10}%</span>
                        )}
                      </div>
                      <div className="col-span-2 text-xs text-muted-foreground">
                        {opp.expectedCloseDate ? format(new Date(opp.expectedCloseDate), "MMM d, yyyy") : "—"}
                      </div>
                    </div>
                  );
                })}
                {sortedOpps.map(opp => {
                  const si = getStageInfo(opp.stage);
                  return (
                    <div
                      key={opp.id}
                      className="sm:hidden p-4 hover:bg-muted/30 cursor-pointer active:bg-muted/50 min-h-[44px]"
                      onClick={() => openDetail(opp)}
                      data-testid={`row-opp-mobile-${opp.id}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">{opp.name}</p>
                          {opp.crmOrgName && <p className="text-xs text-muted-foreground">{opp.crmOrgName}</p>}
                        </div>
                        <Badge className={`${si.bgColor} ${si.color} border-0 text-xs shrink-0`}>{si.label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-medium">{formatCurrency(opp.dealValue)}</span>
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          {opp.aiWinProbability != null && <Brain className="w-3 h-3" />}
                          {opp.aiWinProbability ?? opp.probability ?? 10}%
                        </span>
                        {opp.expectedCloseDate && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            {format(new Date(opp.expectedCloseDate), "MMM d, yyyy")}
                          </span>
                        )}
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
        <DialogContent className="sm:max-w-lg" data-testid="dialog-add-opportunity">
          <DialogHeader>
            <DialogTitle>Add Opportunity</DialogTitle>
            <DialogDescription>Create a new sales opportunity in the pipeline.</DialogDescription>
          </DialogHeader>
          <OppFormFields
            formData={form}
            onUpdate={patch => setForm(f => ({ ...f, ...patch }))}
            customFields={formCustomFields}
            setCustomFields={setFormCustomFields}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-add">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ ...form, customFields: formCustomFields })}
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
        <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-opportunity">
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
            <DialogDescription>Update the details of this opportunity.</DialogDescription>
          </DialogHeader>
          <OppFormFields
            formData={editForm}
            onUpdate={patch => setEditForm(f => ({ ...f, ...patch }))}
            isEdit
            customFields={editFormCustomFields}
            setCustomFields={setEditFormCustomFields}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit">Cancel</Button>
            <Button
              onClick={() => selectedOpp && updateMutation.mutate({ id: selectedOpp.id, data: { ...editForm, customFields: editFormCustomFields } })}
              disabled={!editForm.name.trim() || updateMutation.isPending}
              data-testid="button-submit-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Bid Dialog */}
      <Dialog open={createBidOpen} onOpenChange={setCreateBidOpen}>
        <DialogContent data-testid="dialog-create-bid">
          <DialogHeader>
            <DialogTitle>Create Bid</DialogTitle>
            <DialogDescription>Create a new bid from this opportunity. The opportunity stage will be updated to Estimating if applicable.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Bid Name *</Label>
              <Input
                value={createBidForm.name}
                onChange={e => setCreateBidForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-create-bid-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={createBidForm.description}
                onChange={e => setCreateBidForm(f => ({ ...f, description: e.target.value }))}
                data-testid="input-create-bid-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBidOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedOpp && createBidMutation.mutate({ id: selectedOpp.id, data: createBidForm })}
              disabled={!createBidForm.name.trim() || createBidMutation.isPending}
              data-testid="button-submit-create-bid"
            >
              {createBidMutation.isPending ? "Creating Bid..." : "Create Bid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Project Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent data-testid="dialog-convert-project">
          <DialogHeader>
            <DialogTitle>Convert to Project</DialogTitle>
            <DialogDescription>Create a new project from this WON opportunity.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Project Name *</Label>
              <Input
                value={convertForm.name}
                onChange={e => setConvertForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-convert-name"
              />
            </div>
            <div>
              <Label>Client Name *</Label>
              <Input
                value={convertForm.clientName}
                onChange={e => setConvertForm(f => ({ ...f, clientName: e.target.value }))}
                placeholder="Client or company name"
                data-testid="input-convert-client-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={convertForm.startDate} onChange={e => setConvertForm(f => ({ ...f, startDate: e.target.value }))} data-testid="input-convert-start" />
              </div>
              <div>
                <Label>Target End Date</Label>
                <Input type="date" value={convertForm.targetEndDate} onChange={e => setConvertForm(f => ({ ...f, targetEndDate: e.target.value }))} data-testid="input-convert-end" />
              </div>
            </div>
            <div>
              <Label>Location</Label>
              <Input value={convertForm.location} onChange={e => setConvertForm(f => ({ ...f, location: e.target.value }))} data-testid="input-convert-location" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedOpp && convertMutation.mutate({ id: selectedOpp.id, data: convertForm })}
              disabled={!convertForm.name.trim() || convertMutation.isPending}
              data-testid="button-submit-convert"
            >
              {convertMutation.isPending ? "Creating Project..." : "Create Project"}
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
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const si = getStageInfo(selectedOpp.stage);
                    return <Badge className={`${si.bgColor} ${si.color} border-0`}>{si.label}</Badge>;
                  })()}
                  {selectedOpp.leadScore != null && (
                    <Badge
                      variant="outline"
                      className={
                        selectedOpp.leadScore >= 70 ? "border-green-500 text-green-700 dark:text-green-400" :
                        selectedOpp.leadScore >= 40 ? "border-yellow-500 text-yellow-700 dark:text-yellow-400" :
                        "border-slate-400 text-slate-600 dark:text-slate-400"
                      }
                      data-testid="badge-lead-score"
                    >
                      <Target className="w-3 h-3 mr-1" /> Score {selectedOpp.leadScore}
                    </Badge>
                  )}
                  {selectedOpp.lostCategory && (
                    <Badge variant="destructive" className="text-xs" data-testid="badge-lost-category">{selectedOpp.lostCategory}</Badge>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">Move to:</span>
                    {STAGES.filter(s => s.key !== selectedOpp.stage).map(s => (
                      <button
                        key={s.key}
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5 border rounded px-1.5 py-0.5 hover:border-primary transition-colors"
                        onClick={() => {
                          if (s.key === "LOST") { setLostDialogOpen(true); return; }
                          stageMutation.mutate({ id: selectedOpp.id, stage: s.key });
                        }}
                        disabled={stageMutation.isPending}
                        data-testid={`button-detail-move-${s.key}`}
                      >
                        <ChevronRight className="w-3 h-3" /> {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedOpp.aiWinProbability != null && (
                <div className={`rounded-md p-3 border ${
                  selectedOpp.aiWinProbability >= 60
                    ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                    : selectedOpp.aiWinProbability >= 30
                      ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800"
                      : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Brain className="w-4 h-4 text-primary" />
                      <span className="text-xs font-medium uppercase tracking-wide">AI Win Probability</span>
                    </div>
                    <span className="text-lg font-bold" data-testid="text-ai-win-prob">{selectedOpp.aiWinProbability}%</span>
                  </div>
                  {selectedOpp.aiWinProbabilityRationale && (
                    <p className="text-xs text-muted-foreground" data-testid="text-ai-rationale">{selectedOpp.aiWinProbabilityRationale}</p>
                  )}
                </div>
              )}

              {/* Key fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
                {(selectedOpp.contactFirstName || selectedOpp.contactLastName) && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Contact</p>
                    <p>{selectedOpp.contactFirstName} {selectedOpp.contactLastName}</p>
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
                {(selectedOpp.assignedFirstName || selectedOpp.assignedLastName) && (
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
              <div className="flex gap-2 flex-wrap">
                {canEdit && selectedOpp.stage !== "WON" && selectedOpp.stage !== "LOST" && (
                  <EnrollSequenceDialog opportunityId={selectedOpp.id} />
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rescoreMutation.mutate(selectedOpp.id)}
                    disabled={rescoreMutation.isPending}
                    data-testid="button-rescore-opp"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${rescoreMutation.isPending ? "animate-spin" : ""}`} />
                    {rescoreMutation.isPending ? "Scoring..." : "Re-score"}
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => openEdit(selectedOpp)} data-testid="button-edit-opp">
                    Edit Details
                  </Button>
                )}
                {canEdit && selectedOpp.stage !== "LOST" && selectedOpp.stage !== "WON" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-blue-600 text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                    onClick={() => {
                      setCreateBidForm({ name: selectedOpp.name, description: "" });
                      setCreateBidOpen(true);
                    }}
                    data-testid="button-create-bid-from-opp"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                    Create Bid
                  </Button>
                )}
                {canManageProjects && selectedOpp.stage === "WON" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-600 text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={() => openConvert(selectedOpp)}
                    data-testid="button-convert-to-project"
                  >
                    <Folder className="w-3.5 h-3.5 mr-1.5" />
                    Convert to Project
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => deleteMutation.mutate(selectedOpp.id)}
                    disabled={deleteMutation.isPending}
                    data-testid="button-delete-opp"
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </Button>
                )}
              </div>

              {/* Unified Timeline (activities + tasks + quotes) */}
              <div>
                <p className="font-semibold text-sm mb-3">Timeline</p>
                <CrmActivityTimeline opportunityId={selectedOpp.id} />
              </div>

              {/* Activity Log */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-sm">Activity & Stage History</p>
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
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {activities.map(act => {
                      const isHistory = isStageChange(act);
                      const isConverted = act.description.startsWith("[Converted]");
                      const Icon = isHistory
                        ? (isConverted ? Folder : GitBranch)
                        : (ACTIVITY_ICONS[act.activityType] ?? FileText);
                      const displayDesc = isHistory
                        ? act.description.replace(/^\[(Stage Change|Converted)\]\s*/, "")
                        : act.description;

                      return (
                        <div
                          key={act.id}
                          className={`flex gap-3 p-3 rounded-md text-sm ${isHistory ? "bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-800" : "bg-muted/40"}`}
                          data-testid={`activity-${act.id}`}
                        >
                          <div className="mt-0.5 shrink-0">
                            <div className={`p-1.5 rounded-full border ${isHistory ? "bg-blue-100 dark:bg-blue-900 border-blue-200 dark:border-blue-700" : "bg-background"}`}>
                              <Icon className={`w-3.5 h-3.5 ${isHistory ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-medium text-xs">
                                {isHistory
                                  ? (isConverted ? "Converted to Project" : "Stage Change")
                                  : ACTIVITY_LABELS[act.activityType]}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(act.createdAt), "MMM d, h:mm a")}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-xs leading-snug whitespace-pre-wrap">{displayDesc}</p>
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

      {/* Lost Capture Dialog */}
      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent data-testid="dialog-mark-lost">
          <DialogHeader>
            <DialogTitle>Mark as Lost</DialogTitle>
            <DialogDescription>Capture why this deal was lost so you can analyze trends.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>Lost Category *</Label>
              <Select value={lostForm.lostCategory} onValueChange={v => setLostForm(f => ({ ...f, lostCategory: v }))}>
                <SelectTrigger data-testid="select-lost-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["PRICE","TIMING","COMPETITOR","SCOPE","RELATIONSHIP","NO_DECISION","OTHER"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason / Notes</Label>
              <Textarea
                value={lostForm.lostReason}
                onChange={e => setLostForm(f => ({ ...f, lostReason: e.target.value }))}
                rows={3}
                placeholder="What happened? (competitor name, price gap, etc.)"
                data-testid="textarea-lost-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostDialogOpen(false)} data-testid="button-lost-cancel">Cancel</Button>
            <Button
              variant="destructive"
              disabled={!selectedOpp || stageMutation.isPending}
              onClick={async () => {
                if (!selectedOpp) return;
                try {
                  await apiRequest("PATCH", `/api/crm/opportunities/${selectedOpp.id}`, {
                    stage: "LOST",
                    lostCategory: lostForm.lostCategory,
                    lostReason: lostForm.lostReason || null,
                  });
                  invalidateAll();
                  queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities", selectedOpp.id, "activities"] });
                  setSelectedOpp(prev => prev ? { ...prev, stage: "LOST" as PipelineStage, lostCategory: lostForm.lostCategory, lostReason: lostForm.lostReason } : null);
                  setLostDialogOpen(false);
                  setLostForm({ lostCategory: "PRICE", lostReason: "" });
                  toast({ title: "Marked as Lost" });
                } catch (e: any) {
                  toast({ title: "Failed to update", description: e?.message, variant: "destructive" });
                }
              }}
              data-testid="button-lost-confirm"
            >Mark as Lost</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Activity Dialog */}
      <Dialog open={addActivityOpen} onOpenChange={setAddActivityOpen}>
        <DialogContent data-testid="dialog-add-activity">
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
            <DialogDescription>Record a call, email, meeting, or note for this opportunity.</DialogDescription>
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

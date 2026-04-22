import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, formatDistanceToNowStrict, isToday, isPast } from "date-fns";
import {
  Briefcase,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  ExternalLink,
  FileText,
  Inbox,
  Search,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import ViewSwitcher, { type ViewType } from "@/components/ViewSwitcher";
import SavedViewsDropdown, { type BuiltInView } from "@/components/SavedViewsDropdown";
import EntityCalendarView, { type CalendarEntityItem } from "@/components/EntityCalendarView";

type MyWorkType = "TASK" | "CRM_TASK" | "PUNCH" | "RFI" | "INSPECTION";
type Bucket = "overdue" | "today" | "thisWeek" | "later" | "none";

interface MyWorkItem {
  id: string;
  type: MyWorkType;
  title: string;
  description: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  dueDate: string | null;
  status: string;
  priority: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  bucket: Bucket;
  sourceUrl: string;
  canEditStatus: boolean;
  canEditPriority: boolean;
  canEditDueDate: boolean;
  canReassign: boolean;
  isCompleted: boolean;
  updatedAt: string | null;
}

interface MyWorkResponse {
  userId: string;
  generatedAt: string;
  items: MyWorkItem[];
  nextCursor: string | null;
  counts: {
    total: number;
    overdue: number;
    today: number;
    thisWeek: number;
    later: number;
    completedThisWeek: number;
    byType: Record<MyWorkType, number>;
  };
}

const TYPE_META: Record<MyWorkType, { label: string; short: string; icon: LucideIcon; badgeClass: string }> = {
  TASK: {
    label: "Project Task",
    short: "TASK",
    icon: CheckSquare,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800",
  },
  CRM_TASK: {
    label: "CRM Task",
    short: "CRM",
    icon: Briefcase,
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-800",
  },
  PUNCH: {
    label: "Punch Item",
    short: "PUNCH",
    icon: ClipboardList,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800",
  },
  RFI: {
    label: "RFI",
    short: "RFI",
    icon: FileText,
    badgeClass: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900 dark:text-violet-200 dark:border-violet-800",
  },
  INSPECTION: {
    label: "Inspection",
    short: "INSP",
    icon: ShieldCheck,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-800",
  },
};

const ALL_SOURCES: MyWorkType[] = ["TASK", "CRM_TASK", "PUNCH", "RFI", "INSPECTION"];
const PRIORITIES = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "NORMAL"];
const STATUS_OPTIONS = ["OPEN", "COMPLETED", "ALL"];
const GROUPING_OPTIONS = ["none", "project", "status", "due-week"] as const;
type Grouping = (typeof GROUPING_OPTIONS)[number];

interface Filters {
  search: string;
  sources: MyWorkType[];
  priority: string;
  status: string;
  projects: string[];
  dueFrom: string | null;
  dueTo: string | null;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  sources: [],
  priority: "ALL",
  status: "OPEN",
  projects: [],
  dueFrom: null,
  dueTo: null,
};

const BUILT_IN_VIEWS: BuiltInView<Filters>[] = [
  { id: "builtin-everything", name: "Everything open", apply: { view: "table", filters: DEFAULT_FILTERS } },
  {
    id: "builtin-overdue",
    name: "Overdue only",
    apply: { view: "table", filters: { ...DEFAULT_FILTERS, dueTo: format(new Date(), "yyyy-MM-dd") } },
  },
  {
    id: "builtin-rfis",
    name: "Open RFIs",
    apply: { view: "table", filters: { ...DEFAULT_FILTERS, sources: ["RFI"] } },
  },
  {
    id: "builtin-board",
    name: "Workload board",
    apply: { view: "kanban", filters: DEFAULT_FILTERS },
  },
  {
    id: "builtin-cal",
    name: "Due dates",
    apply: { view: "calendar", filters: DEFAULT_FILTERS },
  },
];

function dueColor(item: MyWorkItem): string {
  if (!item.dueDate) return "text-muted-foreground";
  const d = new Date(item.dueDate);
  if (isPast(d) && !isToday(d)) return "text-red-600 dark:text-red-400";
  if (isToday(d)) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function dueLabel(item: MyWorkItem): string {
  if (!item.dueDate) return "No due date";
  const d = new Date(item.dueDate);
  if (isToday(d)) return "Due today";
  return `${format(d, "MMM d")} · ${formatDistanceToNowStrict(d, { addSuffix: true })}`;
}

function dueDateForBucket(bucket: Bucket): Date | null {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (bucket) {
    case "none":
      return null;
    case "overdue": {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - 1);
      d.setHours(17, 0, 0, 0);
      return d;
    }
    case "today": {
      const d = new Date(startOfToday);
      d.setHours(17, 0, 0, 0);
      return d;
    }
    case "thisWeek": {
      // End of the current calendar week — upcoming Saturday at 5pm. If today
      // is already Saturday, push out 6 days so it still lands in the
      // "thisWeek" bucket (server defines that as < today + 7 days).
      const d = new Date(startOfToday);
      const dow = d.getDay();
      const targetDow = 6; // Saturday
      let daysAhead = (targetDow - dow + 7) % 7;
      if (daysAhead === 0) daysAhead = 6;
      d.setDate(d.getDate() + daysAhead);
      d.setHours(17, 0, 0, 0);
      return d;
    }
    case "later": {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() + 14);
      d.setHours(17, 0, 0, 0);
      return d;
    }
  }
}

function dispatchUpdate(item: MyWorkItem, body: Record<string, unknown>) {
  switch (item.type) {
    case "TASK":
      return apiRequest("PATCH", `/api/tasks/${item.id}`, body);
    case "CRM_TASK":
      return apiRequest("PATCH", `/api/crm/tasks/${item.id}`, body);
    case "PUNCH":
      if (!item.projectCode) throw new Error("Missing project code");
      return apiRequest("PATCH", `/api/projects/${item.projectCode}/punch-list/${item.id}`, body);
    default:
      throw new Error("Inline edits not supported for this item type");
  }
}

function statusOptionsFor(type: MyWorkType): string[] {
  switch (type) {
    case "TASK":
    case "CRM_TASK":
      return ["PENDING", "IN_PROGRESS", "COMPLETED"];
    case "PUNCH":
      return ["OPEN", "IN_PROGRESS", "RESOLVED"];
    case "RFI":
      return ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ANSWERED", "CLOSED"];
    case "INSPECTION":
      return ["REQUESTED", "SCHEDULED", "PASSED", "FAILED"];
  }
}

function priorityOptionsFor(type: MyWorkType): string[] {
  if (type === "CRM_TASK") return ["LOW", "NORMAL", "HIGH", "CRITICAL"];
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
}

export default function MyWorkPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager =
    user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT" || user?.role === "SUPER_ADMIN";

  const [view, setView] = useState<ViewType>(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem("my-work-view");
    return saved === "kanban" || saved === "calendar" || saved === "table" ? (saved as ViewType) : "table";
  });
  const handleViewChange = (v: ViewType) => {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem("my-work-view", v);
  };

  const [grouping, setGrouping] = useState<Grouping>(() => {
    if (typeof window === "undefined") return "none";
    const saved = window.localStorage.getItem("my-work-grouping");
    return GROUPING_OPTIONS.includes(saved as Grouping) ? (saved as Grouping) : "none";
  });
  const handleGroupingChange = (g: Grouping) => {
    setGrouping(g);
    if (typeof window !== "undefined") window.localStorage.setItem("my-work-grouping", g);
  };

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [teamMode, setTeamMode] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MyWorkItem | null>(null);

  const sourceParam = filters.sources.length > 0 ? filters.sources.join(",") : "";
  const queryKey: readonly unknown[] = useMemo(
    () => [
      "/api/me/work",
      { source: sourceParam, status: filters.status, team: teamMode ? "direct-reports" : "" },
    ],
    [sourceParam, filters.status, teamMode],
  );

  const { data, isLoading } = useQuery<MyWorkResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceParam) params.set("source", sourceParam);
      params.set("status", filters.status);
      if (teamMode) params.set("team", "direct-reports");
      const res = await fetch(`/api/me/work?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load work");
      return res.json();
    },
  });

  // Fetch projects + users for filters / inline edits
  const { data: projectsData } = useQuery<{ data: Array<{ id: string; code: string; name: string }> }, Error, Array<{ id: string; code: string; name: string }>>(
    {
      queryKey: ["/api/projects"],
      select: (r) => r.data || [],
    },
  );
  const { data: usersData = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string }>>(
    { queryKey: ["/api/users"] },
  );

  const updateMutation = useMutation<unknown, Error, { item: MyWorkItem; patch: Record<string, unknown>; silent?: boolean }>({
    mutationFn: async ({ item, patch }) => dispatchUpdate(item, patch),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/work"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      if (!vars.silent) toast({ title: "Updated" });
    },
    onError: (err) => {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Could not update",
        variant: "destructive",
      });
    },
  });

  const bucketLabel = (b: Bucket): string => {
    switch (b) {
      case "overdue": return "Overdue";
      case "today": return "Today";
      case "thisWeek": return "This week";
      case "later": return "Later";
      case "none": return "No due date";
    }
  };

  const handleKanbanMove = async (item: MyWorkItem, bucket: Bucket) => {
    const previousDueDate = item.dueDate;
    const newDueDate = dueDateForBucket(bucket);
    const newDueIso = newDueDate ? newDueDate.toISOString() : null;
    if (previousDueDate === newDueIso) return;
    try {
      await updateMutation.mutateAsync({
        item,
        patch: { dueDate: newDueIso },
        silent: true,
      });
      const dateSuffix = newDueDate ? ` (${format(newDueDate, "MMM d")})` : "";
      const { dismiss } = toast({
        title: `Moved "${item.title}" to ${bucketLabel(bucket)}${dateSuffix}`,
        action: (
          <ToastAction
            altText="Undo move"
            onClick={async () => {
              dismiss();
              try {
                await updateMutation.mutateAsync({
                  item,
                  patch: { dueDate: previousDueDate },
                  silent: true,
                });
                toast({ title: "Move undone" });
              } catch {
                /* error toast already shown by mutation */
              }
            }}
            data-testid={`button-undo-move-${item.id}`}
          >
            Undo
          </ToastAction>
        ),
      });
    } catch {
      /* error toast already shown by mutation */
    }
  };

  // Filtering done client-side for project, search, priority, due-date range.
  const items = useMemo(() => {
    if (!data) return [] as MyWorkItem[];
    return data.items.filter((it) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!it.title.toLowerCase().includes(q) && !(it.description ?? "").toLowerCase().includes(q)) return false;
      }
      if (filters.priority !== "ALL" && (it.priority ?? "").toUpperCase() !== filters.priority) return false;
      if (filters.projects.length > 0 && !(it.projectId && filters.projects.includes(it.projectId))) return false;
      if (filters.dueFrom) {
        if (!it.dueDate) return false;
        if (new Date(it.dueDate) < new Date(filters.dueFrom)) return false;
      }
      if (filters.dueTo) {
        if (!it.dueDate) return false;
        const to = new Date(filters.dueTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(it.dueDate) > to) return false;
      }
      return true;
    });
  }, [data, filters]);

  const counts = data?.counts;

  const groupedRows = useMemo(() => {
    if (grouping === "none") return [{ key: "all", label: "All work", rows: items }];
    const map = new Map<string, MyWorkItem[]>();
    for (const it of items) {
      let key = "—";
      if (grouping === "project") key = it.projectName ? `${it.projectCode ? it.projectCode + " · " : ""}${it.projectName}` : "No project";
      else if (grouping === "status") key = it.status;
      else if (grouping === "due-week") {
        if (!it.dueDate) key = "No due date";
        else {
          const d = new Date(it.dueDate);
          const wk = new Date(d);
          wk.setDate(d.getDate() - d.getDay());
          key = `Week of ${format(wk, "MMM d, yyyy")}`;
        }
      }
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, label: k, rows: v }));
  }, [items, grouping]);

  const kanbanColumns = useMemo(() => {
    const cols: { key: Bucket; label: string }[] = [
      { key: "overdue", label: "Overdue" },
      { key: "today", label: "Due today" },
      { key: "thisWeek", label: "This week" },
      { key: "later", label: "Later" },
      { key: "none", label: "No due date" },
    ];
    return cols.map((c) => ({ ...c, items: items.filter((i) => i.bucket === c.key) }));
  }, [items]);

  const calendarItems: CalendarEntityItem<MyWorkItem>[] = useMemo(
    () =>
      items
        .filter((i) => !!i.dueDate)
        .map((i) => ({
          id: `${i.type}-${i.id}`,
          label: i.title,
          date: new Date(i.dueDate as string),
          colorClass: TYPE_META[i.type].badgeClass,
          data: i,
        })),
    [items],
  );

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4" data-testid="page-my-work-loading">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const toggleSource = (t: MyWorkType) =>
    setFilters((f) => ({
      ...f,
      sources: f.sources.includes(t) ? f.sources.filter((s) => s !== t) : [...f.sources, t],
    }));

  const toggleProject = (id: string) =>
    setFilters((f) => ({
      ...f,
      projects: f.projects.includes(id) ? f.projects.filter((p) => p !== id) : [...f.projects, id],
    }));

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-my-work">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-my-work">
            My Work
          </h1>
          <p className="text-muted-foreground" data-testid="text-my-work-subtitle">
            Everything assigned to you across every project
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && (
            <Button
              variant={teamMode ? "default" : "outline"}
              size="sm"
              onClick={() => setTeamMode((m) => !m)}
              data-testid="button-team-toggle"
            >
              <Users className="w-4 h-4 mr-1.5" />
              {teamMode ? "Team view (on)" : "Team view"}
            </Button>
          )}
          <ViewSwitcher value={view} onChange={handleViewChange} views={["table", "kanban", "calendar"]} testId="my-work-view-switcher" />
          <SavedViewsDropdown
            viewKey="my-work"
            apiBasePath="/api/me/work/views"
            defaultFilters={DEFAULT_FILTERS}
            builtInViews={BUILT_IN_VIEWS}
            current={{ view, filters }}
            onApply={(applied) => {
              handleViewChange(applied.view === "map" ? "table" : applied.view);
              setFilters({ ...DEFAULT_FILTERS, ...(applied.filters as Partial<Filters>) });
            }}
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="kpi-strip">
        <KpiCard label="Overdue" value={counts?.overdue ?? 0} tone="danger" testId="kpi-overdue" />
        <KpiCard label="Due today" value={counts?.today ?? 0} tone="warning" testId="kpi-today" />
        <KpiCard label="Due this week" value={counts?.thisWeek ?? 0} testId="kpi-week" />
        <KpiCard label="Completed this week" value={counts?.completedThisWeek ?? 0} tone="success" testId="kpi-completed" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border rounded-md p-3 bg-card" data-testid="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by title or description"
            className="pl-8"
            data-testid="input-search"
          />
        </div>

        <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
          <SelectTrigger className="w-[130px]" data-testid="select-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "OPEN" ? "Open" : s === "COMPLETED" ? "Completed" : "All"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.priority} onValueChange={(v) => setFilters((f) => ({ ...f, priority: v }))}>
          <SelectTrigger className="w-[130px]" data-testid="select-priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p === "ALL" ? "All priority" : p.charAt(0) + p.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-filter-source">
              Source ({filters.sources.length === 0 ? "all" : filters.sources.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_SOURCES.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={filters.sources.includes(t)}
                onCheckedChange={() => toggleSource(t)}
                data-testid={`filter-source-${t}`}
              >
                {TYPE_META[t].label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-filter-projects">
              Projects ({filters.projects.length === 0 ? "all" : filters.projects.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto w-64">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(projectsData ?? []).map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={filters.projects.includes(p.id)}
                onCheckedChange={() => toggleProject(p.id)}
                data-testid={`filter-project-${p.id}`}
              >
                {p.code} · {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Due</span>
          <DatePicker
            value={filters.dueFrom}
            onChange={(d) => setFilters((f) => ({ ...f, dueFrom: d ? format(d, "yyyy-MM-dd") : null }))}
            placeholder="From"
            buttonClassName="h-8 w-[130px]"
            data-testid="filter-due-from"
          />
          <DatePicker
            value={filters.dueTo}
            onChange={(d) => setFilters((f) => ({ ...f, dueTo: d ? format(d, "yyyy-MM-dd") : null }))}
            placeholder="To"
            buttonClassName="h-8 w-[130px]"
            data-testid="filter-due-to"
          />
        </div>

        <Select value={grouping} onValueChange={(v) => handleGroupingChange(v as Grouping)}>
          <SelectTrigger className="w-[150px]" data-testid="select-grouping">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="project">Group by project</SelectItem>
            <SelectItem value="status">Group by status</SelectItem>
            <SelectItem value="due-week">Group by due week</SelectItem>
          </SelectContent>
        </Select>

        {(filters.search ||
          filters.sources.length > 0 ||
          filters.priority !== "ALL" ||
          filters.projects.length > 0 ||
          filters.dueFrom ||
          filters.dueTo ||
          filters.status !== "OPEN") && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)} data-testid="button-clear-filters">
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Body */}
      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing to do here"
          description="No work matches your filters. Try clearing them or switching the source."
          testId="empty-my-work"
        />
      ) : view === "table" ? (
        <div className="space-y-6">
          {groupedRows.map((g) => (
            <div key={g.key} data-testid={`group-${g.key}`}>
              {grouping !== "none" && (
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g.label}</h2>
                  <Badge variant="secondary">{g.rows.length}</Badge>
                </div>
              )}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Type</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-[200px]">Project</TableHead>
                        <TableHead className="w-[140px]">Status</TableHead>
                        <TableHead className="w-[120px]">Priority</TableHead>
                        <TableHead className="w-[170px]">Due</TableHead>
                        <TableHead className="w-[180px]">Assignee</TableHead>
                        <TableHead className="w-[60px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((it) => (
                        <Row
                          key={`${it.type}-${it.id}`}
                          item={it}
                          users={usersData}
                          onUpdate={(patch) => updateMutation.mutate({ item: it, patch })}
                          updating={updateMutation.isPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      ) : view === "kanban" ? (
        <KanbanBoard
          columns={kanbanColumns}
          onMove={(item, bucket) => {
            void handleKanbanMove(item, bucket);
          }}
        />
      ) : (
        <EntityCalendarView
          items={calendarItems}
          onItemClick={(item) => setSelectedItem(item)}
          legend={ALL_SOURCES.map((t) => ({ label: TYPE_META[t].label, colorClass: TYPE_META[t].badgeClass }))}
          testIdPrefix="my-work-calendar"
        />
      )}

      {selectedItem && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
          data-testid="calendar-detail-modal"
        >
          <Card className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge className={TYPE_META[selectedItem.type].badgeClass}>{TYPE_META[selectedItem.type].short}</Badge>
                <Button variant="ghost" size="icon" onClick={() => setSelectedItem(null)} data-testid="button-close-calendar-detail">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <h3 className="text-lg font-semibold">{selectedItem.title}</h3>
              {selectedItem.projectName && (
                <p className="text-sm text-muted-foreground">
                  {selectedItem.projectCode ? `${selectedItem.projectCode} · ` : ""}
                  {selectedItem.projectName}
                </p>
              )}
              <p className={cn("text-sm", dueColor(selectedItem))}>{dueLabel(selectedItem)}</p>
              <Button asChild data-testid="button-open-calendar-item">
                <Link href={selectedItem.sourceUrl}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning" | "success";
  testId: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={cn("text-3xl font-bold mt-1", toneClass)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Row({
  item,
  users,
  onUpdate,
  updating,
}: {
  item: MyWorkItem;
  users: Array<{ id: string; firstName: string; lastName: string }>;
  onUpdate: (patch: Record<string, unknown>) => void;
  updating: boolean;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const statusOptions = statusOptionsFor(item.type);
  const priorityOptions = priorityOptionsFor(item.type);

  return (
    <TableRow data-testid={`row-${item.type.toLowerCase()}-${item.id}`}>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <Badge className={cn("text-[10px]", meta.badgeClass)} data-testid={`badge-type-${item.id}`}>
            {meta.short}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="max-w-[400px]">
        <Link href={item.sourceUrl} className="font-medium hover:underline" data-testid={`link-title-${item.id}`}>
          {item.title}
        </Link>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.description}</p>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {item.projectName ? (
          <span className="text-muted-foreground" data-testid={`text-project-${item.id}`}>
            {item.projectCode ? `${item.projectCode} · ` : ""}
            {item.projectName}
          </span>
        ) : (
          <span className="text-muted-foreground italic">—</span>
        )}
      </TableCell>
      <TableCell>
        {item.canEditStatus ? (
          <Select
            value={item.status}
            onValueChange={(v) => onUpdate({ status: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-8 text-xs" data-testid={`select-status-${item.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="text-xs" data-testid={`text-status-${item.id}`}>
            {item.status.replace(/_/g, " ")}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {item.canEditPriority ? (
          <Select
            value={item.priority ?? "MEDIUM"}
            onValueChange={(v) => onUpdate({ priority: v })}
            disabled={updating}
          >
            <SelectTrigger className="h-8 text-xs" data-testid={`select-priority-${item.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : item.priority ? (
          <Badge variant="outline" className="text-xs">
            {item.priority}
          </Badge>
        ) : (
          <span className="text-muted-foreground italic text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        {item.canEditDueDate ? (
          <DatePicker
            value={item.dueDate}
            onChange={(d) => onUpdate({ dueDate: d ? d.toISOString() : null })}
            placeholder="Set"
            buttonClassName={cn("h-8 text-xs", dueColor(item))}
            data-testid={`date-due-${item.id}`}
          />
        ) : (
          <span className={cn("text-xs", dueColor(item))} data-testid={`text-due-${item.id}`}>
            {dueLabel(item)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <ColoredAvatarFallback className="text-[10px]" name={item.assignedToName} />
          </Avatar>
          {item.canReassign ? (
            <Select
              value={item.assignedToId ?? ""}
              onValueChange={(v) => onUpdate({ assignedToId: v || null })}
              disabled={updating}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-assignee-${item.id}`}>
                <SelectValue placeholder="Assign" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground" data-testid={`text-assignee-${item.id}`}>
              {item.assignedToName ?? "—"}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link href={item.sourceUrl} data-testid={`link-open-${item.id}`}>
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function KanbanBoard({
  columns,
  onMove,
}: {
  columns: { key: Bucket; label: string; items: MyWorkItem[] }[];
  onMove: (item: MyWorkItem, bucket: Bucket) => void;
}) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Bucket | null>(null);
  const draggedRef = useMemo(() => ({ current: null as MyWorkItem | null }), []);

  const handleDrop = (bucket: Bucket) => {
    const item = draggedRef.current;
    setDragOverCol(null);
    setDraggingKey(null);
    draggedRef.current = null;
    if (!item) return;
    if (item.bucket === bucket) return;
    if (!item.canEditDueDate) return;
    onMove(item, bucket);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="kanban">
      {columns.map((col) => {
        const isOver = dragOverCol === col.key;
        return (
          <div
            key={col.key}
            className={cn(
              "flex flex-col rounded-md border bg-muted/30 p-2 transition-colors",
              isOver && "ring-2 ring-primary bg-muted/60",
            )}
            data-testid={`kanban-col-${col.key}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverCol !== col.key) setDragOverCol(col.key);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverCol((cur) => (cur === col.key ? null : cur));
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(col.key);
            }}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <Badge variant="outline">{col.items.length}</Badge>
            </div>
            <div className="space-y-2 min-h-[100px]">
              {col.items.map((it) => {
                const key = `${it.type}-${it.id}`;
                return (
                  <KanbanCard
                    key={key}
                    item={it}
                    isDragging={draggingKey === key}
                    onDragStart={(e) => {
                      if (!it.canEditDueDate) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.setData("text/plain", key);
                      e.dataTransfer.effectAllowed = "move";
                      draggedRef.current = it;
                      setDraggingKey(key);
                    }}
                    onDragEnd={() => {
                      setDraggingKey(null);
                      setDragOverCol(null);
                      draggedRef.current = null;
                    }}
                  />
                );
              })}
              {col.items.length === 0 && (
                <div className="text-xs text-muted-foreground italic px-1 py-6 text-center">
                  {isOver ? "Drop to reschedule" : "No items"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  item,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  item: MyWorkItem;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const meta = TYPE_META[item.type];
  const draggable = item.canEditDueDate;
  return (
    <Card
      className={cn(
        "hover-elevate",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-50",
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`kanban-card-${item.id}`}
      data-draggable={draggable ? "true" : "false"}
    >
      <Link href={item.sourceUrl}>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Badge className={cn("text-[10px]", meta.badgeClass)}>{meta.short}</Badge>
            {item.priority && (
              <Badge variant="outline" className="text-[10px]">
                {item.priority}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium line-clamp-2">{item.title}</p>
          {item.projectName && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {item.projectCode ? `${item.projectCode} · ` : ""}
              {item.projectName}
            </p>
          )}
          <div className="flex items-center justify-between">
            <p className={cn("text-xs", dueColor(item))}>{dueLabel(item)}</p>
            <Avatar className="h-5 w-5">
              <ColoredAvatarFallback className="text-[8px]" name={item.assignedToName} />
            </Avatar>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

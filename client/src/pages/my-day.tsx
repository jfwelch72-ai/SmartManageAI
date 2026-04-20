import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, formatDistanceToNowStrict, isToday, isPast, startOfDay, endOfDay, addDays } from "date-fns";
import {
  Sun,
  CheckSquare,
  FileText,
  FileSignature,
  ClipboardList,
  ShieldCheck,
  Briefcase,
  ExternalLink,
  CheckCircle2,
  X,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type MyDayType = "TASK" | "RFI" | "SUBMITTAL" | "PUNCH" | "APPROVAL" | "CRM_TASK";

interface MyDayItem {
  id: string;
  type: MyDayType;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  dueDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  status: string;
  priority: string | null;
  sourceUrl: string;
  canQuickComplete: boolean;
}

interface MyDayResponse {
  userId: string;
  generatedAt: string;
  tasks: MyDayItem[];
  rfis: MyDayItem[];
  submittals: MyDayItem[];
  punchItems: MyDayItem[];
  approvals: MyDayItem[];
  crmTasks: MyDayItem[];
  counts: {
    total: number;
    overdue: number;
    today: number;
    thisWeek: number;
    later: number;
    byType: Record<string, number>;
  };
}

const TYPE_META: Record<MyDayType, { label: string; short: string; icon: LucideIcon; badgeClass: string }> = {
  TASK: {
    label: "Task",
    short: "TASK",
    icon: CheckSquare,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800",
  },
  RFI: {
    label: "RFI",
    short: "RFI",
    icon: FileText,
    badgeClass: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900 dark:text-violet-200 dark:border-violet-800",
  },
  SUBMITTAL: {
    label: "Submittal",
    short: "SUB",
    icon: FileSignature,
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-800",
  },
  PUNCH: {
    label: "Punch",
    short: "PUNCH",
    icon: ClipboardList,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800",
  },
  APPROVAL: {
    label: "Approval",
    short: "APPR",
    icon: ShieldCheck,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-800",
  },
  CRM_TASK: {
    label: "CRM Task",
    short: "CRM",
    icon: Briefcase,
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-800",
  },
};

const FILTER_TYPES: { value: MyDayType; label: string }[] = [
  { value: "TASK", label: "Tasks" },
  { value: "RFI", label: "RFIs" },
  { value: "SUBMITTAL", label: "Submittals" },
  { value: "PUNCH", label: "Punch" },
  { value: "APPROVAL", label: "Approvals" },
  { value: "CRM_TASK", label: "CRM" },
];

type Bucket = "overdue" | "today" | "thisWeek" | "later";

function bucketFor(item: MyDayItem, now: Date): Bucket {
  if (!item.dueDate) return "later";
  const d = new Date(item.dueDate);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = addDays(todayEnd, 6);
  if (d < todayStart) return "overdue";
  if (d <= todayEnd) return "today";
  if (d <= weekEnd) return "thisWeek";
  return "later";
}

function dueColor(item: MyDayItem): string {
  if (!item.dueDate) return "text-muted-foreground";
  const d = new Date(item.dueDate);
  if (isPast(d) && !isToday(d)) return "text-red-600 dark:text-red-400";
  if (isToday(d)) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function dueLabel(item: MyDayItem): string {
  if (!item.dueDate) return "No due date";
  const d = new Date(item.dueDate);
  if (isToday(d)) return "Due today";
  const rel = formatDistanceToNowStrict(d, { addSuffix: true });
  return `${format(d, "MMM d")} · ${rel}`;
}

const SECTION_LABELS: Record<Bucket, { title: string; description: string; testId: string }> = {
  overdue: { title: "Overdue", description: "Past due — handle these first", testId: "section-overdue" },
  today: { title: "Due today", description: "Wrap these up by end of day", testId: "section-today" },
  thisWeek: { title: "Due this week", description: "On deck for the next 7 days", testId: "section-week" },
  later: { title: "No due date / later", description: "Backlog and future-dated items", testId: "section-later" },
};

export default function MyDayPage() {
  const { toast } = useToast();
  const [activeTypes, setActiveTypes] = useState<Set<MyDayType>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<MyDayResponse>({
    queryKey: ["/api/my-day"],
  });

  const items: MyDayItem[] = useMemo(() => {
    if (!data) return [];
    return [
      ...data.tasks,
      ...data.rfis,
      ...data.submittals,
      ...data.punchItems,
      ...data.approvals,
      ...data.crmTasks,
    ];
  }, [data]);
  const counts = data?.counts;

  const filteredItems = useMemo(() => {
    if (activeTypes.size === 0) return items;
    return items.filter((i) => activeTypes.has(i.type));
  }, [items, activeTypes]);

  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<Bucket, MyDayItem[]> = { overdue: [], today: [], thisWeek: [], later: [] };
    for (const it of filteredItems) {
      groups[bucketFor(it, now)].push(it);
    }
    const sorter = (a: MyDayItem, b: MyDayItem) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    };
    (Object.keys(groups) as Bucket[]).forEach((k) => groups[k].sort(sorter));
    return groups;
  }, [filteredItems]);

  const completeMutation = useMutation<unknown, Error, MyDayItem, { previous?: MyDayResponse }>({
    mutationFn: async (item: MyDayItem) => {
      if (item.type === "TASK") {
        return apiRequest("PATCH", `/api/tasks/${item.id}`, { status: "COMPLETED" });
      }
      if (item.type === "PUNCH") {
        if (!item.projectCode) throw new Error("Missing project");
        // Server enforces OPEN -> IN_PROGRESS -> RESOLVED. If the item is OPEN,
        // bump to IN_PROGRESS first, then resolve.
        if (item.status === "OPEN") {
          await apiRequest("PATCH", `/api/projects/${item.projectCode}/punch-list/${item.id}`, { status: "IN_PROGRESS" });
        }
        return apiRequest("PATCH", `/api/projects/${item.projectCode}/punch-list/${item.id}`, { status: "RESOLVED" });
      }
      throw new Error("Quick complete not supported");
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: ["/api/my-day"] });
      const previous = queryClient.getQueryData<MyDayResponse>(["/api/my-day"]);
      if (previous) {
        const removeFrom = (arr: MyDayItem[]) => arr.filter((x) => x.id !== item.id);
        const next: MyDayResponse = {
          ...previous,
          tasks: item.type === "TASK" ? removeFrom(previous.tasks) : previous.tasks,
          punchItems: item.type === "PUNCH" ? removeFrom(previous.punchItems) : previous.punchItems,
        };
        // Recompute counts from the post-removal state.
        const all = [
          ...next.tasks,
          ...next.rfis,
          ...next.submittals,
          ...next.punchItems,
          ...next.approvals,
          ...next.crmTasks,
        ];
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
        const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
        let overdue = 0, today = 0, thisWeek = 0, later = 0;
        for (const it of all) {
          if (!it.dueDate) { later += 1; continue; }
          const d = new Date(it.dueDate);
          if (d < startOfToday) overdue += 1;
          else if (d < endOfToday) today += 1;
          else if (d < endOfWeek) thisWeek += 1;
          else later += 1;
        }
        next.counts = {
          total: all.length,
          overdue,
          today,
          thisWeek,
          later,
          byType: {
            TASK: next.tasks.length,
            RFI: next.rfis.length,
            SUBMITTAL: next.submittals.length,
            PUNCH: next.punchItems.length,
            APPROVAL: next.approvals.length,
            CRM_TASK: next.crmTasks.length,
          },
        };
        queryClient.setQueryData(["/api/my-day"], next);
      }
      // Drop from local selection so stale ids don't linger.
      setSelected((prev) => {
        if (!prev.has(item.id)) return prev;
        const n = new Set(prev);
        n.delete(item.id);
        return n;
      });
      return { previous };
    },
    onError: (e, _item, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["/api/my-day"], ctx.previous);
      const msg = e instanceof Error ? e.message : "Could not mark complete";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-day"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onSuccess: () => {
      toast({ title: "Marked complete" });
    },
  });

  const toggleType = (t: MyDayType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectableIds = useMemo(
    () => filteredItems.filter((i) => i.canQuickComplete).map((i) => i.id),
    [filteredItems],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  };

  const bulkComplete = async () => {
    const ids = Array.from(selected);
    const targets = filteredItems.filter((i) => ids.includes(i.id) && i.canQuickComplete);
    if (targets.length === 0) return;
    let ok = 0;
    let fail = 0;
    for (const item of targets) {
      try {
        await completeMutation.mutateAsync(item);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSelected(new Set());
    toast({ title: `Bulk update: ${ok} completed${fail ? `, ${fail} failed` : ""}` });
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4" data-testid="page-my-day-loading">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-my-day">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Sun className="h-7 w-7 text-amber-500" />
          <div>
            <h1 className="text-3xl font-bold" data-testid="heading-my-day">My Day</h1>
            <p className="text-muted-foreground" data-testid="text-my-day-subtitle">
              Everything assigned to you across every project
            </p>
          </div>
        </div>
        {counts && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" data-testid="count-overdue">
              {counts.overdue} overdue
            </Badge>
            <Badge variant="outline" data-testid="count-today">
              {counts.today} today
            </Badge>
            <Badge variant="outline" data-testid="count-week">
              {counts.thisWeek} this week
            </Badge>
            <Badge variant="outline" data-testid="count-total">
              {counts.total} total
            </Badge>
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2" data-testid="filter-chips">
        <FilterChip
          label="All types"
          count={items.length}
          active={activeTypes.size === 0}
          onClick={() => setActiveTypes(new Set())}
          testId="chip-all"
        />
        {FILTER_TYPES.map((f) => (
          <FilterChip
            key={f.value}
            label={f.label}
            count={counts?.byType?.[f.value] ?? 0}
            active={activeTypes.has(f.value)}
            onClick={() => toggleType(f.value)}
            testId={`chip-${f.value.toLowerCase()}`}
          />
        ))}
      </div>

      {/* Bulk actions */}
      {selectableIds.length > 0 && (
        <div className="flex items-center gap-3 border rounded-md px-3 py-2" data-testid="bulk-bar">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleSelectAll}
            data-testid="checkbox-select-all"
            aria-label="Select all completable items"
          />
          <span className="text-sm text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : "Select all completable items"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} data-testid="button-clear-selection">
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
            <Button
              size="sm"
              disabled={selected.size === 0 || completeMutation.isPending}
              onClick={bulkComplete}
              data-testid="button-bulk-complete"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Mark complete
            </Button>
          </div>
        </div>
      )}

      {/* Sections */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox zero — nice work"
          description="You're all caught up. Take a breath, then pick the next big thing."
          testId="empty-my-day"
        />
      ) : (
        <div className="space-y-6">
          {(Object.keys(SECTION_LABELS) as Bucket[]).map((bucket) => {
            const rows = grouped[bucket];
            if (rows.length === 0) return null;
            const meta = SECTION_LABELS[bucket];
            return (
              <section key={bucket} data-testid={meta.testId}>
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <h2 className="text-lg font-semibold">{meta.title}</h2>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                  <Badge variant="secondary" data-testid={`${meta.testId}-count`}>{rows.length}</Badge>
                </div>
                <Card>
                  <CardContent className="p-0 divide-y">
                    {rows.map((item) => (
                      <Row
                        key={`${item.type}-${item.id}`}
                        item={item}
                        selected={selected.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
                        onComplete={() => completeMutation.mutate(item)}
                        completing={completeMutation.isPending}
                      />
                    ))}
                  </CardContent>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors hover-elevate active-elevate-2",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border",
      )}
    >
      {label}
      <span className="opacity-70">· {count}</span>
    </button>
  );
}

function Row({
  item,
  selected,
  onToggleSelect,
  onComplete,
  completing,
}: {
  item: MyDayItem;
  selected: boolean;
  onToggleSelect: () => void;
  onComplete: () => void;
  completing: boolean;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 p-3 hover-elevate" data-testid={`row-${item.type.toLowerCase()}-${item.id}`}>
      <div className="w-6 flex justify-center">
        {item.canQuickComplete ? (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select ${item.title}`}
            data-testid={`checkbox-${item.id}`}
          />
        ) : (
          <span className="w-4" />
        )}
      </div>
      <Avatar className="h-7 w-7 shrink-0" data-testid={`avatar-owner-${item.id}`}>
        <ColoredAvatarFallback
          className="text-[10px]"
          name={item.ownerName}
          email={item.ownerEmail}
        />
      </Avatar>
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <Badge className={cn("text-[10px] font-semibold", meta.badgeClass)} data-testid={`badge-type-${item.id}`}>
        {meta.short}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate" data-testid={`text-title-${item.id}`}>{item.title}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          {item.projectName && (
            <span className="truncate" data-testid={`text-project-${item.id}`}>
              {item.projectCode ? `${item.projectCode} · ` : ""}{item.projectName}
            </span>
          )}
          {item.priority && <Badge variant="outline" className="text-[10px]">{item.priority}</Badge>}
        </div>
      </div>
      <div className={cn("text-xs whitespace-nowrap", dueColor(item))} data-testid={`text-due-${item.id}`}>
        {dueLabel(item)}
      </div>
      <div className="flex items-center gap-1">
        {item.canQuickComplete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={completing}
            onClick={onComplete}
            title="Mark complete"
            data-testid={`button-complete-${item.id}`}
          >
            <CheckCircle2 className="h-4 w-4" />
          </Button>
        )}
        <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Open in new tab">
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" data-testid={`link-open-new-${item.id}`}>
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button asChild variant="outline" size="sm" data-testid={`link-open-${item.id}`}>
          <Link href={item.sourceUrl}>Open</Link>
        </Button>
      </div>
    </div>
  );
}

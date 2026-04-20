import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, FileText, MessageSquare, FileSignature, Activity, X } from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

interface TimelineProps {
  opportunityId: string;
  urlSync?: boolean;
}

const TYPE_CHIPS: { value: string; label: string; matches: (t: string) => boolean }[] = [
  { value: "EMAIL", label: "Email", matches: (t) => t === "EMAIL" },
  { value: "CALL", label: "Call", matches: (t) => t === "CALL" },
  { value: "MEETING", label: "Meeting", matches: (t) => t === "MEETING" },
  { value: "SITE_VISIT", label: "Site Visit", matches: (t) => t === "SITE_VISIT" },
  { value: "NOTE", label: "Note", matches: (t) => t === "NOTE" },
  { value: "TASK", label: "Task", matches: (t) => t === "TASK" },
];

const WINDOW_CHIPS: { value: TimeWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

type TimeWindow = "all" | "today" | "week" | "month";

function readParams(): { types: Set<string>; window: TimeWindow } {
  if (typeof window === "undefined") return { types: new Set(), window: "all" };
  const sp = new URLSearchParams(window.location.search);
  const typeStr = sp.get("type") ?? "";
  const types = new Set(typeStr ? typeStr.split(",").filter(Boolean) : []);
  const sinceRaw = (sp.get("since") ?? "all") as TimeWindow;
  const win: TimeWindow = ["all", "today", "week", "month"].includes(sinceRaw) ? sinceRaw : "all";
  return { types, window: win };
}

function writeParams(types: Set<string>, win: TimeWindow) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (types.size > 0) sp.set("type", Array.from(types).join(","));
  else sp.delete("type");
  if (win !== "all") sp.set("since", win);
  else sp.delete("since");
  const qs = sp.toString();
  const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

export function CrmActivityTimeline({ opportunityId, urlSync = false }: TimelineProps) {
  const { data: activities, isLoading: l1 } = useQuery<any[]>({
    queryKey: ["/api/crm/opportunities", opportunityId, "activities"],
    enabled: !!opportunityId,
  });
  const { data: tasks, isLoading: l2 } = useQuery<any[]>({
    queryKey: ["/api/crm/tasks", { opportunityId }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/tasks?opportunityId=${opportunityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!opportunityId,
  });
  const { data: quotes, isLoading: l3 } = useQuery<any[]>({
    queryKey: ["/api/crm/quotes", { opportunityId }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/quotes?opportunityId=${opportunityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!opportunityId,
  });

  const initial = urlSync ? readParams() : { types: new Set<string>(), window: "all" as TimeWindow };
  const [activeTypes, setActiveTypes] = useState<Set<string>>(initial.types);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(initial.window);

  useEffect(() => {
    if (urlSync) writeParams(activeTypes, timeWindow);
  }, [urlSync, activeTypes, timeWindow]);

  const items = useMemo(() => {
    const out: { type: string; ts: Date; title: string; desc?: string; meta?: string }[] = [];
    (activities ?? []).forEach((a) => out.push({
      type: a.activityType ?? "NOTE",
      ts: new Date(a.createdAt),
      title: a.activityType === "NOTE" ? "Note" : a.activityType,
      desc: a.description,
    }));
    (tasks ?? []).forEach((t) => out.push({
      type: "TASK",
      ts: new Date(t.createdAt),
      title: `Task: ${t.title}`,
      desc: t.description,
      meta: `Due ${format(new Date(t.dueDate), "MMM d")} · ${t.status}`,
    }));
    (quotes ?? []).forEach((q) => out.push({
      type: "QUOTE",
      ts: new Date(q.createdAt),
      title: `Quote ${q.quoteNumber}`,
      desc: q.title,
      meta: `${q.status} · $${Number(q.totalAmount).toLocaleString()}`,
    }));
    out.sort((a, b) => b.ts.getTime() - a.ts.getTime());
    return out;
  }, [activities, tasks, quotes]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const chip of TYPE_CHIPS) counts[chip.value] = 0;
    for (const it of items) {
      for (const chip of TYPE_CHIPS) if (chip.matches(it.type)) counts[chip.value]++;
    }
    return counts;
  }, [items]);

  const windowCounts = useMemo(() => {
    const now = new Date();
    const cutoffs: Record<TimeWindow, Date | null> = {
      all: null,
      today: startOfDay(now),
      week: startOfWeek(now, { weekStartsOn: 0 }),
      month: startOfMonth(now),
    };
    const counts: Record<TimeWindow, number> = { all: items.length, today: 0, week: 0, month: 0 };
    for (const it of items) {
      if (cutoffs.today && it.ts >= cutoffs.today) counts.today++;
      if (cutoffs.week && it.ts >= cutoffs.week) counts.week++;
      if (cutoffs.month && it.ts >= cutoffs.month) counts.month++;
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff =
      timeWindow === "today" ? startOfDay(now) :
      timeWindow === "week" ? startOfWeek(now, { weekStartsOn: 0 }) :
      timeWindow === "month" ? startOfMonth(now) : null;
    return items.filter((it) => {
      if (cutoff && it.ts < cutoff) return false;
      if (activeTypes.size === 0) return true;
      for (const t of activeTypes) {
        const chip = TYPE_CHIPS.find((c) => c.value === t);
        if (chip && chip.matches(it.type)) return true;
      }
      return false;
    });
  }, [items, activeTypes, timeWindow]);

  const toggleType = useCallback((value: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveTypes(new Set());
    setTimeWindow("all");
  }, []);

  if (l1 || l2 || l3) return <Skeleton className="h-40" />;

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-timeline-empty">No activity yet.</p>;
  }

  const chipBase = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors hover-elevate active-elevate-2";
  const chipActive = "bg-primary text-primary-foreground border-primary";
  const chipInactive = "bg-background text-foreground border-border";

  return (
    <div className="space-y-4" data-testid="view-activity-timeline">
      <div className="space-y-2" data-testid="filter-chips">
        <div className="flex flex-wrap gap-2" data-testid="filter-chips-type">
          <button
            type="button"
            onClick={() => setActiveTypes(new Set())}
            className={cn(chipBase, activeTypes.size === 0 ? chipActive : chipInactive)}
            data-testid="chip-type-all"
            aria-pressed={activeTypes.size === 0}
          >
            All
            <span className="opacity-70">· {items.length}</span>
          </button>
          {TYPE_CHIPS.map((chip) => {
            const active = activeTypes.has(chip.value);
            return (
              <button
                type="button"
                key={chip.value}
                onClick={() => toggleType(chip.value)}
                className={cn(chipBase, active ? chipActive : chipInactive)}
                data-testid={`chip-type-${chip.value.toLowerCase()}`}
                aria-pressed={active}
              >
                {chip.label}
                <span className="opacity-70">· {typeCounts[chip.value] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2" data-testid="filter-chips-window">
          {WINDOW_CHIPS.map((chip) => {
            const active = timeWindow === chip.value;
            return (
              <button
                type="button"
                key={chip.value}
                onClick={() => setTimeWindow(chip.value)}
                className={cn(chipBase, active ? chipActive : chipInactive)}
                data-testid={`chip-window-${chip.value}`}
                aria-pressed={active}
              >
                {chip.label}
                <span className="opacity-70">· {windowCounts[chip.value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 border rounded-md" data-testid="text-timeline-filtered-empty">
          <p className="text-sm text-muted-foreground mb-3">No activities match these filters.</p>
          <Button size="sm" variant="outline" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-3.5 h-3.5 mr-1" /> Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((it, i) => (
            <div key={i} className="flex gap-3 border-l-2 border-muted pl-3 py-1" data-testid={`timeline-item-${i}`}>
              <div className="mt-0.5">{iconFor(it.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{it.title}</span>
                  {it.meta && <Badge variant="outline" className="text-xs">{it.meta}</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{format(it.ts, "MMM d, yyyy h:mm a")}</span>
                </div>
                {it.desc && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{it.desc}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function iconFor(type: string) {
  switch (type) {
    case "TASK": return <CheckSquare className="h-4 w-4 text-blue-600" />;
    case "QUOTE": return <FileSignature className="h-4 w-4 text-emerald-600" />;
    case "NOTE": return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case "EMAIL": case "CALL": case "MEETING": case "SITE_VISIT": return <FileText className="h-4 w-4 text-violet-600" />;
    default: return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

import { useMemo, useState, useEffect, useCallback, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckSquare,
  FileText,
  MessageSquare,
  FileSignature,
  Activity,
  X,
  MailOpen,
  Send,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  GitBranch,
  Reply,
} from "lucide-react";
import { format, startOfDay, startOfWeek, startOfMonth, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";

export interface CrmActivityTimelineProps {
  opportunityId?: string;
  contactId?: string;
  crmOrganisationId?: string;
  /** Sync filter state to URL query string. */
  urlSync?: boolean;
  /** Persist filter state per-user in localStorage. */
  stickyKey?: string;
}

interface UnifiedActivity {
  id: string;
  type: "CALL" | "EMAIL" | "MEETING" | "NOTE" | "TASK" | "STATUS" | "QUOTE" | "FOLLOW_UP" | "SITE_VISIT";
  occurredAt: string;
  title: string;
  description: string | null;
  actorName: string | null;
  meta: Record<string, any>;
}

const TYPE_CHIPS: { value: UnifiedActivity["type"]; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "SITE_VISIT", label: "Site Visit" },
  { value: "NOTE", label: "Note" },
  { value: "TASK", label: "Task" },
  { value: "STATUS", label: "Status" },
  { value: "QUOTE", label: "Quote" },
];

type TimeWindow = "all" | "today" | "week" | "month";
const WINDOW_CHIPS: { value: TimeWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function readUrlParams(): { types: Set<string>; window: TimeWindow } {
  if (typeof window === "undefined") return { types: new Set(), window: "all" };
  const sp = new URLSearchParams(window.location.search);
  const typeStr = sp.get("type") ?? "";
  const types = new Set(typeStr ? typeStr.split(",").filter(Boolean) : []);
  const sinceRaw = (sp.get("since") ?? "all") as TimeWindow;
  const win: TimeWindow = (["all", "today", "week", "month"] as TimeWindow[]).includes(sinceRaw)
    ? sinceRaw
    : "all";
  return { types, window: win };
}

function writeUrlParams(types: Set<string>, win: TimeWindow) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (types.size > 0) sp.set("type", Array.from(types).join(","));
  else sp.delete("type");
  if (win !== "all") sp.set("since", win);
  else sp.delete("since");
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

function readSticky(key: string): { types: Set<string>; window: TimeWindow } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`crm_activity_filter:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { types: string[]; window: TimeWindow };
    return { types: new Set(parsed.types || []), window: parsed.window || "all" };
  } catch {
    return null;
  }
}

function writeSticky(key: string, types: Set<string>, win: TimeWindow) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `crm_activity_filter:${key}`,
      JSON.stringify({ types: Array.from(types), window: win }),
    );
  } catch {
    /* ignore */
  }
}

export function CrmActivityTimeline({
  opportunityId,
  contactId,
  crmOrganisationId,
  urlSync = false,
  stickyKey,
}: CrmActivityTimelineProps) {
  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (opportunityId) sp.set("opportunityId", opportunityId);
    if (contactId) sp.set("contactId", contactId);
    if (crmOrganisationId) sp.set("crmOrganisationId", crmOrganisationId);
    return sp.toString();
  }, [opportunityId, contactId, crmOrganisationId]);

  const { data, isLoading } = useQuery<UnifiedActivity[]>({
    queryKey: ["/api/crm/activity", { opportunityId, contactId, crmOrganisationId }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/activity?${queryString}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!(opportunityId || contactId || crmOrganisationId),
  });

  // Tasks are not in the unified endpoint yet (kept as separate query for opportunity context).
  const { data: tasks } = useQuery<any[]>({
    queryKey: ["/api/crm/tasks", { opportunityId }],
    queryFn: async () => {
      if (!opportunityId) return [];
      const res = await fetch(`/api/crm/tasks?opportunityId=${opportunityId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!opportunityId,
  });

  const items: UnifiedActivity[] = useMemo(() => {
    const base = data ?? [];
    const taskItems: UnifiedActivity[] = (tasks ?? []).map((t: any) => ({
      id: `task:${t.id}`,
      type: "TASK",
      occurredAt: new Date(t.createdAt).toISOString(),
      title: `Task: ${t.title}`,
      description: t.description ?? null,
      actorName: null,
      meta: { taskId: t.id, dueDate: t.dueDate, status: t.status },
    }));
    return [...base, ...taskItems].sort((a, b) =>
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
    );
  }, [data, tasks]);

  const initial = useMemo(() => {
    if (urlSync) return readUrlParams();
    if (stickyKey) return readSticky(stickyKey) ?? { types: new Set<string>(), window: "all" as TimeWindow };
    return { types: new Set<string>(), window: "all" as TimeWindow };
  }, [urlSync, stickyKey]);

  const [activeTypes, setActiveTypes] = useState<Set<string>>(initial.types);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(initial.window);

  useEffect(() => {
    if (urlSync) writeUrlParams(activeTypes, timeWindow);
    if (stickyKey) writeSticky(stickyKey, activeTypes, timeWindow);
  }, [urlSync, stickyKey, activeTypes, timeWindow]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const chip of TYPE_CHIPS) c[chip.value] = 0;
    for (const it of items) if (c[it.type] !== undefined) c[it.type]++;
    return c;
  }, [items]);

  const windowCounts = useMemo(() => {
    const now = new Date();
    const cutoffs = {
      today: startOfDay(now),
      week: startOfWeek(now, { weekStartsOn: 0 }),
      month: startOfMonth(now),
    };
    const counts: Record<TimeWindow, number> = { all: items.length, today: 0, week: 0, month: 0 };
    for (const it of items) {
      const ts = new Date(it.occurredAt);
      if (ts >= cutoffs.today) counts.today++;
      if (ts >= cutoffs.week) counts.week++;
      if (ts >= cutoffs.month) counts.month++;
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
      const ts = new Date(it.occurredAt);
      if (cutoff && ts < cutoff) return false;
      if (activeTypes.size === 0) return true;
      return activeTypes.has(it.type);
    });
  }, [items, activeTypes, timeWindow]);

  const grouped = useMemo(() => {
    const groups: { date: Date; items: UnifiedActivity[] }[] = [];
    for (const it of filtered) {
      const ts = new Date(it.occurredAt);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.date, ts)) {
        last.items.push(it);
      } else {
        groups.push({ date: ts, items: [it] });
      }
    }
    return groups;
  }, [filtered]);

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

  if (isLoading) return <Skeleton className="h-40" data-testid="skeleton-timeline" />;

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-timeline-empty">
        No activity yet.
      </p>
    );
  }

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors hover-elevate active-elevate-2";
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
            All <span className="opacity-70">· {items.length}</span>
          </button>
          {TYPE_CHIPS.map((chip) => {
            const active = activeTypes.has(chip.value);
            const count = typeCounts[chip.value] ?? 0;
            return (
              <button
                type="button"
                key={chip.value}
                onClick={() => toggleType(chip.value)}
                className={cn(chipBase, active ? chipActive : chipInactive)}
                data-testid={`chip-type-${chip.value.toLowerCase()}`}
                aria-pressed={active}
              >
                {chip.label} <span className="opacity-70">· {count}</span>
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
                {chip.label} <span className="opacity-70">· {windowCounts[chip.value]}</span>
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
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.date.toISOString()} data-testid={`group-day-${format(group.date, "yyyy-MM-dd")}`}>
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 mb-2 border-b">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {format(group.date, "EEEE, MMM d, yyyy")}
                </span>
                <span className="text-xs text-muted-foreground ml-2">· {group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="space-y-3">
                {group.items.map((it) => (
                  <ActivityRow key={it.id} item={it} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: UnifiedActivity }) {
  const ts = new Date(item.occurredAt);
  return (
    <div
      className="flex gap-3 border-l-2 border-muted pl-3 py-1"
      data-testid={`timeline-item-${item.id}`}
    >
      <div className="mt-0.5">{iconFor(item)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" data-testid={`text-title-${item.id}`}>
            {item.title}
          </span>
          {renderBadges(item)}
          <span className="text-xs text-muted-foreground ml-auto">{format(ts, "h:mm a")}</span>
        </div>
        {item.description && (
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-desc-${item.id}`}>
            {item.description}
          </p>
        )}
        {item.actorName && (
          <p className="text-xs text-muted-foreground mt-0.5">by {item.actorName}</p>
        )}
        {item.type === "EMAIL" && (
          <EmailActions item={item} />
        )}
      </div>
    </div>
  );
}

function EmailActions({ item }: { item: UnifiedActivity }) {
  const meta = item.meta || {};
  const subject: string = meta.subject || item.title || "";
  const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const recipient: string = meta.direction === "OUTBOUND"
    ? (Array.isArray(meta.toAddresses) ? meta.toAddresses[0] : (meta.toAddresses || ""))
    : (meta.fromAddress || "");
  const externalId: string = meta.externalMessageId || "";
  const headers: string[] = [];
  if (externalId) {
    const messageId = externalId.startsWith("<") ? externalId : `<${externalId}>`;
    headers.push(`In-Reply-To=${encodeURIComponent(messageId)}`);
    headers.push(`References=${encodeURIComponent(messageId)}`);
  }
  const mailto = recipient
    ? `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(replySubject)}${headers.length ? `&${headers.join("&")}` : ""}`
    : null;

  if (!mailto) return null;
  return (
    <div className="mt-1.5 flex gap-2">
      <a href={mailto} data-testid={`link-reply-${item.id}`}>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <Reply className="w-3 h-3 mr-1" /> Reply
        </Button>
      </a>
      {meta.providerDeepLink && (
        <a href={meta.providerDeepLink} target="_blank" rel="noopener noreferrer" data-testid={`link-provider-${item.id}`}>
          <Button variant="ghost" size="sm" className="h-7 text-xs">Open in provider</Button>
        </a>
      )}
    </div>
  );
}

function renderBadges(item: UnifiedActivity) {
  const out: JSX.Element[] = [];
  if (item.type === "CALL" && item.meta) {
    const dur = item.meta.durationSeconds as number | undefined;
    if (dur && dur > 0) {
      const m = Math.floor(dur / 60);
      const s = dur % 60;
      out.push(
        <Badge key="dur" variant="outline" className="text-xs">
          {m}:{s.toString().padStart(2, "0")}
        </Badge>,
      );
    }
    if (item.meta.outcome) {
      out.push(
        <Badge key="outcome" variant="secondary" className="text-xs">
          {String(item.meta.outcome).replace(/_/g, " ").toLowerCase()}
        </Badge>,
      );
    }
  }
  if (item.type === "TASK" && item.meta?.status) {
    out.push(
      <Badge key="status" variant="outline" className="text-xs">{String(item.meta.status)}</Badge>,
    );
  }
  if (item.type === "QUOTE" && item.meta?.status) {
    out.push(
      <Badge key="qstatus" variant="outline" className="text-xs">{String(item.meta.status)}</Badge>,
    );
  }
  if (item.type === "EMAIL" && item.meta?.direction) {
    out.push(
      <Badge key="dir" variant="outline" className="text-xs">
        {item.meta.direction === "OUTBOUND" ? "Sent" : "Received"}
      </Badge>,
    );
  }
  return out.length ? <>{out}</> : null;
}

function iconFor(item: UnifiedActivity) {
  switch (item.type) {
    case "TASK":
      return <CheckSquare className="h-4 w-4 text-blue-600" />;
    case "QUOTE":
      return <FileSignature className="h-4 w-4 text-emerald-600" />;
    case "NOTE":
      return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case "STATUS":
      return <GitBranch className="h-4 w-4 text-amber-600" />;
    case "EMAIL":
      if (item.meta?.direction === "OUTBOUND") return <Send className="h-4 w-4 text-sky-600" data-testid="icon-email-out" />;
      return <MailOpen className="h-4 w-4 text-amber-600" data-testid="icon-email-in" />;
    case "CALL":
      if (item.meta?.direction === "INBOUND") return <PhoneIncoming className="h-4 w-4 text-emerald-700" />;
      return <PhoneOutgoing className="h-4 w-4 text-sky-700" />;
    case "MEETING":
    case "SITE_VISIT":
      return <FileText className="h-4 w-4 text-violet-600" />;
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

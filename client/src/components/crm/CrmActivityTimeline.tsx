import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, FileText, MessageSquare, FileSignature, Activity } from "lucide-react";
import { format } from "date-fns";

interface TimelineProps { opportunityId: string }

export function CrmActivityTimeline({ opportunityId }: TimelineProps) {
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

  if (l1 || l2 || l3) return <Skeleton className="h-40" />;

  const items: { type: string; ts: Date; title: string; desc?: string; meta?: string }[] = [];
  (activities ?? []).forEach(a => items.push({
    type: a.activityType ?? "NOTE", ts: new Date(a.createdAt),
    title: a.activityType === "NOTE" ? "Note" : a.activityType,
    desc: a.description,
  }));
  (tasks ?? []).forEach(t => items.push({
    type: "TASK", ts: new Date(t.createdAt), title: `Task: ${t.title}`, desc: t.description, meta: `Due ${format(new Date(t.dueDate), "MMM d")} · ${t.status}`,
  }));
  (quotes ?? []).forEach(q => items.push({
    type: "QUOTE", ts: new Date(q.createdAt), title: `Quote ${q.quoteNumber}`, desc: q.title, meta: `${q.status} · $${Number(q.totalAmount).toLocaleString()}`,
  }));
  items.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-timeline-empty">No activity yet.</p>;

  return (
    <div className="space-y-3" data-testid="view-activity-timeline">
      {items.map((it, i) => (
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
  );
}

function iconFor(type: string) {
  switch (type) {
    case "TASK": return <CheckSquare className="h-4 w-4 text-blue-600" />;
    case "QUOTE": return <FileSignature className="h-4 w-4 text-emerald-600" />;
    case "NOTE": return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case "EMAIL": case "CALL": case "MEETING": return <FileText className="h-4 w-4 text-violet-600" />;
    default: return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

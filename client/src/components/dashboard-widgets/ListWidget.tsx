import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { List, Calendar, DollarSign, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  type ListWidgetConfig,
  DEFAULT_LIST_CONFIG,
  LIST_ENTITIES,
} from "./ListWidgetSettings";

interface ListItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  date: string | null;
  amount: number | null;
  amountLabel?: string;
  link?: string;
  code?: string;
}

interface ListResponse {
  items: ListItem[];
  entity: string;
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/10 text-green-700 dark:text-green-400",
  COMPLETED: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  APPROVED: "bg-green-500/10 text-green-700 dark:text-green-400",
  AWARDED: "bg-green-500/10 text-green-700 dark:text-green-400",
  PLANNING: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  PENDING: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  DRAFT: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  NOT_STARTED: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  SUBMITTED: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  PROCESSING: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  IN_PROGRESS: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-400",
  CANCELLED: "bg-red-500/10 text-red-700 dark:text-red-400",
  TERMINATED: "bg-red-500/10 text-red-700 dark:text-red-400",
  ON_HOLD: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  LOST: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(amount: number | null, label?: string): string {
  if (amount === null || amount === undefined) return "";
  if (label === "hrs") return `${amount.toFixed(1)}h`;
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function formatStatus(status: string): string {
  if (!status) return "";
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

interface ListWidgetProps {
  config?: ListWidgetConfig;
}

export function ListWidget({ config }: ListWidgetProps) {
  const merged = { ...DEFAULT_LIST_CONFIG, ...config };
  const entityDef = LIST_ENTITIES.find(e => e.value === merged.entity) || LIST_ENTITIES[0];

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/dashboard/list", merged.entity, merged.status, merged.sortBy, merged.sortDir, merged.limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        entity: merged.entity || "PROJECTS",
        sortBy: merged.sortBy || "created_at",
        sortDir: merged.sortDir || "desc",
        limit: String(merged.limit || 5),
      });
      if (merged.status) params.set("status", merged.status);
      const res = await fetch(`/api/dashboard/list?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch list data");
      return res.json();
    },
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <Card data-testid="list-widget-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-28 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-1.5">
              <div className="h-3.5 w-3/4 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = data?.items || [];
  const total = data?.total || 0;

  return (
    <Card data-testid="list-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{entityDef.label}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px]" data-testid="badge-list-total">
            {total} total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground" data-testid="list-widget-empty">
            <List className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No {entityDef.label.toLowerCase()} found</p>
          </div>
        ) : (
          <div className="space-y-1" data-testid="list-widget-items">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-start justify-between gap-3 py-2.5 px-2 rounded-md",
                  "hover:bg-muted/50 transition-colors",
                  idx < items.length - 1 && "border-b border-border/50"
                )}
                data-testid={`list-item-${item.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {item.status && (
                      <Badge
                        variant="secondary"
                        className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[item.status] || "bg-muted")}
                        data-testid={`badge-status-${item.id}`}
                      >
                        {formatStatus(item.status)}
                      </Badge>
                    )}
                    {item.date && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatDate(item.date)}
                      </span>
                    )}
                  </div>
                </div>
                {item.amount !== null && item.amount !== undefined && (
                  <div className="text-right shrink-0">
                    <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                      {item.amountLabel === "hrs" ? (
                        <Clock className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <DollarSign className="w-3 h-3 text-muted-foreground" />
                      )}
                      {formatAmount(item.amount, item.amountLabel)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

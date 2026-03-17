import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { type RFIStatusConfig, DEFAULT_RFI_STATUS_CONFIG } from "./RFIStatusSettings";
import type { WidgetComponentProps } from "./WidgetRegistry";

interface RFIItem {
  id: string;
  rfiNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  project?: { id: string; name: string; code: string } | null;
  submittedBy?: { id: string; firstName: string; lastName: string } | null;
}

function getDaysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
}

export function RFIStatusWidget({ config }: WidgetComponentProps) {
  const cfg: RFIStatusConfig = { ...DEFAULT_RFI_STATUS_CONFIG, ...(config as Partial<RFIStatusConfig>) };

  const submittedUrl = cfg.projectId
    ? `/api/rfi?status=SUBMITTED&projectId=${encodeURIComponent(cfg.projectId)}`
    : "/api/rfi?status=SUBMITTED";
  const underReviewUrl = cfg.projectId
    ? `/api/rfi?status=UNDER_REVIEW&projectId=${encodeURIComponent(cfg.projectId)}`
    : "/api/rfi?status=UNDER_REVIEW";

  const { data: submittedRfis, isLoading: submittedLoading, isError: submittedError } = useQuery<RFIItem[]>({
    queryKey: ["/api/rfi", { status: "SUBMITTED", projectId: cfg.projectId }],
    queryFn: () => fetch(submittedUrl, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 300000,
  });

  const { data: underReviewRfis, isLoading: underReviewLoading, isError: underReviewError } = useQuery<RFIItem[]>({
    queryKey: ["/api/rfi", { status: "UNDER_REVIEW", projectId: cfg.projectId }],
    queryFn: () => fetch(underReviewUrl, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 300000,
  });

  const isLoading = submittedLoading || underReviewLoading;
  const isError = submittedError || underReviewError;

  if (isLoading) {
    return (
      <Card data-testid="rfi-status-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-36" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Skeleton className="h-14 w-full rounded-lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-start py-2 px-2.5 rounded-md">
              <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3.5 w-6 shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="rfi-status-error">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load RFIs.</p>
        </CardContent>
      </Card>
    );
  }

  const allOpen = [
    ...(Array.isArray(submittedRfis) ? submittedRfis : []),
    ...(Array.isArray(underReviewRfis) ? underReviewRfis : []),
  ]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const openCount = allOpen.length;
  const projectLabel = cfg.projectId
    ? (allOpen[0]?.project?.name || `Project ${cfg.projectId.slice(0, 8)}...`)
    : null;

  return (
    <Card data-testid="rfi-status-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">RFIs Awaiting Response</CardTitle>
          </div>
          {openCount > 0 && (
            <Badge variant="secondary" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 text-[10px]" data-testid="rfi-open-badge">
              {openCount} Open
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {openCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="rfi-status-empty">
            <CheckCircle2 className="w-8 h-8 text-green-500 opacity-70 mb-2" />
            <p className="text-sm text-muted-foreground">No RFIs awaiting response</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {projectLabel ? `No open RFIs for ${projectLabel}` : "All submitted RFIs have been answered"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg bg-orange-500/10 border border-orange-200 dark:border-orange-800/50 px-3 py-2.5 mb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {projectLabel ? `Open RFIs — ${projectLabel}` : "Open RFIs"}
                </span>
                <span className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-400" data-testid="rfi-count">{openCount}</span>
              </div>
            </div>

            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {allOpen.slice(0, cfg.showLimit).map((item) => {
                const daysOpen = getDaysOpen(item.createdAt);
                const isOld = daysOpen >= cfg.highlightDaysThreshold;
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-2.5 py-2 px-2.5 rounded-md bg-muted/30 border border-border/50"
                    data-testid={`rfi-item-${item.id}`}
                  >
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {item.rfiNumber}: {item.subject}
                      </p>
                      {item.project && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.project.name}</p>
                      )}
                    </div>
                    <span className={cn("text-[11px] font-medium shrink-0 ml-1", isOld ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                      {daysOpen}d
                    </span>
                  </div>
                );
              })}
            </div>

            <Link href="/rfis" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-2" data-testid="link-view-all-rfis">
              View all RFIs
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

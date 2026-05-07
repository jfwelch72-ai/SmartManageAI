import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import { useGlobalSSE } from "@/contexts/GlobalSSEContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MyJob {
  id: string;
  name: string;
  state: "created" | "active" | "retry" | "completed" | "failed" | "expired" | "cancelled";
  retryCount: number;
  createdOn: string | null;
  startedOn: string | null;
  completedOn: string | null;
  idempotencyKey: string | null;
}

interface MyJobsResponse {
  items: MyJob[];
}

interface LiveProgress {
  status: "running" | "completed" | "failed";
  progress: number;
  message?: string;
}

const JOB_NAME_LABELS: Record<string, string> = {
  ai_takeoff_analyze: "AI takeoff",
  ai_document_analyze: "AI document analysis",
  ai_estimator_draft: "AI estimator draft",
  pdf_tile_prerender: "Plan tile prerender",
  accounting_sync: "Accounting sync",
  bulk_export: "Bulk export",
  plan_set_ingest: "Plan-set ingest",
};

function jobLabel(name: string): string {
  return JOB_NAME_LABELS[name] || name.replace(/_/g, " ");
}

function isActiveState(state: MyJob["state"]): boolean {
  return state === "created" || state === "active" || state === "retry";
}

function isFailedState(state: MyJob["state"]): boolean {
  return state === "failed" || state === "expired" || state === "cancelled";
}

/**
 * Task #2583 — Nav-bar "Background activity" tray.
 *
 * Shows a global view of every long-running background job for the
 * current user (AI estimator drafts, accounting sync, bulk exports,
 * plan-set ingests across bids, etc.) so users don't have to hunt
 * page-by-page. Backed by `GET /api/jobs/mine` polling + the same
 * messaging-bus SSE channel that drives `useJobProgress`.
 */
export function BackgroundActivityTray() {
  const { user } = useAuth();
  const { addListener, removeListener } = useGlobalSSE();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Record<string, LiveProgress>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const { data, refetch } = useQuery<MyJobsResponse>({
    queryKey: ["/api/jobs/mine"],
    enabled: !!user,
    refetchInterval: 5000,
    staleTime: 2000,
  });

  // Subscribe to SSE job-progress events and merge into local live cache.
  useEffect(() => {
    if (!user) return;
    const handler = (e: MessageEvent) => {
      let payload: {
        __jobProgress?: boolean;
        jobId?: string;
        status?: "running" | "completed" | "failed";
        progress?: number;
        message?: string;
      };
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!payload?.__jobProgress || !payload.jobId) return;
      const status = payload.status ?? "running";
      const progress =
        typeof payload.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(payload.progress)))
          : 0;
      setLive((prev) => ({
        ...prev,
        [payload.jobId!]: {
          status,
          progress: status === "completed" ? 100 : progress,
          message: payload.message,
        },
      }));
      // On terminal events, refetch the list so completedOn / state flip.
      if (status === "completed" || status === "failed") {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/mine"] });
      }
    };
    addListener("message_new", handler);
    return () => removeListener("message_new", handler);
  }, [user, addListener, removeListener]);

  const items = data?.items ?? [];

  const activeCount = useMemo(
    () =>
      items.filter((j) => {
        const liveStatus = live[j.id]?.status;
        if (liveStatus === "completed" || liveStatus === "failed") return false;
        return isActiveState(j.state);
      }).length,
    [items, live],
  );

  const handleRetry = useCallback(
    async (jobId: string) => {
      setRetrying((r) => ({ ...r, [jobId]: true }));
      try {
        await apiRequest("POST", `/api/jobs/${encodeURIComponent(jobId)}/retry`);
        toast({ title: "Re-queued", description: "Job restarted in the background." });
        await refetch();
      } catch (err) {
        toast({
          title: "Retry failed",
          description: err instanceof Error ? err.message : "Could not re-queue job",
          variant: "destructive",
        });
      } finally {
        setRetrying((r) => {
          const next = { ...r };
          delete next[jobId];
          return next;
        });
      }
    },
    [refetch, toast],
  );

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Background activity"
          data-testid="button-background-activity"
        >
          {activeCount > 0 ? (
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          ) : (
            <Activity className="w-5 h-5" />
          )}
          {activeCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-background-activity-count"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[calc(100vw-2rem)] sm:w-96 p-0"
        data-testid="panel-background-activity"
      >
        <div className="flex items-center justify-between p-3 border-b">
          <div>
            <p className="text-sm font-medium">Background activity</p>
            <p className="text-xs text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} running`
                : items.length > 0
                ? "No jobs running"
                : "Nothing recent"}
            </p>
          </div>
        </div>
        <ScrollArea className="h-96">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-background-activity-empty">
              No background jobs in the last 24 hours.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((job) => {
                const liveProg = live[job.id];
                const effectiveStatus =
                  liveProg?.status === "completed"
                    ? "completed"
                    : liveProg?.status === "failed"
                    ? "failed"
                    : isActiveState(job.state)
                    ? "running"
                    : job.state === "completed"
                    ? "completed"
                    : isFailedState(job.state)
                    ? "failed"
                    : "running";
                const percent =
                  effectiveStatus === "completed"
                    ? 100
                    : effectiveStatus === "failed"
                    ? 0
                    : Math.max(liveProg?.progress ?? 0, job.state === "active" ? 5 : 1);
                const message =
                  liveProg?.message ||
                  (effectiveStatus === "completed"
                    ? "Completed"
                    : effectiveStatus === "failed"
                    ? `${job.state === "expired" ? "Expired" : job.state === "cancelled" ? "Cancelled" : "Failed"}${
                        job.retryCount > 0 ? ` after ${job.retryCount} retries` : ""
                      }`
                    : job.state === "active"
                    ? "Running…"
                    : "Queued…");
                const ts = job.completedOn || job.startedOn || job.createdOn;
                return (
                  <li
                    key={job.id}
                    className="p-3"
                    data-testid={`row-background-activity-${job.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">
                        {effectiveStatus === "completed" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : effectiveStatus === "failed" ? (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        ) : (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className="text-sm font-medium truncate"
                            data-testid={`text-background-activity-name-${job.id}`}
                          >
                            {jobLabel(job.name)}
                          </p>
                          {effectiveStatus === "failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs px-2"
                              disabled={!!retrying[job.id]}
                              onClick={() => handleRetry(job.id)}
                              data-testid={`button-background-activity-retry-${job.id}`}
                            >
                              {retrying[job.id] ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3 mr-1" />
                              )}
                              Retry
                            </Button>
                          )}
                        </div>
                        {effectiveStatus !== "failed" && (
                          <div className="flex items-center gap-2 mt-1">
                            <Progress
                              value={percent}
                              className="h-1.5 flex-1"
                              data-testid={`progress-background-activity-${job.id}`}
                            />
                            <span
                              className="text-[10px] tabular-nums text-muted-foreground w-9 text-right"
                              data-testid={`text-background-activity-pct-${job.id}`}
                            >
                              {percent}%
                            </span>
                          </div>
                        )}
                        <p
                          className="text-xs text-muted-foreground mt-1 truncate"
                          data-testid={`text-background-activity-message-${job.id}`}
                        >
                          {message}
                        </p>
                        {ts && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(ts), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

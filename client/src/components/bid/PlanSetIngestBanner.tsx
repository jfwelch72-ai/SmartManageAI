import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle2, AlertTriangle, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useJobProgress } from "@/hooks/use-job-progress";

export interface PlanSetIngestPayload {
  bidId: string;
  bidDocumentId?: string;
  fileUrl?: string;
  fileName?: string;
  objectKey?: string;
  baseSheetName?: string;
}

interface StoredJob {
  jobId: string;
  payload: PlanSetIngestPayload;
  startedAt: number;
}

interface JobStatusResponse {
  id: string;
  state:
    | "created"
    | "active"
    | "retry"
    | "completed"
    | "failed"
    | "expired"
    | "cancelled";
  retryCount?: number;
  output?: unknown;
}

const STORAGE_PREFIX = "plan-set-ingest-job:";

function storageKey(bidId: string) {
  return `${STORAGE_PREFIX}${bidId}`;
}

export function loadStoredIngestJob(bidId: string): StoredJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(bidId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredJob;
  } catch {
    return null;
  }
}

export function persistIngestJob(bidId: string, job: StoredJob | null) {
  if (typeof window === "undefined") return;
  try {
    if (job) window.localStorage.setItem(storageKey(bidId), JSON.stringify(job));
    else window.localStorage.removeItem(storageKey(bidId));
  } catch {
    /* best-effort */
  }
}

export async function enqueuePlanSetIngest(
  payload: PlanSetIngestPayload,
): Promise<{ jobId: string; deduplicated?: boolean }> {
  const res = await apiRequest("POST", "/api/takeoff/plan-set-ingest/enqueue", payload);
  const body = (await res.json()) as { jobId: string; deduplicated?: boolean };
  if (!body?.jobId) throw new Error("Server did not return a job id");
  return body;
}

interface PlanSetIngestBannerProps {
  bidId: string;
}

/**
 * Task #2582 — Persistent banner for the background plan-set ingest job.
 *
 * Reads the active job for this bid from localStorage so it survives
 * navigation, polls `/api/jobs/:jobId` every 3s for state transitions,
 * and overlays the live SSE progress feed (`useJobProgress`) for a
 * real percent + status message. On failure the user can Retry with
 * the original payload or Dismiss the banner.
 */
export function PlanSetIngestBanner({ bidId }: PlanSetIngestBannerProps) {
  const { toast } = useToast();
  const [job, setJob] = useState<StoredJob | null>(() => loadStoredIngestJob(bidId));
  const [polled, setPolled] = useState<JobStatusResponse | null>(null);
  const [retrying, setRetrying] = useState(false);
  const completedNotifiedRef = useRef<string | null>(null);

  // Re-load whenever the bid changes (banner is rendered per-bid).
  useEffect(() => {
    setJob(loadStoredIngestJob(bidId));
    setPolled(null);
    completedNotifiedRef.current = null;
  }, [bidId]);

  // Cross-tab sync: another tab may set/clear the active job.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== storageKey(bidId)) return;
      setJob(loadStoredIngestJob(bidId));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [bidId]);

  const live = useJobProgress(job?.jobId ?? null);

  const terminalState = useMemo(() => {
    if (!polled) return null;
    if (polled.state === "completed") return "completed" as const;
    if (polled.state === "failed" || polled.state === "expired" || polled.state === "cancelled") {
      return "failed" as const;
    }
    return null;
  }, [polled]);

  // Poll /api/jobs/:id while we have a job and it has not finished.
  useEffect(() => {
    if (!job?.jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        // Use raw fetch (not apiRequest) so we can branch on a 404 as a
        // terminal "expired" state instead of having the helper throw.
        const res = await fetch(`/api/jobs/${encodeURIComponent(job.jobId)}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) setPolled({ id: job.jobId, state: "expired" });
            return;
          }
          throw new Error(`Job status check failed (${res.status})`);
        }
        const status = (await res.json()) as JobStatusResponse;
        if (cancelled) return;
        setPolled(status);
        if (
          status.state === "completed" ||
          status.state === "failed" ||
          status.state === "expired" ||
          status.state === "cancelled"
        ) {
          return;
        }
      } catch {
        /* network blip — keep trying */
      }
      if (!cancelled) timer = setTimeout(tick, 3000);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [job?.jobId]);

  // When the job completes, refresh the takeoff sheets list and notify once.
  useEffect(() => {
    if (!job?.jobId) return;
    const isCompleteFromLive = live.status === "completed";
    const isCompleteFromPoll = terminalState === "completed";
    if ((isCompleteFromLive || isCompleteFromPoll) && completedNotifiedRef.current !== job.jobId) {
      completedNotifiedRef.current = job.jobId;
      queryClient.invalidateQueries({
        queryKey: ["/api/bids", bidId, "takeoff", "sheets"],
      });
      toast({
        title: "Plan set ready",
        description: "Sheets imported into the takeoff workspace.",
      });
    }
  }, [live.status, terminalState, job?.jobId, bidId, toast]);

  const handleDismiss = useCallback(() => {
    persistIngestJob(bidId, null);
    setJob(null);
    setPolled(null);
  }, [bidId]);

  const handleRetry = useCallback(async () => {
    if (!job) return;
    setRetrying(true);
    try {
      const result = await enqueuePlanSetIngest(job.payload);
      const next: StoredJob = {
        jobId: result.jobId,
        payload: job.payload,
        startedAt: Date.now(),
      };
      persistIngestJob(bidId, next);
      setJob(next);
      setPolled(null);
      completedNotifiedRef.current = null;
      toast({ title: "Re-enqueued", description: "Background ingest restarted." });
    } catch (err) {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Could not re-enqueue job",
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  }, [job, bidId, toast]);

  if (!job) return null;

  const isComplete = terminalState === "completed" || live.status === "completed";
  const isFailed = terminalState === "failed" || live.status === "failed";
  // Prefer live SSE progress while running; once polling reports completion,
  // peg to 100 so the bar doesn't slide back.
  const percent = isComplete ? 100 : Math.max(live.progress, polled?.state === "active" ? 5 : 1);
  const message = isFailed
    ? "Plan-set ingest failed"
    : isComplete
    ? "Plan-set ingest complete"
    : live.message ||
      (polled?.state === "active" ? "Ingesting plan set..." : "Queued for background ingest...");

  const fileLabel = job.payload.fileName || job.payload.baseSheetName || "plan set";

  return (
    <div
      className="border rounded-md bg-muted/40 p-3 mb-2"
      data-testid="banner-plan-set-ingest"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" data-testid="banner-plan-set-ingest-icon-complete" />
          ) : isFailed ? (
            <AlertTriangle className="w-4 h-4 text-destructive" data-testid="banner-plan-set-ingest-icon-failed" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-primary" data-testid="banner-plan-set-ingest-icon-running" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium truncate" data-testid="banner-plan-set-ingest-title">
              Background ingest · <span className="text-muted-foreground">{fileLabel}</span>
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {isFailed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={handleRetry}
                  disabled={retrying}
                  data-testid="button-plan-set-ingest-retry"
                >
                  {retrying ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  )}
                  Retry
                </Button>
              )}
              {/* Dismiss is always available so a stale localStorage
                  entry (e.g. job purged on the server) can't trap the
                  user with a banner stuck in a non-terminal state. */}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={handleDismiss}
                data-testid="button-plan-set-ingest-dismiss"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Progress
              value={percent}
              className="h-1.5 flex-1"
              data-testid="banner-plan-set-ingest-bar"
            />
            <span
              className="text-[10px] tabular-nums text-muted-foreground w-9 text-right"
              data-testid="banner-plan-set-ingest-pct"
            >
              {percent}%
            </span>
          </div>
          <p
            className="text-[11px] text-muted-foreground mt-1 truncate"
            data-testid="banner-plan-set-ingest-message"
          >
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useJobProgress } from "@/hooks/use-job-progress";

interface JobProgressBarProps {
  jobId: string | null | undefined;
  fallbackMessage?: string;
  initialProgress?: number;
  onComplete?: (jobId: string) => void;
  onFail?: (jobId: string, message?: string) => void;
  testIdPrefix?: string;
}

/**
 * Task #2530 — Reusable live progress bar that subscribes to the
 * job-progress SSE channel via `useJobProgress`. Used by the long-
 * running AI/queue flows (AI Estimator draft, accounting sync, bulk
 * exports) so users see real percentages instead of indeterminate
 * spinners.
 */
export function JobProgressBar({
  jobId,
  fallbackMessage = "Working...",
  initialProgress = 5,
  onComplete,
  onFail,
  testIdPrefix = "job-progress",
}: JobProgressBarProps) {
  const job = useJobProgress(jobId ?? null);
  const hasLive = !!jobId && job.status !== "idle";
  const value = hasLive ? job.progress : initialProgress;

  useEffect(() => {
    if (!jobId) return;
    if (job.status === "completed") onComplete?.(jobId);
    if (job.status === "failed") onFail?.(jobId, job.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status, jobId]);

  return (
    <div className="space-y-2" data-testid={testIdPrefix}>
      <div className="flex items-center gap-2">
        {job.status !== "completed" && job.status !== "failed" && (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        )}
        <span className="text-sm" data-testid={`${testIdPrefix}-message`}>
          {hasLive && job.message ? job.message : fallbackMessage}
        </span>
      </div>
      <Progress value={value} className="h-2" data-testid={`${testIdPrefix}-bar`} />
      <div className="flex items-center justify-end text-xs text-muted-foreground">
        {hasLive && (
          <span className="tabular-nums" data-testid={`${testIdPrefix}-pct`}>
            {job.progress}%
          </span>
        )}
      </div>
    </div>
  );
}

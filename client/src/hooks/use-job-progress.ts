import { useEffect, useState } from "react";
import { useGlobalSSE } from "@/contexts/GlobalSSEContext";

export type JobProgressStatus = "idle" | "running" | "completed" | "failed";

export interface JobProgressState {
  status: JobProgressStatus;
  progress: number;
  message?: string;
}

interface JobProgressEventPayload {
  conversationId?: string;
  __jobProgress?: boolean;
  jobId?: string;
  jobName?: string;
  status?: "running" | "completed" | "failed";
  progress?: number;
  message?: string;
}

const INITIAL_STATE: JobProgressState = { status: "idle", progress: 0 };

/**
 * Subscribe to live progress events for a background job (Task #2518).
 *
 * The job queue (`server/jobQueue/index.ts → publishJobProgress`)
 * publishes progress over the messaging bus as a `message_new` SSE event
 * with a `__jobProgress: true` payload addressed to the originating
 * user. This hook listens on the shared SSE connection and surfaces the
 * latest progress / status / message for the given job id so the UI can
 * render a real progress bar instead of an indeterminate spinner.
 */
export function useJobProgress(jobId: string | null | undefined): JobProgressState {
  const { addListener, removeListener } = useGlobalSSE();
  const [state, setState] = useState<JobProgressState>(INITIAL_STATE);

  useEffect(() => {
    if (!jobId) {
      setState(INITIAL_STATE);
      return;
    }

    setState({ status: "running", progress: 0 });

    const handler = (e: MessageEvent) => {
      let payload: JobProgressEventPayload;
      try {
        payload = JSON.parse(e.data) as JobProgressEventPayload;
      } catch {
        return;
      }
      if (!payload?.__jobProgress) return;
      if (payload.jobId !== jobId) return;

      const status = payload.status ?? "running";
      const progress = typeof payload.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(payload.progress)))
        : 0;

      setState({
        status,
        progress: status === "completed" ? 100 : progress,
        message: payload.message,
      });
    };

    addListener("message_new", handler);
    return () => removeListener("message_new", handler);
  }, [jobId, addListener, removeListener]);

  return state;
}

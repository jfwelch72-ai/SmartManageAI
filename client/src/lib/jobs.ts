// Task #2517 — Client-side helper for the pg-boss job queue.
// Enqueue a job by hitting an endpoint that returns
// `{ jobId, status: "QUEUED" }`, then poll `/api/jobs/:id` until the
// job reaches a terminal state.

export interface JobStatus<TOutput = unknown> {
  id: string;
  state: "created" | "active" | "completed" | "failed" | "expired" | "cancelled" | "retry";
  output: TOutput | null;
  error?: string | null;
  attempts?: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (status: JobStatus<unknown>) => void;
}

const TERMINAL: ReadonlyArray<JobStatus["state"]> = [
  "completed",
  "failed",
  "expired",
  "cancelled",
];

export async function pollJobUntilDone<TOutput = unknown>(
  jobId: string,
  opts: PollOptions = {},
): Promise<JobStatus<TOutput>> {
  const interval = opts.intervalMs ?? 1500;
  const timeout = opts.timeoutMs ?? 5 * 60_000;
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
    });
    if (res.status === 404) {
      throw new Error("Job not found (it may have been purged)");
    }
    if (!res.ok) {
      throw new Error(`Job status check failed (${res.status})`);
    }
    const status = (await res.json()) as JobStatus<TOutput>;
    if (opts.onProgress) opts.onProgress(status as JobStatus<unknown>);
    if (TERMINAL.includes(status.state)) {
      return status;
    }
    if (Date.now() - start > timeout) {
      throw new Error("Timed out waiting for job to finish");
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

export interface EnqueueResponse {
  jobId: string;
  idempotencyKey?: string;
  deduplicated?: boolean;
  status?: string;
}

export async function enqueueViaGet(url: string): Promise<EnqueueResponse> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let msg = `Failed to enqueue (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as EnqueueResponse;
}

export async function enqueueAndAwaitJob<TOutput = unknown>(
  url: string,
  opts: PollOptions = {},
): Promise<TOutput> {
  const enq = await enqueueViaGet(url);
  if (!enq.jobId) throw new Error("Server did not return a job id");
  const status = await pollJobUntilDone<TOutput>(enq.jobId, opts);
  if (status.state !== "completed") {
    throw new Error(status.error || `Job ${status.state}`);
  }
  if (status.output == null) {
    throw new Error("Job completed without an output payload");
  }
  return status.output;
}

/**
 * Enqueue an export job and download the resulting file from the signed
 * URL the worker writes into `output.url`. Used by the audit-log,
 * change-order bulk-PDF, and payroll acknowledgement export buttons.
 */
export async function enqueueAndDownloadExport(
  url: string,
  fallbackFilename: string,
  opts: PollOptions = {},
): Promise<void> {
  const out = await enqueueAndAwaitJob<{ url: string; bytes?: number }>(url, opts);
  if (!out?.url) throw new Error("Export job did not return a download URL");
  const a = document.createElement("a");
  a.href = out.url;
  a.rel = "noopener";
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

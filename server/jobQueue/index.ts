// Task #2481 — Background job queue (pg-boss).
//
// Single source of truth for enqueueing/processing long-running work
// (AI takeoff, AI document analysis, PDF tile prerender, accounting
// sync, exports). See `docs/architecture/job-queue.md` for the design.
//
// The same module is imported by both the HTTP server (which only
// enqueues) and the dedicated worker process (`server/worker.ts`,
// which calls `startJobQueue({ withWorkers: true })`).

import PgBoss from "pg-boss";
import crypto from "node:crypto";
import { logError, logInfo, logWarn } from "../utils/logger";
import { withOrgContext } from "../dbContext";
import { recordJobMetrics } from "../utils/jobMetrics";
import { publishMessagingEvent } from "../messagingBus";

export type JobName =
  | "ai_takeoff_analyze"
  | "ai_document_analyze"
  | "ai_estimator_draft"
  | "pdf_tile_prerender"
  | "accounting_sync"
  | "bulk_export"
  // Task #2576 — Background plan-set ingest (page count + sheet split).
  | "plan_set_ingest";

export interface JobContext {
  jobId: string;
  jobName: JobName;
  organizationId: string | null;
  userId: string | null;
  idempotencyKey: string;
  attempt: number;
  /** Push a progress event to the originating user via the messaging bus. */
  progress: (pct: number, message?: string, extra?: Record<string, unknown>) => Promise<void>;
}

export type JobHandler<TPayload> = (
  payload: TPayload,
  ctx: JobContext,
) => Promise<unknown>;

export interface EnqueueOptions {
  organizationId: string | null;
  userId: string | null;
  idempotencyKey?: string;
  /** Run the job no earlier than this many seconds from now. */
  startAfterSeconds?: number;
  /** Override per-job retry limit (default 5). */
  retryLimit?: number;
}

export interface EnqueueResult {
  jobId: string;
  idempotencyKey: string;
  /** True when an existing in-flight singleton swallowed this enqueue. */
  deduplicated: boolean;
}

interface InternalJobPayload<TPayload> {
  payload: TPayload;
  organizationId: string | null;
  userId: string | null;
  idempotencyKey: string;
}

const handlers = new Map<JobName, { handler: JobHandler<unknown>; perTenantConcurrency: number }>();
let boss: PgBoss | null = null;
let started = false;
let workersRegistered = false;

// Per-tenant in-flight semaphore. Keyed by `${jobName}::${organizationId}`.
const tenantInFlight = new Map<string, number>();

function tenantKey(name: JobName, orgId: string | null): string {
  return `${name}::${orgId ?? "_global"}`;
}

function buildIdempotencyKey(name: JobName, orgId: string | null, payload: unknown): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ name, orgId, payload }))
    .digest("hex")
    .slice(0, 32);
  return `${name}:${orgId ?? "_"}:${hash}`;
}

export function getBoss(): PgBoss {
  if (!boss) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL required for job queue");
    }
    boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      // Light footprint — pg-boss opens its own internal pool.
      max: 5,
      // Run pg-boss objects in their own schema so they don't
      // collide with the app's tables under `public`.
      schema: process.env.PGBOSS_SCHEMA || "pgboss",
      // Keep failed jobs around so the admin DLQ view can surface
      // and retry them.
      archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
      deleteAfterDays: 30,
    });
    boss.on("error", (err) => {
      logError("pg-boss error", {}, err instanceof Error ? err : new Error(String(err)));
    });
  }
  return boss;
}

/**
 * Boot the queue. Call from server boot (`withWorkers: false` for the
 * HTTP server, `true` for the dedicated worker entrypoint).
 *
 * Idempotent — repeated calls with `withWorkers: true` register the
 * declared handlers exactly once.
 */
export async function startJobQueue(opts: { withWorkers: boolean }): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.JOB_QUEUE_FORCE !== "1") {
    return;
  }
  if (!process.env.DATABASE_URL) {
    logWarn("Job queue disabled: DATABASE_URL not set");
    return;
  }
  const b = getBoss();
  if (!started) {
    await b.start();
    started = true;
    logInfo("Job queue started");
  }
  if (opts.withWorkers && !workersRegistered) {
    await registerHandlers();
    workersRegistered = true;
    logInfo("Job queue handlers registered", {
      handlers: Array.from(handlers.keys()),
    });
  }
}

export async function stopJobQueue(): Promise<void> {
  if (boss && started) {
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
    } catch (err) {
      logWarn("Job queue stop failed", { error: String(err) });
    }
    started = false;
    workersRegistered = false;
  }
}

/**
 * Declare a handler for a job name. Must be called before
 * `startJobQueue({ withWorkers: true })`. Safe to call multiple times
 * with the same name (last registration wins) so dev hot-reload doesn't
 * blow up.
 */
export function defineJob<TPayload>(
  name: JobName,
  handler: JobHandler<TPayload>,
  opts: { perTenantConcurrency?: number } = {},
): void {
  handlers.set(name, {
    handler: handler as JobHandler<unknown>,
    perTenantConcurrency: opts.perTenantConcurrency ?? 2,
  });
}

async function registerHandlers(): Promise<void> {
  const b = getBoss();
  for (const [name, def] of Array.from(handlers.entries())) {
    // pg-boss v10 delivers batches; we still process one-by-one so the
    // per-tenant semaphore in `runJobWithContext` stays meaningful.
    await b.work<InternalJobPayload<unknown>>(
      name,
      { batchSize: 4, newJobCheckIntervalSeconds: 2 } as PgBoss.WorkOptions,
      async (jobs) => {
        const list = (Array.isArray(jobs) ? jobs : [jobs]) as unknown as PgBoss.JobWithMetadata<InternalJobPayload<unknown>>[];
        for (const job of list) {
          try {
            await runJobWithContext(name, def, job);
          } catch (err) {
            // Tenant-concurrency overflow: ack the current attempt and
            // explicitly re-enqueue with a UNIQUE singleton key so the
            // active-singleton dedup doesn't silently swallow it. This
            // does not burn the original job's retry budget.
            if (err instanceof Error && (err as Error & { tenantOverflow?: boolean }).tenantOverflow) {
              await b.send(name, job.data, {
                startAfter: 5,
                retryLimit: 5,
                retryBackoff: true,
                retryDelay: 10,
                singletonKey: `${job.data.idempotencyKey}:overflow:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
                expireInHours: 6,
              });
              continue;
            }
            throw err;
          }
        }
      },
    );
  }
}

async function countActiveJobsForTenant(
  name: JobName,
  orgId: string | null,
): Promise<number> {
  // Cross-instance fairness — count rows currently in `active` state in
  // pg-boss's job table for the same (name, orgId) tuple. The in-memory
  // semaphore handles same-pod fairness; this handles multi-worker pods.
  try {
    const dbi = await getBoss().getDb();
    const schema = process.env.PGBOSS_SCHEMA || "pgboss";
    const result = await dbi.executeSql(
      `SELECT COUNT(*)::int AS n FROM ${schema}.job
         WHERE name = $1 AND state = 'active'
           AND COALESCE(data->>'organizationId', '_global') = $2`,
      [name, orgId ?? "_global"],
    );
    const row = (result?.rows ?? [])[0] as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch (err) {
    logWarn("countActiveJobsForTenant failed", { name, error: String(err) });
    return 0;
  }
}

async function runJobWithContext(
  name: JobName,
  def: { handler: JobHandler<unknown>; perTenantConcurrency: number },
  job: PgBoss.JobWithMetadata<InternalJobPayload<unknown>>,
): Promise<void> {
  const data = job.data;
  const orgId = data.organizationId;
  const key = tenantKey(name, orgId);
  const inFlight = tenantInFlight.get(key) ?? 0;
  // Fairness check: combine in-memory semaphore (same-pod) with a
  // cross-pod active-count query (subtract this job, which is already
  // marked active by the time the handler fires).
  const crossInstance = Math.max(0, (await countActiveJobsForTenant(name, orgId)) - 1);
  if (inFlight >= def.perTenantConcurrency || crossInstance >= def.perTenantConcurrency) {
    // Signal overflow up to the work() wrapper which will explicitly
    // re-enqueue with a UNIQUE singleton key (the active singleton key
    // would otherwise dedupe a same-key send() and drop the work).
    recordJobMetrics(`queue:${name}`, { skipped: 1 });
    const err = new Error(
      `tenant_concurrency_exceeded:${name}:${orgId ?? "_global"} (inFlight=${inFlight}, crossInstance=${crossInstance}, cap=${def.perTenantConcurrency})`,
    );
    (err as Error & { tenantOverflow?: boolean }).tenantOverflow = true;
    throw err;
  }
  tenantInFlight.set(key, inFlight + 1);

  const ctx: JobContext = {
    jobId: job.id,
    jobName: name,
    organizationId: orgId,
    userId: data.userId,
    idempotencyKey: data.idempotencyKey,
    // pg-boss exposes the attempt count via `retrycount` (0 on first try).
    attempt: ((job as unknown as { retrycount?: number }).retrycount ?? 0) + 1,
    progress: async (pct, message, extra) => {
      await publishJobProgress({
        jobId: job.id,
        jobName: name,
        organizationId: orgId,
        userId: data.userId,
        status: "running",
        progress: pct,
        message,
        extra,
      });
    },
  };

  const start = Date.now();
  try {
    let result: unknown;
    if (orgId) {
      result = await withOrgContext(
        { organizationId: orgId, source: `job:${name}`, isSuperadmin: false },
        async () => def.handler(data.payload, ctx),
      );
    } else {
      result = await def.handler(data.payload, ctx);
    }
    recordJobMetrics(`queue:${name}`, { succeeded: 1, durationMs: Date.now() - start });
    await publishJobProgress({
      jobId: job.id,
      jobName: name,
      organizationId: orgId,
      userId: data.userId,
      status: "completed",
      progress: 100,
      result,
    });
  } catch (err) {
    recordJobMetrics(`queue:${name}`, { failed: 1, durationMs: Date.now() - start });
    const error = err instanceof Error ? err : new Error(String(err));
    logError(`Job ${name} failed`, { jobId: job.id, attempt: ctx.attempt }, error);
    await publishJobProgress({
      jobId: job.id,
      jobName: name,
      organizationId: orgId,
      userId: data.userId,
      status: "failed",
      progress: 0,
      message: error.message,
    });
    throw err;
  } finally {
    const v = tenantInFlight.get(key) ?? 1;
    if (v <= 1) tenantInFlight.delete(key);
    else tenantInFlight.set(key, v - 1);
  }
}

export async function enqueueJob<TPayload>(
  name: JobName,
  payload: TPayload,
  opts: EnqueueOptions,
): Promise<EnqueueResult> {
  if (!started) {
    await startJobQueue({ withWorkers: false });
  }
  const idempotencyKey = opts.idempotencyKey ?? buildIdempotencyKey(name, opts.organizationId, payload);
  const data: InternalJobPayload<TPayload> = {
    payload,
    organizationId: opts.organizationId,
    userId: opts.userId,
    idempotencyKey,
  };
  const jobId = await getBoss().send(name, data, {
    startAfter: opts.startAfterSeconds ?? 0,
    retryLimit: opts.retryLimit ?? 5,
    retryBackoff: true,
    retryDelay: 10,
    singletonKey: idempotencyKey,
    expireInHours: 6,
  });
  if (!jobId) {
    // pg-boss returns null when a singleton with the same key is
    // already queued / active. Look up the real existing job id via
    // singletonkey so the client can poll /api/jobs/:id correctly.
    const existing = await findActiveJobBySingletonKey(name, idempotencyKey);
    return {
      jobId: existing ?? idempotencyKey,
      idempotencyKey,
      deduplicated: true,
    };
  }
  return { jobId, idempotencyKey, deduplicated: false };
}

async function findActiveJobBySingletonKey(
  name: JobName,
  singletonKey: string,
): Promise<string | null> {
  try {
    const dbi = await getBoss().getDb();
    const schema = process.env.PGBOSS_SCHEMA || "pgboss";
    const result = await dbi.executeSql(
      `SELECT id FROM ${schema}.job
        WHERE name = $1 AND singletonkey = $2
          AND state IN ('created','retry','active')
        ORDER BY createdon DESC LIMIT 1`,
      [name, singletonKey],
    );
    const row = (result?.rows ?? [])[0] as { id?: string } | undefined;
    return row?.id ?? null;
  } catch (err) {
    logWarn("findActiveJobBySingletonKey failed", {
      name,
      error: String(err),
    });
    return null;
  }
}

export interface JobStatus {
  id: string;
  name: string;
  state: string;
  data: unknown;
  output: unknown;
  createdOn: Date | null;
  startedOn: Date | null;
  completedOn: Date | null;
  retryCount: number;
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  if (!started) await startJobQueue({ withWorkers: false });
  // pg-boss v10's getJobById requires the queue name; we don't always
  // have it on the caller side, so query the job table directly. Same
  // table we read for the DLQ list.
  const dbi = await getBoss().getDb();
  const schema = process.env.PGBOSS_SCHEMA || "pgboss";
  const result = await dbi.executeSql(
    `SELECT id, name, state, data, output, retrycount, createdon, startedon, completedon
       FROM ${schema}.job
       WHERE id = $1
       LIMIT 1`,
    [jobId],
  );
  const row = (result?.rows ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: jobId,
    name: String(row.name ?? ""),
    state: String(row.state ?? ""),
    data: row.data,
    output: row.output,
    createdOn: (row.createdon as Date | null) ?? null,
    startedOn: (row.startedon as Date | null) ?? null,
    completedOn: (row.completedon as Date | null) ?? null,
    retryCount: Number(row.retrycount ?? 0),
  };
}

export async function getQueueDepths(): Promise<
  Array<{ name: JobName; size: number }>
> {
  if (!started) await startJobQueue({ withWorkers: false });
  const out: Array<{ name: JobName; size: number }> = [];
  for (const name of handlers.keys()) {
    try {
      const size = await getBoss().getQueueSize(name);
      out.push({ name, size });
    } catch (err) {
      logWarn("getQueueSize failed", { name, error: String(err) });
      out.push({ name, size: 0 });
    }
  }
  // Include any registered names that weren't registered as workers in
  // this process (e.g. HTTP-only pod).
  for (const name of [
    "ai_takeoff_analyze",
    "ai_document_analyze",
    "ai_estimator_draft",
    "pdf_tile_prerender",
    "accounting_sync",
    "bulk_export",
    "plan_set_ingest",
  ] as JobName[]) {
    if (!out.find((o) => o.name === name)) {
      try {
        const size = await getBoss().getQueueSize(name);
        out.push({ name, size });
      } catch {
        out.push({ name, size: 0 });
      }
    }
  }
  return out;
}

export interface DeadLetterRow {
  id: string;
  name: string;
  data: unknown;
  output: unknown;
  retryCount: number;
  createdOn: Date | null;
  completedOn: Date | null;
}

export async function listDeadLetterJobs(limit = 50): Promise<DeadLetterRow[]> {
  if (!started) await startJobQueue({ withWorkers: false });
  const b = getBoss();
  const db = await b.getDb();
  const schema = process.env.PGBOSS_SCHEMA || "pgboss";
  const result = await db.executeSql(
    `SELECT id, name, data, output, retrycount, createdon, completedon
       FROM ${schema}.job
       WHERE state = 'failed'
       ORDER BY completedon DESC NULLS LAST
       LIMIT $1`,
    [limit],
  );
  const rows = (result?.rows ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    data: r.data,
    output: r.output,
    retryCount: Number(r.retrycount ?? 0),
    createdOn: (r.createdon as Date | null) ?? null,
    completedOn: (r.completedon as Date | null) ?? null,
  }));
}

/**
 * Re-enqueue a previously failed job. Reuses the original payload and
 * idempotency key so the same downstream side-effects apply.
 */
export async function retryDeadLetterJob(jobId: string): Promise<EnqueueResult | null> {
  if (!started) await startJobQueue({ withWorkers: false });
  const status = await getJobStatus(jobId);
  if (!status) return null;
  const data = status.data as InternalJobPayload<unknown> | null;
  if (!data) return null;
  return enqueueJob(status.name as JobName, data.payload, {
    organizationId: data.organizationId,
    userId: data.userId,
    idempotencyKey: `${data.idempotencyKey}:retry:${Date.now()}`,
  });
}

interface PublishProgressArgs {
  jobId: string;
  jobName: JobName;
  organizationId: string | null;
  userId: string | null;
  status: "running" | "completed" | "failed";
  progress: number;
  message?: string;
  result?: unknown;
  extra?: Record<string, unknown>;
}

async function publishJobProgress(args: PublishProgressArgs): Promise<void> {
  if (!args.userId || !args.organizationId) return;
  try {
    // Reuse the messaging bus fan-out so SSE/WS clients on any pod see
    // the update. The "conversation" id is just the job id; clients
    // subscribe by user id, not by conversation, so this is harmless.
    await publishMessagingEvent(
      "message_new",
      args.organizationId,
      `job:${args.jobId}`,
      [args.userId],
      {
        __jobProgress: true,
        jobId: args.jobId,
        jobName: args.jobName,
        status: args.status,
        progress: args.progress,
        message: args.message,
        result: args.result,
        extra: args.extra,
      },
    );
  } catch (err) {
    logWarn("publishJobProgress failed", { jobId: args.jobId, error: String(err) });
  }
}

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

// All known job queue names — used to pre-register queues in pgboss.queue
// at startup so boss.send() never silently drops a job due to a missing
// queue row (pg-boss v10's insertJob SQL does JOIN pgboss.queue and
// returns null when the queue is not registered there).
const ALL_JOB_NAMES: readonly JobName[] = [
  "ai_takeoff_analyze",
  "ai_document_analyze",
  "ai_estimator_draft",
  "pdf_tile_prerender",
  "accounting_sync",
  "bulk_export",
  "plan_set_ingest",
];

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
 * Ensure a queue is registered in pgboss.queue so that boss.send() can
 * insert jobs for it. pg-boss v10's insertJob SQL does:
 *   INSERT ... FROM j JOIN pgboss.queue q ON j.name = q.name ...
 * If the queue row is missing the JOIN returns nothing and send() silently
 * returns null — the job is lost. boss.work() does NOT call createQueue(),
 * so queues must be pre-registered explicitly.
 *
 * Safe to call repeatedly: boss.createQueue() uses ON CONFLICT DO NOTHING
 * for the queue row, and skips table creation if it finds the row already
 * exists. If the partition table already exists but the queue row was
 * somehow deleted (e.g. after a pgboss.queue truncation), we fall back to
 * a direct upsert-style INSERT so the existing partition stays usable.
 */
async function ensureQueueRegistered(name: string, b: PgBoss): Promise<void> {
  const schema = process.env.PGBOSS_SCHEMA || "pgboss";
  try {
    await b.createQueue(name);
  } catch (err) {
    // Partition table already exists — happens when pgboss.queue was
    // cleared but partition tables survived. Just insert the queue row.
    const errMsg = String(err);
    if (
      errMsg.includes("already exists") ||
      errMsg.includes("duplicate") ||
      errMsg.includes("42P07")   // PostgreSQL "duplicate_table" SQLSTATE
    ) {
      try {
        const dbi = await b.getDb();
        await dbi.executeSql(
          `INSERT INTO ${schema}.queue (name, policy, partition_name)
           VALUES ($1, 'standard', 'j' || encode(sha224($1::bytea), 'hex'))
           ON CONFLICT (name) DO NOTHING`,
          [name],
        );
      } catch (insertErr) {
        logWarn("ensureQueueRegistered fallback INSERT failed", {
          queue: name,
          error: String(insertErr),
        });
      }
    } else {
      logWarn("ensureQueueRegistered createQueue failed", {
        queue: name,
        error: errMsg,
      });
    }
  }
}

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
  // Pre-register all known queues so boss.send() never silently drops a job.
  // Called unconditionally (both HTTP server and worker) so the server
  // process can enqueue even if the worker hasn't run createQueue() yet.
  // NOTE: must run sequentially — boss.createQueue() issues ALTER TABLE
  // ATTACH PARTITION which takes an exclusive lock; concurrent calls deadlock.
  for (const name of ALL_JOB_NAMES) {
    await ensureQueueRegistered(name, b);
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
    // pg-boss 10 exposes the attempt count via `retry_count`
    // (snake_case; older versions used `retrycount`). Read both for
    // compatibility with mocked job objects in tests.
    attempt:
      ((job as unknown as { retry_count?: number; retrycount?: number }).retry_count ??
        (job as unknown as { retrycount?: number }).retrycount ??
        0) + 1,
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
      // pg-boss 10 columns are snake_case (singleton_key, created_on);
      // legacy camelCase variants no longer exist and threw 500s.
      `SELECT id FROM ${schema}.job
        WHERE name = $1 AND singleton_key = $2
          AND state IN ('created','retry','active')
        ORDER BY created_on DESC LIMIT 1`,
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
    `SELECT id, name, state, data, output, retry_count, created_on, started_on, completed_on
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
    createdOn: (row.created_on as Date | null) ?? null,
    startedOn: (row.started_on as Date | null) ?? null,
    completedOn: (row.completed_on as Date | null) ?? null,
    retryCount: Number(row.retry_count ?? 0),
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
    `SELECT id, name, data, output, retry_count, created_on, completed_on
       FROM ${schema}.job
       WHERE state = 'failed'
       ORDER BY completed_on DESC NULLS LAST
       LIMIT $1`,
    [limit],
  );
  const rows = (result?.rows ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    data: r.data,
    output: r.output,
    retryCount: Number(r.retry_count ?? 0),
    createdOn: (r.created_on as Date | null) ?? null,
    completedOn: (r.completed_on as Date | null) ?? null,
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

// Task #2668 — exported so the AI takeoff cancel endpoint and the stall
// watchdog can publish terminal SSE events from outside the queue
// pipeline.
export async function publishJobProgress(args: PublishProgressArgs): Promise<void> {
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

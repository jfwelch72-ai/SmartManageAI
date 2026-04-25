/**
 * Lightweight job metrics surface.
 *
 * Background jobs call `recordJobMetrics(jobName, counters)` at the end of
 * each tick. We keep a rolling 24h window of samples per job so a Super
 * Admin can hit an admin endpoint to spot regressions (e.g. a DST bug
 * spiking `skippedDedupe`, or an empty-contact week causing
 * `skippedNoBirthdays` to dominate) without needing to grep raw logs.
 *
 * Task #705: samples are now ALSO persisted to the `job_metric_samples`
 * table so the window survives server restarts/deploys. The in-process
 * Map remains the read path (sync API, no DB round-trip per request) and
 * is hydrated from the table at startup via `loadJobMetricsFromDb()`.
 * DB writes are fire-and-forget so a transient DB hiccup never breaks a
 * job tick — the in-memory record always succeeds, and the row will be
 * missing on next restart only if the insert genuinely failed.
 */

import { db } from "../db";
import { jobMetricSamples } from "@shared/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import { logError } from "./logger";

export type JobCounters = Record<string, number>;

export interface JobMetricSample {
  timestamp: number;
  counters: JobCounters;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const PERSISTED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_JOB = 2000;

export type MetricsRangeKey = "24h" | "7d" | "30d";
export const METRICS_RANGES: Record<MetricsRangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function parseMetricsRange(value: unknown): MetricsRangeKey {
  if (value === "7d" || value === "30d") return value;
  return "24h";
}

const samplesByJob = new Map<string, JobMetricSample[]>();
let persistenceEnabled = true;

function prune(job: string, now: number): JobMetricSample[] {
  const list = samplesByJob.get(job);
  if (!list) return [];
  const cutoff = now - RETENTION_MS;
  let i = 0;
  while (i < list.length && list[i].timestamp < cutoff) i++;
  if (i > 0) list.splice(0, i);
  if (list.length > MAX_SAMPLES_PER_JOB) {
    list.splice(0, list.length - MAX_SAMPLES_PER_JOB);
  }
  return list;
}

async function persistSample(job: string, sample: JobMetricSample): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    await db.insert(jobMetricSamples).values({
      job,
      recordedAt: new Date(sample.timestamp),
      counters: sample.counters,
    });
  } catch (err) {
    logError("Failed to persist job metric sample", { job, error: String(err) });
  }
}

/**
 * Record a sample of counter values for a job tick. The sample is
 * stamped with the current time, kept in the rolling 24h in-memory
 * window, and asynchronously persisted to `job_metric_samples` so the
 * trend survives restarts.
 */
export function recordJobMetrics(job: string, counters: JobCounters): JobMetricSample {
  const now = Date.now();
  const sample: JobMetricSample = {
    timestamp: now,
    counters: { ...counters },
  };
  const list = samplesByJob.get(job) ?? [];
  list.push(sample);
  samplesByJob.set(job, list);
  prune(job, now);
  // Fire-and-forget — DB outages must never break a job tick.
  void persistSample(job, sample);
  return sample;
}

/**
 * Return the rolling 24h samples for a single job along with
 * convenience aggregates (sum / latest) for the counters seen.
 */
export function getJobMetrics(job: string): {
  job: string;
  windowMs: number;
  samples: JobMetricSample[];
  totals: JobCounters;
  latest: JobMetricSample | null;
} {
  const now = Date.now();
  const samples = prune(job, now).slice();
  const totals: JobCounters = {};
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.counters)) {
      // Task #1962 — guard against non-numeric values so jobs that store
      // richer per-run JSONB detail (e.g. dot_pay_items_refresh's
      // per-agency results array) don't poison the numeric totals/aggregates
      // shown on the JobMetricsHealth dashboard.
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return {
    job,
    windowMs: RETENTION_MS,
    samples,
    totals,
    latest: samples.length ? samples[samples.length - 1] : null,
  };
}

/**
 * Snapshot of every job currently tracked. Useful for a generic admin
 * dashboard listing all known job metrics in one call.
 */
export function getAllJobMetrics(): Array<ReturnType<typeof getJobMetrics>> {
  const now = Date.now();
  for (const job of samplesByJob.keys()) prune(job, now);
  return Array.from(samplesByJob.keys()).sort().map(getJobMetrics);
}

function summarize(job: string, windowMs: number, samples: JobMetricSample[]) {
  const totals: JobCounters = {};
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.counters)) {
      // Task #1962 — same numeric guard as `getJobMetrics`; see comment there.
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return {
    job,
    windowMs,
    samples,
    totals,
    latest: samples.length ? samples[samples.length - 1] : null,
  };
}

/**
 * Range-aware variant. For 24h we use the in-memory rolling window
 * (fast, no DB round-trip). For 7d / 30d we query the persisted
 * `job_metric_samples` table directly so admins can spot slow
 * regressions that span days or weeks.
 */
export async function getJobMetricsForRange(job: string, range: MetricsRangeKey) {
  const windowMs = METRICS_RANGES[range];
  if (range === "24h") {
    const mem = getJobMetrics(job);
    return { ...mem, windowMs };
  }
  if (!persistenceEnabled) return summarize(job, windowMs, []);
  const cutoff = new Date(Date.now() - windowMs);
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(and(eq(jobMetricSamples.job, job), gte(jobMetricSamples.recordedAt, cutoff)))
      .orderBy(jobMetricSamples.recordedAt);
    const samples: JobMetricSample[] = rows.map((r) => ({
      timestamp: new Date(r.recordedAt).getTime(),
      counters: (r.counters as JobCounters) ?? {},
    }));
    return summarize(job, windowMs, samples);
  } catch (err) {
    logError("Failed to load job metrics for range", { job, range, error: String(err) });
    return summarize(job, windowMs, []);
  }
}

export async function getAllJobMetricsForRange(range: MetricsRangeKey) {
  const windowMs = METRICS_RANGES[range];
  if (range === "24h") {
    return getAllJobMetrics().map((j) => ({ ...j, windowMs }));
  }
  if (!persistenceEnabled) return [];
  const cutoff = new Date(Date.now() - windowMs);
  try {
    const rows = await db
      .select({
        job: jobMetricSamples.job,
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(gte(jobMetricSamples.recordedAt, cutoff))
      .orderBy(jobMetricSamples.recordedAt);
    const byJob = new Map<string, JobMetricSample[]>();
    for (const row of rows) {
      const list = byJob.get(row.job) ?? [];
      list.push({
        timestamp: new Date(row.recordedAt).getTime(),
        counters: (row.counters as JobCounters) ?? {},
      });
      byJob.set(row.job, list);
    }
    return Array.from(byJob.keys())
      .sort()
      .map((job) => summarize(job, windowMs, byJob.get(job)!));
  } catch (err) {
    logError("Failed to load all job metrics for range", { range, error: String(err) });
    return [];
  }
}

/**
 * Hydrate the in-memory window from the persisted samples table. Called
 * once at startup so a fresh process immediately has access to the
 * trailing 24h of data instead of starting empty.
 */
export async function loadJobMetricsFromDb(): Promise<number> {
  if (!persistenceEnabled) return 0;
  const cutoff = new Date(Date.now() - RETENTION_MS);
  try {
    const rows = await db
      .select({
        job: jobMetricSamples.job,
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(gte(jobMetricSamples.recordedAt, cutoff))
      .orderBy(jobMetricSamples.recordedAt);

    samplesByJob.clear();
    for (const row of rows) {
      const list = samplesByJob.get(row.job) ?? [];
      list.push({
        timestamp: new Date(row.recordedAt).getTime(),
        counters: (row.counters as JobCounters) ?? {},
      });
      samplesByJob.set(row.job, list);
    }
    // Cap each job to MAX_SAMPLES_PER_JOB just in case the DB has more.
    const now = Date.now();
    for (const job of samplesByJob.keys()) prune(job, now);
    return rows.length;
  } catch (err) {
    logError("Failed to hydrate job metrics from DB", { error: String(err) });
    return 0;
  }
}

/**
 * Delete persisted samples older than the retention window. Called
 * periodically by the job runner to keep the table bounded.
 */
export async function pruneJobMetricsDb(): Promise<number> {
  if (!persistenceEnabled) return 0;
  const cutoff = new Date(Date.now() - PERSISTED_RETENTION_MS);
  try {
    const deleted = await db
      .delete(jobMetricSamples)
      .where(lt(jobMetricSamples.recordedAt, cutoff))
      .returning({ id: jobMetricSamples.id });
    return deleted.length;
  } catch (err) {
    logError("Failed to prune persisted job metrics", { error: String(err) });
    return 0;
  }
}

/**
 * Test helper — drop all in-memory samples (does not touch the DB).
 */
export function resetJobMetrics(): void {
  samplesByJob.clear();
}

/**
 * Clear stored job metric history. Wipes both the in-memory rolling
 * window and the persisted `job_metric_samples` rows. When `job` is
 * provided only that job's samples are removed; otherwise every job is
 * cleared. Returns the number of DB rows deleted.
 *
 * Used by the Super Admin "reset metrics" endpoint so a known-bad
 * deploy or noisy backfill can be flushed without manual SQL.
 */
export async function clearJobMetrics(job?: string): Promise<number> {
  if (job) {
    samplesByJob.delete(job);
  } else {
    samplesByJob.clear();
  }
  if (!persistenceEnabled) return 0;
  try {
    const deleted = job
      ? await db
          .delete(jobMetricSamples)
          .where(eq(jobMetricSamples.job, job))
          .returning({ id: jobMetricSamples.id })
      : await db.delete(jobMetricSamples).returning({ id: jobMetricSamples.id });
    return deleted.length;
  } catch (err) {
    logError("Failed to clear persisted job metrics", { job: job ?? "*", error: String(err) });
    return 0;
  }
}

/**
 * Test helper — disable DB persistence so unit tests don't hit the DB.
 * Kept module-private semantics by default; tests opt-in explicitly.
 */
export function setJobMetricsPersistenceEnabled(enabled: boolean): void {
  persistenceEnabled = enabled;
}

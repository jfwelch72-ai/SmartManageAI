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
import { gte, lt } from "drizzle-orm";
import { logError } from "./logger";

export type JobCounters = Record<string, number>;

export interface JobMetricSample {
  timestamp: number;
  counters: JobCounters;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_JOB = 2000;

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
  const cutoff = new Date(Date.now() - RETENTION_MS);
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
 * Test helper — disable DB persistence so unit tests don't hit the DB.
 * Kept module-private semantics by default; tests opt-in explicitly.
 */
export function setJobMetricsPersistenceEnabled(enabled: boolean): void {
  persistenceEnabled = enabled;
}

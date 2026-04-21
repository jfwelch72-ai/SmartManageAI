/**
 * Lightweight in-process job metrics surface.
 *
 * Background jobs call `recordJobMetrics(jobName, counters)` at the end of
 * each tick. We keep a rolling 24h window of samples per job in memory so
 * a Super Admin can hit an admin endpoint to spot regressions (e.g. a DST
 * bug spiking `skippedDedupe`, or an empty-contact week causing
 * `skippedNoBirthdays` to dominate) without needing to grep raw logs.
 *
 * This is intentionally process-local. Metrics reset on restart and are
 * not aggregated across workers — sufficient for the single-process
 * scheduler we run today and good enough for the "log query / dev page"
 * acceptance criterion in task #700.
 */

export type JobCounters = Record<string, number>;

export interface JobMetricSample {
  timestamp: number;
  counters: JobCounters;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_JOB = 2000;

const samplesByJob = new Map<string, JobMetricSample[]>();

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

/**
 * Record a sample of counter values for a job tick. The sample is
 * stamped with the current time and pruned to the rolling 24h window.
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
 * Test helper — drop all in-memory samples.
 */
export function resetJobMetrics(): void {
  samplesByJob.clear();
}

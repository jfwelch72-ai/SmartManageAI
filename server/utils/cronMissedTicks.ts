/**
 * Task #2753 — In-process counter for node-cron `execution:missed` events.
 *
 * node-cron emits `execution:missed` on a task when its scheduled fire time
 * slips because the event loop was saturated. We intercept these in
 * `scheduleCron()` (server/jobs/jobRunner.ts) and record them here so:
 *
 *   1. The /metrics Prometheus endpoint exposes
 *      `cron_missed_ticks_total{job}` for alerting.
 *   2. Each miss produces a single structured `logWarn` line with
 *      `{ job, scheduledAt }` instead of the raw node-cron console.warn.
 *
 * The counter is intentionally process-local (not persisted) — it is a
 * real-time health signal, not a historical audit trail. Reset to zero
 * on each server restart, which is intentional.
 */

const _counters = new Map<string, number>();

/** Increment the missed-tick counter for the named job. */
export function recordCronMissedTick(job: string): void {
  _counters.set(job, (_counters.get(job) ?? 0) + 1);
}

/** Return a snapshot of all non-zero missed-tick counters. */
export function getCronMissedTicksSnapshot(): Array<{ job: string; value: number }> {
  const out: Array<{ job: string; value: number }> = [];
  for (const [job, value] of _counters.entries()) {
    if (value > 0) out.push({ job, value });
  }
  return out;
}

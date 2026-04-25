/**
 * Task #1950 — Real-time Postgres pool health surface.
 *
 * Task #1949 added structured `pool_exhausted` vs `query_failed` log
 * lines but admins still had to grep production logs to know when the
 * shared connection pool was starving. This module exposes:
 *
 *   1. Live pool counters (`active`, `idle`, `waiting`, `total`, `max`)
 *      pulled directly from the `pg.Pool` instance in `server/db.ts`.
 *   2. A small in-process ring buffer of the last 50 `pool_exhausted`
 *      events emitted by `logJobErrorWithKind` in `jobRunner.ts`.
 *
 * Both surfaces are intentionally process-local — the goal is "spot the
 * problem in the dashboard before the next republish hangs", not durable
 * audit. Persisting every starvation event would add write pressure on
 * the very pool we're trying to monitor.
 *
 * Task #1957 — Wire pool starvation into the existing job-metric alert
 * engine so Super Admins get the same in-app + SendGrid notification
 * (with quiet-hours / digest behavior) the moment the pool starts
 * starving — no need to keep the dashboard open.
 *
 * Two counters are published under the synthetic `pool_health` job:
 *
 *   - `exhausted` — incremented by `recordPoolExhaustedEvent`. The
 *     `PER_JOB_DEFAULTS["pool_health"]` absolute-floor spike rule in
 *     `jobMetricAlerts.ts` fires (and, if the rate clears the email
 *     floor, escalates) when the per-hour count exceeds a configurable
 *     threshold.
 *
 *   - `waitingSaturated` — incremented by `samplePoolHealth` when the
 *     `waiting` counter stays > 0 for `WAITING_SATURATION_SAMPLES`
 *     consecutive samples. After firing, the consecutive counter is
 *     reset so each saturation *episode* publishes one event rather
 *     than one event per saturated minute (the alert engine's dedupe
 *     window further suppresses repeat pages).
 *
 * Each `samplePoolHealth` tick also publishes a `sampled: 1` heartbeat
 * so the engine's stall rule can fire if the sampler itself stops
 * reporting (server hung, runner crashed, etc.).
 */

import type { Pool } from "pg";
import { pool as defaultPool } from "../db";
import { recordJobMetrics } from "./jobMetrics";

export interface PoolStats {
  active: number;
  idle: number;
  waiting: number;
  total: number;
  max: number;
}

export interface PoolExhaustedEvent {
  timestamp: number;
  job: string;
  message: string;
  error: string;
}

const MAX_EVENTS = 50;
const events: PoolExhaustedEvent[] = [];

/**
 * Synthetic job name under which pool-health counters are published to
 * `jobMetrics` so the existing alert engine in `jobMetricAlerts.ts` can
 * apply spike / stall rules without any new wiring.
 */
export const POOL_HEALTH_JOB = "pool_health";

/**
 * Number of consecutive `samplePoolHealth` ticks that must observe
 * `waiting > 0` before a `waitingSaturated` counter is published. With
 * the default 1-minute sampling cadence in `jobRunner.ts`, the default
 * value of 3 means "page after the pool has had queued waiters for
 * roughly three minutes straight" — short enough to catch a real
 * starvation episode quickly, long enough to ride out a single slow
 * query that briefly parks one waiter.
 *
 * Operators can override via env var without redeploying. Negative or
 * non-finite values fall back to the default so a typo can't disable
 * the alert.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  const int = Math.floor(raw);
  return int > 0 ? int : fallback;
}

export const WAITING_SATURATION_SAMPLES = readPositiveIntEnv(
  "POOL_HEALTH_WAITING_SATURATION_SAMPLES",
  3,
);

let consecutiveWaitingSamples = 0;

/**
 * Read the live pg.Pool counters. Defaults to the shared pool exported
 * from `server/db.ts`; tests can pass a stub.
 */
export function getPoolStats(pool: Pool = defaultPool): PoolStats {
  const total = pool.totalCount ?? 0;
  const idle = pool.idleCount ?? 0;
  const waiting = pool.waitingCount ?? 0;
  const max =
    typeof (pool as unknown as { options?: { max?: number } }).options?.max === "number"
      ? ((pool as unknown as { options: { max: number } }).options.max)
      : 0;
  return {
    active: Math.max(0, total - idle),
    idle,
    waiting,
    total,
    max,
  };
}

/**
 * Append a `pool_exhausted` event to the rolling 50-entry buffer. Older
 * events are dropped FIFO so the buffer stays bounded.
 *
 * Task #1957 — Also publishes a `pool_health.exhausted` job-metric
 * sample so the existing alert engine can fire the absolute-floor spike
 * rule. The metric publish is wrapped in try/catch so a transient
 * failure (e.g. the metrics module itself running into a pool error)
 * never blocks the in-memory buffer write — observability must not
 * cascade into application failures.
 */
export function recordPoolExhaustedEvent(event: {
  job: string;
  message: string;
  error: string;
}): PoolExhaustedEvent {
  const entry: PoolExhaustedEvent = {
    timestamp: Date.now(),
    job: event.job,
    message: event.message,
    error: event.error,
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  try {
    recordJobMetrics(POOL_HEALTH_JOB, { exhausted: 1 });
  } catch {
    // Best-effort observability — buffering the event is the primary
    // contract; metric publication is a downstream nice-to-have.
  }
  return entry;
}

/**
 * Return the buffered `pool_exhausted` events, newest first.
 */
export function getRecentPoolExhaustedEvents(): PoolExhaustedEvent[] {
  return events.slice().reverse();
}

/**
 * Test helper — drop all buffered events.
 */
export function resetPoolExhaustedEvents(): void {
  events.length = 0;
}

/**
 * Task #1957 — Periodic poll that captures live pool counters and
 * publishes them as `pool_health` job-metric samples. Called from a
 * 1-minute cron in `jobRunner.ts`. Each tick publishes:
 *
 *   - `sampled: 1` — heartbeat for the engine's stall rule.
 *   - `waiting`, `active` — gauge values stamped on the sample so the
 *     dashboard / 7-30d trend view can plot pool pressure over time.
 *     These are summed by the alert engine, which is meaningless for
 *     gauges, so no spike rule is wired to them.
 *   - `waitingSaturated: 1` — published only when `waiting > 0` has
 *     been observed on `WAITING_SATURATION_SAMPLES` consecutive ticks.
 *     After publishing, the consecutive counter is reset to 0 so a
 *     sustained saturation publishes one event per N-tick window
 *     rather than every tick. The alert engine's dedupe window further
 *     suppresses repeat pages.
 */
export function samplePoolHealth(pool: Pool = defaultPool): PoolStats {
  const stats = getPoolStats(pool);
  const counters: Record<string, number> = {
    sampled: 1,
    waiting: stats.waiting,
    active: stats.active,
  };

  if (stats.waiting > 0) {
    consecutiveWaitingSamples++;
    if (consecutiveWaitingSamples >= WAITING_SATURATION_SAMPLES) {
      counters.waitingSaturated = 1;
      // Reset so a continuing saturation needs another N consecutive
      // samples before publishing the next event. Combined with the
      // 60-minute alert dedupe this keeps a stuck pool from spamming
      // Super Admins every minute while still re-paging if the
      // condition outlives the dedupe window.
      consecutiveWaitingSamples = 0;
    }
  } else {
    consecutiveWaitingSamples = 0;
  }

  try {
    recordJobMetrics(POOL_HEALTH_JOB, counters);
  } catch {
    // Best-effort — never let metric publication break the sampler.
  }
  return stats;
}

/**
 * Test helper — reset the consecutive-waiting counter so each test can
 * drive `samplePoolHealth` from a clean slate.
 */
export function resetPoolHealthSamplerStateForTests(): void {
  consecutiveWaitingSamples = 0;
}

export const POOL_EXHAUSTED_BUFFER_SIZE = MAX_EVENTS;

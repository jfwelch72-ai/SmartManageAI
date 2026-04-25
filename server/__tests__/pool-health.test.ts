/**
 * Task #1950 — smoke tests for the in-process pool health surface.
 *
 * The module is process-local with no DB dependency for the buffer
 * portion, so we exercise the recording / retrieval / ring-buffer
 * trimming behaviour directly. `getPoolStats` is exercised against a
 * stub pool to avoid binding to live `db.ts` state.
 *
 * Task #1957 — `recordPoolExhaustedEvent` now also publishes a
 * `pool_health.exhausted` job-metric sample so the alert engine can
 * fire on it. We disable jobMetrics DB persistence in this suite so
 * the buffer-only tests don't need a live `job_metric_samples` table.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  getPoolStats,
  recordPoolExhaustedEvent,
  getRecentPoolExhaustedEvents,
  resetPoolExhaustedEvents,
  POOL_EXHAUSTED_BUFFER_SIZE,
} from "../utils/poolHealth";
import {
  resetJobMetrics,
  setJobMetricsPersistenceEnabled,
} from "../utils/jobMetrics";
import type { Pool } from "pg";

function stubPool(opts: {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  max: number;
}): Pool {
  return {
    totalCount: opts.totalCount,
    idleCount: opts.idleCount,
    waitingCount: opts.waitingCount,
    options: { max: opts.max },
  } as unknown as Pool;
}

beforeEach(() => {
  resetPoolExhaustedEvents();
  // Task #1957 — `recordPoolExhaustedEvent` now publishes a job-metric
  // sample, which would try to write to `job_metric_samples`. Disable
  // persistence so the suite stays in-process only.
  setJobMetricsPersistenceEnabled(false);
  resetJobMetrics();
});

afterAll(() => {
  setJobMetricsPersistenceEnabled(true);
});

describe("poolHealth.getPoolStats", () => {
  it("derives active = total - idle and surfaces max", () => {
    const stats = getPoolStats(
      stubPool({ totalCount: 10, idleCount: 3, waitingCount: 2, max: 60 }),
    );
    expect(stats).toEqual({
      active: 7,
      idle: 3,
      waiting: 2,
      total: 10,
      max: 60,
    });
  });

  it("clamps active to zero when the pool reports nonsensical idle > total", () => {
    const stats = getPoolStats(
      stubPool({ totalCount: 0, idleCount: 5, waitingCount: 0, max: 10 }),
    );
    expect(stats.active).toBe(0);
  });

  it("returns 0 max when the pool config does not expose options.max", () => {
    const pool = { totalCount: 0, idleCount: 0, waitingCount: 0 } as unknown as Pool;
    const stats = getPoolStats(pool);
    expect(stats.max).toBe(0);
  });
});

describe("poolHealth recent events buffer", () => {
  it("records events newest-first", () => {
    recordPoolExhaustedEvent({ job: "outbox", message: "Outbox processing failed", error: "timeout" });
    recordPoolExhaustedEvent({ job: "social_posts", message: "Social post processing failed", error: "Connection terminated unexpectedly" });

    const events = getRecentPoolExhaustedEvents();
    expect(events).toHaveLength(2);
    expect(events[0].job).toBe("social_posts");
    expect(events[1].job).toBe("outbox");
  });

  it("caps the buffer at POOL_EXHAUSTED_BUFFER_SIZE entries", () => {
    for (let i = 0; i < POOL_EXHAUSTED_BUFFER_SIZE + 10; i++) {
      recordPoolExhaustedEvent({ job: `job_${i}`, message: "msg", error: "err" });
    }
    const events = getRecentPoolExhaustedEvents();
    expect(events).toHaveLength(POOL_EXHAUSTED_BUFFER_SIZE);
    // The newest event is at index 0; the oldest retained should be the
    // (10th + 1) recorded event since the first 10 were evicted.
    expect(events[0].job).toBe(`job_${POOL_EXHAUSTED_BUFFER_SIZE + 9}`);
    expect(events[events.length - 1].job).toBe(`job_10`);
  });

  it("captures timestamp, job, message, and error on each entry", () => {
    const before = Date.now();
    const entry = recordPoolExhaustedEvent({
      job: "scheduled_campaigns",
      message: "Scheduled campaign processing failed",
      error: "timeout exceeded when trying to connect",
    });
    const after = Date.now();
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.job).toBe("scheduled_campaigns");
    expect(entry.message).toBe("Scheduled campaign processing failed");
    expect(entry.error).toMatch(/timeout/);
  });
});

// ---------------------------------------------------------------------
// Task #1957 — alert-engine integration. `recordPoolExhaustedEvent`
// publishes a `pool_health.exhausted` job-metric sample, and
// `samplePoolHealth` publishes `pool_health.{sampled,waitingSaturated}`
// so the existing alert engine can page Super Admins. We exercise the
// metric publication paths here against the in-memory jobMetrics
// surface (DB persistence disabled in the suite-level beforeEach).
// ---------------------------------------------------------------------

import {
  POOL_HEALTH_JOB,
  WAITING_SATURATION_SAMPLES,
  resetPoolHealthSamplerStateForTests,
  samplePoolHealth,
} from "../utils/poolHealth";
import { getJobMetrics } from "../utils/jobMetrics";

describe("poolHealth.recordPoolExhaustedEvent → jobMetrics (Task #1957)", () => {
  beforeEach(() => {
    resetPoolHealthSamplerStateForTests();
  });

  it("publishes a `pool_health.exhausted` sample on every recorded event", () => {
    recordPoolExhaustedEvent({
      job: "outbox",
      message: "Outbox processing failed",
      error: "Connection terminated due to connection timeout",
    });
    recordPoolExhaustedEvent({
      job: "social_posts",
      message: "Social post processing failed",
      error: "timeout exceeded when trying to connect",
    });

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.samples.length).toBe(2);
    expect(metrics.totals.exhausted).toBe(2);
  });
});

describe("poolHealth.samplePoolHealth (Task #1957)", () => {
  beforeEach(() => {
    resetPoolHealthSamplerStateForTests();
  });

  it("publishes a `sampled` heartbeat with the live waiting / active gauges on every tick", () => {
    samplePoolHealth(
      stubPool({ totalCount: 8, idleCount: 3, waitingCount: 0, max: 20 }),
    );

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.samples).toHaveLength(1);
    expect(metrics.samples[0].counters.sampled).toBe(1);
    expect(metrics.samples[0].counters.waiting).toBe(0);
    expect(metrics.samples[0].counters.active).toBe(5);
    // No saturation episode yet → no `waitingSaturated` counter.
    expect(metrics.samples[0].counters.waitingSaturated).toBeUndefined();
  });

  it("does NOT publish `waitingSaturated` until N consecutive samples have waiting > 0", () => {
    const saturated = stubPool({ totalCount: 10, idleCount: 0, waitingCount: 4, max: 10 });

    // Drive (N-1) saturated samples. None should publish the
    // `waitingSaturated` counter yet.
    for (let i = 0; i < WAITING_SATURATION_SAMPLES - 1; i++) {
      samplePoolHealth(saturated);
    }

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.samples).toHaveLength(WAITING_SATURATION_SAMPLES - 1);
    expect(metrics.totals.waitingSaturated ?? 0).toBe(0);
  });

  it("publishes `waitingSaturated: 1` on the Nth consecutive saturated sample", () => {
    const saturated = stubPool({ totalCount: 10, idleCount: 0, waitingCount: 4, max: 10 });

    for (let i = 0; i < WAITING_SATURATION_SAMPLES; i++) {
      samplePoolHealth(saturated);
    }

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.totals.waitingSaturated).toBe(1);
  });

  it("resets the consecutive counter when waiting drops back to 0", () => {
    const saturated = stubPool({ totalCount: 10, idleCount: 0, waitingCount: 4, max: 10 });
    const calm = stubPool({ totalCount: 10, idleCount: 5, waitingCount: 0, max: 10 });

    // Two saturated samples then a calm sample — the counter resets.
    samplePoolHealth(saturated);
    samplePoolHealth(saturated);
    samplePoolHealth(calm);

    // Two more saturated samples should still NOT trigger
    // `waitingSaturated` because the streak was broken.
    samplePoolHealth(saturated);
    samplePoolHealth(saturated);

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.totals.waitingSaturated ?? 0).toBe(0);
  });

  it("publishes one `waitingSaturated` per N-tick window for sustained saturation", () => {
    const saturated = stubPool({ totalCount: 10, idleCount: 0, waitingCount: 4, max: 10 });

    // 2 × N consecutive saturated samples should yield exactly 2
    // `waitingSaturated` events (one per N-tick episode), not 2N.
    for (let i = 0; i < 2 * WAITING_SATURATION_SAMPLES; i++) {
      samplePoolHealth(saturated);
    }

    const metrics = getJobMetrics(POOL_HEALTH_JOB);
    expect(metrics.totals.waitingSaturated).toBe(2);
  });
});

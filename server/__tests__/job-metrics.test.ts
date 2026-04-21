/**
 * Task #700: smoke tests for the lightweight job metrics surface.
 *
 * The module is process-local and has no DB dependency, so we exercise
 * the recording / aggregation / pruning behaviour directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordJobMetrics,
  getJobMetrics,
  getAllJobMetrics,
  resetJobMetrics,
  setJobMetricsPersistenceEnabled,
} from "../utils/jobMetrics";

beforeEach(() => {
  // Tests in this file exercise the in-memory surface only; disable DB
  // persistence so they don't depend on the `job_metric_samples` table.
  setJobMetricsPersistenceEnabled(false);
  resetJobMetrics();
});

afterEach(() => {
  vi.useRealTimers();
  resetJobMetrics();
  setJobMetricsPersistenceEnabled(true);
});

describe("jobMetrics", () => {
  it("records samples and aggregates totals across the rolling window", () => {
    recordJobMetrics("crm_birthday_digest", {
      digestsSent: 2,
      skippedTimeOfDay: 5,
      skippedDedupe: 0,
      skippedNoBirthdays: 1,
    });
    recordJobMetrics("crm_birthday_digest", {
      digestsSent: 3,
      skippedTimeOfDay: 7,
      skippedDedupe: 1,
      skippedNoBirthdays: 0,
    });

    const result = getJobMetrics("crm_birthday_digest");
    expect(result.samples.length).toBe(2);
    expect(result.totals).toEqual({
      digestsSent: 5,
      skippedTimeOfDay: 12,
      skippedDedupe: 1,
      skippedNoBirthdays: 1,
    });
    expect(result.latest?.counters.digestsSent).toBe(3);
  });

  it("drops samples older than the 24h retention window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
    recordJobMetrics("crm_birthday_digest", { digestsSent: 100 });

    // Jump 25h forward — the older sample must be pruned on the next read.
    vi.setSystemTime(new Date("2026-04-21T01:00:00Z"));
    recordJobMetrics("crm_birthday_digest", { digestsSent: 1 });

    const result = getJobMetrics("crm_birthday_digest");
    expect(result.samples.length).toBe(1);
    expect(result.totals.digestsSent).toBe(1);
  });

  it("returns an empty result for an unknown job", () => {
    const result = getJobMetrics("does-not-exist");
    expect(result.samples).toEqual([]);
    expect(result.totals).toEqual({});
    expect(result.latest).toBeNull();
  });

  it("lists every job seen via getAllJobMetrics", () => {
    recordJobMetrics("job_a", { count: 1 });
    recordJobMetrics("job_b", { count: 2 });
    const all = getAllJobMetrics();
    expect(all.map((j) => j.job).sort()).toEqual(["job_a", "job_b"]);
  });
});

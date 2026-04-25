// @vitest-environment jsdom
/**
 * Task #2017 — `pool_health` publishes `waiting` and `active` as live
 * gauges (instantaneous readings stamped on each sample). The dashboard
 * used to graph them on the same LineChart as the cumulative counters,
 * which sums per-tick gauge values into the 24h/7d/30d buckets — totally
 * meaningless. This test pins the new behavior of `bucketSamples`:
 *
 *   - `aggregation: "sum"` keeps the existing cumulative semantics
 *     (zero-filled empty buckets, sum-per-bucket).
 *   - `aggregation: "max"` is used by the new gauge sparkline. Empty
 *     buckets are `null` (so the line shows a gap instead of dipping to
 *     zero when the sampler skips a tick) and populated buckets carry
 *     the maximum gauge reading observed inside the bucket.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { bucketSamples } from "../JobMetricsDashboard";

const HOUR_MS = 60 * 60 * 1000;

// Anchor "now" so the 24h bucket math is deterministic. The dashboard
// uses a rolling cutoff of `now - 24 * HOUR_MS`, so picking a round
// timestamp simplifies the per-bucket arithmetic below.
const FROZEN_NOW = new Date("2026-04-25T12:00:00.000Z").getTime();
const RANGE_24H_START = FROZEN_NOW - 24 * HOUR_MS;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("bucketSamples — sum aggregation (cumulative counters)", () => {
  it("zero-fills empty buckets and sums per-tick samples inside each bucket", () => {
    // Two samples in the first hour bucket, one in the second, none in
    // the rest. Cumulative semantics: the bucket value is the sum of
    // every sample's counter inside that hour.
    const samples = [
      { timestamp: RANGE_24H_START + 5 * 60 * 1000, counters: { exhausted: 1 } },
      { timestamp: RANGE_24H_START + 30 * 60 * 1000, counters: { exhausted: 2 } },
      { timestamp: RANGE_24H_START + HOUR_MS + 10 * 60 * 1000, counters: { exhausted: 4 } },
    ];

    const buckets = bucketSamples(samples, ["exhausted"], "24h", "sum");

    expect(buckets).toHaveLength(24);
    expect(buckets[0].exhausted).toBe(3);
    expect(buckets[1].exhausted).toBe(4);
    // Empty buckets default to 0 — a missing tick really did contribute
    // zero increments, which is the meaningful answer for cumulative.
    for (let i = 2; i < 24; i++) {
      expect(buckets[i].exhausted).toBe(0);
    }
  });
});

describe("bucketSamples — max aggregation (gauge counters)", () => {
  it("returns the maximum gauge reading observed inside each bucket", () => {
    // Three samples in bucket 0 with rising waiting gauges; one sample
    // in bucket 1; nothing afterwards. Max-per-bucket should surface
    // the peak inside each populated bucket.
    const samples = [
      { timestamp: RANGE_24H_START + 5 * 60 * 1000, counters: { waiting: 1 } },
      { timestamp: RANGE_24H_START + 20 * 60 * 1000, counters: { waiting: 4 } },
      { timestamp: RANGE_24H_START + 40 * 60 * 1000, counters: { waiting: 2 } },
      { timestamp: RANGE_24H_START + HOUR_MS + 10 * 60 * 1000, counters: { waiting: 7 } },
    ];

    const buckets = bucketSamples(samples, ["waiting"], "24h", "max");

    expect(buckets).toHaveLength(24);
    expect(buckets[0].waiting).toBe(4);
    expect(buckets[1].waiting).toBe(7);
  });

  it("leaves empty buckets as null so the sparkline shows a gap, not a misleading dip", () => {
    // A single sample lands in bucket 5. Every other bucket should be
    // null — gauges aren't counters, so a missing tick does NOT mean
    // "the gauge was zero", it means "we don't know what the gauge was".
    const samples = [
      { timestamp: RANGE_24H_START + 5 * HOUR_MS + 30 * 60 * 1000, counters: { active: 12 } },
    ];

    const buckets = bucketSamples(samples, ["active"], "24h", "max");

    expect(buckets[5].active).toBe(12);
    for (let i = 0; i < 24; i++) {
      if (i === 5) continue;
      expect(buckets[i].active).toBeNull();
    }
  });

  it("computes max per gauge independently when multiple gauges share the sample", () => {
    // Mirrors the real `samplePoolHealth` payload — `waiting` and
    // `active` are stamped on the same sample. Each should be folded
    // independently with max-per-bucket.
    const samples = [
      { timestamp: RANGE_24H_START + 10 * 60 * 1000, counters: { waiting: 0, active: 3 } },
      { timestamp: RANGE_24H_START + 20 * 60 * 1000, counters: { waiting: 2, active: 1 } },
      { timestamp: RANGE_24H_START + 50 * 60 * 1000, counters: { waiting: 1, active: 5 } },
    ];

    const buckets = bucketSamples(samples, ["waiting", "active"], "24h", "max");

    expect(buckets[0].waiting).toBe(2);
    expect(buckets[0].active).toBe(5);
  });
});

describe("bucketSamples — defaults", () => {
  it("defaults to sum aggregation so existing cumulative call sites keep their behavior", () => {
    // The historical signature `bucketSamples(samples, counters, range)`
    // must keep working after Task #2017 added the optional aggregation
    // parameter — otherwise every other JobCard chart silently changes
    // semantics.
    const samples = [
      { timestamp: RANGE_24H_START + 5 * 60 * 1000, counters: { sampled: 1 } },
      { timestamp: RANGE_24H_START + 6 * 60 * 1000, counters: { sampled: 1 } },
    ];

    const buckets = bucketSamples(samples, ["sampled"], "24h");

    expect(buckets[0].sampled).toBe(2);
    expect(buckets[1].sampled).toBe(0);
  });
});

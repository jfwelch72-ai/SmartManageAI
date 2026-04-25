/**
 * Task #2004 — Unit tests for the ObjectUploader formatting helpers and
 * the rolling-window throughput calculation.
 *
 * These helpers power the "MB / total, rate, ETA" overlay that users see
 * on multi-GB uploads (BIM, LiDAR, plan zips). The contracts locked in
 * here:
 *   - `formatBytes` switches units at 1 KiB / 1 MiB / 1 GiB and never
 *     prints a negative or NaN value.
 *   - `formatRate` returns an em-dash sentinel when the rate is unknown.
 *   - `formatEta` returns an em-dash sentinel when ETA is unknown,
 *     formats sub-minute as "Ns", sub-hour as "Mm SSs", and hour-plus
 *     as "Hh MMm".
 *   - `computeRollingThroughput` ignores samples older than the window,
 *     returns 0 B/s with fewer than two in-window samples, and handles
 *     clock skew / decreasing-bytes pathological inputs without
 *     surfacing negative throughput.
 */
import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatRate,
  formatEta,
  computeRollingThroughput,
  ROLLING_WINDOW_MS,
} from "../ObjectUploader.helpers";

describe("formatBytes", () => {
  it("returns '0 B' for zero, negative, and non-finite inputs", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-100)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("formats sub-KiB values as plain bytes (no decimals)", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches to KB at 1024 bytes and uses one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("switches to MB at 1 MiB and uses one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50.0 MB");
    expect(formatBytes(256 * 1024 * 1024)).toBe("256.0 MB");
  });

  it("switches to GB at 1 GiB and uses two decimals", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
    expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe("10.00 GB");
  });
});

describe("formatRate", () => {
  it("returns '—' when throughput is unknown / zero / non-finite", () => {
    expect(formatRate(0)).toBe("—");
    expect(formatRate(-1)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("appends '/s' to the formatted byte rate", () => {
    expect(formatRate(500)).toBe("500 B/s");
    expect(formatRate(1024)).toBe("1.0 KB/s");
    expect(formatRate(5 * 1024 * 1024)).toBe("5.0 MB/s");
    expect(formatRate(1024 * 1024 * 1024)).toBe("1.00 GB/s");
  });
});

describe("formatEta", () => {
  it("returns '—' for zero, negative, and non-finite seconds", () => {
    expect(formatEta(0)).toBe("—");
    expect(formatEta(-5)).toBe("—");
    expect(formatEta(Number.NaN)).toBe("—");
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats sub-minute as 'Ns' (rounded)", () => {
    expect(formatEta(1)).toBe("1s");
    expect(formatEta(45.4)).toBe("45s");
    expect(formatEta(59)).toBe("59s");
  });

  it("formats sub-hour as 'Mm SSs' with zero-padded seconds", () => {
    expect(formatEta(60)).toBe("1m 00s");
    expect(formatEta(65)).toBe("1m 05s");
    expect(formatEta(125)).toBe("2m 05s");
    expect(formatEta(59 * 60 + 59)).toBe("59m 59s");
  });

  it("formats hour-plus as 'Hh MMm' with zero-padded minutes", () => {
    expect(formatEta(3600)).toBe("1h 00m");
    expect(formatEta(3600 + 5 * 60)).toBe("1h 05m");
    expect(formatEta(2 * 3600 + 30 * 60 + 15)).toBe("2h 30m");
  });
});

describe("computeRollingThroughput", () => {
  it("returns 0 B/s when given zero samples", () => {
    const result = computeRollingThroughput([], 10_000);
    expect(result.bytesPerSecond).toBe(0);
    expect(result.samples).toEqual([]);
  });

  it("returns 0 B/s with only a single in-window sample", () => {
    const samples = [{ t: 9_500, bytes: 1_000_000 }];
    const result = computeRollingThroughput(samples, 10_000);
    expect(result.bytesPerSecond).toBe(0);
    expect(result.samples).toEqual(samples);
  });

  it("computes bytes-per-second from the first and last in-window samples", () => {
    // 10 MB transferred over 2 seconds → 5 MB/s
    const samples = [
      { t: 8_000, bytes: 0 },
      { t: 9_000, bytes: 5 * 1024 * 1024 },
      { t: 10_000, bytes: 10 * 1024 * 1024 },
    ];
    const result = computeRollingThroughput(samples, 10_000);
    expect(result.bytesPerSecond).toBeCloseTo(5 * 1024 * 1024, 5);
    expect(result.samples).toHaveLength(3);
  });

  it("trims samples older than the rolling window", () => {
    const now = 100_000;
    const samples = [
      { t: now - ROLLING_WINDOW_MS - 5_000, bytes: 0 }, // expired
      { t: now - ROLLING_WINDOW_MS - 1, bytes: 1_000 }, // expired by 1ms
      { t: now - 4_000, bytes: 2_000_000 }, // in window
      { t: now - 1_000, bytes: 5_000_000 }, // in window
    ];
    const result = computeRollingThroughput(samples, now);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].bytes).toBe(2_000_000);
    expect(result.samples[1].bytes).toBe(5_000_000);
    // 3 MB over 3 seconds → 1 MB/s
    expect(result.bytesPerSecond).toBeCloseTo(1_000_000, 0);
  });

  it("returns 0 B/s when only one sample remains after trimming", () => {
    const now = 100_000;
    const samples = [
      { t: now - ROLLING_WINDOW_MS - 100, bytes: 0 }, // expired
      { t: now - 500, bytes: 5_000_000 }, // in window
    ];
    const result = computeRollingThroughput(samples, now);
    expect(result.samples).toHaveLength(1);
    expect(result.bytesPerSecond).toBe(0);
  });

  it("returns 0 B/s when bytes appear to decrease (defensive)", () => {
    const samples = [
      { t: 9_000, bytes: 5_000_000 },
      { t: 10_000, bytes: 4_000_000 }, // shouldn't happen, but be safe
    ];
    const result = computeRollingThroughput(samples, 10_000);
    expect(result.bytesPerSecond).toBe(0);
  });

  it("returns 0 B/s when two samples share an identical timestamp", () => {
    const samples = [
      { t: 10_000, bytes: 1_000_000 },
      { t: 10_000, bytes: 2_000_000 },
    ];
    const result = computeRollingThroughput(samples, 10_000);
    expect(result.bytesPerSecond).toBe(0);
  });

  it("honors a custom window size", () => {
    const samples = [
      { t: 0, bytes: 0 },
      { t: 500, bytes: 1_000 }, // outside a 200ms window
      { t: 900, bytes: 2_000 },
      { t: 1_000, bytes: 3_000 },
    ];
    const result = computeRollingThroughput(samples, 1_000, 200);
    expect(result.samples).toHaveLength(2);
    expect(result.samples.map((s) => s.t)).toEqual([900, 1_000]);
    // 1_000 bytes over 0.1s = 10_000 B/s
    expect(result.bytesPerSecond).toBeCloseTo(10_000, 0);
  });
});

/**
 * Task #2004 — Pure helpers for the ObjectUploader progress overlay.
 *
 * Extracted from `ObjectUploader.tsx` so the formatting helpers and the
 * rolling-window throughput calculation can be unit-tested in isolation
 * (no React, no Uppy). The component imports and re-exports these so its
 * runtime behavior is unchanged.
 */

export const ROLLING_WINDOW_MS = 5000;

export interface ThroughputSample {
  /** Wall-clock timestamp in milliseconds (Date.now()-style). */
  t: number;
  /** Cumulative bytes uploaded across all in-flight files at time `t`. */
  bytes: number;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const remainingM = m - h * 60;
  return `${h}h ${remainingM.toString().padStart(2, "0")}m`;
}

/**
 * Compute throughput over a rolling time window from cumulative-bytes
 * samples. Returns the bytesPerSecond value plus the trimmed sample
 * window (samples older than `windowMs` removed) so the caller can keep
 * memory bounded.
 *
 * Invariants:
 *   - Fewer than 2 samples in the window → 0 B/s
 *   - Negative `db` (cumulative bytes shouldn't decrease) → 0 B/s
 *   - Zero or negative `dt` (clock skew, identical timestamps) → 0 B/s
 */
export function computeRollingThroughput(
  samples: ThroughputSample[],
  nowMs: number,
  windowMs: number = ROLLING_WINDOW_MS,
): { bytesPerSecond: number; samples: ThroughputSample[] } {
  const cutoff = nowMs - windowMs;
  const filtered = samples.filter((s) => s.t >= cutoff);
  if (filtered.length < 2) {
    return { bytesPerSecond: 0, samples: filtered };
  }
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const dt = (last.t - first.t) / 1000;
  const db = last.bytes - first.bytes;
  const bytesPerSecond = dt > 0 && db > 0 ? db / dt : 0;
  return { bytesPerSecond, samples: filtered };
}
